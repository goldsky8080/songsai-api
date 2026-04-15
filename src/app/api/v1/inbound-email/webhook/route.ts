import { NextRequest, NextResponse } from "next/server";

import { buildCorsHeaders } from "@/lib/http";
import { isInboundWebhookAuthorized, saveInboundEmail } from "@/server/email/inbound";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);

  if (!isInboundWebhookAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400, headers: corsHeaders },
    );
  }

  const email = await saveInboundEmail(payload);

  return NextResponse.json(
    {
      ok: true,
      id: email.id,
    },
    { status: 200, headers: corsHeaders },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
