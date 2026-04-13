import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/http";
import { toPublicUser } from "@/server/auth/user";

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

  if (sessionUser.role !== "ADMIN" && sessionUser.role !== "DEVELOPER") {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: corsHeaders },
    );
  }

  const limitParam = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
  const offsetParam = Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

  const [items, total] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    db.user.count(),
  ]);

  return NextResponse.json(
    {
      items: items.map(toPublicUser),
      total,
      limit,
      offset,
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
