import type { Locator, Page } from 'playwright';
import type { VisionProvider } from '../captcha/visionProvider';
import { createVisionProvider, getOpenAIProviderFromCurrent } from '../captcha/visionProviderFactory';
import { humanMouseMoveToCoords, pulseVisualCursorOverlay } from '../browser/humanBehavior';

export interface VisionRegionClip {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface VisionInteractionOptions {
    /** Custom provider override (per test o uso diretto). */
    provider?: VisionProvider;
    locator?: Locator;
    clip?: VisionRegionClip;
    retries?: number;
    pollIntervalMs?: number;
    timeoutMs?: number;
    preClickDelayMs?: number;
    postClickDelayMs?: number;
}

export interface VisionClickResult {
    x: number;
    y: number;
    attempt: number;
    region: VisionRegionClip;
}

interface VisionCapture {
    imageBase64: string;
    region: VisionRegionClip;
}

function isScreenshotTimeout(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /screenshot: Timeout|waiting for fonts to load/i.test(message);
}

async function captureScreenshotViaCdp(page: Page, clip?: VisionRegionClip): Promise<Buffer> {
    // CDP è Chromium-only — Firefox non lo supporta.
    // Fallback a page.screenshot() standard di Playwright per Firefox.
    try {
        const cdp = await page.context().newCDPSession(page);
        try {
            const payload = clip
                ? {
                    format: 'png' as const,
                    clip: {
                        x: clip.x,
                        y: clip.y,
                        width: clip.width,
                        height: clip.height,
                        scale: 1,
                    },
                }
                : { format: 'png' as const };
            const result = (await cdp.send('Page.captureScreenshot', payload)) as { data: string };
            return Buffer.from(result.data, 'base64');
        } finally {
            await cdp.detach().catch(() => null);
        }
    } catch {
        // Firefox fallback: usa Playwright screenshot API standard
        const screenshotOptions: Parameters<Page['screenshot']>[0] = { type: 'png' };
        if (clip) {
            screenshotOptions.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height };
        }
        return page.screenshot(screenshotOptions);
    }
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clampRegion(page: Page, clip: VisionRegionClip): VisionRegionClip {
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const width = clampNumber(Math.floor(clip.width), 1, viewport.width);
    const height = clampNumber(Math.floor(clip.height), 1, viewport.height);
    const x = clampNumber(Math.floor(clip.x), 0, Math.max(0, viewport.width - width));
    const y = clampNumber(Math.floor(clip.y), 0, Math.max(0, viewport.height - height));
    return { x, y, width, height };
}

function normalizeVisionText(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim();
}

function parseYesNo(raw: string): boolean {
    const normalized = normalizeVisionText(raw).toUpperCase();
    if (normalized.startsWith('YES')) return true;
    if (normalized.startsWith('NO')) return false;
    if (/\bYES\b/.test(normalized)) return true;
    if (/\bNO\b/.test(normalized)) return false;
    throw new Error(`Vision verify response non valida: ${normalized || '<empty>'}`);
}

/**
 * Ottiene il VisionProvider corrente.
 * Usa il factory con caching: la prima chiamata crea il provider, le successive riusano il singleton.
 * Supporta override esplicito via options.provider per test e uso diretto.
 */
function getProvider(options?: VisionInteractionOptions): VisionProvider {
    if (options?.provider) return options.provider;
    return createVisionProvider();
}

export class OllamaDownError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OllamaDownError';
    }
}

export class VisionParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'VisionParseError';
    }
}

function classifyVisionError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    // Lazy-import to avoid circular dependency
    const { config: appConfig } = require('../config') as typeof import('../config');
    const provider = appConfig.visionProvider;
    const hint = provider === 'openai'
        ? 'Verifica che OPENAI_API_KEY sia valida e che il servizio sia raggiungibile.'
        : provider === 'ollama'
            ? `Verifica che Ollama sia attivo su ${appConfig.ollamaEndpoint} e che il modello ${appConfig.visionModelOllama} sia disponibile.`
            : `Verifica OPENAI_API_KEY o che Ollama sia attivo su ${appConfig.ollamaEndpoint} con modello ${appConfig.visionModelOllama}.`;

    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|circuit.?open|fetch failed|socket hang up/i.test(message)) {
        return new OllamaDownError(`${message}. ${hint}`);
    }
    if (/Vision API error: HTTP [45]|OpenAI Vision API error/i.test(message)) {
        return new OllamaDownError(`${message}. ${hint}`);
    }
    return new VisionParseError(`${message}. ${hint}`);
}

