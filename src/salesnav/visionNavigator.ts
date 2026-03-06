import type { Locator, Page } from 'playwright';
import { VisionSolver } from '../captcha/solver';
import { humanMouseMoveToCoords, pulseVisualCursorOverlay } from '../browser/humanBehavior';

export interface VisionRegionClip {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface VisionInteractionOptions {
    solver?: VisionSolver;
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

function getVisionSolver(options?: VisionInteractionOptions): VisionSolver {
    return options?.solver ?? new VisionSolver();
}

function wrapVisionError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(
        `${message}. Verifica che Ollama sia attivo su ${process.env.OLLAMA_ENDPOINT ?? 'http://127.0.0.1:11434'} e che il modello ${process.env.VISION_MODEL ?? 'llava'} sia disponibile.`,
    );
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
    const solver = getVisionSolver(options);
    try {
        const capture = await captureVisionRegion(page, options);
        const response = await solver.analyzeImage(capture.imageBase64, prompt);
        return normalizeVisionText(response);
    } catch (error) {
        throw wrapVisionError(error);
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
        } catch {
            // Ignore parse/transient vision failures and retry until timeout.
        }
        await page.waitForTimeout(pollIntervalMs);
    }

    return false;
}

export async function visionClick(
    page: Page,
    description: string,
    options?: VisionInteractionOptions,
): Promise<VisionClickResult> {
    const solver = getVisionSolver(options);
    const retries = Math.max(1, options?.retries ?? 2);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const capture = await captureVisionRegion(page, options);
            const localCoordinates = await solver.findObjectCoordinates(capture.imageBase64, description);
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
                throw wrapVisionError(error);
            }
            await page.waitForTimeout(400 + attempt * 250);
        }
    }

    throw wrapVisionError(new Error(`Vision click fallito per: ${description}`));
}
