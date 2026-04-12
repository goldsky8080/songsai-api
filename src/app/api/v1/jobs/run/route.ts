import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { buildCorsHeaders } from "@/lib/http";
import { runMusicWorker } from "@/server/music/worker";

export const dynamic = "force-dynamic";

function isLocalRequest(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isAuthorizedWorkerRequest(request: NextRequest) {
  const env = getEnv();
  const configuredSecret = env.WORKER_SECRET;

  if (!configuredSecret) {
    return isLocalRequest(request);
  }

  return request.headers.get("x-worker-secret") === configuredSecret;
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: buildCorsHeaders(request) },
    );
  }

  const workerId = `manual-${randomUUID()}`;
  const result = await runMusicWorker(workerId);

  return NextResponse.json(result, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
