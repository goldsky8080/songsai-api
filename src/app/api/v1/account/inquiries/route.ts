import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();
  const corsHeaders = buildCorsHeaders(request);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const user = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, email: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const items = await db.inboundEmail.findMany({
    where: {
      OR: [
        { fromEmail: user.email },
        { rawPayload: { path: ["userId"], equals: user.id } },
      ],
    },
    orderBy: { receivedAt: "desc" },
    take: 12,
    select: {
      id: true,
      subject: true,
      textBody: true,
      status: true,
      receivedAt: true,
    },
  });

  return NextResponse.json(
    {
      items: items.map((item) => ({
        id: item.id,
        subject: item.subject,
        preview: item.textBody?.slice(0, 180) ?? "",
        status: item.status,
        receivedAt: item.receivedAt,
      })),
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
