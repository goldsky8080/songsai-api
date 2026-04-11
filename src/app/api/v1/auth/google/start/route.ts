import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildOAuthStateCookieOptions, GOOGLE_AUTH_STATE_COOKIE_NAME } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
const GOOGLE_REDIRECT_COOKIE_NAME = "songsai-api-google-redirect";

function buildGoogleRedirectUri() {
  return `${getEnv().APP_URL}/api/v1/auth/google/callback`;
}

function getAllowedFrontendOrigins() {
  const env = getEnv();
  const extraOrigins = env.FRONTEND_URLS
    ? env.FRONTEND_URLS.split(",").map((value) => value.trim()).filter(Boolean)
    : [];

  return Array.from(new Set([env.FRONTEND_URL, ...extraOrigins].filter(Boolean)));
}

function resolveRedirectOrigin(request: NextRequest) {
  const requestedOrigin = request.nextUrl.searchParams.get("redirectTo")?.trim();

  if (requestedOrigin && getAllowedFrontendOrigins().includes(requestedOrigin)) {
    return requestedOrigin;
  }

  return getAllowedFrontendOrigins()[0] ?? getEnv().APP_URL;
}

export async function GET(request: NextRequest) {
  const env = getEnv();

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ error: "Google login is not configured." }, { status: 500 });
  }

  const state = randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", buildGoogleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(url);
  const redirectOrigin = resolveRedirectOrigin(request);

  response.cookies.set({
    name: GOOGLE_AUTH_STATE_COOKIE_NAME,
    value: state,
    ...buildOAuthStateCookieOptions(60 * 10),
  });
  response.cookies.set({
    name: GOOGLE_REDIRECT_COOKIE_NAME,
    value: redirectOrigin,
    ...buildOAuthStateCookieOptions(60 * 10),
  });

  return response;
}
