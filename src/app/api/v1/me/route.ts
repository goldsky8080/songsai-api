import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { buildCorsHeaders } from "@/lib/http";
import { toPublicUser } from "@/server/auth/user";
import { updateProfileSchema } from "@/server/auth/schema";

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

export async function PATCH(request: NextRequest) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: buildCorsHeaders(request) },
    );
  }

  const body = await request.json();
  const parsed = updateProfileSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: buildCorsHeaders(request) },
    );
  }

  const user = await db.user.update({
    where: { id: sessionUser.id },
    data: { name: parsed.data.name },
  });

  return NextResponse.json(
    { user: toPublicUser(user), message: "프로필이 업데이트되었습니다." },
    { status: 200, headers: buildCorsHeaders(request) },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
