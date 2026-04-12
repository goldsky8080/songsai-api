import { z } from "zod";

export const createMusicSchema = z
  .object({
    title: z.string().min(1).max(120).default("제목 없는 곡"),
    lyrics: z.string().max(5000).default(""),
    stylePrompt: z.string().min(2).max(500),
    lyricMode: z.enum(["manual", "auto", "ai_lyrics"]).default("manual"),
    isMr: z.boolean().default(false),
    vocalGender: z.enum(["auto", "female", "male"]).default("auto"),
    trackCount: z.literal(1).default(1),
    modelVersion: z.enum(["v4_5_plus", "v5", "v5_5"]).default("v5_5"),
  })
  .superRefine((data, ctx) => {
    if (!data.isMr && data.lyricMode !== "auto" && data.lyrics.trim().length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lyrics"],
        message: "가사는 10자 이상 입력해 주세요.",
      });
    }
  });

export type CreateMusicRequest = z.infer<typeof createMusicSchema>;
