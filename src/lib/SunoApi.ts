import axios, { AxiosInstance } from 'axios';
import UserAgent from 'user-agents';
import pino from 'pino';
import yn from 'yn';
import { isPage, sleep, waitForRequests } from '@/lib/utils';
import * as cookie from 'cookie';
import { randomUUID } from 'node:crypto';
import { Solver } from '@2captcha/captcha-solver';
import { paramsCoordinates } from '@2captcha/captcha-solver/dist/structs/2captcha';
import { BrowserContext, Page, Locator, chromium, firefox } from 'rebrowser-playwright-core';
import { createCursor, Cursor } from 'ghost-cursor-playwright';
import { promises as fs } from 'fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// sunoApi instance caching
const globalForSunoApi = global as unknown as { sunoApiCache?: Map<string, SunoApi> };
const cache = globalForSunoApi.sunoApiCache || new Map<string, SunoApi>();
globalForSunoApi.sunoApiCache = cache;

const logger = pino();
export const DEFAULT_MODEL = 'chirp-v3-5';

export interface AudioInfo {
  id: string; // Unique identifier for the audio
  title?: string; // Title of the audio
  image_url?: string; // URL of the image associated with the audio
  lyric?: string; // Lyrics of the audio
  audio_url?: string; // URL of the audio file
  video_url?: string; // URL of the video associated with the audio
  created_at: string; // Date and time when the audio was created
  model_name: string; // Name of the model used for audio generation
  gpt_description_prompt?: string; // Prompt for GPT description
  prompt?: string; // Prompt for audio generation
  status: string; // Status
  type?: string;
  tags?: string; // Genre of music.
  negative_tags?: string; // Negative tags of music.
  duration?: string; // Duration of the audio
  error_message?: string; // Error message if any
}

interface PersonaResponse {
  persona: {
    id: string;
    name: string;
    description: string;
    image_s3_id: string;
    root_clip_id: string;
    clip: any; // You can define a more specific type if needed
    user_display_name: string;
    user_handle: string;
    user_image_url: string;
    persona_clips: Array<{
      clip: any; // You can define a more specific type if needed
    }>;
    is_suno_persona: boolean;
    is_trashed: boolean;
    is_owned: boolean;
    is_public: boolean;
    is_public_approved: boolean;
    is_loved: boolean;
    upvote_count: number;
    clip_count: number;
  };
  total_results: number;
  current_page: number;
  is_following: boolean;
}

type GenerationMetadata = {
  create_mode?: string;
  is_custom?: boolean;
  mv?: string;
  vocal_gender?: string;
  web_client_pathname?: string;
  [key: string]: any;
};

type CaptchaCreateContext = {
  prompt?: string;
  tags?: string;
  title?: string;
  gpt_description_prompt?: string;
  metadata?: GenerationMetadata;
};

type ManualCaptchaLockState = {
  requestId: string;
  acquiredAt: number;
  expiresAt: number;
};

let manualCaptchaLock: ManualCaptchaLockState | null = null;
class SunoApi {
  private static BASE_URL: string = 'https://studio-api.prod.suno.com';
  private static CLERK_BASE_URL: string = 'https://auth.suno.com';
  private static CLERK_VERSION = '5.117.0';

  private readonly client: AxiosInstance;
  private sid?: string;
  private currentToken?: string;
  private deviceId?: string;
  private userAgent?: string;
  private cookies: Record<string, string | undefined>;
  private solver = new Solver(process.env.TWOCAPTCHA_KEY + '');
  private ghostCursorEnabled = yn(process.env.BROWSER_GHOST_CURSOR, { default: false });
  private cursor?: Cursor;

  constructor(cookies: string) {
    this.userAgent = new UserAgent(/Macintosh/).random().toString(); // Usually Mac systems get less amount of CAPTCHAs
    this.cookies = cookie.parse(cookies);
    this.deviceId = this.cookies.ajs_anonymous_id || randomUUID();
    this.client = axios.create({
      withCredentials: true,
      headers: {
        'Affiliate-Id': 'undefined',
        'Device-Id': `"${this.deviceId}"`,
        'x-suno-client': 'Android prerelease-4nt180t 1.0.42',
        'X-Requested-With': 'com.suno.android',
        'sec-ch-ua': '"Chromium";v="130", "Android WebView";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'User-Agent': this.userAgent
      }
    });
    this.client.interceptors.request.use(config => {
      if (this.currentToken && !config.headers.Authorization)
        config.headers.Authorization = `Bearer ${this.currentToken}`;
      const cookiesArray = Object.entries(this.cookies).map(([key, value]) =>
        cookie.serialize(key, value as string)
      );
      config.headers.Cookie = cookiesArray.join('; ');
      return config;
    });
    this.client.interceptors.response.use(resp => {
      const setCookieHeader = resp.headers['set-cookie'];
      if (Array.isArray(setCookieHeader)) {
        const newCookies = cookie.parse(setCookieHeader.join('; '));
        for (const [key, value] of Object.entries(newCookies)) {
          this.cookies[key] = value;
        }
      }
      return resp;
    })
  }

  public async init(): Promise<SunoApi> {
    //await this.getClerkLatestVersion();
    await this.getAuthToken();
    await this.keepAlive();
    return this;
  }

  /**
   * Get the clerk package latest version id.
   * This method is commented because we are now using a hard-coded Clerk version, hence this method is not needed.
   
  private async getClerkLatestVersion() {
    // URL to get clerk version ID
    const getClerkVersionUrl = `${SunoApi.JSDELIVR_BASE_URL}/v1/package/npm/@clerk/clerk-js`;
    // Get clerk version ID
    const versionListResponse = await this.client.get(getClerkVersionUrl);
    if (!versionListResponse?.data?.['tags']['latest']) {
      throw new Error(
        'Failed to get clerk version info, Please try again later'
      );
    }
    // Save clerk version ID for auth
    SunoApi.clerkVersion = versionListResponse?.data?.['tags']['latest'];
  }
  */

