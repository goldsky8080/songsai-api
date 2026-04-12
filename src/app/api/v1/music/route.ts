import { JobTargetType, JobType, MusicStatus, QueueStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { toMusicItem } from "@/server/music/mapper";
import { createMusicSchema } from "@/server/music/schema";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: buildCorsHeaders(request) },
    );
  }

  const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 20;

  const items = await db.music.findMany({
    where: {
      userId: sessionUser.id,
    },
    include: {
      videos: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
  });

  return NextResponse.json(
    { items: items.map((item) => toMusicItem(item, item.videos[0] ?? null)) },
    { status: 200, headers: buildCorsHeaders(request) },
  );
}

export async function POST(request: NextRequest) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: buildCorsHeaders(request) },
    );
  }

  const body = await request.json();
  const parsed = createMusicSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400, headers: buildCorsHeaders(request) },
    );
  }

  const requestGroupId = crypto.randomUUID();

  const created = await db.$transaction(async (tx) => {
    const music = await tx.music.create({
      data: {
        userId: sessionUser.id,
        requestGroupId,
        title: parsed.data.title,
        lyrics: parsed.data.lyrics,
        stylePrompt: parsed.data.stylePrompt,
        isMr: parsed.data.isMr,
        provider: "SUNO",
        status: MusicStatus.QUEUED,
        rawPayload: parsed.data,
      },
    });

    await tx.generationJob.create({
      data: {
        userId: sessionUser.id,
        musicId: music.id,
        targetType: JobTargetType.MUSIC,
        jobType: JobType.MUSIC_GENERATION,
        queueStatus: QueueStatus.QUEUED,
        priority: 100,
        maxAttempts: 3,
        runAfter: new Date(),
        payload: parsed.data,
      },
    });

    return music;
  });

  return NextResponse.json(
    { item: toMusicItem(created) },
    { status: 202, headers: buildCorsHeaders(request) },
  );
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
