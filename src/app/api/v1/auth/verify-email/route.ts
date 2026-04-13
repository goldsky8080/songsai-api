import { NextRequest, NextResponse } from "next/server";
import { buildCorsHeaders } from "@/lib/http";
import { getEnv } from "@/lib/env";
import { verifyEmailToken } from "@/server/email/verification";

export const dynamic = "force-dynamic";

function buildFrontendRedirect(pathname: string, params?: Record<string, string>) {
  const baseUrl = getEnv().FRONTEND_URL ?? getEnv().APP_URL;
  const url = new URL(pathname, baseUrl);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const nextPath = request.nextUrl.searchParams.get("next");

  if (!token) {
    return NextResponse.redirect(buildFrontendRedirect("/login", { verify: "invalid" }));
  }

  const result = await verifyEmailToken(token);

  if (!result.ok) {
    return NextResponse.redirect(
      buildFrontendRedirect("/login", {
        verify: result.reason,
      }),
    );
  }

  return NextResponse.redirect(
    buildFrontendRedirect(nextPath && nextPath.startsWith("/") ? nextPath : "/login", {
      verify: "success",
    }),
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
