import { InboundEmailStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/http";
import { listInboundEmails } from "@/server/email/inbound";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders },
    );
  }

  if (sessionUser.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: corsHeaders },
    );
  }

  const limitParam = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
  const offsetParam = Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "", 10);
  const statusParam = request.nextUrl.searchParams.get("status");

  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 30;
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;
  const status = Object.values(InboundEmailStatus).includes(statusParam as InboundEmailStatus)
    ? (statusParam as InboundEmailStatus)
    : undefined;

  const { items, total } = await listInboundEmails({
    limit,
    offset,
    status,
  });

  return NextResponse.json(
    {
      items,
      total,
      limit,
      offset,
      status: status ?? null,
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
