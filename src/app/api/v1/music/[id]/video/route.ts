import { JobTargetType, JobType, MusicStatus, QueueStatus, VideoStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { buildAlignedLyricLines } from "@/server/music/aligned-lyrics";
import {
  syncMusicCoverImageAsset,
  syncMusicMetadataAssets,
  syncMusicMp3Asset,
} from "@/server/music/asset-storage";
import { getAlignedLyricsFromProvider, getMusicStatusFromProvider } from "@/server/music/provider";
import { isDownloadReady } from "@/server/music/policy";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    id: string;
  };
};

function parseDuration(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }

  return null;
}

function toDbMusicStatus(status: "queued" | "processing" | "completed" | "failed") {
  switch (status) {
    case "processing":
      return MusicStatus.PROCESSING;
    case "completed":
      return MusicStatus.COMPLETED;
    case "failed":
      return MusicStatus.FAILED;
    case "queued":
    default:
      return MusicStatus.QUEUED;
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

  if (!music.mp3Url) {
    return NextResponse.json(
      { error: "Audio is not ready yet." },
      { status: 409, headers: buildCorsHeaders(request) },
    );
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

  let currentMusic = music;

  if (music.providerTaskId) {
    const [providerState] = await getMusicStatusFromProvider([music.providerTaskId]).catch(() => []);

    if (providerState) {
      const alignedWords = await getAlignedLyricsFromProvider(music.providerTaskId).catch(() => []);
      const alignedLines = alignedWords.length > 0 ? buildAlignedLyricLines(alignedWords) : [];

      currentMusic = await db.music.update({
        where: { id: music.id },
        data: {
          title: providerState.title?.trim() || music.title,
          status:
            providerState.status === "completed" && providerState.mp3Url
              ? MusicStatus.COMPLETED
              : toDbMusicStatus(providerState.status),
          mp3Url: providerState.mp3Url ?? music.mp3Url,
          imageUrl: providerState.imageUrl ?? music.imageUrl,
          videoUrl: providerState.videoUrl ?? music.videoUrl,
          rawStatus: providerState.status,
          rawResponse: providerState,
          duration: parseDuration(providerState.duration) ?? music.duration,
          tags: providerState.tags ?? music.tags,
          errorMessage: providerState.errorMessage ?? null,
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

      await syncMusicMetadataAssets({
        musicId: music.id,
        alignedWords,
        alignedLines,
        titleText: providerState.title ?? currentMusic.title ?? null,
      });
      await syncMusicCoverImageAsset({
        musicId: music.id,
        sourceUrl: providerState.imageUrl ?? currentMusic.imageUrl ?? null,
      });
    }
  }

  if (!currentMusic.mp3Url) {
    return NextResponse.json(
      { error: "Audio is not ready yet." },
      { status: 409, headers: buildCorsHeaders(request) },
    );
  }

  const existingVideo = currentMusic.videos[0] ?? null;
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

  const cachedMp3Asset = await syncMusicMp3Asset({
    musicId: currentMusic.id,
    sourceUrl: currentMusic.mp3Url,
  });

  if (!cachedMp3Asset) {
    return NextResponse.json(
      { error: "Failed to prepare audio asset for video render." },
      { status: 502, headers: buildCorsHeaders(request) },
    );
  }

  const created = await db.$transaction(async (tx) => {
    const video = await tx.video.create({
      data: {
        musicId: currentMusic.id,
        status: VideoStatus.QUEUED,
      },
    });

    await tx.generationJob.create({
      data: {
        userId: sessionUser.id,
        musicId: currentMusic.id,
        videoId: video.id,
        targetType: JobTargetType.VIDEO,
        jobType: JobType.VIDEO_RENDER,
        queueStatus: QueueStatus.QUEUED,
        priority: 120,
        maxAttempts: 6,
        runAfter: new Date(),
        providerTaskId: currentMusic.providerTaskId ?? null,
        payload: {
          source: "provider_video",
          requestedAt: new Date().toISOString(),
          title: currentMusic.title,
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
