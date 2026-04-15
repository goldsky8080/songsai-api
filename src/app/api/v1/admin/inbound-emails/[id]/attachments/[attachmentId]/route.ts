import { access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sanitizeFilenamePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "").trim() || "attachment";
}

function encodeDispositionFilename(fileName: string, fallbackName: string) {
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

type RouteContext = {
  params: Promise<{
    id: string;
    attachmentId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const corsHeaders = buildCorsHeaders(request);
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  if (sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders });
  }

  const { id, attachmentId } = await context.params;
  const attachment = await db.inboundEmailAttachment.findFirst({
    where: {
      id: attachmentId,
      inboundEmailId: id,
    },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404, headers: corsHeaders });
  }

  if (!attachment.storagePath) {
    return NextResponse.json(
      { error: "Attachment metadata is saved, but the file is not stored locally yet." },
      { status: 409, headers: corsHeaders },
    );
  }

  try {
    await access(attachment.storagePath);
  } catch {
    return NextResponse.json(
      { error: "Stored attachment file was not found." },
      { status: 404, headers: corsHeaders },
    );
  }

  const fileName = sanitizeFilenamePart(attachment.filename);
  const fallbackName = "attachment.bin";

  return new Response(Readable.toWeb(createReadStream(attachment.storagePath)) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": attachment.contentType ?? "application/octet-stream",
      "Content-Disposition": encodeDispositionFilename(fileName, fallbackName),
      "Cache-Control": "private, no-store",
    },
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
