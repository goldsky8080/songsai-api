import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

import { buildCorsHeaders } from "@/lib/http";
import { resetPasswordSchema } from "@/server/auth/schema";
import { resetPasswordWithToken } from "@/server/email/verification";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);
  const body = await request.json();
  const parsed = resetPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: corsHeaders },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const result = await resetPasswordWithToken({
    rawToken: parsed.data.token,
    passwordHash,
  });

  if (!result.ok) {
    const status = result.reason === "invalid" ? 400 : 410;
    const messageMap = {
      invalid: "재설정 링크가 올바르지 않습니다.",
      expired: "재설정 링크가 만료되었습니다.",
      used: "이미 사용된 재설정 링크입니다.",
    } as const;

    return NextResponse.json(
      { error: messageMap[result.reason] },
      { status, headers: corsHeaders },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message: "비밀번호가 재설정되었습니다. 다시 로그인해 주세요.",
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
