import { randomUUID } from "node:crypto";
import { JobTargetType, JobType, MusicStatus, Prisma, QueueStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCorsHeaders } from "@/lib/http";
import { runMusicWorker } from "@/server/music/worker";
import { toMusicItem } from "@/server/music/mapper";
import { getMusicStatusFromProvider, createMusicWithProvider } from "@/server/music/provider";
import { isDownloadReady } from "@/server/music/policy";
import { createMusicSchema } from "@/server/music/schema";

export const dynamic = "force-dynamic";

function parseProviderFilter(value: string | null) {
  if (value === "suno") {
    return "SUNO" as const;
  }

  if (value === "ace_step") {
    return "ACE_STEP" as const;
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

function toNullableInputJson(value: Prisma.JsonValue | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return Prisma.JsonNull;
  }

  return value as Prisma.InputJsonValue;
}

function toInputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

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

function parseProviderDetail(detail: unknown) {
  if (typeof detail !== "string") {
    return null;
  }

  try {
    return JSON.parse(detail) as {
      message?: string;
      running_clip_ids?: string[];
    };
  } catch {
    return null;
  }
}
function toStoredProvider(provider: "suno" | "ace_step") {
  return provider === "ace_step" ? "ACE_STEP" : "SUNO";
}

function shouldSchedulePollJob(
  provider: "suno" | "ace_step",
  status: "queued" | "processing" | "completed" | "failed",
  mp3Url?: string | null,
) {
  if (provider === "ace_step" && status === "completed" && mp3Url) {
    return false;
  }

  return true;
}

function buildProviderErrorResponse(error: unknown) {
  const errorObject = error as {
    message?: string;
    response?: {
      status?: number;
      data?: {
        detail?: unknown;
      };
    };
  };

  const status = errorObject.response?.status;
  const detail = parseProviderDetail(errorObject.response?.data?.detail);

  if (status === 429) {
    return NextResponse.json(
      {
        error: "?꾩옱 ?앹꽦 ?湲곗뿴??媛??李??덉뒿?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄??二쇱꽭??",
        code: "SUNO_QUEUE_FULL",
        providerMessage: detail?.message ?? errorObject.message ?? null,
        runningClipIds: detail?.running_clip_ids ?? [],
      },
      { status: 429 },
    );
  }

  return NextResponse.json(
    {
      error: errorObject.message ?? "Music generation request failed.",
    },
    { status: 502 },
  );
}

async function nudgeDueVideoQueue() {
  const dueVideoJobs = await db.generationJob.count({
    where: {
      jobType: JobType.VIDEO_RENDER,
      queueStatus: QueueStatus.QUEUED,
      runAfter: {
        lte: new Date(),
      },
    },
  });

  if (dueVideoJobs < 1) {
    return;
  }

  try {
    await runMusicWorker(`video-list-${randomUUID()}`);
  } catch {
    // Ignore worker kick failures here and keep the queue retryable.
  }
}
export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();

  if (!sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: buildCorsHeaders(request) },
    );
  }

  await nudgeDueVideoQueue();

  const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 20;
  const parsedOffset = Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10);
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const provider = parseProviderFilter(request.nextUrl.searchParams.get("provider"));
  const where: Prisma.MusicWhereInput = {
    userId: sessionUser.id,
    ...(provider ? { provider } : {}),
  };

  const total = await db.music.count({
    where,
  });

  let items = await db.music.findMany({
    where,
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
    skip: offset,
    take: limit,
  });

  const previewTargets = items.filter(
    (item) =>
      item.providerTaskId &&
      !isDownloadReady(item.createdAt) &&
      (!item.mp3Url || !item.imageUrl || !item.title),
  );

  if (previewTargets.length > 0) {
    const providerStates = await getMusicStatusFromProvider(
      previewTargets.map((item) => item.providerTaskId as string),
    ).catch(() => []);

    if (providerStates.length > 0) {
      const stateByTaskId = new Map(providerStates.map((state) => [state.providerTaskId, state]));

      await Promise.all(
        previewTargets.map(async (item) => {
          const providerState = stateByTaskId.get(item.providerTaskId as string);
          if (!providerState) {
            return;
          }

          await db.music.update({
            where: { id: item.id },
            data: {
              title: providerState.title?.trim() || item.title,
              mp3Url: providerState.mp3Url ?? item.mp3Url,
              imageUrl: providerState.imageUrl ?? item.imageUrl,
              videoUrl: providerState.videoUrl ?? item.videoUrl,
              rawStatus: providerState.status,
              rawResponse: toInputJson(providerState),
              duration: parseDuration(providerState.duration) ?? item.duration,
              tags: providerState.tags ?? item.tags,
              errorMessage: providerState.errorMessage ?? null,
              status: providerState.status === "failed" ? MusicStatus.FAILED : item.status,
            },
          });
        }),
      );

      items = await db.music.findMany({
        where,
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
        skip: offset,
        take: limit,
      });
    }
  }

  return NextResponse.json(
    {
      items: items.map((item) => toMusicItem(item, item.videos[0] ?? null)),
      pagination: {
        offset,
        limit,
        total,
        hasMore: offset + items.length < total,
      },
    },
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

  try {
    const providerResult = await createMusicWithProvider(parsed.data);
    const storedProvider = toStoredProvider(parsed.data.provider);
    const tracks =
      providerResult.tracks && providerResult.tracks.length > 0
        ? providerResult.tracks
        : [
            {
              providerTaskId: providerResult.providerTaskId,
              title: providerResult.title,
              status: providerResult.status,
              mp3Url: providerResult.mp3Url,
              videoUrl: providerResult.videoUrl,
              imageUrl: providerResult.imageUrl,
              generatedLyrics: providerResult.generatedLyrics,
              providerPrompt: providerResult.providerPrompt,
              providerDescriptionPrompt: providerResult.providerDescriptionPrompt,
              tags: providerResult.tags,
              duration: providerResult.duration,
            },
          ];

    const [primaryTrack, ...extraTracks] = tracks;

    if (!primaryTrack?.providerTaskId) {
      return NextResponse.json(
        { error: "Provider did not return a usable primary track." },
        { status: 502, headers: buildCorsHeaders(request) },
      );
    }

    const requestGroupId = randomUUID();

    const createdPrimary = await db.$transaction(async (tx) => {
      const primaryMusic = await tx.music.create({
        data: {
          userId: sessionUser.id,
          requestGroupId,
          title: primaryTrack.title?.trim() || parsed.data.title?.trim() || null,
          lyrics: parsed.data.lyrics,
          stylePrompt: parsed.data.stylePrompt,
          isMr: parsed.data.isMr,
          provider: storedProvider,
          providerTaskId: primaryTrack.providerTaskId,
          mp3Url: primaryTrack.mp3Url ?? null,
          imageUrl: primaryTrack.imageUrl ?? null,
          videoUrl: primaryTrack.videoUrl ?? null,
          rawStatus: primaryTrack.status,
          rawPayload: toInputJson(parsed.data),
          rawResponse: toInputJson(providerResult),
          status: toDbMusicStatus(primaryTrack.status),
          duration: parseDuration(primaryTrack.duration),
          tags: primaryTrack.tags ?? null,
          errorMessage: providerResult.errorMessage ?? null,
        },
      });

      if (shouldSchedulePollJob(parsed.data.provider, primaryTrack.status, primaryTrack.mp3Url)) {
        await tx.generationJob.create({
          data: {
            userId: sessionUser.id,
            musicId: primaryMusic.id,
            targetType: JobTargetType.MUSIC,
            jobType: JobType.MUSIC_STATUS_POLL,
            queueStatus: QueueStatus.QUEUED,
            priority: 100,
            maxAttempts: 6,
            runAfter: new Date(Date.now() + 5 * 60 * 1000),
            providerTaskId: primaryTrack.providerTaskId,
            payload: toInputJson(parsed.data),
            result: toInputJson(primaryTrack),
          },
        });
      }

      for (const extraTrack of extraTracks) {
        if (!extraTrack.providerTaskId) {
          continue;
        }

        const bonusMusic = await tx.music.create({
          data: {
            userId: sessionUser.id,
            requestGroupId,
            title: extraTrack.title?.trim() || parsed.data.title?.trim() || null,
            lyrics: parsed.data.lyrics,
            stylePrompt: parsed.data.stylePrompt,
            isMr: parsed.data.isMr,
            provider: storedProvider,
            providerTaskId: extraTrack.providerTaskId,
            mp3Url: extraTrack.mp3Url ?? null,
            imageUrl: extraTrack.imageUrl ?? null,
            videoUrl: extraTrack.videoUrl ?? null,
            rawStatus: extraTrack.status,
            rawPayload: toInputJson(parsed.data),
            rawResponse: toInputJson(extraTrack),
            isBonusTrack: true,
            status: toDbMusicStatus(extraTrack.status),
            duration: parseDuration(extraTrack.duration),
            tags: extraTrack.tags ?? null,
            errorMessage: providerResult.errorMessage ?? null,
          },
        });

        if (shouldSchedulePollJob(parsed.data.provider, extraTrack.status, extraTrack.mp3Url)) {
          await tx.generationJob.create({
            data: {
              userId: sessionUser.id,
              musicId: bonusMusic.id,
              targetType: JobTargetType.MUSIC,
              jobType: JobType.MUSIC_STATUS_POLL,
              queueStatus: QueueStatus.QUEUED,
              priority: 100,
              maxAttempts: 6,
              runAfter: new Date(Date.now() + 5 * 60 * 1000),
              providerTaskId: extraTrack.providerTaskId,
              payload: toInputJson(parsed.data),
              result: toInputJson(extraTrack),
            },
          });
        }
      }

      return primaryMusic;
    });

    return NextResponse.json(
      { item: toMusicItem(createdPrimary) },
      { status: 201, headers: buildCorsHeaders(request) },
    );
  } catch (error) {
    const response = buildProviderErrorResponse(error);
    Object.entries(buildCorsHeaders(request)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: buildCorsHeaders(request),
  });
}

