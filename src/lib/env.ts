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
  RESEND_API_KEY: emptyStringToUndefined,
  RESEND_FROM_EMAIL: emptyStringToUndefined,
  EMAIL_VERIFY_BASE_URL: emptyStringToUndefined,
  EMAIL_VERIFY_TOKEN_TTL_MINUTES: emptyStringToUndefined,
  PASSWORD_RESET_BASE_URL: emptyStringToUndefined,
  PASSWORD_RESET_TOKEN_TTL_MINUTES: emptyStringToUndefined,
  INBOUND_WEBHOOK_SECRET: emptyStringToUndefined,
  SUPPORT_INBOX_EMAIL: emptyStringToUndefined,
  SUNO_COOKIE: emptyStringToUndefined,
  ACE_STEP_API_BASE_URL: emptyStringToUndefined,
  ACE_STEP_API_KEY: emptyStringToUndefined,
  ACE_STEP_TIMEOUT_MS: emptyStringToUndefined,
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
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    EMAIL_VERIFY_BASE_URL: process.env.EMAIL_VERIFY_BASE_URL,
    EMAIL_VERIFY_TOKEN_TTL_MINUTES: process.env.EMAIL_VERIFY_TOKEN_TTL_MINUTES,
    PASSWORD_RESET_BASE_URL: process.env.PASSWORD_RESET_BASE_URL,
    PASSWORD_RESET_TOKEN_TTL_MINUTES: process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
    INBOUND_WEBHOOK_SECRET: process.env.INBOUND_WEBHOOK_SECRET,
    SUPPORT_INBOX_EMAIL: process.env.SUPPORT_INBOX_EMAIL,
    SUNO_COOKIE: process.env.SUNO_COOKIE,
    ACE_STEP_API_BASE_URL: process.env.ACE_STEP_API_BASE_URL,
    ACE_STEP_API_KEY: process.env.ACE_STEP_API_KEY,
    ACE_STEP_TIMEOUT_MS: process.env.ACE_STEP_TIMEOUT_MS,
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

