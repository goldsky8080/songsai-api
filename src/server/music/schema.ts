import { z } from "zod";

export const createMusicSchema = z.object({
  title: z.string().trim().max(120).optional(),
  lyrics: z.string().max(5000).default(""),
  stylePrompt: z.string().min(2).max(900),
  lyricMode: z.enum(["manual", "auto", "ai_lyrics"]).default("manual"),
  isMr: z.boolean().default(false),
  vocalGender: z.enum(["auto", "female", "male"]).default("auto"),
  trackCount: z.literal(1).default(1),
  modelVersion: z.enum(["v4_5_plus", "v5", "v5_5"]).default("v5_5"),
});

export type CreateMusicRequest = z.infer<typeof createMusicSchema>;

