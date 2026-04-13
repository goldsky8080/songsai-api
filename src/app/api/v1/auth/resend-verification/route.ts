import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { resendVerificationSchema } from "@/server/auth/schema";
import {
  buildEmailVerificationUrl,
  createEmailVerificationToken,
  isEmailVerificationConfigured,
  sendVerificationEmail,
} from "@/server/email/verification";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);
  const body = await request.json();
  const parsed = resendVerificationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: corsHeaders },
    );
  }

  if (!isEmailVerificationConfigured()) {
    return NextResponse.json(
      { error: "Email verification is not configured." },
      { status: 503, headers: corsHeaders },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });

  if (!user || user.emailVerifiedAt) {
    return NextResponse.json(
      {
        ok: true,
        message: "가입된 미인증 계정이면 인증 메일을 다시 보냈습니다.",
      },
      { status: 200, headers: corsHeaders },
    );
  }

  await db.emailVerificationToken.deleteMany({
    where: {
      userId: user.id,
      usedAt: null,
    },
  });

  const token = await createEmailVerificationToken(user.id);
  const verifyUrl = buildEmailVerificationUrl(token.rawToken, request.nextUrl.searchParams.get("next"));

  await sendVerificationEmail({
    toEmail: user.email,
    name: user.name,
    verifyUrl,
  });

  return NextResponse.json(
    {
      ok: true,
      message: "가입된 미인증 계정이면 인증 메일을 다시 보냈습니다.",
      verificationExpiresAt: token.expiresAt.toISOString(),
    },
    { status: 200, headers: corsHeaders },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
