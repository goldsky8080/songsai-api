import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { changePasswordSchema } from "@/server/auth/schema";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionUser = await getSessionUser();
  const corsHeaders = buildCorsHeaders(request);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const body = await request.json();
  const parsed = changePasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: corsHeaders });
  }

  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return NextResponse.json(
      { error: "현재 비밀번호와 다른 새 비밀번호를 입력해 주세요." },
      { status: 400, headers: corsHeaders },
    );
  }

  const user = await db.user.findUnique({ where: { id: sessionUser.id } });

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const passwordMatches = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);

  if (!passwordMatches) {
    return NextResponse.json(
      { error: "현재 비밀번호가 올바르지 않습니다." },
      { status: 400, headers: corsHeaders },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return NextResponse.json(
    { ok: true, message: "비밀번호가 변경되었습니다." },
    { status: 200, headers: corsHeaders },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
