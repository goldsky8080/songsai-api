import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

const updateVisibilitySchema = z.object({
  isPublic: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: buildCorsHeaders(request) });
  }

  const { id } = await context.params;
  const body = await request.json();
  const parsed = updateVisibilitySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: buildCorsHeaders(request) });
  }

  const music = await db.music.findFirst({
    where: {
      id,
      userId: sessionUser.id,
    },
    select: {
      id: true,
      isPublic: true,
    },
  });

  if (!music) {
    return NextResponse.json({ error: "Music not found." }, { status: 404, headers: buildCorsHeaders(request) });
  }

  if (music.isPublic === parsed.data.isPublic) {
    return NextResponse.json(
      {
        item: {
          id: music.id,
          isPublic: music.isPublic,
        },
      },
      { status: 200, headers: buildCorsHeaders(request) },
    );
  }

  const updated = await db.music.update({
    where: { id: music.id },
    data: {
      isPublic: parsed.data.isPublic,
    },
    select: {
      id: true,
      isPublic: true,
    },
  });

  return NextResponse.json(
    {
      item: {
        id: updated.id,
        isPublic: updated.isPublic,
      },
    },
    { status: 200, headers: buildCorsHeaders(request) },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