async function captureVisionRegion(page: Page, options?: VisionInteractionOptions): Promise<VisionCapture> {
    if (options?.locator) {
        try {
            await options.locator.scrollIntoViewIfNeeded();
            const box = await options.locator.boundingBox();
            if (box && box.width > 0 && box.height > 0) {
                let buffer: Buffer;
                try {
                    buffer = await options.locator.screenshot({ type: 'png', timeout: 8_000 });
                } catch (error) {
                    if (!isScreenshotTimeout(error)) {
                        throw error;
                    }
                    const region = {
                        x: Math.floor(box.x),
                        y: Math.floor(box.y),
                        width: Math.floor(box.width),
                        height: Math.floor(box.height),
                    };
                    buffer = await captureScreenshotViaCdp(page, region);
                }
                return {
                    imageBase64: buffer.toString('base64'),
                    region: {
                        x: Math.floor(box.x),
                        y: Math.floor(box.y),
                        width: Math.floor(box.width),
                        height: Math.floor(box.height),
                    },
                };
            }
        } catch {
            // Fallback su clip/full viewport.
        }
    }

    if (options?.clip) {
        const region = clampRegion(page, options.clip);
        let buffer: Buffer;
        try {
            buffer = await page.screenshot({ type: 'png', clip: region, timeout: 8_000 });
        } catch (error) {
            if (!isScreenshotTimeout(error)) {
                throw error;
            }
            buffer = await captureScreenshotViaCdp(page, region);
        }
        return {
            imageBase64: buffer.toString('base64'),
            region,
        };
    }

    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    let buffer: Buffer;
    try {
        buffer = await page.screenshot({ type: 'png', timeout: 8_000 });
    } catch (error) {
        if (!isScreenshotTimeout(error)) {
            throw error;
        }
        buffer = await captureScreenshotViaCdp(page);
    }
    return {
        imageBase64: buffer.toString('base64'),
        region: {
            x: 0,
            y: 0,
            width: viewport.width,
            height: viewport.height,
        },
    };
}

export async function visionRead(
    page: Page,
    prompt: string,
    options?: VisionInteractionOptions,
): Promise<string> {
    const provider = getProvider(options);
    try {
        const capture = await captureVisionRegion(page, options);
        const result = await provider.analyzeImage(capture.imageBase64, prompt);
        return normalizeVisionText(result.text);
    } catch (error) {
        throw classifyVisionError(error);
    }
}

export async function visionVerify(
    page: Page,
    question: string,
    options?: VisionInteractionOptions,
): Promise<boolean> {
    const response = await visionRead(
        page,
        `Analyze this UI screenshot carefully. Answer with exactly one word: YES or NO. If unsure, answer NO. Question: ${question}`,
        options,
    );
    return parseYesNo(response);
}

export async function visionWaitFor(
    page: Page,
    condition: string,
    timeoutMs: number = 20_000,
    options?: VisionInteractionOptions,
): Promise<boolean> {
    const deadline = Date.now() + Math.max(500, timeoutMs);
    const pollIntervalMs = Math.max(250, options?.pollIntervalMs ?? 1_250);

    while (Date.now() < deadline) {
        try {
            if (await visionVerify(page, condition, options)) {
                return true;
            }
        } catch (error) {
            if (error instanceof OllamaDownError) {
                throw error;
            }
            // VisionParseError or transient failures: retry until timeout.
        }
        await page.waitForTimeout(pollIntervalMs);
    }

    return false;
}

export async function visionReadTotalResults(
    page: Page,
    options?: VisionInteractionOptions,
): Promise<number | null> {
    try {
        const response = await visionRead(
            page,
            'Look for text showing the total number of search results on this page, such as "847 results", "320 risultati", or "1-25 of 450". Answer with ONLY the total integer number (e.g. "847"). If not visible, answer "0".',
            options,
        );
        const digits = response.replace(/[^0-9]/g, '');
        if (!digits) return null;
        const num = parseInt(digits, 10);
        return Number.isFinite(num) && num > 0 ? num : null;
    } catch {
        return null;
    }
}

export async function visionClick(
    page: Page,
    description: string,
    options?: VisionInteractionOptions,
): Promise<VisionClickResult> {
    const provider = getProvider(options);
    const retries = Math.max(1, options?.retries ?? 2);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const capture = await captureVisionRegion(page, options);
            const localCoordinates = await provider.findCoordinates(capture.imageBase64, description);
            if (!localCoordinates) {
                throw new Error(`Vision non ha trovato coordinate per: ${description}`);
            }

            const x = clampNumber(
                Math.round(capture.region.x + localCoordinates.x),
                capture.region.x,
                capture.region.x + capture.region.width - 1,
            );
            const y = clampNumber(
                Math.round(capture.region.y + localCoordinates.y),
                capture.region.y,
                capture.region.y + capture.region.height - 1,
            );

            await humanMouseMoveToCoords(page, x, y);
            await page.waitForTimeout(Math.max(40, options?.preClickDelayMs ?? 140));
            await pulseVisualCursorOverlay(page);
            await page.mouse.click(x, y, { delay: 40 + Math.floor(Math.random() * 80) });
            await pulseVisualCursorOverlay(page);
            await page.waitForTimeout(Math.max(80, options?.postClickDelayMs ?? 700));

            return {
                x,
                y,
                attempt,
                region: capture.region,
            };
        } catch (error) {
            if (attempt >= retries) {
                throw classifyVisionError(error);
            }
            await page.waitForTimeout(400 + attempt * 250);
        }
    }

    throw classifyVisionError(new Error(`Vision click fallito per: ${description}`));
}

/**
 * Se il provider corrente supporta GPT-5.4, suggerisce un delay contestuale
 * basato sull'analisi della pagina. Altrimenti usa delay randomico classico.
 */
export async function visionContextualDelay(page: Page): Promise<number> {
    const openaiProvider = getOpenAIProviderFromCurrent();
    if (!openaiProvider) {
        return 3000 + Math.floor(Math.random() * 5000);
    }
    try {
        const capture = await captureVisionRegion(page);
        return await openaiProvider.suggestContextualDelay(capture.imageBase64);
    } catch {
        return 3000 + Math.floor(Math.random() * 5000);
    }
}
