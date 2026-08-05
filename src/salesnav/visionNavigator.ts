import type { Locator, Page } from 'playwright';
import type { VisionProvider } from '../captcha/visionProvider';
import { createVisionProvider, getOpenAIProviderFromCurrent } from '../captcha/visionProviderFactory';
import { clickCoordinatesHumanLike } from '../browser';
import { humanPointInBox } from '../browser/humanClick';
import { dimensioniFinestra, dimensioniPng } from '../browser/viewport';

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

/**
 * Ritaglia il clip dentro la finestra REALE.
 *
 * Prima usava `viewportSize() ?? {1280,800}`: in non-headless (il default) `viewportSize()` e' null,
 * quindi il clip veniva ritagliato su una finestra INVENTATA di 1280x800 anche su schermi piu'
 * grandi — e tutto cio' che stava oltre finiva schiacciato. Ora la misura e' quella vera; se e'
 * davvero ignota NON si inventa un ritaglio: si lascia il clip come chiesto e sara' Playwright a
 * limitarlo ai bordi reali della pagina (meglio un clip non ritagliato che uno ritagliato sbagliato).
 */
async function clampRegion(page: Page, clip: VisionRegionClip): Promise<VisionRegionClip> {
    const viewport = await dimensioniFinestra(page);
    if (!viewport) {
        return {
            x: Math.max(0, Math.floor(clip.x)),
            y: Math.max(0, Math.floor(clip.y)),
            width: Math.max(1, Math.floor(clip.width)),
            height: Math.max(1, Math.floor(clip.height)),
        };
    }
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

// H07: Track how many vision calls were skipped due to Ollama/Vision being offline.
// Reset per process — useful for observability in long-running sessions.
let _visionOfflineSkipCount = 0;

/** Returns the number of vision calls skipped due to Vision AI being offline this session. */
export function getVisionOfflineSkipCount(): number {
    return _visionOfflineSkipCount;
}

/**
 * H07: Fixed-coordinate fallbacks for common SalesNav buttons.
 * Used as last resort when Vision AI is offline.
 *
 * ⚠️ Queste coordinate valgono SOLO per il viewport per cui furono misurate (vedi
 * `VISION_FALLBACK_VIEWPORT`). Il layout di SalesNav è responsive: la posizione di un bottone non
 * scala linearmente con la finestra, quindi a 1920x1080 il punto (640,120) non è il bottone — è un
 * punto qualsiasi della pagina. Prima si cliccava comunque, con il solo clamp ai bordi dello schermo
 * a fare da rete: un click cieco su LinkedIn, in un punto non osservato. Da qui la guardia in
 * `fallbackViewportCompatibile`: fuori dal viewport di calibrazione si SALTA, non si tira a indovinare.
 */
const VISION_FIXED_FALLBACKS: Record<string, { x: number; y: number }> = {
    'Save to list': { x: 640, y: 120 },
    'Select All': { x: 80, y: 160 },
    'save to list': { x: 640, y: 120 },
    'select all': { x: 80, y: 160 },
};

/** Viewport per cui le coordinate di `VISION_FIXED_FALLBACKS` sono state misurate. */
const VISION_FALLBACK_VIEWPORT = { width: 1280, height: 800 };

/** Tolleranza stretta (±5%): oltre, il layout può già aver spostato il bottone. */
const VISION_FALLBACK_TOLLERANZA = 0.05;

// `dimensioniFinestra` nasceva qui (2026-08-05, per la guardia del fallback vision). E' stata
// ESTRATTA in `browser/viewport.ts` quando si e' visto che lo stesso `viewportSize() ?? {1280,800}`
// vive in 17 punti su 11 file: una copia locale avrebbe sanato un punto solo e lasciato la classe
// aperta. Vedi il modulo per il perche' quel default e' sempre attivo, non raro.

function fallbackViewportCompatibile(viewport: { width: number; height: number }): boolean {
    const deltaW = Math.abs(viewport.width - VISION_FALLBACK_VIEWPORT.width) / VISION_FALLBACK_VIEWPORT.width;
    const deltaH = Math.abs(viewport.height - VISION_FALLBACK_VIEWPORT.height) / VISION_FALLBACK_VIEWPORT.height;
    return deltaW <= VISION_FALLBACK_TOLLERANZA && deltaH <= VISION_FALLBACK_TOLLERANZA;
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
    const hint =
        provider === 'openai'
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
        const region = await clampRegion(page, options.clip);
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

    let buffer: Buffer;
    try {
        buffer = await page.screenshot({ type: 'png', timeout: 8_000 });
    } catch (error) {
        if (!isScreenshotTimeout(error)) {
            throw error;
        }
        buffer = await captureScreenshotViaCdp(page);
    }

    // 🔴 La region DEVE coincidere con l'immagine che il provider guarda, perche' le coordinate che
    // restituisce vengono clampate dentro questa region (vedi visionClick). Prima si dichiarava
    // `viewportSize() ?? {1280,800}` mentre lo screenshot e' della finestra INTERA: in non-headless
    // (il default) quel `??` scattava sempre, l'immagine era p.es. 1920x1080 e la region diceva
    // 1280x800 ⇒ ogni coordinata oltre 1279/799 finiva schiacciata sul bordo, cioe' TUTTO il terzo
    // destro e quello basso collassavano su una riga di pixel. Ora la misura viene dall'immagine
    // stessa (header PNG), che e' l'unica fonte che non puo' divergere da cio' che l'AI ha visto.
    const daImmagine = dimensioniPng(buffer);
    const viewport = daImmagine ?? (await dimensioniFinestra(page));
    if (!viewport) {
        // Ne' l'immagine ne' la finestra sanno dire le dimensioni: mappare coordinate qui sarebbe
        // indovinare, e a valle si trasforma in un click su un punto sbagliato.
        throw new Error(
            'Dimensioni dello screenshot non determinabili (header PNG illeggibile e finestra non misurabile): ' +
                'coordinate non mappabili, meglio fallire che cliccare a caso',
        );
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

export async function visionRead(page: Page, prompt: string, options?: VisionInteractionOptions): Promise<string> {
    const provider = getProvider(options);
    try {
        const capture = await captureVisionRegion(page, options);
        const result = await provider.analyzeImage(capture.imageBase64, prompt);
        return normalizeVisionText(result.text);
    } catch (error) {
        throw classifyVisionError(error);
    }
}

export async function visionVerify(page: Page, question: string, options?: VisionInteractionOptions): Promise<boolean> {
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

export async function visionReadTotalResults(page: Page, options?: VisionInteractionOptions): Promise<number | null> {
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

            await page.waitForTimeout(Math.max(40, options?.preClickDelayMs ?? 140));
            await clickCoordinatesHumanLike(page, x, y);
            await page.waitForTimeout(Math.max(80, options?.postClickDelayMs ?? 700));

            return {
                x,
                y,
                attempt,
                region: capture.region,
            };
        } catch (error) {
            // H07: If Vision AI is offline (connection/timeout error), log warning and attempt
            // fixed coordinate fallback before giving up — avoids full page skip on SPOF.
            if (error instanceof OllamaDownError || classifyVisionError(error) instanceof OllamaDownError) {
                _visionOfflineSkipCount += 1;
                const descLower = description.toLowerCase();
                const fallback = VISION_FIXED_FALLBACKS[description] ?? VISION_FIXED_FALLBACKS[descLower];
                // ⚠️ `viewportSize()` restituisce null quando il context e' creato con `viewport: null`
                // (modalita' non-headless, `launcher.ts:329`). Un default a 1280x800 qui sarebbe il
                // buco peggiore: la guardia direbbe "compatibile" proprio quando le dimensioni sono
                // IGNOTE, cioe' esattamente il caso in cui non si deve cliccare. Non sapere ≠ sapere
                // che va bene.
                const viewport = await dimensioniFinestra(page);
                if (fallback && (!viewport || !fallbackViewportCompatibile(viewport))) {
                    // Meglio saltare che cliccare alla cieca: fuori dal viewport di calibrazione quel
                    // punto non e' il bottone, e un click non osservato su LinkedIn costa piu' di una
                    // pagina saltata.
                    const descrizioneViewport = viewport ? `${viewport.width}x${viewport.height}` : 'IGNOTO (viewport: null)';
                    console.warn(
                        `[VISION-H07] Vision AI offline e viewport ${descrizioneViewport} diverso da quello di calibrazione ` +
                            `(${VISION_FALLBACK_VIEWPORT.width}x${VISION_FALLBACK_VIEWPORT.height}): coordinate fisse NON usate per "${description}" — skip.`,
                    );
                } else if (fallback && viewport) {
                    const fx = clampNumber(fallback.x, 0, viewport.width - 1);
                    const fy = clampNumber(fallback.y, 0, viewport.height - 1);
                    // Dispersione attorno al punto: la coordinata a listino e' identica su ogni account
                    // e ogni sessione, cioe' una firma. Si riusa humanPointInBox (una sola dispersione,
                    // dove il "box" diventa coordinata) su una finestra stretta, per non uscire dal
                    // bottone: ~28x18 px attorno al punto misurato.
                    const punto = humanPointInBox({ x: fx - 14, y: fy - 9, width: 28, height: 18 });
                    const px = clampNumber(punto.x, 0, viewport.width - 1);
                    const py = clampNumber(punto.y, 0, viewport.height - 1);
                    console.warn(
                        `[VISION-H07] Vision AI offline (skip #${_visionOfflineSkipCount}). Usando coordinate fisse per "${description}": (${fx}, ${fy}) → click (${Math.round(px)}, ${Math.round(py)})`,
                    );
                    await clickCoordinatesHumanLike(page, px, py);
                    await page.waitForTimeout(Math.max(80, options?.postClickDelayMs ?? 700));
                    return {
                        x: px,
                        y: py,
                        attempt,
                        region: { x: 0, y: 0, width: viewport.width, height: viewport.height },
                    };
                }
                // No fixed fallback available — log and rethrow
                console.warn(
                    `[VISION-H07] Vision AI offline (skip #${_visionOfflineSkipCount}). Nessun fallback fisso per "${description}" — skip.`,
                );
                throw error;
            }
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
