import { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";

function getAllowedOrigin(origin: string | null) {
  if (!origin) {
    return null;
  }

  const env = getEnv();
  const allowedOrigins = [env.FRONTEND_URL, env.APP_URL].filter(Boolean);

  return allowedOrigins.includes(origin) ? origin : null;
}

export function buildCorsHeaders(request: NextRequest) {
  const origin = getAllowedOrigin(request.headers.get("origin"));

  return {
    "Access-Control-Allow-Origin": origin ?? getEnv().FRONTEND_URL ?? getEnv().APP_URL,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}