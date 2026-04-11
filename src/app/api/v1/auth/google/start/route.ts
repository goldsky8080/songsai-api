import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildOAuthStateCookieOptions, GOOGLE_AUTH_STATE_COOKIE_NAME } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

function buildGoogleRedirectUri() {
  return `${getEnv().APP_URL}/api/v1/auth/google/callback`;
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
  response.cookies.set({
    name: GOOGLE_AUTH_STATE_COOKIE_NAME,
    value: state,
    ...buildOAuthStateCookieOptions(60 * 10),
  });

  return response;
}