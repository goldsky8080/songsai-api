import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { InboundEmail, InboundEmailStatus, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";

type MaybeRecord = Record<string, unknown>;
type NormalizedInboundAttachment = {
  filename: string;
  contentType: string | null;
  size: number | null;
  bytes: Uint8Array | null;
};

const INBOUND_ATTACHMENT_DIR = path.join(process.cwd(), "storage", "inbound-email-attachments");

function asRecord(value: unknown): MaybeRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as MaybeRecord) : null;
}

function pickString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickEmailFromAddress(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const matched = trimmed.match(/<([^>]+)>/);
    return matched?.[1]?.trim() || trimmed;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return pickString(record.email) || pickString(record.address);
}

function pickNameFromAddress(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return pickString(record.name);
}

function pickFirstAddress(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const email = pickEmailFromAddress(item);
      if (email) {
        return {
          email,
          name: pickNameFromAddress(item),
        };
      }
    }

    return null;
  }

  const email = pickEmailFromAddress(value);
  if (!email) {
    return null;
  }

  return {
    email,
    name: pickNameFromAddress(value),
  };
}

function parseReceivedAt(value: unknown) {
  const stringValue = pickString(value);
  if (!stringValue) {
    return new Date();
  }

  const parsed = new Date(stringValue);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getAttachmentFilename(value: unknown, index: number) {
  const record = asRecord(value);
  const filename =
    pickString(record?.filename) ||
    pickString(record?.name) ||
    pickString(record?.fileName) ||
    `attachment-${index + 1}.bin`;

  return filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

function getAttachmentContentType(value: unknown) {
  const record = asRecord(value);
  return (
    pickString(record?.contentType) ||
    pickString(record?.content_type) ||
    pickString(record?.mimeType) ||
    pickString(record?.type) ||
    null
  );
}

function getAttachmentBytes(value: unknown) {
  const record = asRecord(value);
  const base64Content =
    pickString(record?.base64) ||
    pickString(record?.base64Content) ||
    pickString(record?.contentBase64) ||
    pickString(record?.data);

  if (base64Content) {
    try {
      return new Uint8Array(Buffer.from(base64Content, "base64"));
    } catch {
      return null;
    }
  }

  const textContent =
    pickString(record?.content) ||
    pickString(record?.text);

  if (textContent) {
    return new TextEncoder().encode(textContent);
  }

  return null;
}

function normalizeInboundAttachments(payload: unknown) {
  const record = asRecord(payload) ?? {};
  const attachmentsCandidate =
    record.attachments ??
    asRecord(record.data)?.attachments ??
    asRecord(record.email)?.attachments;

  if (!Array.isArray(attachmentsCandidate)) {
    return [] as NormalizedInboundAttachment[];
  }

  return attachmentsCandidate
    .map((item, index) => {
      const bytes = getAttachmentBytes(item);
      const recordItem = asRecord(item);
      const sizeValue =
        typeof recordItem?.size === "number"
          ? recordItem.size
          : typeof recordItem?.contentLength === "number"
            ? recordItem.contentLength
            : bytes?.byteLength ?? null;

      return {
        filename: getAttachmentFilename(item, index),
        contentType: getAttachmentContentType(item),
        size: sizeValue,
        bytes,
      } satisfies NormalizedInboundAttachment;
    })
    .filter((item) => item.filename);
}

async function ensureInboundAttachmentDir() {
  await mkdir(INBOUND_ATTACHMENT_DIR, { recursive: true });
}

async function saveInboundAttachmentFile(params: {
  inboundEmailId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  await ensureInboundAttachmentDir();
  const storagePath = path.join(
    INBOUND_ATTACHMENT_DIR,
    `${params.inboundEmailId}-${randomUUID()}-${params.filename}`,
  );
  await writeFile(storagePath, params.bytes);
  return storagePath;
}

export function isInboundWebhookAuthorized(request: Request) {
  const secret = getEnv().INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }

  const headerSecret =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("x-songsai-webhook-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    new URL(request.url).searchParams.get("secret");

  return headerSecret === secret;
}

export function normalizeInboundEmailPayload(payload: unknown) {
  const record = asRecord(payload) ?? {};
  const fromCandidate =
    record.from ??
    record.sender ??
    record.from_email ??
    record.fromEmail;
  const toCandidate =
    record.to ??
    record.recipients ??
    record.to_email ??
    record.toEmail ??
    getEnv().SUPPORT_INBOX_EMAIL;

  const fromAddress = pickFirstAddress(fromCandidate);
  const toAddress = pickFirstAddress(toCandidate);

  const messageId =
    pickString(record.message_id) ||
    pickString(record.messageId) ||
    pickString(record.id);

  return {
    messageId,
    fromEmail: fromAddress?.email || "unknown@songsai.org",
    fromName: fromAddress?.name || null,
    toEmail: toAddress?.email || getEnv().SUPPORT_INBOX_EMAIL || "support@songsai.org",
    subject: pickString(record.subject),
    textBody:
      pickString(record.text) ||
      pickString(record.textBody) ||
      pickString(record.plain) ||
      null,
    htmlBody:
      pickString(record.html) ||
      pickString(record.htmlBody) ||
      null,
    receivedAt: parseReceivedAt(record.received_at ?? record.receivedAt ?? record.created_at ?? record.createdAt),
    attachments: normalizeInboundAttachments(payload),
    rawPayload: payload ?? {},
  };
}

export async function saveInboundEmail(payload: unknown) {
  const normalized = normalizeInboundEmailPayload(payload);
  const { attachments, ...emailData } = normalized;

  const email = normalized.messageId
    ? await db.inboundEmail.upsert({
        where: { messageId: normalized.messageId },
        update: {
          fromEmail: normalized.fromEmail,
          fromName: normalized.fromName,
          toEmail: normalized.toEmail,
          subject: normalized.subject,
          textBody: normalized.textBody,
          htmlBody: normalized.htmlBody,
          receivedAt: normalized.receivedAt,
          rawPayload: normalized.rawPayload,
        },
        create: emailData,
      })
    : await db.inboundEmail.create({
        data: emailData,
      });

  if (attachments.length > 0) {
    await db.inboundEmailAttachment.deleteMany({
      where: { inboundEmailId: email.id },
    });

    for (const attachment of attachments) {
      const storagePath =
        attachment.bytes && attachment.bytes.byteLength > 0
          ? await saveInboundAttachmentFile({
              inboundEmailId: email.id,
              filename: attachment.filename,
              bytes: attachment.bytes,
            })
          : null;

      await db.inboundEmailAttachment.create({
        data: {
          inboundEmailId: email.id,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          storagePath,
        },
      });
    }
  }

  return db.inboundEmail.findUniqueOrThrow({
    where: { id: email.id },
    include: {
      attachments: true,
    },
  });
}

export async function listInboundEmails(params: { limit: number; offset: number; status?: InboundEmailStatus }) {
  const where: Prisma.InboundEmailWhereInput | undefined = params.status
    ? {
        status: params.status,
      }
    : undefined;

  const [items, total] = await Promise.all([
    db.inboundEmail.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: params.offset,
      take: params.limit,
    }),
    db.inboundEmail.count({ where }),
  ]);

  return { items, total };
}

export async function getInboundEmail(id: string) {
  return db.inboundEmail.findUnique({
    where: { id },
    include: {
      attachments: true,
    },
  });
}

export async function updateInboundEmailStatus(id: string, status: InboundEmailStatus): Promise<InboundEmail> {
  return db.inboundEmail.update({
    where: { id },
    data: { status },
  });
}
