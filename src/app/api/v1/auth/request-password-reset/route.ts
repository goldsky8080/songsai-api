import { NextRequest, NextResponse } from "next/server";

import { buildCorsHeaders } from "@/lib/http";
import { db } from "@/lib/db";
import { requestPasswordResetSchema } from "@/server/auth/schema";
import {
  buildPasswordResetUrl,
  createPasswordResetToken,
  isPasswordResetConfigured,
  sendPasswordResetEmail,
} from "@/server/email/verification";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);
  const body = await request.json();
  const parsed = requestPasswordResetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: corsHeaders },
    );
  }

  if (!isPasswordResetConfigured()) {
    return NextResponse.json(
      { error: "Password reset email is not configured." },
      { status: 503, headers: corsHeaders },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });

  if (!user || !user.emailVerifiedAt) {
    return NextResponse.json(
      {
        ok: true,
        message: "가입된 이메일이면 비밀번호 재설정 메일을 보냈습니다.",
      },
      { status: 200, headers: corsHeaders },
    );
  }

  const token = await createPasswordResetToken(user.id);
  const resetUrl = buildPasswordResetUrl(token.rawToken, request.nextUrl.searchParams.get("next"));

  await sendPasswordResetEmail({
    toEmail: user.email,
    name: user.name,
    resetUrl,
  });

  return NextResponse.json(
    {
      ok: true,
      message: "가입된 이메일이면 비밀번호 재설정 메일을 보냈습니다.",
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
