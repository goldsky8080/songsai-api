import path from "node:path";
import { AssetStatus, MusicAssetType, Prisma } from "@prisma/client";

type MusicAssetStorageTier = Prisma.MusicAssetCreateInput["storageTier"];
const HOT_STORAGE_TIER = "HOT" as MusicAssetStorageTier;

const HOT_STORAGE_ROOT = path.join(process.cwd(), "storage", "music-assets");

const PUBLIC_PREFIX_BY_TYPE: Record<MusicAssetType, string> = {
  [MusicAssetType.MP3]: "/media/music",
  [MusicAssetType.COVER_IMAGE]: "/media/image",
  [MusicAssetType.ALIGNED_LYRICS_RAW_JSON]: "/media/lyrics/raw",
  [MusicAssetType.ALIGNED_LYRICS_LINES_JSON]: "/media/lyrics/lines",
  [MusicAssetType.TITLE_TEXT]: "/media/meta/title",
};

const STORAGE_PREFIX_BY_TYPE: Record<MusicAssetType, string> = {
  [MusicAssetType.MP3]: "music",
  [MusicAssetType.COVER_IMAGE]: "image",
  [MusicAssetType.ALIGNED_LYRICS_RAW_JSON]: "lyrics/raw",
  [MusicAssetType.ALIGNED_LYRICS_LINES_JSON]: "lyrics/lines",
  [MusicAssetType.TITLE_TEXT]: "meta/title",
};

export const MUSIC_ASSET_DIRS: Record<MusicAssetType, string> = {
  [MusicAssetType.MP3]: path.join(HOT_STORAGE_ROOT, "audio"),
  [MusicAssetType.COVER_IMAGE]: path.join(HOT_STORAGE_ROOT, "images"),
  [MusicAssetType.ALIGNED_LYRICS_RAW_JSON]: path.join(HOT_STORAGE_ROOT, "lyrics-raw"),
  [MusicAssetType.ALIGNED_LYRICS_LINES_JSON]: path.join(HOT_STORAGE_ROOT, "lyrics-lines"),
  [MusicAssetType.TITLE_TEXT]: path.join(HOT_STORAGE_ROOT, "titles"),
};

export function getMusicAssetDir(assetType: MusicAssetType) {
  return MUSIC_ASSET_DIRS[assetType];
}

export function buildMusicAssetStorageKey(params: {
  musicId: string;
  assetType: MusicAssetType;
  extension: string;
}) {
  const extension = params.extension.startsWith(".") ? params.extension : `.${params.extension}`;
  return `${STORAGE_PREFIX_BY_TYPE[params.assetType]}/${params.musicId}${extension}`;
}

export function buildMusicAssetPublicUrl(params: {
  musicId: string;
  assetType: MusicAssetType;
  extension: string;
}) {
  const extension = params.extension.startsWith(".") ? params.extension : `.${params.extension}`;
  return `${PUBLIC_PREFIX_BY_TYPE[params.assetType]}/${params.musicId}${extension}`;
}

export function getMusicAssetPath(params: {
  musicId: string;
  assetType: MusicAssetType;
  extension: string;
}) {
  const extension = params.extension.startsWith(".") ? params.extension : `.${params.extension}`;
  return path.join(getMusicAssetDir(params.assetType), `${params.musicId}${extension}`);
}

export type MusicAssetRecordInput = {
  musicId: string;
  assetType: MusicAssetType;
  storageTier?: MusicAssetStorageTier;
  sourceUrl?: string | null;
  storageKey?: string | null;
  storagePath?: string | null;
  publicUrl?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  checksum?: string | null;
  archivedAt?: Date | null;
  errorMessage?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  status?: AssetStatus;
};

export function buildMusicAssetUpsertData(input: MusicAssetRecordInput) {
  return {
    where: {
      musicId_assetType: {
        musicId: input.musicId,
        assetType: input.assetType,
      },
    },
    create: {
      musicId: input.musicId,
      assetType: input.assetType,
      status: input.status ?? AssetStatus.PENDING,
      storageTier: input.storageTier ?? HOT_STORAGE_TIER,
      sourceUrl: input.sourceUrl ?? null,
      storageKey: input.storageKey ?? null,
      storagePath: input.storagePath ?? null,
      publicUrl: input.publicUrl ?? null,
      mimeType: input.mimeType ?? null,
      fileSize: input.fileSize ?? null,
      checksum: input.checksum ?? null,
      archivedAt: input.archivedAt ?? null,
      errorMessage: input.errorMessage ?? null,
      metadata: input.metadata ?? undefined,
    },
    update: {
      status: input.status ?? AssetStatus.PENDING,
      storageTier: input.storageTier ?? HOT_STORAGE_TIER,
      sourceUrl: input.sourceUrl ?? null,
      storageKey: input.storageKey ?? null,
      storagePath: input.storagePath ?? null,
      publicUrl: input.publicUrl ?? null,
      mimeType: input.mimeType ?? null,
      fileSize: input.fileSize ?? null,
      checksum: input.checksum ?? null,
      archivedAt: input.archivedAt ?? null,
      errorMessage: input.errorMessage ?? null,
      metadata: input.metadata ?? undefined,
    },
  };
}
