import type { MusicProvider } from "@/server/music/types";

export const FREE_CREDIT_DAYS = 30;
export const SIGNUP_FREE_CREDITS = 300;

export const MUSIC_GENERATION_COSTS: Record<MusicProvider, number> = {
  suno: 7,
  ace_step: 2,
};

export function getMusicGenerationCost(provider: MusicProvider) {
  return MUSIC_GENERATION_COSTS[provider] ?? MUSIC_GENERATION_COSTS.suno;
}
