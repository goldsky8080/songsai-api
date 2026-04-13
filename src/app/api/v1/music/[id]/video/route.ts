import { randomUUID } from "node:crypto";
import { JobTargetType, JobType, QueueStatus, VideoStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { ensureMusicMaterialsReady } from "@/server/music/finalize";
import { isDownloadReady } from "@/server/music/policy";
import { runMusicWorker } from "@/server/music/worker";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    id: string;
  };
};

async function nudgeVideoQueue() {
  try {
    await runMusicWorker(`video-route-${randomUUID()}`);
  } catch {
    // Keep queued jobs retryable.
  }
}

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

  if (!isDownloadReady(music.createdAt)) {
    return NextResponse.json(
      {
        error: "Video can be requested after the 5 minute stabilization window.",
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
      await nudgeVideoQueue();
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

  const materials = await ensureMusicMaterialsReady(music.id);
  if (!materials?.mp3AssetPath || !materials.coverAssetPath) {
    return NextResponse.json(
      { error: "Video render materials are not ready yet." },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  const pendingVideoJobsBeforeCreate = await db.generationJob.count({
    where: {
      jobType: JobType.VIDEO_RENDER,
      queueStatus: {
        in: [QueueStatus.QUEUED, QueueStatus.ACTIVE],
      },
    },
  });

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
        maxAttempts: 3,
        runAfter: new Date(),
        providerTaskId: materials.music.providerTaskId ?? null,
        payload: {
          source: "local_ffmpeg_render",
          requestedAt: new Date().toISOString(),
          title: materials.titleText,
        },
      },
    });

    return video;
  });

  if (pendingVideoJobsBeforeCreate === 0) {
    await nudgeVideoQueue();
  }

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
