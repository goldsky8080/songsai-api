import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, buildSessionCookieOptions } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const response = NextResponse.json(
    { ok: true },
    { status: 200, headers: buildCorsHeaders(request) },
  );

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    ...buildSessionCookieOptions(0),
  });

  return response;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}