import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  AUTH_COOKIE_NAME,
  GOOGLE_AUTH_STATE_COOKIE_NAME,
  buildOAuthStateCookieOptions,
  buildSessionCookieOptions,
  createSessionToken,
} from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
const GOOGLE_REDIRECT_COOKIE_NAME = "songsai-api-google-redirect";

type GoogleTokenResponse = {
  access_token: string;
};

type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
};

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

function buildFrontendRedirect(pathname: string, params?: Record<string, string>) {
  const env = getEnv();
  const redirectCookieValue = cookies().get(GOOGLE_REDIRECT_COOKIE_NAME)?.value;
  const allowedOrigins = getAllowedFrontendOrigins();
  const baseUrl =
    (redirectCookieValue && allowedOrigins.includes(redirectCookieValue) ? redirectCookieValue : null) ??
    allowedOrigins[0] ??
    env.APP_URL;
  const url = new URL(pathname, baseUrl);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

export async function GET(request: NextRequest) {
  const env = getEnv();

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ error: "Google login is not configured." }, { status: 500 });
  }

  const expectedState = request.cookies.get(GOOGLE_AUTH_STATE_COOKIE_NAME)?.value;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(buildFrontendRedirect("/login", { authError: oauthError }));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(buildFrontendRedirect("/login", { authError: "google_state_invalid" }));
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: buildGoogleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.redirect(buildFrontendRedirect("/login", { authError: "google_token_failed" }));
  }

  const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;
  const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userInfoResponse.ok) {
    return NextResponse.redirect(buildFrontendRedirect("/login", { authError: "google_userinfo_failed" }));
  }

  const userInfo = (await userInfoResponse.json()) as GoogleUserInfo;

  if (!userInfo.email || !userInfo.email_verified) {
    return NextResponse.redirect(buildFrontendRedirect("/login", { authError: "google_email_not_verified" }));
  }

  const email = userInfo.email.trim().toLowerCase();

  const user = await db.$transaction(async (tx) => {
    const linkedUser = await tx.user.findUnique({ where: { googleId: userInfo.sub } });

    if (linkedUser) {
      return linkedUser;
    }

    const existingUser = await tx.user.findUnique({ where: { email } });

    if (existingUser) {
      return tx.user.update({
        where: { id: existingUser.id },
        data: {
          googleId: userInfo.sub,
          name: existingUser.name ?? userInfo.name,
          profileImage: existingUser.profileImage ?? userInfo.picture,
        },
      });
    }

    return tx.user.create({
      data: {
        email,
        googleId: userInfo.sub,
        passwordHash: `google-oauth:${randomUUID()}`,
        name: userInfo.name,
        profileImage: userInfo.picture,
      },
    });
  });

  const token = await createSessionToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  const response = NextResponse.redirect(buildFrontendRedirect("/"));
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    ...buildSessionCookieOptions(60 * 60 * 24 * 7),
  });
  response.cookies.set({
    name: GOOGLE_AUTH_STATE_COOKIE_NAME,
    value: "",
    ...buildOAuthStateCookieOptions(0),
  });
  response.cookies.set({
    name: GOOGLE_REDIRECT_COOKIE_NAME,
    value: "",
    ...buildOAuthStateCookieOptions(0),
  });

  return response;
}
