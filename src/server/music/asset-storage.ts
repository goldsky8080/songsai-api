import { access, mkdir, writeFile } from "node:fs/promises";
import { AssetStatus, MusicAssetType } from "@prisma/client";
import { db } from "@/lib/db";
import type { AlignedLyricLine } from "@/server/music/aligned-lyrics";
import type { ProviderAlignedLyricWord } from "@/server/music/types";
import {
  buildMusicAssetPublicUrl,
  buildMusicAssetStorageKey,
  buildMusicAssetUpsertData,
  getMusicAssetPath,
  MUSIC_ASSET_DIRS,
} from "./assets";

const HOT_STORAGE_TIER = "HOT" as const;

async function ensureAssetDirs() {
  await Promise.all(Object.values(MUSIC_ASSET_DIRS).map((dir) => mkdir(dir, { recursive: true })));
}

function getImageExtension(contentType: string | null, sourceUrl: string) {
  const normalized = contentType?.split(";")[0].trim().toLowerCase() ?? "";

  if (normalized === "image/png") {
    return ".png";
  }

  if (normalized === "image/webp") {
    return ".webp";
  }

  if (normalized === "image/gif") {
    return ".gif";
  }

  if (normalized === "image/svg+xml") {
    return ".svg";
  }

  try {
    const pathname = new URL(sourceUrl).pathname;
    const match = pathname.match(/\.(png|webp|gif|svg|jpe?g)$/i);
    if (match) {
      const ext = match[0].toLowerCase();
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  } catch {
    // ignore URL parsing issues and fall back to jpg
  }

  return ".jpg";
}

async function saveJsonFile(params: {
  musicId: string;
  assetType: MusicAssetType;
  value: unknown;
}) {
  const serialized = JSON.stringify(params.value, null, 2);
  const storagePath = getMusicAssetPath({
    musicId: params.musicId,
    assetType: params.assetType,
    extension: ".json",
  });

  await writeFile(storagePath, serialized, "utf8");

  return {
    storageTier: HOT_STORAGE_TIER,
    storageKey: buildMusicAssetStorageKey({
      musicId: params.musicId,
      assetType: params.assetType,
      extension: ".json",
    }),
    storagePath,
    publicUrl: buildMusicAssetPublicUrl({
      musicId: params.musicId,
      assetType: params.assetType,
      extension: ".json",
    }),
    mimeType: "application/json",
    fileSize: Buffer.byteLength(serialized, "utf8"),
  };
}

async function saveTextFile(params: {
  musicId: string;
  assetType: MusicAssetType;
  value: string;
}) {
  const text = params.value.trim();
  const storagePath = getMusicAssetPath({
    musicId: params.musicId,
    assetType: params.assetType,
    extension: ".txt",
  });

  await writeFile(storagePath, text, "utf8");

  return {
    storageTier: HOT_STORAGE_TIER,
    storageKey: buildMusicAssetStorageKey({
      musicId: params.musicId,
      assetType: params.assetType,
      extension: ".txt",
    }),
    storagePath,
    publicUrl: buildMusicAssetPublicUrl({
      musicId: params.musicId,
      assetType: params.assetType,
      extension: ".txt",
    }),
    mimeType: "text/plain; charset=utf-8",
    fileSize: Buffer.byteLength(text, "utf8"),
  };
}

async function saveBinaryFile(params: {
  musicId: string;
  assetType: MusicAssetType;
  bytes: Uint8Array;
  extension: string;
  mimeType: string;
}) {
  const storagePath = getMusicAssetPath({
    musicId: params.musicId,
    assetType: params.assetType,
    extension: params.extension,
  });

  await writeFile(storagePath, params.bytes);

  return {
    storageTier: HOT_STORAGE_TIER,
    storageKey: buildMusicAssetStorageKey({
      musicId: params.musicId,
      assetType: params.assetType,
      extension: params.extension,
    }),
    storagePath,
    publicUrl: buildMusicAssetPublicUrl({
      musicId: params.musicId,
      assetType: params.assetType,
      extension: params.extension,
    }),
    mimeType: params.mimeType,
    fileSize: params.bytes.byteLength,
  };
}

async function upsertFailedAsset(params: {
  musicId: string;
  assetType: MusicAssetType;
  sourceUrl?: string | null;
  errorMessage: string;
}) {
  await db.musicAsset.upsert(
    buildMusicAssetUpsertData({
      musicId: params.musicId,
      assetType: params.assetType,
      sourceUrl: params.sourceUrl,
      status: AssetStatus.FAILED,
      errorMessage: params.errorMessage,
    }),
  );
}

export async function syncMusicCoverImageAsset(params: {
  musicId: string;
  sourceUrl?: string | null;
}) {
  const sourceUrl = params.sourceUrl?.trim();
  if (!sourceUrl) {
    return null;
  }

  await ensureAssetDirs();

  const existing = await db.musicAsset.findUnique({
    where: {
      musicId_assetType: {
        musicId: params.musicId,
        assetType: MusicAssetType.COVER_IMAGE,
      },
    },
  });

  if (existing?.status === AssetStatus.READY && existing.storagePath) {
    try {
      await access(existing.storagePath);
      return existing;
    } catch {
      // fall through to refresh the cached file
    }
  }

  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch cover image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const mimeType = response.headers.get("content-type")?.split(";")[0].trim() || "image/jpeg";
    const extension = getImageExtension(mimeType, sourceUrl);
    const stored = await saveBinaryFile({
      musicId: params.musicId,
      assetType: MusicAssetType.COVER_IMAGE,
      bytes,
      extension,
      mimeType,
    });

    return db.musicAsset.upsert(
      buildMusicAssetUpsertData({
        musicId: params.musicId,
        assetType: MusicAssetType.COVER_IMAGE,
        storageTier: stored.storageTier,
        sourceUrl,
        storageKey: stored.storageKey,
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
        mimeType: stored.mimeType,
        fileSize: stored.fileSize,
        status: AssetStatus.READY,
        errorMessage: null,
      }),
    );
  } catch (error) {
    await upsertFailedAsset({
      musicId: params.musicId,
      assetType: MusicAssetType.COVER_IMAGE,
      sourceUrl,
      errorMessage: error instanceof Error ? error.message : "Failed to cache cover image.",
    });
    return null;
  }
}

