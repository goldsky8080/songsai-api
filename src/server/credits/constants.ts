import type { MusicProvider } from "@/server/music/types";

export const FREE_CREDIT_DAYS = 30;

export const MUSIC_GENERATION_COSTS: Record<MusicProvider, number> = {
  suno: 10,
  ace_step: 8,
};

export function getMusicGenerationCost(provider: MusicProvider) {
  return MUSIC_GENERATION_COSTS[provider] ?? MUSIC_GENERATION_COSTS.suno;
}
