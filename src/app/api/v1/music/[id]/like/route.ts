import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

async function getMusicLikeState(id: string, userId: string) {
  const [likeCount, liked] = await Promise.all([
    db.musicLike.count({
      where: { musicId: id },
    }),
    db.musicLike.findFirst({
      where: {
        musicId: id,
        userId,
      },
      select: { id: true },
    }),
  ]);

  return {
    likeCount,
    likedByMe: Boolean(liked),
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: buildCorsHeaders(request) });
  }

  const { id } = await context.params;
  const music = await db.music.findUnique({
    where: { id },
    select: { id: true, isPublic: true },
  });

  if (!music || !music.isPublic) {
    return NextResponse.json({ error: "Music not found." }, { status: 404, headers: buildCorsHeaders(request) });
  }

  try {
    await db.musicLike.create({
      data: {
        musicId: id,
        userId: sessionUser.id,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
  }

  return NextResponse.json(await getMusicLikeState(id, sessionUser.id), {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: buildCorsHeaders(request) });
  }

  const { id } = await context.params;

  await db.musicLike.deleteMany({
    where: {
      musicId: id,
      userId: sessionUser.id,
    },
  });

  return NextResponse.json(await getMusicLikeState(id, sessionUser.id), {
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