  /**
   * Get the session ID and save it for later use.
   */
  private async getAuthToken() {
    logger.info('Getting the session ID');
    // URL to get session ID
    const getSessionUrl = `${SunoApi.CLERK_BASE_URL}/v1/client?__clerk_api_version=2025-11-10&_clerk_js_version=${SunoApi.CLERK_VERSION}`;
    // Get session ID
    const sessionResponse = await this.client.get(getSessionUrl, {
      headers: { Authorization: this.cookies.__client }
    });
    if (!sessionResponse?.data?.response?.last_active_session_id) {
      throw new Error(
        'Failed to get session id, you may need to update the SUNO_COOKIE'
      );
    }
    // Save session ID for later use
    this.sid = sessionResponse.data.response.last_active_session_id;
  }

  /**
   * Keep the session alive.
   * @param isWait Indicates if the method should wait for the session to be fully renewed before returning.
   */
  public async keepAlive(isWait?: boolean): Promise<void> {
    if (!this.sid) {
      throw new Error('Session ID is not set. Cannot renew token.');
    }
    // URL to renew session token
    const renewUrl = `${SunoApi.CLERK_BASE_URL}/v1/client/sessions/${this.sid}/tokens?__clerk_api_version=2025-11-10&_clerk_js_version=${SunoApi.CLERK_VERSION}`;
    // Renew session token
    logger.info('KeepAlive...\n');
    const renewResponse = await this.client.post(renewUrl, {}, {
      headers: { Authorization: this.cookies.__client }
    });
    if (isWait) {
      await sleep(1, 2);
    }
    const newToken = renewResponse.data.jwt;
    // Update Authorization field in request header with the new JWT token
    this.currentToken = newToken;
  }

  /**
   * Get the session token (not to be confused with session ID) and save it for later use.
   */
  private async getSessionToken() {
    const tokenResponse = await this.client.post(
      `${SunoApi.BASE_URL}/api/user/create_session_id/`,
      {
        session_properties: JSON.stringify({ deviceId: this.deviceId }),
        session_type: 1
      }
    );
    return tokenResponse.data.session_id;
  }

  private async captchaRequired(): Promise<boolean> {
    const resp = await this.client.post(`${SunoApi.BASE_URL}/api/c/check`, {
      ctype: 'generation'
    });
    logger.info(resp.data);
    return resp.data.required;
  }

  /**
   * Clicks on a locator or XY vector. This method is made because of the difference between ghost-cursor-playwright and Playwright methods
   */
  private async click(target: Locator | Page, position?: { x: number, y: number }): Promise<void> {
    if (this.ghostCursorEnabled) {
      let pos: any = isPage(target) ? { x: 0, y: 0 } : await target.boundingBox();
      if (position)
        pos = {
          ...pos,
          x: pos.x + position.x,
          y: pos.y + position.y,
          width: null,
          height: null,
        };
      return this.cursor?.actions.click({
        target: pos
      });
    } else {
      if (isPage(target))
        return target.mouse.click(position?.x ?? 0, position?.y ?? 0);
      else
        return target.click({ force: true, position });
    }
  }

  /**
   * Get the BrowserType from the `BROWSER` environment variable.
   * @returns {BrowserType} chromium, firefox or webkit. Default is chromium
   */
  private getBrowserType() {
    const browser = process.env.BROWSER?.toLowerCase();
    switch (browser) {
      case 'firefox':
        return firefox;
      /*case 'webkit': ** doesn't work with rebrowser-patches
      case 'safari':
        return webkit;*/
      default:
        return chromium;
    }
  }

  /**
   * Returns the persistent browser profile directory when configured.
   */
  private getBrowserProfileDir(): string | null {
    const configured = process.env.BROWSER_PROFILE_DIR?.trim();
    return configured ? configured : null;
  }

  /**
   * Closes a BrowserContext and its owning browser when needed.
   */
  private async closeBrowserContext(context: BrowserContext): Promise<void> {
    const owningBrowser = context.browser();
    if (owningBrowser) {
      await owningBrowser.close();
      return;
    }
    await context.close();
  }

  /**
   * Launches a browser with the necessary cookies
   * @returns {BrowserContext}
   */
  private async launchBrowser(): Promise<BrowserContext> {
    const args = [
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=site-per-process',
      '--disable-features=IsolateOrigins',
      '--disable-extensions',
      '--disable-infobars'
    ];
    if (yn(process.env.BROWSER_DISABLE_GPU, { default: false }))
      args.push('--enable-unsafe-swiftshader',
        '--disable-gpu',
        '--disable-setuid-sandbox');

    const headless = yn(process.env.BROWSER_HEADLESS, { default: true });
    const browserType = this.getBrowserType();
    const profileDir = this.getBrowserProfileDir();

    let context: BrowserContext;
    if (profileDir) {
      logger.info({ profileDir, headless }, 'Launching persistent browser context');
      context = await browserType.launchPersistentContext(profileDir, {
        args,
        headless,
        userAgent: this.userAgent,
        locale: process.env.BROWSER_LOCALE,
        viewport: null
      });
    } else {
      const browser = await browserType.launch({
        args,
        headless
      });
      context = await browser.newContext({ userAgent: this.userAgent, locale: process.env.BROWSER_LOCALE, viewport: null });
    }

    const cookieUrl = 'https://suno.com';
    const lax: 'Lax' | 'Strict' | 'None' = 'Lax';
    const browserCookies: Array<{ name: string; value: string; url: string; sameSite: 'Lax' | 'Strict' | 'None' }> = [];
    const sessionValue = String(this.currentToken || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();

    if (sessionValue) {
      browserCookies.push({
        name: '__session',
        value: sessionValue,
        url: cookieUrl,
        sameSite: lax
      });
    } else {
      logger.warn('Missing valid __session bootstrap token. Relying on persistent browser session only.');
    }

    if (browserCookies.length > 0) {
      logger.info({ cookieCount: browserCookies.length }, 'Adding cookies to Playwright context');
      await context.addCookies(browserCookies);
    }
    return context;
  }
  private async resetCookieConsentState(context: BrowserContext): Promise<void> {
    const expiredAt = 1;
    const sameSite: 'Lax' | 'Strict' | 'None' = 'Lax';
    const consentCookies = [
      'OptanonConsent',
      'OptanonAlertBoxClosed',
      'OneTrustGPC',
      'cookie_consent',
      'cookieConsent'
    ];

    const expiredCookies = consentCookies.flatMap((name) => ([
      { name, value: '', domain: 'suno.com', path: '/', expires: expiredAt, sameSite },
      { name, value: '', domain: '.suno.com', path: '/', expires: expiredAt, sameSite },
      { name, value: '', url: 'https://suno.com', expires: expiredAt, sameSite }
    ]));

    await context.addCookies(expiredCookies).catch(() => null);
    await context.addInitScript(() => {
      const fragments = ['optanon', 'consent', 'cookie'];
      const clearMatchingStorage = (storage: Storage) => {
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (!key)
            continue;
          const lowered = key.toLowerCase();
          if (fragments.some((fragment) => lowered.includes(fragment))) {
            keys.push(key);
          }
        }
        for (const key of keys) {
          storage.removeItem(key);
        }
      };

      try {
        clearMatchingStorage(window.localStorage);
      } catch {}
      try {
        clearMatchingStorage(window.sessionStorage);
      } catch {}
    });
  }

