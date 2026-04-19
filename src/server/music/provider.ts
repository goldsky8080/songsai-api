import type { AudioInfo } from "@/lib/SunoApi";
import { DEFAULT_MODEL, sunoApi } from "@/lib/SunoApi";
import { getEnv } from "@/lib/env";
import type { AlignedLyricLine } from "./aligned-lyrics";
import { buildAlignedLyricLines } from "./aligned-lyrics";
import type { CreateMusicRequest } from "./schema";
import type { ProviderAlignedLyricWord, ProviderMusicResult } from "./types";

type AceStepApiResponse = {
  item?: Record<string, unknown>;
  provider?: unknown;
  providerTaskId?: unknown;
  title?: unknown;
  lyrics?: unknown;
  generatedLyrics?: unknown;
  stylePrompt?: unknown;
  status?: unknown;
  mp3Url?: unknown;
  videoUrl?: unknown;
  imageUrl?: unknown;
  imageLargeUrl?: unknown;
  duration?: unknown;
  errorMessage?: unknown;
};

function resolveModelVersion(modelVersion?: "v4_5_plus" | "v5" | "v5_5" | "ace_step_1_5") {
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
  if (input.provider === "ace_step") {
    return createMusicWithAceStep(input);
  }

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
    provider: "SUNO",
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

async function createMusicWithAceStep(input: CreateMusicRequest): Promise<ProviderMusicResult> {
  const env = getEnv();

  if (!env.ACE_STEP_API_BASE_URL) {
    throw new Error("ACE-Step API base URL is not configured.");
  }

  const controller = new AbortController();
  const parsedTimeout = Number.parseInt(env.ACE_STEP_TIMEOUT_MS ?? "600000", 10);
  const timeoutMs = Number.isFinite(parsedTimeout) ? parsedTimeout : 600000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(new URL("/api/v1/music", env.ACE_STEP_API_BASE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.ACE_STEP_API_KEY ? { Authorization: `Bearer ${env.ACE_STEP_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        title: input.title,
        lyrics: input.lyrics,
        stylePrompt: input.stylePrompt,
        provider: "ace_step",
        model: input.model ?? "acestep-v15-turbo",
        modelVersion: input.modelVersion === "ace_step_1_5" ? input.modelVersion : "ace_step_1_5",
        duration: input.duration ?? 120,
        thinking: false,
        vocalLanguage: "ko",
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const payload = await parseAceStepResponse(response);

    if (!response.ok) {
      throw new Error(
        readAceStepString(payload.errorMessage) ??
          `ACE-Step API request failed with status ${response.status}.`,
      );
    }

    const normalizedPayload = payload.item && typeof payload.item === "object" ? payload.item : payload;
    const providerTaskId = readAceStepString(normalizedPayload.providerTaskId);

    if (!providerTaskId) {
      throw new Error("ACE-Step API did not return providerTaskId.");
    }

    return {
      provider: "ACE_STEP",
      providerTaskId,
      title: readAceStepString(normalizedPayload.title) ?? input.title,
      status: normalizeProviderStatus(readAceStepString(normalizedPayload.status) ?? "completed"),
      mp3Url: readAceStepString(normalizedPayload.mp3Url) ?? undefined,
      videoUrl: readAceStepString(normalizedPayload.videoUrl) ?? undefined,
      imageUrl: readAceStepString(normalizedPayload.imageUrl) ?? undefined,
      imageLargeUrl: readAceStepString(normalizedPayload.imageLargeUrl) ?? undefined,
      generatedLyrics:
        readAceStepString(normalizedPayload.generatedLyrics) ??
        readAceStepString(normalizedPayload.lyrics) ??
        input.lyrics,
      providerPrompt: readAceStepString(normalizedPayload.stylePrompt) ?? input.stylePrompt,
      duration: readAceStepDuration(normalizedPayload.duration),
      errorMessage: readAceStepString(normalizedPayload.errorMessage) ?? undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function parseAceStepResponse(response: Response): Promise<AceStepApiResponse> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as AceStepApiResponse;
  } catch {
    throw new Error("ACE-Step API returned invalid JSON.");
  }
}

function readAceStepString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readAceStepDuration(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.round(value));
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return undefined;
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
      provider: "SUNO",
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

export async function getAlignedLyricDataFromProvider(providerTaskId: string): Promise<{
  alignedWords: ProviderAlignedLyricWord[];
  alignedLines: AlignedLyricLine[];
}> {
  const response = await (await sunoApi(getEnv().SUNO_COOKIE)).getLyricAlignment(providerTaskId);

  const alignedWords =
    response && typeof response === "object" && Array.isArray((response as { aligned_words?: unknown }).aligned_words)
      ? ((response as { aligned_words: unknown[] }).aligned_words
          .map((item): ProviderAlignedLyricWord | null => {
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
          })
          .filter((item): item is ProviderAlignedLyricWord => item !== null))
      : [];

  const alignedLinesFromProvider =
    response && typeof response === "object" && Array.isArray((response as { aligned_lyrics?: unknown }).aligned_lyrics)
      ? ((response as { aligned_lyrics: unknown[] }).aligned_lyrics
          .map((item): AlignedLyricLine | null => {
            if (!item || typeof item !== "object") {
              return null;
            }

            const text = (item as { text?: unknown }).text;
            const start = (item as { start_s?: unknown }).start_s;
            const end = (item as { end_s?: unknown }).end_s;

            if (typeof text !== "string" || typeof start !== "number" || typeof end !== "number") {
              return null;
            }

            const normalizedText = text.replace(/\s+/g, " ").trim();
            if (!normalizedText) {
              return null;
            }

            return {
              text: normalizedText,
              start_s: start,
              end_s: end,
            };
          })
          .filter((item): item is AlignedLyricLine => item !== null))
      : [];

  return {
    alignedWords,
    alignedLines:
      alignedLinesFromProvider.length > 0 ? alignedLinesFromProvider : buildAlignedLyricLines(alignedWords),
  };
}
