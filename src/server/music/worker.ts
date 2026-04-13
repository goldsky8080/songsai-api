import {
  JobTargetType,
  JobType,
  MusicStatus,
  Prisma,
  QueueStatus,
  VideoStatus,
  type GenerationJob,
  type Music,
  type Video,
} from "@prisma/client";
import { db } from "@/lib/db";
import { buildAlignedLyricLines } from "./aligned-lyrics";
import { syncMusicCoverImageAsset, syncMusicMetadataAssets } from "./asset-storage";
import { createMusicSchema, type CreateMusicRequest } from "./schema";
import {
  createMusicWithProvider,
  getAlignedLyricsFromProvider,
  getMusicStatusFromProvider,
} from "./provider";
import { toMusicItem } from "./mapper";

const GENERATION_CONCURRENCY = 5;
const POLL_CONCURRENCY = 5;
const VIDEO_CONCURRENCY = 5;
const DEFAULT_POLL_DELAY_MS = 5 * 60 * 1000;
const STALE_LOCK_MS = 10 * 60 * 1000;

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

function nextRunAfter(delayMs = DEFAULT_POLL_DELAY_MS) {
  return new Date(Date.now() + delayMs);
}

async function claimJobs(jobType: JobType, limit: number, workerId: string) {
  const staleLockCutoff = new Date(Date.now() - STALE_LOCK_MS);
  const candidates = await db.generationJob.findMany({
    where: {
      jobType,
      queueStatus: QueueStatus.QUEUED,
      runAfter: {
        lte: new Date(),
      },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleLockCutoff } }],
    },
    orderBy: [{ priority: "asc" }, { runAfter: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  const claimed: GenerationJob[] = [];

  for (const candidate of candidates) {
    const result = await db.generationJob.updateMany({
      where: {
        id: candidate.id,
        queueStatus: QueueStatus.QUEUED,
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleLockCutoff } }],
      },
      data: {
        queueStatus: QueueStatus.ACTIVE,
        startedAt: new Date(),
        lockedAt: new Date(),
        lockedBy: workerId,
      },
    });

    if (result.count === 1) {
      const fresh = await db.generationJob.findUnique({ where: { id: candidate.id } });
      if (fresh) {
        claimed.push(fresh);
      }
    }
  }

  return claimed;
}