  private async nativeClickLocator(button: Locator): Promise<boolean> {
    if (process.platform !== 'linux' || !process.env.DISPLAY)
      return false;

    try {
      const box = await button.boundingBox();
      if (!box)
        return false;

      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height / 2);
      const rawWindowIds = execFileSync('xdotool', ['search', '--onlyvisible', '--class', 'chromium']).toString().trim();
      const windowId = rawWindowIds.split(/\s+/).pop();
      if (!windowId)
        return false;

      execFileSync('xdotool', ['windowactivate', '--sync', windowId], { stdio: 'ignore' });
      execFileSync('xdotool', ['mousemove', '--window', windowId, String(x), String(y)], { stdio: 'ignore' });
      await sleep(0.8, 1.1);
      execFileSync('xdotool', ['click', '1'], { stdio: 'ignore' });
      logger.info({ method: 'xdotool-window-click', windowId, x, y }, 'Clicked Create button for manual CAPTCHA flow');
      return true;
    } catch (error: any) {
      logger.warn({ error: error?.message }, 'Native xdotool click failed');
      return false;
    }
  }

  /**
   * Checks for CAPTCHA verification and solves the CAPTCHA if needed
   * @returns {string|null} hCaptcha token. If no verification is required, returns null
   */
  public async getCaptcha(createContext?: CaptchaCreateContext): Promise<string | null> {
    if (!await this.captchaRequired())
      return null;

    const manualCaptcha = yn(process.env.BROWSER_MANUAL_CAPTCHA, { default: false });
    const manualTimeoutMs = Number(process.env.BROWSER_MANUAL_CAPTCHA_TIMEOUT_MS || 300000);
    const manualLockRequestId = manualCaptcha ? randomUUID() : null;

    if (manualCaptcha) {
      const now = Date.now();
      if (manualCaptchaLock && manualCaptchaLock.expiresAt > now) {
        logger.warn({
          activeRequestId: manualCaptchaLock.requestId,
          acquiredAt: manualCaptchaLock.acquiredAt,
          expiresAt: manualCaptchaLock.expiresAt
        }, 'Manual CAPTCHA lock already active');
        throw new Error('Another manual CAPTCHA flow is already in progress. Please try again shortly.');
      }

      manualCaptchaLock = {
        requestId: manualLockRequestId!,
        acquiredAt: now,
        expiresAt: now + manualTimeoutMs + 60000
      };
      logger.info({ requestId: manualLockRequestId, expiresAt: manualCaptchaLock.expiresAt }, 'Acquired manual CAPTCHA lock');
    }

    try {

    logger.info('CAPTCHA required. Launching browser...')
    const browser = await this.launchBrowser();
    const page = await browser.newPage();
    const dismissCookieBanner = async () => {
      const cookieButtons = [
        page.getByRole('button', { name: /accept all cookies/i }),
        page.getByRole('button', { name: /accept all/i }),
        page.getByText(/accept all cookies/i),
        page.locator('button:has-text("Accept All Cookies")'),
        page.locator('button:has-text("Accept All")')
      ];

      for (const candidate of cookieButtons) {
        try {
          const button = candidate.first();
          await button.waitFor({ state: 'visible', timeout: 1500 });
          await button.click({ force: true });
          logger.info('Accepted cookie banner automatically');
          return true;
        } catch {
        }
      }

      return false;
    };
    await page.goto('https://suno.com/create', { referer: 'https://www.google.com/', waitUntil: 'domcontentloaded', timeout: 0 });
    await dismissCookieBanner().catch(() => false);

    logger.info('Waiting for Suno interface to load');
    const lyricsInput = page.getByTestId('lyrics-textarea').or(page.locator('textarea[placeholder*="Write some lyrics"]')).or(page.locator('.custom-textarea textarea'));
    const styleInput = page.getByPlaceholder(/Describe the sound you want/i)
      .or(page.getByPlaceholder(/bass line/i))
      .or(page.locator('textarea[maxlength="500"]'))
      .or(page.locator('textarea[maxlength="1000"]'));
    const titleInput = page.getByPlaceholder(/title/i)
      .or(page.locator('input[name="title"]'))
      .or(page.locator('input[placeholder*="Title"]'))
      .or(page.locator('input[placeholder*="title"]'));
    const fillField = async (locator: Locator, value?: string, timeout: number = 4000) => {
      const text = value?.trim();
      if (!text)
        return false;
      try {
        const field = locator.first();
        await field.waitFor({ state: 'visible', timeout });
        await this.click(field);
        await field.fill('');
        await field.pressSequentially(text, { delay: 25 });
        return true;
      } catch {
        return false;
      }
    };
    await Promise.race([
      page.waitForResponse(
        (response) => response.url().includes('/api/project/') && response.request().method() === 'GET',
        { timeout: 90000 }
      ).catch(() => null),
      lyricsInput.first().waitFor({ state: 'visible', timeout: 90000 }).catch(() => null),
      page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => null)
    ]);

    if (this.ghostCursorEnabled)
      this.cursor = await createCursor(page);

    logger.info('Triggering the CAPTCHA');
    try {
      await page.getByLabel('Close').click({ timeout: 2000 });
    } catch (e) { }

    try {
      await lyricsInput.first().waitFor({ state: 'visible', timeout: 90000 });
    } catch {
      logger.info('Text input not visible after CAPTCHA wait. Reloading once and retrying.');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => null);
      await dismissCookieBanner().catch(() => false);
      await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => null);
      await lyricsInput.first().waitFor({ state: 'visible', timeout: 90000 });
    }

    const createMode = `${createContext?.metadata?.create_mode || ''}`.trim().toLowerCase();
    const hasAiDescriptionPrompt = Boolean(createContext?.gpt_description_prompt?.trim());
    const shouldLeaveLyricsEmpty = hasAiDescriptionPrompt || createMode.includes('ai') || createMode.includes('auto');
    const lyricsText = shouldLeaveLyricsEmpty ? '' : (createContext?.prompt?.trim() || '');
    const styleText = shouldLeaveLyricsEmpty
      ? [createContext?.tags?.trim(), createContext?.gpt_description_prompt?.trim()].filter(Boolean).join(', ')
      : (createContext?.tags?.trim() || '');
    const titleText = createContext?.title?.trim() || '';

    logger.info({
      createMode,
      hasAiDescriptionPrompt,
      shouldLeaveLyricsEmpty,
      lyricsLength: lyricsText.length,
      styleLength: styleText.length,
      titleLength: titleText.length
    }, 'Prepared manual CAPTCHA field values');

    try {
      const lyricsField = lyricsInput.first();
      await lyricsField.waitFor({ state: 'visible', timeout: 90000 });
      await this.click(lyricsField).catch(() => null);
      await lyricsField.fill('');
      if (lyricsText) {
        await lyricsField.pressSequentially(lyricsText, { delay: 25 });
        logger.info({ lyricsLength: lyricsText.length }, 'Filled lyrics field for manual CAPTCHA flow');
      } else {
        logger.info('Left lyrics field empty for manual CAPTCHA flow');
      }
    } catch (error: any) {
      logger.warn({ error: error?.message }, 'Unable to set lyrics field for manual CAPTCHA flow');
    }

    if (styleText) {
      const styleFilled = await fillField(styleInput, styleText);
      logger.info({ styleFilled, styleText }, 'Filled style field for manual CAPTCHA flow');
      await sleep(0.8, 1.2);
    }

    if (titleText) {
      const titleFilled = await fillField(titleInput, titleText);
      logger.info({ titleFilled, titleText }, 'Filled title field for manual CAPTCHA flow');
      await sleep(0.5, 0.9);
    }

    const clickCreateButton = async () => {
      const candidateLocators = [
        page.getByRole('button', { name: /^create$/i }),
        page.getByRole('button', { name: /create/i }),
        page.locator('button[aria-label="Create"]'),
        page.locator('button:has-text("Create")'),
        page.locator('[role="button"]:has-text("Create")')
      ];

      type CreateCandidate = {
        button: any;
        source: string;
        text: string;
        box: { x: number; y: number; width: number; height: number };
        score: number;
      };

      const rankedCandidates: CreateCandidate[] = [];

      for (const [index, candidate] of candidateLocators.entries()) {
        try {
          const count = await candidate.count().catch(() => 0);
          for (let i = 0; i < count; i++) {
            try {
              const button = candidate.nth(i);
              await button.waitFor({ state: 'visible', timeout: 1500 }).catch(() => null);
              const box = await button.boundingBox();
              if (!box || box.width < 80 || box.height < 24)
                continue;

              const text = ((await button.innerText().catch(() => '')) || '').trim();
              let score = box.y * 10 + box.width + box.height;

              if (/^create$/i.test(text))
                score += 5000;
              else if (/create/i.test(text))
                score += 2500;

              if (box.width >= 180)
                score += 1500;
              if (box.height >= 40)
                score += 500;
              if (box.y >= 500)
                score += 2500;

              rankedCandidates.push({
                button,
                source: `candidate-${index}-nth-${i}`,
                text,
                box,
                score
              });
            } catch {
            }
          }
        } catch {
        }
      }

      rankedCandidates.sort((a, b) => b.score - a.score);

      logger.info({
        candidates: rankedCandidates.slice(0, 5).map((candidate) => ({
          source: candidate.source,
          text: candidate.text,
          x: Math.round(candidate.box.x),
          y: Math.round(candidate.box.y),
          width: Math.round(candidate.box.width),
          height: Math.round(candidate.box.height),
          score: Math.round(candidate.score)
        }))
      }, 'Ranked Create button candidates for manual CAPTCHA flow');

      for (const candidate of rankedCandidates) {
        try {
          const button = candidate.button;
          await button.scrollIntoViewIfNeeded().catch(() => null);
          await button.focus().catch(() => null);
          await button.hover({ force: true }).catch(() => null);
          await sleep(0.8, 1.2);

          logger.info({
            source: candidate.source,
            text: candidate.text,
            x: Math.round(candidate.box.x),
            y: Math.round(candidate.box.y),
            width: Math.round(candidate.box.width),
            height: Math.round(candidate.box.height),
            score: Math.round(candidate.score)
          }, 'Trying Create button candidate for manual CAPTCHA flow');

          const nativeClicked = await this.nativeClickLocator(button);
          if (nativeClicked) {
            if (manualCaptcha) {
              await sleep(1.2, 1.6);
              await this.nativeClickLocator(button).catch(() => false);
              await sleep(0.8, 1.2);
              await button.press('Enter').catch(() => null);
              await sleep(0.5, 0.8);
              await button.press(' ').catch(() => null);
              logger.info({ method: 'xdotool-window-click+delayed-confirm-keys', source: candidate.source }, 'Clicked Create button for manual CAPTCHA flow');
            } else {
              await sleep(0.6, 0.9);
            }
            return true;
          }

          if (manualCaptcha) {
            logger.warn('Native xdotool click unavailable in manual CAPTCHA mode. Falling back to Playwright click methods.');
          }

          try {
            const box = await button.boundingBox();
            if (box) {
              const centerX = box.x + box.width / 2;
              const centerY = box.y + box.height / 2;
              await page.mouse.move(centerX, centerY, { steps: 20 });
              await sleep(0.8, 1.1);
              await page.mouse.click(centerX, centerY);
              await sleep(0.5, 0.8);
              await page.mouse.click(centerX, centerY);
              await button.press('Enter').catch(() => null);
              logger.info({ method: 'hover+double-mouse-click+enter-fallback', source: candidate.source }, 'Clicked Create button for manual CAPTCHA flow');
              return true;
            }
          } catch {
          }

          try {
            await button.click({ timeout: 1500 });
            await sleep(0.5, 0.8);
            await button.click({ timeout: 1500 }).catch(() => null);
            await button.press('Enter').catch(() => null);
            await button.press(' ').catch(() => null);
            logger.info({ method: 'playwright-double-click+keys', source: candidate.source }, 'Clicked Create button for manual CAPTCHA flow');
            return true;
          } catch {
          }

          try {
            await button.evaluate((el: Element) => {
              (el as HTMLElement).click();
            });
            await sleep(0.5, 0.8);
            await button.evaluate((el: Element) => {
              (el as HTMLElement).click();
            }).catch(() => null);
            await button.press('Enter').catch(() => null);
            logger.info({ method: 'dom-double-click+enter', source: candidate.source }, 'Clicked Create button for manual CAPTCHA flow');
            return true;
          } catch {
          }
        } catch {
        }
      }

      return false;
    };

    let manualCaptchaPromise: Promise<string> | null = null;
    if (manualCaptcha) {
      logger.info({ manualTimeoutMs }, 'Manual CAPTCHA mode enabled. Solve the challenge in the opened browser window.');
      manualCaptchaPromise = new Promise<string>((resolve, reject) => {
        const manualMatchStartedAtMs = Date.now();
        let settled = false;
        const timeout = setTimeout(async () => {
          if (settled)
            return;
          try {
            const matched = await this.waitForRecentGeneratedMatch(createContext, manualMatchStartedAtMs, 45000);
            if (matched?.id) {
              clearTimeout(timeout);
              if (!settled) {
                settled = true;
                resolve(`RECENT_MATCH:${matched.id}`);
              }
              return;
            }
          } catch (error) {
          }
          if (settled)
            return;
          settled = true;
          reject(new Error('CAPTCHA token was not acquired in time and no recent generated result matched the request.'));
        }, manualTimeoutMs);

        page.route('**/api/generate/v2/**', async (route: any) => {
          try {
            const request = route.request();
            const requestBody = request.postDataJSON();
            const token = requestBody?.token ?? null;
            await route.abort();

            if (!token) {
              clearTimeout(timeout);
              if (!settled) {
                settled = true;
                reject(new Error('CAPTCHA token missing in generate request.'));
              }
              return;
            }

            this.currentToken = request.headers().authorization?.split('Bearer ').pop();
            logger.info('Manual CAPTCHA solved. Token received.');
            clearTimeout(timeout);
            if (!settled) {
              settled = true;
              resolve(token);
            }
          } catch (err) {
            clearTimeout(timeout);
            if (!settled) {
              settled = true;
              reject(err);
            }
          }
        });
      });
    }

    let createClicked = await clickCreateButton();
    if (!createClicked) {
      logger.info('Create button not found after CAPTCHA. Reloading once and retrying.');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => null);
      await dismissCookieBanner().catch(() => false);
      await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => null);
      await lyricsInput.first().waitFor({ state: 'visible', timeout: 90000 }).catch(() => null);
      createClicked = await clickCreateButton();
    }

    if (!createClicked) {
      await this.closeBrowserContext(browser).catch(() => null);
      throw new Error('Create button not found after CAPTCHA flow');
    }

    if (manualCaptcha && manualCaptchaPromise) {
      try {
        return await manualCaptchaPromise;
      } finally {
        await this.closeBrowserContext(browser).catch(() => null);
      }
    }

    const controller = new AbortController();
    return await new Promise<string | null>((resolve, reject) => {
      let settled = false;

      const finish = (value: string | null) => {
        if (settled)
          return;
        settled = true;
        controller.abort();
        void this.closeBrowserContext(browser).catch(() => null);
        resolve(value);
      };

      const fail = (error: any) => {
        if (settled)
          return;
        settled = true;
        controller.abort();
        void this.closeBrowserContext(browser).catch(() => null);
        reject(error);
      };

      page.route('**/api/generate/v2/**', async (route: any) => {
        try {
          const request = route.request();
          const token = request.postDataJSON()?.token ?? null;
          await route.abort();

          if (!token) {
            fail(new Error('CAPTCHA token missing in generate request.'));
            return;
          }

          logger.info('hCaptcha token received. Closing browser');
          this.currentToken = request.headers().authorization?.split('Bearer ').pop();
          finish(token);
        } catch (err) {
          fail(err);
        }
      });

      (async () => {
        const frame = page.frameLocator('iframe[title*="hCaptcha"]');
        const challenge = frame.locator('.challenge-container');
        try {
          let wait = true;
          while (true) {
            if (wait)
              await waitForRequests(page, controller.signal);

            const prompt = challenge.locator('.prompt-text').first();
            const promptVisible = await prompt.isVisible({ timeout: 5000 }).catch(() => false);
            if (!promptVisible) {
              fail(new Error('hCaptcha challenge prompt did not appear. Manual intervention is required.'));
              return;
            }

            const drag = (await prompt.innerText()).toLowerCase().includes('drag');
            let captcha: any;
            for (let j = 0; j < 3; j++) {
              try {
                logger.info('Sending the CAPTCHA to 2Captcha');
                const payload: paramsCoordinates = {
                  body: (await challenge.screenshot({ timeout: 5000 })).toString('base64'),
                  lang: process.env.BROWSER_LOCALE
                };
                if (drag) {
                  payload.textinstructions = 'CLICK on the shapes at their edge or center as shown above????lease be precise!';
                  payload.imginstructions = (await fs.readFile(path.join(process.cwd(), 'public', 'drag-instructions.jpg'))).toString('base64');
                }
                captcha = await this.solver.coordinates(payload);
                break;
              } catch (err: any) {
                logger.info(err.message);
                if (j != 2)
                  logger.info('Retrying...');
                else
                  throw err;
              }
            }
            if (drag) {
              const challengeBox = await challenge.boundingBox();
              if (challengeBox == null)
                throw new Error('.challenge-container boundingBox is null!');
              if (captcha.data.length % 2) {
                logger.info('Solution does not have even amount of points required for dragging. Requesting new solution...');
                this.solver.badReport(captcha.id);
                wait = false;
                continue;
              }
              for (let i = 0; i < captcha.data.length; i += 2) {
                const data1 = captcha.data[i];
                const data2 = captcha.data[i + 1];
                logger.info(JSON.stringify(data1) + JSON.stringify(data2));
                await page.mouse.move(challengeBox.x + +data1.x, challengeBox.y + +data1.y);
                await page.mouse.down();
                await sleep(1.1);
                await page.mouse.move(challengeBox.x + +data2.x, challengeBox.y + +data2.y, { steps: 30 });
                await page.mouse.up();
              }
              wait = true;
            } else {
              for (const data of captcha.data) {
                logger.info(data);
                await this.click(challenge, { x: +data.x, y: +data.y });
              }
            }
            try {
              await this.click(frame.locator('.button-submit'));
            } catch (e: any) {
              if (e.message.includes('viewport')) {
                const retriggered = await clickCreateButton();
                if (!retriggered) {
                  fail(new Error('Could not retrigger Create button after hCaptcha viewport closed'));
                  return;
                }
              } else {
                throw e;
              }
            }
          }
        } catch (e: any) {
          if (settled)
            return;
          if (e.message.includes('been closed') || e.message === 'AbortError')
            fail(new Error('CAPTCHA flow was interrupted before token acquisition.'));
          else
            fail(e);
        }
      })().catch(fail);
    });
    } finally {
      if (manualCaptcha && manualLockRequestId && manualCaptchaLock?.requestId === manualLockRequestId) {
        manualCaptchaLock = null;
        logger.info({ requestId: manualLockRequestId }, 'Released manual CAPTCHA lock');
      }
    }
  }
  /**
   * Imitates Cloudflare Turnstile loading error. Unused right now, left for future
   */
  private async getTurnstile() {
    return this.client.post(
      `https://clerk.suno.com/v1/client?__clerk_api_version=2021-02-05&_clerk_js_version=${SunoApi.CLERK_VERSION}&_method=PATCH`,
      { captcha_error: '300030,300030,300030' },
      { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }

  /**
   * Generate a song based on the prompt.
   * @param prompt The text prompt to generate audio from.
   * @param make_instrumental Indicates if the generated audio should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @returns
   */
  public async generate(
    prompt: string,
    make_instrumental: boolean = false,
    model?: string,
    wait_audio: boolean = false
  ): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const startTime = Date.now();
    const audios = await this.generateSongs(
      prompt,
      false,
      undefined,
      undefined,
      make_instrumental,
      model,
      wait_audio
    );
    const costTime = Date.now() - startTime;
    logger.info('Generate Response:\n' + JSON.stringify(audios, null, 2));
    logger.info('Cost time: ' + costTime);
    return audios;
  }

  /**
   * Calls the concatenate endpoint for a clip to generate the whole song.
   * @param clip_id The ID of the audio clip to concatenate.
   * @returns A promise that resolves to an AudioInfo object representing the concatenated audio.
   * @throws Error if the response status is not 200.
   */
  public async concatenate(clip_id: string): Promise<AudioInfo> {
    await this.keepAlive(false);
    const payload: any = { clip_id: clip_id };

    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/generate/concat/v2/`,
      payload,
      {
        timeout: 10000 // 10 seconds timeout
      }
    );
    if (response.status !== 200) {
      throw new Error('Error response:' + response.statusText);
    }
    return response.data;
  }

  /**
   * Generates custom audio based on provided parameters.
   *
   * @param prompt The text prompt to generate audio from.
   * @param tags Tags to categorize the generated audio.
   * @param title The title for the generated audio.
   * @param make_instrumental Indicates if the generated audio should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @param negative_tags Negative tags that should not be included in the generated audio.
   * @returns A promise that resolves to an array of AudioInfo objects representing the generated audios.
   */
  public async custom_generate(
    prompt: string,
    tags: string,
    title: string,
    make_instrumental: boolean = false,
    model?: string,
    wait_audio: boolean = false,
    negative_tags?: string,
    gpt_description_prompt?: string,
    metadata?: GenerationMetadata
  ): Promise<AudioInfo[]> {
    const startTime = Date.now();
    const audios = await this.generateSongs(
      prompt,
      true,
      tags,
      title,
      make_instrumental,
      model,
      wait_audio,
      negative_tags,
      undefined,
      undefined,
      undefined,
      gpt_description_prompt,
      metadata
    );
    const costTime = Date.now() - startTime;
    logger.info(
      'Custom Generate Response:\n' + JSON.stringify(audios, null, 2)
    );
    logger.info('Cost time: ' + costTime);
    return audios;
  }

  /**
   * Generates songs based on the provided parameters.
   *
   * @param prompt The text prompt to generate songs from.
   * @param isCustom Indicates if the generation should consider custom parameters like tags and title.
   * @param tags Optional tags to categorize the song, used only if isCustom is true.
   * @param title Optional title for the song, used only if isCustom is true.
   * @param make_instrumental Indicates if the generated song should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @param negative_tags Negative tags that should not be included in the generated audio.
   * @param task Optional indication of what to do. Enter 'extend' if extending an audio, otherwise specify null.
   * @param continue_clip_id 
   * @returns A promise that resolves to an array of AudioInfo objects representing the generated songs.
   */
  private async generateSongs(
    prompt: string,
    isCustom: boolean,
    tags?: string,
    title?: string,
    make_instrumental?: boolean,
    model?: string,
    wait_audio: boolean = false,
    negative_tags?: string,
    task?: string,
    continue_clip_id?: string,
    continue_at?: number,
    gpt_description_prompt?: string,
    metadata?: GenerationMetadata
  ): Promise<AudioInfo[]> {
    await this.keepAlive();
    const resolvedModel = metadata?.mv || model || DEFAULT_MODEL;
    const captchaResult = await this.getCaptcha({ prompt, tags, title, gpt_description_prompt, metadata });
    if (typeof captchaResult === 'string' && captchaResult.startsWith('RECENT_MATCH:')) {
      const matchedClipId = captchaResult.replace('RECENT_MATCH:', '');
      logger.info({ matchedClipId, title }, 'Using recent result fallback match instead of generate API token');
      return await this.get([matchedClipId]);
    }

    const payload: any = {
      make_instrumental: make_instrumental,
      mv: resolvedModel,
      prompt: '',
      generation_type: 'TEXT',
      continue_at: continue_at,
      continue_clip_id: continue_clip_id,
      task: task,
      token: captchaResult
    };
    if (isCustom) {
      payload.tags = tags;
      payload.title = title;
      payload.negative_tags = negative_tags;
      payload.prompt = prompt;
      if (gpt_description_prompt) {
        payload.gpt_description_prompt = gpt_description_prompt;
      }
      if (metadata) {
        payload.metadata = {
          ...metadata,
          mv: metadata.mv || resolvedModel
        };
      }
    } else {
      payload.gpt_description_prompt = prompt;
    }
    logger.info(
      'generateSongs payload:\n' +
      JSON.stringify(
        {
          prompt: prompt,
          isCustom: isCustom,
          tags: tags,
          title: title,
          make_instrumental: make_instrumental,
          wait_audio: wait_audio,
          negative_tags: negative_tags,
          gpt_description_prompt: gpt_description_prompt,
          metadata: metadata,
          payload: payload
        },
        null,
        2
      )
    );
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/generate/v2/`,
      payload,
      {
        timeout: 10000 // 10 seconds timeout
      }
    );
    if (response.status !== 200) {
      throw new Error('Error response:' + response.statusText);
    }
    const songIds = response.data.clips.map((audio: any) => audio.id);
    //Want to wait for music file generation
    if (wait_audio) {
      const startTime = Date.now();
      let lastResponse: AudioInfo[] = [];
      await sleep(5, 5);
      while (Date.now() - startTime < 100000) {
        const response = await this.get(songIds);
        const allCompleted = response.every(
          (audio) => audio.status === 'streaming' || audio.status === 'complete'
        );
        const allError = response.every((audio) => audio.status === 'error');
        if (allCompleted || allError) {
          return response;
        }
        lastResponse = response;
        await sleep(3, 6);
        await this.keepAlive(true);
      }
      return lastResponse;
    } else {
      return response.data.clips.map((audio: any) => ({
        id: audio.id,
        title: audio.title,
        image_url: audio.image_url,
        lyric: audio.metadata.prompt,
        audio_url: audio.audio_url,
        video_url: audio.video_url,
        created_at: audio.created_at,
        model_name: audio.model_name,
        status: audio.status,
        gpt_description_prompt: audio.metadata.gpt_description_prompt,
        prompt: audio.metadata.prompt,
        type: audio.metadata.type,
        tags: audio.metadata.tags,
        negative_tags: audio.metadata.negative_tags,
        duration: audio.metadata.duration
      }));
    }
  }

  /**
   * Generates lyrics based on a given prompt.
   * @param prompt The prompt for generating lyrics.
   * @returns The generated lyrics text.
   */
  public async generateLyrics(prompt: string): Promise<string> {
    await this.keepAlive(false);
    // Initiate lyrics generation
    const generateResponse = await this.client.post(
      `${SunoApi.BASE_URL}/api/generate/lyrics/`,
      { prompt }
    );
    const generateId = generateResponse.data.id;

    // Poll for lyrics completion
    let lyricsResponse = await this.client.get(
      `${SunoApi.BASE_URL}/api/generate/lyrics/${generateId}`
    );
    while (lyricsResponse?.data?.status !== 'complete') {
      await sleep(2); // Wait for 2 seconds before polling again
      lyricsResponse = await this.client.get(
        `${SunoApi.BASE_URL}/api/generate/lyrics/${generateId}`
      );
    }

    // Return the generated lyrics text
    return lyricsResponse.data;
  }

  /**
   * Extends an existing audio clip by generating additional content based on the provided prompt.
   *
   * @param audioId The ID of the audio clip to extend.
   * @param prompt The prompt for generating additional content.
   * @param continueAt Extend a new clip from a song at mm:ss(e.g. 00:30). Default extends from the end of the song.
   * @param tags Style of Music.
   * @param title Title of the song.
   * @returns A promise that resolves to an AudioInfo object representing the extended audio clip.
   */
  public async extendAudio(
    audioId: string,
    prompt: string = '',
    continueAt: number,
    tags: string = '',
    negative_tags: string = '',
    title: string = '',
    model?: string,
    wait_audio?: boolean
  ): Promise<AudioInfo[]> {
    return this.generateSongs(prompt, true, tags, title, false, model, wait_audio, negative_tags, 'extend', audioId, continueAt);
  }

  /**
   * Generate stems for a song.
   * @param song_id The ID of the song to generate stems for.
   * @returns A promise that resolves to an AudioInfo object representing the generated stems.
   */
  public async generateStems(song_id: string): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/edit/stems/${song_id}`, {}
    );

    console.log('generateStems response:\n', response?.data);
    return response.data.clips.map((clip: any) => ({
      id: clip.id,
      status: clip.status,
      created_at: clip.created_at,
      title: clip.title,
      stem_from_id: clip.metadata.stem_from_id,
      duration: clip.metadata.duration
    }));
  }


  /**
   * Get the lyric alignment for a song.
   * @param song_id The ID of the song to get the lyric alignment for.
   * @returns A promise that resolves to an object containing the lyric alignment.
   */
  public async getLyricAlignment(song_id: string): Promise<object> {
    await this.keepAlive(false);
    const response = await this.client.get(`${SunoApi.BASE_URL}/api/gen/${song_id}/aligned_lyrics/v2/`);

    console.log(`getLyricAlignment ~ response:`, response.data);
    return response.data?.aligned_words.map((transcribedWord: any) => ({
      word: transcribedWord.word,
      start_s: transcribedWord.start_s,
      end_s: transcribedWord.end_s,
      success: transcribedWord.success,
      p_align: transcribedWord.p_align
    }));
  }

  /**
   * Processes the lyrics (prompt) from the audio metadata into a more readable format.
   * @param prompt The original lyrics text.
   * @returns The processed lyrics text.
   */
  private parseLyrics(prompt: string): string {
    // Assuming the original lyrics are separated by a specific delimiter (e.g., newline), we can convert it into a more readable format.
    // The implementation here can be adjusted according to the actual lyrics format.
    // For example, if the lyrics exist as continuous text, it might be necessary to split them based on specific markers (such as periods, commas, etc.).
    // The following implementation assumes that the lyrics are already separated by newlines.

    // Split the lyrics using newline and ensure to remove empty lines.
    const lines = prompt.split('\n').filter((line) => line.trim() !== '');

    // Reassemble the processed lyrics lines into a single string, separated by newlines between each line.
    // Additional formatting logic can be added here, such as adding specific markers or handling special lines.
    return lines.join('\n');
  }

  /**
   * Retrieves audio information for the given song IDs.
   * @param songIds An optional array of song IDs to retrieve information for.
   * @param page An optional page number to retrieve audio information from.
   * @returns A promise that resolves to an array of AudioInfo objects.
   */
  private normalizeRecentMatchText(text?: string): string {
    return `${text || ''}`
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '')
      .trim();
  }

  private async waitForRecentGeneratedMatch(
    createContext?: CaptchaCreateContext,
    startedAtMs: number = Date.now(),
    timeoutMs: number = 45000
  ): Promise<AudioInfo | null> {
    const normalizedTitle = this.normalizeRecentMatchText(createContext?.title);
    const normalizedPromptSnippet = this.normalizeRecentMatchText(createContext?.prompt?.split('\n')[0]?.slice(0, 24));
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const recent = await this.get(undefined, null);
        const candidates = recent
          .filter((audio) => {
            const createdAtMs = Date.parse(audio.created_at || '');
            return Number.isFinite(createdAtMs) && createdAtMs >= startedAtMs - 120000;
          })
          .map((audio) => {
            const normalizedAudioTitle = this.normalizeRecentMatchText(audio.title);
            const normalizedAudioLyric = this.normalizeRecentMatchText(audio.lyric);
            let score = 0;
            if (normalizedTitle) {
              if (normalizedAudioTitle === normalizedTitle)
                score += 100;
              else if (normalizedAudioTitle.includes(normalizedTitle) || normalizedTitle.includes(normalizedAudioTitle))
                score += 60;
            }
            if (normalizedPromptSnippet && normalizedAudioLyric.includes(normalizedPromptSnippet))
              score += 25;
            return { audio, score, createdAtMs: Date.parse(audio.created_at || '') };
          })
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score || b.createdAtMs - a.createdAtMs);

        if (candidates[0]) {
          logger.info({
            clipId: candidates[0].audio.id,
            title: candidates[0].audio.title,
            score: candidates[0].score,
            created_at: candidates[0].audio.created_at
          }, 'Matched recent generated result for manual CAPTCHA flow');
          return candidates[0].audio;
        }
      } catch (error: any) {
        logger.warn({ error: error?.message }, 'Recent generated result polling failed');
      }

      await sleep(3, 3);
    }

    logger.warn({ title: createContext?.title, timeoutMs }, 'Recent generated result match timed out');
    return null;
  }

  public async get(
    songIds?: string[],
    page?: string | null
  ): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    let url = new URL(`${SunoApi.BASE_URL}/api/feed/v2`);
    if (songIds) {
      url.searchParams.append('ids', songIds.join(','));
    }
    if (page) {
      url.searchParams.append('page', page);
    }
    logger.info('Get audio status: ' + url.href);
    const response = await this.client.get(url.href, {
      // 10 seconds timeout
      timeout: 10000
    });

    const audios = response.data.clips;

    if (process.env.SUNO_DEBUG_RAW_FEED === 'true' && audios?.[0]) {
      console.log('[SunoApi.get] raw first clip:', JSON.stringify(audios[0], null, 2));
    }

    return audios.map((audio: any) => ({
      id: audio.id,
      title: audio.title,
      image_url: audio.image_url,
      lyric: audio.metadata.prompt
        ? this.parseLyrics(audio.metadata.prompt)
        : '',
      audio_url: audio.audio_url,
      video_url: audio.video_url,
      created_at: audio.created_at,
      model_name: audio.model_name,
      status: audio.status,
      gpt_description_prompt: audio.metadata.gpt_description_prompt,
      prompt: audio.metadata.prompt,
      type: audio.metadata.type,
      tags: audio.metadata.tags,
      duration: audio.metadata.duration,
      error_message: audio.metadata.error_message
    }));
  }

  /**
   * Retrieves information for a specific audio clip.
   * @param clipId The ID of the audio clip to retrieve information for.
   * @returns A promise that resolves to an object containing the audio clip information.
   */
  public async getClip(clipId: string): Promise<object> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/clip/${clipId}`
    );
    return response.data;
  }

  public async get_credits(): Promise<object> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/billing/info/`
    );
    return {
      credits_left: response.data.total_credits_left,
      period: response.data.period,
      monthly_limit: response.data.monthly_limit,
      monthly_usage: response.data.monthly_usage
    };
  }

  public async getPersonaPaginated(personaId: string, page: number = 1): Promise<PersonaResponse> {
    await this.keepAlive(false);

    const url = `${SunoApi.BASE_URL}/api/persona/get-persona-paginated/${personaId}/?page=${page}`;

    logger.info(`Fetching persona data: ${url}`);

    const response = await this.client.get(url, {
      timeout: 10000 // 10 seconds timeout
    });

    if (response.status !== 200) {
      throw new Error('Error response: ' + response.statusText);
    }

    return response.data;
  }
}

export const sunoApi = async (cookie?: string) => {
  const resolvedCookie = cookie && cookie.includes('__client') ? cookie : process.env.SUNO_COOKIE; // Check for bad `Cookie` header (It's too expensive to actually parse the cookies *here*)
  if (!resolvedCookie) {
    logger.info('No cookie provided! Aborting...\nPlease provide a cookie either in the .env file or in the Cookie header of your request.')
    throw new Error('Please provide a cookie either in the .env file or in the Cookie header of your request.');
  }

  // Check if the instance for this cookie already exists in the cache
  const cachedInstance = cache.get(resolvedCookie);
  if (cachedInstance)
    return cachedInstance;

  // If not, create a new instance and initialize it
  const instance = await new SunoApi(resolvedCookie).init();
  // Cache the initialized instance
  cache.set(resolvedCookie, instance);

  return instance;
};




















