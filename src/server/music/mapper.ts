import { MusicStatus, VideoStatus, type Music, type Video } from "@prisma/client";
import { getDownloadAvailableAt, isDownloadReady } from "./policy";
import type { MusicItem, PublicMusicStatus, RecentMusicItem } from "./types";

function hasUsableMediaUrl(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return /^https?:\/\//i.test(value);
}

function getMusicTitle(music: Music) {
  return music.title?.trim() || "제목 생성 대기 중";
}

function resolveMusicImageUrl(music: Music) {
  return music.imageUrl ?? null;
}

export function isRecentCompletedMusic(music: Music) {
  return (
    music.status === MusicStatus.COMPLETED &&
    hasUsableMediaUrl(music.mp3Url) &&
    !music.errorMessage
  );
}

export function toPublicMusicStatus(status: MusicStatus): PublicMusicStatus {
  switch (status) {
    case MusicStatus.COMPLETED:
      return "completed";
    case MusicStatus.PROCESSING:
      return "processing";
    case MusicStatus.FAILED:
      return "failed";
    case MusicStatus.CANCELLED:
      return "failed";
    case MusicStatus.QUEUED:
    default:
      return "queued";
  }
}

function toPublicVideoStatus(status: VideoStatus | null | undefined): PublicMusicStatus | null {
  if (!status) {
    return null;
  }

  switch (status) {
    case VideoStatus.COMPLETED:
      return "completed";
    case VideoStatus.PROCESSING:
      return "processing";
    case VideoStatus.FAILED:
      return "failed";
    case VideoStatus.CANCELLED:
      return "failed";
    case VideoStatus.QUEUED:
    default:
      return "queued";
  }
}

export function toMusicItem(music: Music, latestVideo?: Video | null): MusicItem {
  return {
    id: music.id,
    requestGroupId: music.requestGroupId ?? null,
    title: getMusicTitle(music),
    status: toPublicMusicStatus(music.status),
    createdAt: music.createdAt.toISOString(),
    updatedAt: music.updatedAt.toISOString(),
    downloadAvailableAt: getDownloadAvailableAt(music.createdAt).toISOString(),
    canListen: Boolean(music.mp3Url),
    canDownload: isDownloadReady(music.createdAt) && Boolean(music.mp3Url),
    lyrics: music.lyrics,
    stylePrompt: music.stylePrompt,
    imageUrl: resolveMusicImageUrl(music),
    mp3Url: music.mp3Url ?? null,
    mp4Url: music.videoUrl ?? null,
    provider: music.provider,
    providerTaskId: music.providerTaskId ?? null,
    videoId: latestVideo?.id ?? null,
    videoStatus: toPublicVideoStatus(latestVideo?.status),
    canCreateVideo: isDownloadReady(music.createdAt) && Boolean(music.mp3Url),
    canDownloadVideo: Boolean(latestVideo?.mp4Url && latestVideo.status === VideoStatus.COMPLETED),
    duration: music.duration ?? null,
    errorMessage: music.errorMessage ?? null,
  };
}

export function toRecentMusicItem(music: Music): RecentMusicItem {
  return {
    id: music.id,
    title: getMusicTitle(music),
    status: "completed",
    createdAt: music.createdAt.toISOString(),
    lyrics: music.lyrics ?? null,
    imageUrl: resolveMusicImageUrl(music),
    mp3Url: music.mp3Url ?? "",
    mp4Url: music.videoUrl ?? null,
    providerTaskId: music.providerTaskId ?? null,
    tags: null,
  };
}

