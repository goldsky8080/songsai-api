import { z } from "zod";

const emptyStringToUndefined = z.preprocess((value) => {
  if (value === "") {
    return undefined;
  }

  return value;
}, z.string().optional());

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url(),
  FRONTEND_URL: z.string().url().optional(),
  FRONTEND_URLS: emptyStringToUndefined,
  AUTH_SECRET: z.string().min(16),
  WORKER_SECRET: emptyStringToUndefined,
  GOOGLE_CLIENT_ID: emptyStringToUndefined,
  GOOGLE_CLIENT_SECRET: emptyStringToUndefined,
  SUNO_COOKIE: emptyStringToUndefined,
  TWOCAPTCHA_KEY: emptyStringToUndefined,
  BROWSER: emptyStringToUndefined,
  BROWSER_GHOST_CURSOR: emptyStringToUndefined,
  BROWSER_LOCALE: emptyStringToUndefined,
  BROWSER_HEADLESS: emptyStringToUndefined,
  BROWSER_MANUAL_CAPTCHA: emptyStringToUndefined,
  BROWSER_MANUAL_CAPTCHA_TIMEOUT_MS: emptyStringToUndefined,
  BROWSER_PROFILE_DIR: emptyStringToUndefined,
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsedEnv = envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    APP_URL: process.env.APP_URL,
    FRONTEND_URL: process.env.FRONTEND_URL,
    FRONTEND_URLS: process.env.FRONTEND_URLS,
    AUTH_SECRET: process.env.AUTH_SECRET,
    WORKER_SECRET: process.env.WORKER_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    SUNO_COOKIE: process.env.SUNO_COOKIE,
    TWOCAPTCHA_KEY: process.env.TWOCAPTCHA_KEY,
    BROWSER: process.env.BROWSER,
    BROWSER_GHOST_CURSOR: process.env.BROWSER_GHOST_CURSOR,
    BROWSER_LOCALE: process.env.BROWSER_LOCALE,
    BROWSER_HEADLESS: process.env.BROWSER_HEADLESS,
    BROWSER_MANUAL_CAPTCHA: process.env.BROWSER_MANUAL_CAPTCHA,
    BROWSER_MANUAL_CAPTCHA_TIMEOUT_MS: process.env.BROWSER_MANUAL_CAPTCHA_TIMEOUT_MS,
    BROWSER_PROFILE_DIR: process.env.BROWSER_PROFILE_DIR,
  });

  cachedEnv = parsedEnv;
  return parsedEnv;
}