export async function syncMusicMetadataAssets(params: {
  musicId: string;
  alignedWords?: ProviderAlignedLyricWord[] | null;
  alignedLines?: AlignedLyricLine[] | null;
  titleText?: string | null;
}) {
  await ensureAssetDirs();

  if (params.alignedWords && params.alignedWords.length > 0) {
    try {
      const stored = await saveJsonFile({
        musicId: params.musicId,
        assetType: MusicAssetType.ALIGNED_LYRICS_RAW_JSON,
        value: params.alignedWords,
      });

      await db.musicAsset.upsert(
        buildMusicAssetUpsertData({
          musicId: params.musicId,
          assetType: MusicAssetType.ALIGNED_LYRICS_RAW_JSON,
          storageTier: stored.storageTier,
          storageKey: stored.storageKey,
          storagePath: stored.storagePath,
          publicUrl: stored.publicUrl,
          mimeType: stored.mimeType,
          fileSize: stored.fileSize,
          status: AssetStatus.READY,
          errorMessage: null,
          metadata: {
            count: params.alignedWords.length,
          },
        }),
      );
    } catch (error) {
      await upsertFailedAsset({
        musicId: params.musicId,
        assetType: MusicAssetType.ALIGNED_LYRICS_RAW_JSON,
        errorMessage:
          error instanceof Error ? error.message : "Failed to save aligned lyrics raw asset.",
      });
    }
  }

  if (params.alignedLines && params.alignedLines.length > 0) {
    try {
      const stored = await saveJsonFile({
        musicId: params.musicId,
        assetType: MusicAssetType.ALIGNED_LYRICS_LINES_JSON,
        value: params.alignedLines,
      });

      await db.musicAsset.upsert(
        buildMusicAssetUpsertData({
          musicId: params.musicId,
          assetType: MusicAssetType.ALIGNED_LYRICS_LINES_JSON,
          storageTier: stored.storageTier,
          storageKey: stored.storageKey,
          storagePath: stored.storagePath,
          publicUrl: stored.publicUrl,
          mimeType: stored.mimeType,
          fileSize: stored.fileSize,
          status: AssetStatus.READY,
          errorMessage: null,
          metadata: {
            count: params.alignedLines.length,
          },
        }),
      );
    } catch (error) {
      await upsertFailedAsset({
        musicId: params.musicId,
        assetType: MusicAssetType.ALIGNED_LYRICS_LINES_JSON,
        errorMessage:
          error instanceof Error ? error.message : "Failed to save aligned lyric lines asset.",
      });
    }
  }

  if (params.titleText && params.titleText.trim().length > 0) {
    try {
      const stored = await saveTextFile({
        musicId: params.musicId,
        assetType: MusicAssetType.TITLE_TEXT,
        value: params.titleText,
      });

      await db.musicAsset.upsert(
        buildMusicAssetUpsertData({
          musicId: params.musicId,
          assetType: MusicAssetType.TITLE_TEXT,
          storageTier: stored.storageTier,
          storageKey: stored.storageKey,
          storagePath: stored.storagePath,
          publicUrl: stored.publicUrl,
          mimeType: stored.mimeType,
          fileSize: stored.fileSize,
          status: AssetStatus.READY,
          errorMessage: null,
        }),
      );
    } catch (error) {
      await upsertFailedAsset({
        musicId: params.musicId,
        assetType: MusicAssetType.TITLE_TEXT,
        errorMessage: error instanceof Error ? error.message : "Failed to save title text asset.",
      });
    }
  }
}
