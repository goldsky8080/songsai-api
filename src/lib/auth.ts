import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";

export const AUTH_COOKIE_NAME = "songsai-api-session";
export const GOOGLE_AUTH_STATE_COOKIE_NAME = "songsai-api-google-state";

export type SessionUser = {
  id: string;
  email: string;
  role: "USER" | "DEVELOPER" | "ADMIN";
};

function getSecret() {
  return new TextEncoder().encode(getEnv().AUTH_SECRET);
}

function isSecureCookie() {
  return getEnv().APP_URL.startsWith("https://");
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT({
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export function buildSessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "none" as const,
    secure: isSecureCookie(),
    path: "/",
    maxAge,
  };
}

export function buildOAuthStateCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureCookie(),
    path: "/",
    maxAge,
  };
}

export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret());

  return {
    id: payload.sub ?? "",
    email: String(payload.email ?? ""),
    role:
      payload.role === "ADMIN"
        ? "ADMIN"
        : payload.role === "DEVELOPER"
          ? "DEVELOPER"
          : "USER",
  } satisfies SessionUser;
}

export async function getSessionUser() {
  const token = cookies().get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}
