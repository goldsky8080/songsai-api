import type { AudioInfo } from "@/lib/SunoApi";
import { DEFAULT_MODEL, sunoApi } from "@/lib/SunoApi";
import { getEnv } from "@/lib/env";
import type { CreateMusicRequest } from "./schema";
import type { ProviderAlignedLyricWord, ProviderMusicResult } from "./types";

function resolveModelVersion(modelVersion?: "v4_5_plus" | "v5" | "v5_5") {
  if (modelVersion === "v4_5_plus") {
    return "chirp-bluejay";
  }

  if (modelVersion === "v5_5") {
    return "chirp-fenix";
  }

  return "chirp-crow";
}

function normalizeProviderStatus(status?: string): ProviderMusicResult["status"] {
  const normalized = status?.toLowerCase();

  if (normalized === "complete" || normalized === "completed" || normalized === "streaming") {
    return "completed";
  }

  if (normalized === "processing") {
    return "processing";
  }

  if (normalized === "failed" || normalized === "error") {
    return "failed";
  }

  return "queued";
}

export async function createMusicWithProvider(input: CreateMusicRequest): Promise<ProviderMusicResult> {
  const resolvedModel = resolveModelVersion(input.modelVersion);
  const audioInfo = await (await sunoApi(getEnv().SUNO_COOKIE)).custom_generate(
    input.lyrics ?? "",
    input.stylePrompt,
    input.title?.trim() ? input.title.trim() : undefined,
    Boolean(input.isMr),
    resolvedModel || DEFAULT_MODEL,
    false,
    "",
    input.lyricMode !== "manual" ? input.lyrics : undefined,
    {
      create_mode: "custom",
      is_custom: true,
      mv: resolvedModel || DEFAULT_MODEL,
    },
  );

  if (!Array.isArray(audioInfo) || audioInfo.length === 0) {
    throw new Error("Provider did not return any generated tracks.");
  }

  const tracks = audioInfo
    .filter((item) => Boolean(item.id))
    .map((item) => ({
      providerTaskId: item.id,
      title: item.title,
      status: normalizeProviderStatus(item.status),
      mp3Url: item.audio_url,
      videoUrl: item.video_url,
      imageUrl: item.image_url,
      generatedLyrics: item.lyric,
      providerPrompt: item.prompt,
      providerDescriptionPrompt: item.gpt_description_prompt,
      tags: item.tags,
      duration: item.duration,
    }));

  const primaryTrack = tracks[0];

  if (!primaryTrack) {
    throw new Error("Provider did not return a usable primary track.");
  }

  return {
    providerTaskId: tracks.map((track) => track.providerTaskId).join(","),
    title: primaryTrack.title,
    status: primaryTrack.status,
    mp3Url: primaryTrack.mp3Url,
    videoUrl: primaryTrack.videoUrl,
    imageUrl: primaryTrack.imageUrl,
    generatedLyrics: primaryTrack.generatedLyrics,
    providerPrompt: primaryTrack.providerPrompt,
    providerDescriptionPrompt: primaryTrack.providerDescriptionPrompt,
    tags: primaryTrack.tags,
    duration: primaryTrack.duration,
    tracks,
  };
}

function mapAudioInfoToProviderTrack(item: AudioInfo) {
  return {
    providerTaskId: item.id,
    title: item.title,
    status: normalizeProviderStatus(item.status),
    mp3Url: item.audio_url,
    videoUrl: item.video_url,
    imageUrl: item.image_url,
    generatedLyrics: item.lyric,
    providerPrompt: item.prompt,
    providerDescriptionPrompt: item.gpt_description_prompt,
    tags: item.tags,
    duration: item.duration,
  };
}

export async function getMusicStatusFromProvider(
  providerTaskIds: string[],
): Promise<ProviderMusicResult[]> {
  if (providerTaskIds.length === 0) {
    return [];
  }

  const audioInfo = await (await sunoApi(getEnv().SUNO_COOKIE)).get(providerTaskIds);

  return audioInfo.map((item) => {
    const mapped = mapAudioInfoToProviderTrack(item);

    return {
      providerTaskId: mapped.providerTaskId,
      title: mapped.title,
      status: mapped.status,
      mp3Url: mapped.mp3Url,
      videoUrl: mapped.videoUrl,
      imageUrl: mapped.imageUrl,
      generatedLyrics: mapped.generatedLyrics,
      providerPrompt: mapped.providerPrompt,
      providerDescriptionPrompt: mapped.providerDescriptionPrompt,
      tags: mapped.tags,
      duration: mapped.duration,
      errorMessage: item.error_message,
      tracks: [mapped],
    } satisfies ProviderMusicResult;
  });
}

export async function getAlignedLyricsFromProvider(
  providerTaskId: string,
): Promise<ProviderAlignedLyricWord[]> {
  const response = await (await sunoApi(getEnv().SUNO_COOKIE)).getLyricAlignment(providerTaskId);

  const alignedWords =
    response && typeof response === "object" && Array.isArray((response as { aligned_words?: unknown }).aligned_words)
      ? (response as { aligned_words: unknown[] }).aligned_words
      : [];

  if (alignedWords.length === 0) {
    return [];
  }

  const mapped = alignedWords.map((item): ProviderAlignedLyricWord | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const word = (item as { word?: unknown }).word;
      const start = (item as { start_s?: unknown }).start_s;
      const end = (item as { end_s?: unknown }).end_s;

      if (typeof word !== "string" || typeof start !== "number" || typeof end !== "number") {
        return null;
      }

      return {
        word,
        start_s: start,
        end_s: end,
        success:
          typeof (item as { success?: unknown }).success === "boolean"
            ? ((item as { success?: boolean }).success ?? undefined)
            : undefined,
        p_align:
          typeof (item as { p_align?: unknown }).p_align === "number"
            ? ((item as { p_align?: number }).p_align ?? undefined)
            : undefined,
      };
    });

  return mapped.filter((item): item is ProviderAlignedLyricWord => item !== null);
}