async function completeJob(id: string, result?: unknown) {
  await db.generationJob.update({
    where: { id },
    data: {
      queueStatus: QueueStatus.COMPLETED,
      result: result ?? undefined,
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

async function failJob(id: string, message: string) {
  await db.generationJob.update({
    where: { id },
    data: {
      queueStatus: QueueStatus.FAILED,
      errorMessage: message,
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

async function schedulePollJob(baseJob: GenerationJob, musicId: string, providerTaskId: string) {
  await db.generationJob.create({
    data: {
      userId: baseJob.userId,
      musicId,
      targetType: JobTargetType.MUSIC,
      jobType: JobType.MUSIC_STATUS_POLL,
      queueStatus: QueueStatus.QUEUED,
      priority: baseJob.priority,
      maxAttempts: 6,
      runAfter: nextRunAfter(),
      providerTaskId,
      payload: toNullableInputJson(baseJob.payload),
    },
  });
}

async function processGenerationJob(job: GenerationJob) {
  const music = job.musicId ? await db.music.findUnique({ where: { id: job.musicId } }) : null;

  if (!music) {
    await failJob(job.id, "Music not found for generation job.");
    return { jobId: job.id, status: "failed", reason: "music_not_found" };
  }

  const parsed = createMusicSchema.safeParse(job.payload);

  if (!parsed.success) {
    const message = parsed.error.flatten().formErrors[0] ?? "Invalid generation payload.";
    await db.music.update({
      where: { id: music.id },
      data: {
        status: MusicStatus.FAILED,
        errorMessage: message,
      },
    });
    await failJob(job.id, message);
    return { jobId: job.id, status: "failed", reason: "invalid_payload" };
  }

  try {
    const providerResult = await createMusicWithProvider(parsed.data as CreateMusicRequest);
    const tracks =
      providerResult.tracks && providerResult.tracks.length > 0
        ? providerResult.tracks
        : [
            {
              providerTaskId: providerResult.providerTaskId,
              status: providerResult.status,
              mp3Url: providerResult.mp3Url,
              videoUrl: providerResult.videoUrl,
              imageUrl: providerResult.imageUrl,
              generatedLyrics: providerResult.generatedLyrics,
              providerPrompt: providerResult.providerPrompt,
              providerDescriptionPrompt: providerResult.providerDescriptionPrompt,
            },
          ];

    const [primaryTrack, ...extraTracks] = tracks;

    const pollTargets: Array<{ musicId: string; providerTaskId: string }> = [];

    const updatedPrimary = await db.$transaction(async (tx) => {
      const updated = await tx.music.update({
        where: { id: music.id },
        data: {
          providerTaskId: primaryTrack.providerTaskId,
          status: toDbMusicStatus(primaryTrack.status),
          mp3Url: primaryTrack.mp3Url ?? null,
          imageUrl: primaryTrack.imageUrl ?? null,
          videoUrl: primaryTrack.videoUrl ?? null,
          rawStatus: primaryTrack.status,
          rawResponse: toInputJson(providerResult),
          errorMessage: providerResult.errorMessage ?? null,
        },
      });

      for (const extraTrack of extraTracks) {
        const bonusMusic = await tx.music.create({
          data: {
            userId: music.userId,
            requestGroupId: music.requestGroupId,
            title: music.title,
            lyrics: music.lyrics,
            stylePrompt: music.stylePrompt,
            isMr: music.isMr,
            provider: music.provider,
            providerTaskId: extraTrack.providerTaskId,
            mp3Url: extraTrack.mp3Url ?? null,
            imageUrl: extraTrack.imageUrl ?? null,
            videoUrl: extraTrack.videoUrl ?? null,
            rawStatus: extraTrack.status,
            rawPayload: toNullableInputJson(music.rawPayload),
            rawResponse: toInputJson(extraTrack),
            isBonusTrack: true,
            status: toDbMusicStatus(extraTrack.status),
          },
        });

        pollTargets.push({
          musicId: bonusMusic.id,
          providerTaskId: extraTrack.providerTaskId,
        });
      }

      return updated;
    });

    pollTargets.unshift({
      musicId: updatedPrimary.id,
      providerTaskId: primaryTrack.providerTaskId,
    });

    for (const pollTarget of pollTargets) {
      await schedulePollJob(job, pollTarget.musicId, pollTarget.providerTaskId);
    }
    await completeJob(job.id, providerResult);

    return {
      jobId: job.id,
      status: "completed",
      item: toMusicItem(updatedPrimary),
      trackCount: tracks.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Music generation request failed.";
    const nextAttempt = job.attemptCount + 1;

    if (nextAttempt < job.maxAttempts) {
      await db.generationJob.update({
        where: { id: job.id },
        data: {
          queueStatus: QueueStatus.QUEUED,
          attemptCount: nextAttempt,
          errorMessage: message,
          runAfter: nextRunAfter(60 * 1000 * nextAttempt),
          lockedAt: null,
          lockedBy: null,
          startedAt: null,
        },
      });

      return { jobId: job.id, status: "requeued", reason: message };
    }

    await db.music.update({
      where: { id: music.id },
      data: {
        status: MusicStatus.FAILED,
        errorMessage: message,
      },
    });
    await failJob(job.id, message);
    return { jobId: job.id, status: "failed", reason: message };
  }
}

async function processPollJob(job: GenerationJob) {
  const music = job.musicId ? await db.music.findUnique({ where: { id: job.musicId } }) : null;

  if (!music || !job.providerTaskId) {
    await failJob(job.id, "Music or providerTaskId missing for poll job.");
    return { jobId: job.id, status: "failed", reason: "music_or_provider_missing" };
  }

  try {
    const [providerState] = await getMusicStatusFromProvider([job.providerTaskId]);

    if (!providerState) {
      throw new Error("Provider did not return status for task.");
    }

    const nextAttempt = job.attemptCount + 1;
    const nextStatus = toDbMusicStatus(providerState.status);
    const hasStableAsset = providerState.status === "completed" && Boolean(providerState.mp3Url);

    await db.music.update({
      where: { id: music.id },
      data: {
        status: hasStableAsset ? MusicStatus.COMPLETED : nextStatus,
        mp3Url: providerState.mp3Url ?? music.mp3Url,
        imageUrl: providerState.imageUrl ?? music.imageUrl,
        videoUrl: providerState.videoUrl ?? music.videoUrl,
        rawStatus: providerState.status,
        rawResponse: toInputJson(providerState),
        errorMessage: providerState.errorMessage ?? null,
      },
    });

    if (hasStableAsset) {
      const alignedWords = await getAlignedLyricsFromProvider(job.providerTaskId).catch(() => []);
      const alignedLines = alignedWords.length > 0 ? buildAlignedLyricLines(alignedWords) : [];

      await Promise.all([
        syncMusicMetadataAssets({
          musicId: music.id,
          alignedWords,
          alignedLines,
          titleText: providerState.title ?? music.title ?? null,
        }),
        syncMusicCoverImageAsset({
          musicId: music.id,
          sourceUrl: providerState.imageUrl ?? music.imageUrl,
        }),
      ]);

      await completeJob(job.id, providerState);
      return { jobId: job.id, status: "completed", reason: "asset_ready" };
    }

    if (providerState.status === "failed") {
      await db.music.update({
        where: { id: music.id },
        data: {
          status: MusicStatus.FAILED,
          errorMessage: providerState.errorMessage ?? "Provider reported failure.",
        },
      });
      await failJob(job.id, providerState.errorMessage ?? "Provider reported failure.");
      return { jobId: job.id, status: "failed", reason: "provider_failed" };
    }

    if (nextAttempt >= job.maxAttempts) {
      const message = "Polling timed out before a stable asset URL was available.";
      await db.music.update({
        where: { id: music.id },
        data: {
          status: MusicStatus.FAILED,
          errorMessage: message,
        },
      });
      await failJob(job.id, message);
      return { jobId: job.id, status: "failed", reason: "poll_timeout" };
    }

    await db.generationJob.update({
      where: { id: job.id },
      data: {
        queueStatus: QueueStatus.QUEUED,
        attemptCount: nextAttempt,
        runAfter: nextRunAfter(),
        lastCheckedAt: new Date(),
        result: toInputJson(providerState),
        lockedAt: null,
        lockedBy: null,
        startedAt: null,
      },
    });

    return { jobId: job.id, status: "requeued", reason: providerState.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Music status poll failed.";
    const nextAttempt = job.attemptCount + 1;

    if (nextAttempt < job.maxAttempts) {
      await db.generationJob.update({
        where: { id: job.id },
        data: {
          queueStatus: QueueStatus.QUEUED,
          attemptCount: nextAttempt,
          errorMessage: message,
          runAfter: nextRunAfter(),
          lastCheckedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          startedAt: null,
        },
      });
      return { jobId: job.id, status: "requeued", reason: message };
    }

    await db.music.update({
      where: { id: music.id },
      data: {
        status: MusicStatus.FAILED,
        errorMessage: message,
      },
    });
    await failJob(job.id, message);
    return { jobId: job.id, status: "failed", reason: message };
  }
}

async function processVideoRenderJob(job: GenerationJob) {
  const video = job.videoId
    ? await db.video.findUnique({
        where: { id: job.videoId },
        include: {
          music: true,
        },
      })
    : null;

  if (!video || !video.music || !job.musicId) {
    await failJob(job.id, "Video or related music not found for video render job.");
    return { jobId: job.id, status: "failed", reason: "video_not_found" };
  }

  const music = video.music as Music;

  if (!music.providerTaskId) {
    await db.video.update({
      where: { id: video.id },
      data: {
        status: VideoStatus.FAILED,
        errorMessage: "Music provider task id is missing.",
      },
    });
    await failJob(job.id, "Music provider task id is missing.");
    return { jobId: job.id, status: "failed", reason: "provider_task_missing" };
  }

  try {
    const [providerState] = await getMusicStatusFromProvider([music.providerTaskId]);

    if (!providerState) {
      throw new Error("Provider did not return status for video task.");
    }

    const nextAttempt = job.attemptCount + 1;
    const videoUrl = providerState.videoUrl ?? music.videoUrl;

    await db.music.update({
      where: { id: music.id },
      data: {
        videoUrl,
        rawStatus: providerState.status,
        rawResponse: toInputJson(providerState),
      },
    });

    if (videoUrl) {
      const completed = await db.video.update({
        where: { id: video.id },
        data: {
          mp4Url: videoUrl,
          bgImageUrl: providerState.imageLargeUrl ?? providerState.imageUrl ?? music.imageUrl,
          status: VideoStatus.COMPLETED,
          errorMessage: null,
        },
      });

      await completeJob(job.id, providerState);
      return { jobId: job.id, status: "completed", item: completed };
    }

    if (nextAttempt >= job.maxAttempts) {
      const message = "Video did not become available before retry limit.";
      await db.video.update({
        where: { id: video.id },
        data: {
          status: VideoStatus.FAILED,
          errorMessage: message,
        },
      });
      await failJob(job.id, message);
      return { jobId: job.id, status: "failed", reason: "video_timeout" };
    }

    await db.video.update({
      where: { id: video.id },
      data: {
        status: VideoStatus.PROCESSING,
        errorMessage: null,
      },
    });

    await db.generationJob.update({
      where: { id: job.id },
      data: {
        queueStatus: QueueStatus.QUEUED,
        attemptCount: nextAttempt,
        runAfter: nextRunAfter(),
        lastCheckedAt: new Date(),
        result: toInputJson(providerState),
        lockedAt: null,
        lockedBy: null,
        startedAt: null,
      },
    });

    return { jobId: job.id, status: "requeued", reason: "video_pending" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video render poll failed.";
    const nextAttempt = job.attemptCount + 1;

    if (nextAttempt < job.maxAttempts) {
      await db.generationJob.update({
        where: { id: job.id },
        data: {
          queueStatus: QueueStatus.QUEUED,
          attemptCount: nextAttempt,
          errorMessage: message,
          runAfter: nextRunAfter(),
          lastCheckedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          startedAt: null,
        },
      });

      return { jobId: job.id, status: "requeued", reason: message };
    }

    await db.video.update({
      where: { id: video.id },
      data: {
        status: VideoStatus.FAILED,
        errorMessage: message,
      },
    });
    await failJob(job.id, message);
    return { jobId: job.id, status: "failed", reason: message };
  }
}

export async function runMusicWorker(workerId: string) {
  const generationJobs = await claimJobs(JobType.MUSIC_GENERATION, GENERATION_CONCURRENCY, workerId);
  const pollJobs = await claimJobs(JobType.MUSIC_STATUS_POLL, POLL_CONCURRENCY, workerId);
  const videoJobs = await claimJobs(JobType.VIDEO_RENDER, VIDEO_CONCURRENCY, workerId);

  const generationResults = await Promise.all(generationJobs.map((job) => processGenerationJob(job)));
  const pollResults = await Promise.all(pollJobs.map((job) => processPollJob(job)));
  const videoResults = await Promise.all(videoJobs.map((job) => processVideoRenderJob(job)));

  return {
    workerId,
    claimed: {
      generation: generationJobs.length,
      poll: pollJobs.length,
      video: videoJobs.length,
    },
    processed: {
      generation: generationResults,
      poll: pollResults,
      video: videoResults,
    },
    finishedAt: new Date().toISOString(),
  };
}

