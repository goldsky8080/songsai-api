import { InboundEmailStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/http";
import { getInboundEmail, updateInboundEmailStatus } from "@/server/email/inbound";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  status: z.nativeEnum(InboundEmailStatus),
});

async function requireAdmin(request: NextRequest) {
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

  return corsHeaders;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) {
    return admin;
  }

  const { id } = await context.params;
  const item = await getInboundEmail(id);

  if (!item) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: admin },
    );
  }

  return NextResponse.json(item, { status: 200, headers: admin });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) {
    return admin;
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: admin },
    );
  }

  const { id } = await context.params;
  const existing = await getInboundEmail(id);

  if (!existing) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: admin },
    );
  }

  const item = await updateInboundEmailStatus(id, parsed.data.status);

  return NextResponse.json(item, { status: 200, headers: admin });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
