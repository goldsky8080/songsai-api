import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AUTH_COOKIE_NAME, buildSessionCookieOptions, createSessionToken } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/http";
import { loginSchema } from "@/server/auth/schema";
import { toPublicUser } from "@/server/auth/user";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);
  const body = await request.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: corsHeaders },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });

  if (!user) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401, headers: corsHeaders },
    );
  }

  const passwordMatches = await bcrypt.compare(parsed.data.password, user.passwordHash);

  if (!passwordMatches) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401, headers: corsHeaders },
    );
  }

  if (!user.emailVerifiedAt) {
    return NextResponse.json(
      { error: "Please verify your email before logging in." },
      { status: 403, headers: corsHeaders },
    );
  }

  const token = await createSessionToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  const response = NextResponse.json(
    { user: toPublicUser(user) },
    { status: 200, headers: corsHeaders },
  );

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    ...buildSessionCookieOptions(60 * 60 * 24 * 7),
  });

  return response;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
