import { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";

function getAllowedOrigins() {
  const env = getEnv();
  const extraOrigins = env.FRONTEND_URLS
    ? env.FRONTEND_URLS.split(",").map((value) => value.trim()).filter(Boolean)
    : [];

  return Array.from(new Set([env.FRONTEND_URL, env.APP_URL, ...extraOrigins].filter(Boolean)));
}

function getAllowedOrigin(origin: string | null) {
  if (!origin) {
    return null;
  }

  const allowedOrigins = getAllowedOrigins();

  return allowedOrigins.includes(origin) ? origin : null;
}

export function buildCorsHeaders(request: NextRequest) {
  const origin = getAllowedOrigin(request.headers.get("origin"));
  const fallbackOrigin = getAllowedOrigins()[0] ?? getEnv().APP_URL;

  return {
    "Access-Control-Allow-Origin": origin ?? fallbackOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
    Vary: "Origin",
  };
}
