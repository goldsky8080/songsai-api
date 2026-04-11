import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/http";
import { toPublicUser } from "@/server/auth/user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: buildCorsHeaders(request) },
    );
  }

  const user = await db.user.findUnique({ where: { id: sessionUser.id } });

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: buildCorsHeaders(request) },
    );
  }

  return NextResponse.json(
    { user: toPublicUser(user) },
    { status: 200, headers: buildCorsHeaders(request) },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}