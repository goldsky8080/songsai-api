import { readFile } from "node:fs/promises";
import { AssetStatus, MusicAssetType, MusicStatus, type Music } from "@prisma/client";
import { db } from "@/lib/db";
import type { AlignedLyricLine } from "./aligned-lyrics";
import {
  syncMusicCoverImageAsset,
  syncMusicMetadataAssets,
  syncMusicMp3Asset,
} from "./asset-storage";
import { getAlignedLyricDataFromProvider, getMusicStatusFromProvider } from "./provider";

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

export type FinalizedMusicMaterials = {
  music: Music;
  mp3AssetPath: string | null;
  coverAssetPath: string | null;
  lyricLines: AlignedLyricLine[];
  titleText: string | null;
};

function buildFallbackLyricLines(lyrics: string | null | undefined, duration: number | null | undefined) {
  const normalized = (lyrics ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (normalized.length < 1) {
    return [] as AlignedLyricLine[];
  }

  const totalDuration = typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : 180;
  const slice = totalDuration / normalized.length;

  return normalized.map((text, index) => ({
    text,
    start_s: Number((index * slice).toFixed(3)),
    end_s: Number(((index + 1) * slice).toFixed(3)),
  }));
}

export async function ensureMusicMaterialsReady(musicId: string): Promise<FinalizedMusicMaterials | null> {
  const music = await db.music.findUnique({
    where: { id: musicId },
    include: { assets: true },
  });

  if (!music) {
    return null;
  }

  let currentMusic = music;
  let alignedLines: AlignedLyricLine[] = [];

  if (music.providerTaskId) {
    const [providerState] = await getMusicStatusFromProvider([music.providerTaskId]).catch(() => []);

    if (providerState) {
      const { alignedWords, alignedLines: providerAlignedLines } = await getAlignedLyricDataFromProvider(
        music.providerTaskId,
      ).catch(() => ({
        alignedWords: [],
        alignedLines: [],
      }));
      alignedLines = providerAlignedLines;

      currentMusic = await db.music.update({
        where: { id: music.id },
        data: {
          title: providerState.title?.trim() || music.title,
          status: providerState.mp3Url ? MusicStatus.COMPLETED : toDbMusicStatus(providerState.status),
          mp3Url: providerState.mp3Url ?? music.mp3Url,
          imageUrl: providerState.imageUrl ?? music.imageUrl,
          rawStatus: providerState.status,
          rawResponse: providerState,
          duration: parseDuration(providerState.duration) ?? music.duration,
          tags: providerState.tags ?? music.tags,
          errorMessage: providerState.errorMessage ?? null,
        },
        include: { assets: true },
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

  const cachedMp3 = currentMusic.mp3Url
    ? await syncMusicMp3Asset({
        musicId: currentMusic.id,
        sourceUrl: currentMusic.mp3Url,
      })
    : null;

  const refreshed = await db.music.findUnique({
    where: { id: music.id },
    include: {
      assets: {
        where: {
          status: AssetStatus.READY,
          assetType: {
            in: [
              MusicAssetType.MP3,
              MusicAssetType.COVER_IMAGE,
              MusicAssetType.ALIGNED_LYRICS_LINES_JSON,
              MusicAssetType.TITLE_TEXT,
            ],
          },
        },
      },
    },
  });

  if (!refreshed) {
    return null;
  }

  const mp3Asset = cachedMp3 ?? refreshed.assets.find((asset) => asset.assetType === MusicAssetType.MP3) ?? null;
  const coverAsset = refreshed.assets.find((asset) => asset.assetType === MusicAssetType.COVER_IMAGE) ?? null;
  const lyricLinesAsset = refreshed.assets.find(
    (asset) => asset.assetType === MusicAssetType.ALIGNED_LYRICS_LINES_JSON,
  );

  if (alignedLines.length === 0 && lyricLinesAsset?.storagePath) {
    try {
      const raw = await readFile(lyricLinesAsset.storagePath as string, "utf8");
      const parsed = JSON.parse(raw.toString());
      if (Array.isArray(parsed)) {
        alignedLines = parsed as AlignedLyricLine[];
      }
    } catch {
      // keep lyric lines optional
    }
  }

  if (alignedLines.length === 0) {
    alignedLines = buildFallbackLyricLines(refreshed.lyrics, refreshed.duration);
  }

  return {
    music: refreshed,
    mp3AssetPath: mp3Asset?.storagePath ?? null,
    coverAssetPath: coverAsset?.storagePath ?? null,
    lyricLines: alignedLines,
    titleText: refreshed.title?.trim() || null,
  };
}
