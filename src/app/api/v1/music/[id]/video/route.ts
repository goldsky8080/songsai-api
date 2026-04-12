import { JobTargetType, JobType, QueueStatus, VideoStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { isDownloadReady } from "@/server/music/policy";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: buildCorsHeaders(request) });
  }

  const { id } = context.params;
  const music = await db.music.findFirst({
    where: {
      id,
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
  });

  if (!music) {
    return NextResponse.json({ error: "Music not found" }, { status: 404, headers: buildCorsHeaders(request) });
  }

  if (!music.mp3Url) {
    return NextResponse.json(
      { error: "Audio is not ready yet." },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  if (!isDownloadReady(music.createdAt)) {
    return NextResponse.json(
      {
        error: "Video can be requested after the initial stabilization window.",
        downloadAvailableAt: new Date(music.createdAt.getTime() + 5 * 60 * 1000).toISOString(),
      },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  const existingVideo = music.videos[0] ?? null;
  if (existingVideo) {
    if (existingVideo.status === VideoStatus.COMPLETED && existingVideo.mp4Url) {
      return NextResponse.json(
        {
          item: {
            id: existingVideo.id,
            status: "completed",
            mp4Url: existingVideo.mp4Url,
          },
        },
      { status: 200, headers: buildCorsHeaders(request) },
      );
    }

    if (existingVideo.status === VideoStatus.QUEUED || existingVideo.status === VideoStatus.PROCESSING) {
      return NextResponse.json(
        {
          item: {
            id: existingVideo.id,
            status: existingVideo.status.toLowerCase(),
          },
        },
        { status: 202, headers: buildCorsHeaders(request) },
      );
    }
  }

  const created = await db.$transaction(async (tx) => {
    const video = await tx.video.create({
      data: {
        musicId: music.id,
        status: VideoStatus.QUEUED,
      },
    });

    await tx.generationJob.create({
      data: {
        userId: sessionUser.id,
        musicId: music.id,
        videoId: video.id,
        targetType: JobTargetType.VIDEO,
        jobType: JobType.VIDEO_RENDER,
        queueStatus: QueueStatus.QUEUED,
        priority: 120,
        maxAttempts: 6,
        runAfter: new Date(),
        providerTaskId: music.providerTaskId ?? null,
        payload: {
          source: "provider_video",
          requestedAt: new Date().toISOString(),
          title: music.title,
        },
      },
    });

    return video;
  });

  return NextResponse.json(
    {
      item: {
        id: created.id,
        status: "queued",
      },
    },
      { status: 202, headers: buildCorsHeaders(request) },
    );
  }

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}
