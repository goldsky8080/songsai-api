import { createHash, randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getVerificationBaseUrl() {
  return getEnv().EMAIL_VERIFY_BASE_URL ?? getEnv().FRONTEND_URL ?? getEnv().APP_URL;
}

function getVerificationTtlMinutes() {
  const configured = Number.parseInt(getEnv().EMAIL_VERIFY_TOKEN_TTL_MINUTES ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 60 * 24;
}

function getPasswordResetBaseUrl() {
  return getEnv().PASSWORD_RESET_BASE_URL ?? getEnv().FRONTEND_URL ?? getEnv().APP_URL;
}

function getPasswordResetTtlMinutes() {
  const configured = Number.parseInt(getEnv().PASSWORD_RESET_TOKEN_TTL_MINUTES ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 60;
}

function getResendConfig() {
  const env = getEnv();
  return {
    apiKey: env.RESEND_API_KEY ?? null,
    fromEmail: env.RESEND_FROM_EMAIL ?? null,
  };
}

async function sendResendEmail(params: {
  toEmail: string;
  subject: string;
  html: string;
  text: string;
}) {
  const { apiKey, fromEmail } = getResendConfig();

  if (!apiKey || !fromEmail) {
    throw new Error("Email delivery is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `SongsAI <${fromEmail}>`,
      to: [params.toEmail],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || "Failed to send email.");
  }

  return response.json().catch(() => null);
}

function buildEmailShell(contentHtml: string) {
  return `
    <div style="font-family:Arial,sans-serif;background:#0b1020;color:#f8fafc;padding:32px;">
      <div style="max-width:560px;margin:0 auto;background:#12192b;border:1px solid rgba(255,255,255,0.12);padding:32px;">
        <h1 style="margin:0 0 16px;font-size:28px;letter-spacing:0.08em;">SongsAI</h1>
        ${contentHtml}
      </div>
    </div>
  `;
}

export function isEmailVerificationConfigured() {
  const { apiKey, fromEmail } = getResendConfig();
  return Boolean(apiKey && fromEmail);
}

export function isPasswordResetConfigured() {
  return isEmailVerificationConfigured();
}

export async function createEmailVerificationToken(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + getVerificationTtlMinutes() * 60 * 1000);

  await db.emailVerificationToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  return {
    rawToken,
    expiresAt,
  };
}

export function buildEmailVerificationUrl(rawToken: string, nextPath?: string | null) {
  const baseUrl = new URL("/api/v1/auth/verify-email", getVerificationBaseUrl());
  baseUrl.searchParams.set("token", rawToken);

  if (nextPath && nextPath.startsWith("/")) {
    baseUrl.searchParams.set("next", nextPath);
  }

  return baseUrl.toString();
}

export async function createPasswordResetToken(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + getPasswordResetTtlMinutes() * 60 * 1000);

  await db.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  return {
    rawToken,
    expiresAt,
  };
}

export function buildPasswordResetUrl(rawToken: string, nextPath?: string | null) {
  const baseUrl = new URL("/reset-password", getPasswordResetBaseUrl());
  baseUrl.searchParams.set("token", rawToken);

  if (nextPath && nextPath.startsWith("/")) {
    baseUrl.searchParams.set("next", nextPath);
  }

  return baseUrl.toString();
}

export async function sendVerificationEmail(params: {
  toEmail: string;
  name?: string | null;
  verifyUrl: string;
}) {
  const displayName = params.name?.trim() || params.toEmail;

  return sendResendEmail({
    toEmail: params.toEmail,
    subject: "SongsAI 이메일 인증을 완료해 주세요",
    html: buildEmailShell(`
      <p style="margin:0 0 12px;font-size:16px;line-height:1.7;">${displayName}님, 회원가입을 마무리하려면 아래 버튼을 눌러 이메일 인증을 완료해 주세요.</p>
      <p style="margin:0 0 28px;font-size:14px;line-height:1.7;color:#cbd5e1;">버튼이 열리지 않으면 아래 링크를 브라우저에 붙여 넣어도 됩니다.</p>
      <p style="margin:0 0 28px;">
        <a href="${params.verifyUrl}" style="display:inline-block;padding:14px 24px;background:#ffd6e7;color:#101726;text-decoration:none;font-weight:700;">이메일 인증하기</a>
      </p>
      <p style="margin:0 0 10px;font-size:13px;color:#cbd5e1;word-break:break-all;">${params.verifyUrl}</p>
    `),
    text: `SongsAI 이메일 인증 링크: ${params.verifyUrl}`,
  });
}

export async function sendPasswordResetEmail(params: {
  toEmail: string;
  name?: string | null;
  resetUrl: string;
}) {
  const displayName = params.name?.trim() || params.toEmail;

  return sendResendEmail({
    toEmail: params.toEmail,
    subject: "SongsAI 비밀번호 재설정",
    html: buildEmailShell(`
      <p style="margin:0 0 12px;font-size:16px;line-height:1.7;">${displayName}님, 비밀번호를 다시 설정하려면 아래 버튼을 눌러 주세요.</p>
      <p style="margin:0 0 28px;font-size:14px;line-height:1.7;color:#cbd5e1;">직접 요청하지 않았다면 이 메일은 무시해도 됩니다.</p>
      <p style="margin:0 0 28px;">
        <a href="${params.resetUrl}" style="display:inline-block;padding:14px 24px;background:#ffd6e7;color:#101726;text-decoration:none;font-weight:700;">비밀번호 재설정</a>
      </p>
      <p style="margin:0 0 10px;font-size:13px;color:#cbd5e1;word-break:break-all;">${params.resetUrl}</p>
    `),
    text: `SongsAI 비밀번호 재설정 링크: ${params.resetUrl}`,
  });
}

export async function verifyEmailToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);

  const token = await db.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!token) {
    return { ok: false as const, reason: "invalid" as const };
  }

  if (token.usedAt) {
    return { ok: false as const, reason: "used" as const };
  }

  if (token.expiresAt.getTime() < Date.now()) {
    return { ok: false as const, reason: "expired" as const };
  }

  const updatedUser = await db.$transaction(async (tx) => {
    await tx.emailVerificationToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    return tx.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: new Date() },
    });
  });

  return {
    ok: true as const,
    user: updatedUser,
  };
}

export async function resetPasswordWithToken(params: { rawToken: string; passwordHash: string }) {
  const tokenHash = hashToken(params.rawToken);

  const token = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!token) {
    return { ok: false as const, reason: "invalid" as const };
  }

  if (token.usedAt) {
    return { ok: false as const, reason: "used" as const };
  }

  if (token.expiresAt.getTime() < Date.now()) {
    return { ok: false as const, reason: "expired" as const };
  }

  await db.$transaction(async (tx) => {
    await tx.passwordResetToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    await tx.user.update({
      where: { id: token.userId },
      data: { passwordHash: params.passwordHash },
    });
  });

  return { ok: true as const };
}
