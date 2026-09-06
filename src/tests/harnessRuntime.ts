/**
 * harnessRuntime.ts — runtime CONDIVISO degli harness `harness:*` (contratto C28).
 *
 * Cosa garantisce a ogni harness che lo usa:
 *  - isolamento: `DATABASE_URL`/`SUPABASE_URL` cancellate, `SESSION_DIR` e `DB_PATH` dirottati in una
 *    cartella usa-e-getta sotto `os.tmpdir()` PRIMA che `src/config` venga importato (per questo il
 *    modulo va importato per PRIMO nel file dell'harness: il dirottamento è un effetto dell'import);
 *  - zero egress: ogni richiesta verso un host diverso da 127.0.0.1/localhost è respinta dal contesto
 *    e CONTATA (`blocked_attempts`); una richiesta esterna che riuscisse a completarsi conta in
 *    `external_requests` (deve restare 0);
 *  - osservabilità: le fixture HTML sono servite da un server HTTP locale (mai `setContent`), così
 *    `localhost_requests` e `pages_loaded` provano che i contatori sono cablati (0 = sonda rotta);
 *  - control-case: a fine harness una `fetch('https://www.linkedin.com/')` dalla pagina deve
 *    risultare bloccata (`control.blocked_attempts === 1`), altrimenti il divieto non è reale.
 *
 * Output: una riga `HARNESS_RESULT {json}` e `process.exitCode` = 0 ok · 1 misura/isolamento/egress
 * fuori atteso · 2 sonda rotta (nessuna richiesta locale o nessuna pagina caricata).
 */
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { loadDotEnv } from '../config/env';

// --- isolamento: effetto dell'import, prima di qualunque `src/config` -----------------------------
// `.env`/`bot-settings.conf` caricati QUI (una volta per processo), poi le chiavi remote cancellate: nessun
// import successivo di `src/config` può rimetterle (dotenv non sovrascrive ma RI-AGGIUNGE le chiavi assenti).
loadDotEnv();
const HARNESS_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-bot-harness-'));
const HARNESS_SESSION_DIR = path.join(HARNESS_TMP, 'session');
const HARNESS_DB_PATH = path.join(HARNESS_TMP, 'linkedin_bot.sqlite');
fs.mkdirSync(HARNESS_SESSION_DIR, { recursive: true });
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
process.env.SESSION_DIR = HARNESS_SESSION_DIR;
process.env.DB_PATH = HARNESS_DB_PATH;

import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';

export type HarnessEngine = 'chromium' | 'camoufox';

export interface HarnessCounters {
    externalRequests: number;
    blockedAttempts: number;
    localhostRequests: number;
    pagesLoaded: number;
    controlBlockedAttempts: number;
}

export interface HarnessPaths {
    sessionDir: string;
    dbPath: string;
}

export interface HarnessSummary {
    harness: string;
    external_requests: number;
    blocked_attempts: number;
    localhost_requests: number;
    pages_loaded: number;
    session_dir: string;
    db_path: string;
    control: { blocked_attempts: number };
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SCHEMI_SENZA_RETE = ['about:', 'data:', 'blob:'];

/** Vero solo per richieste che non escono dalla macchina. */
export function isLocalRequestUrl(url: string): boolean {
    if (SCHEMI_SENZA_RETE.some((s) => url.startsWith(s))) return true;
    try {
        return LOCAL_HOSTS.has(new URL(url).hostname);
    } catch {
        return false;
    }
}

export function buildHarnessSummary(harness: string, c: HarnessCounters, p: HarnessPaths): HarnessSummary {
    return {
        harness,
        external_requests: c.externalRequests,
        blocked_attempts: c.blockedAttempts,
        localhost_requests: c.localhostRequests,
        pages_loaded: c.pagesLoaded,
        session_dir: p.sessionDir,
        db_path: p.dbPath,
        control: { blocked_attempts: c.controlBlockedAttempts },
    };
}

const REAL_SESSION_DIR = path.resolve('data', 'session');
const REAL_DB_PATH = path.resolve('data', 'linkedin_bot.sqlite');

function inTmpDir(p: string): boolean {
    return path.resolve(p).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase());
}

/** 0 tutto nell'atteso · 1 misura/isolamento/egress fuori atteso · 2 sonda rotta. */
export function harnessExitCode(s: HarnessSummary, measuresFailed: number): 0 | 1 | 2 {
    if (s.localhost_requests < 1 || s.pages_loaded < 1) return 2;
    const sessionOk = inTmpDir(s.session_dir) && path.resolve(s.session_dir) !== REAL_SESSION_DIR;
    const dbOk = inTmpDir(s.db_path) && path.resolve(s.db_path) !== REAL_DB_PATH;
    if (!sessionOk || !dbOk) return 1;
    if (measuresFailed > 0 || s.external_requests > 0 || s.blocked_attempts > 0 || s.control.blocked_attempts !== 1) return 1;
    return 0;
}

// --- runtime -------------------------------------------------------------------------------------
export interface HarnessRun {
    page: Page;
    engine: HarnessEngine;
    /** Registra una fixture HTML sul server locale e ne restituisce l'URL (usare `page.goto`, mai `setContent`). */
    serve(html: string): string;
    /** URL locale che risponde con gli header ricevuti in JSON (`{ "user-agent": ... }`). */
    echoHeadersUrl(): string;
}

type Fixture = string | ((req: http.IncomingMessage) => string);

async function startLocalServer(fixtures: Map<string, Fixture>): Promise<{ server: http.Server; origin: string }> {
    const server = http.createServer((req, res) => {
        const fixture = fixtures.get(req.url ?? '');
        if (fixture === undefined) {
            res.writeHead(404);
            res.end('not found');
            return;
        }
        const body = typeof fixture === 'function' ? fixture(req) : fixture;
        const isJson = req.url?.startsWith('/echo-headers');
        res.writeHead(200, { 'content-type': isJson ? 'application/json' : 'text/html; charset=utf-8' });
        res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server locale senza porta');
    return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function launchContext(engine: HarnessEngine): Promise<{ context: BrowserContext; close(): Promise<void> }> {
    if (engine === 'chromium') {
        const browser: Browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        return { context, close: () => browser.close() };
    }
    // Camoufox VERO: stesso pacchetto del launcher di produzione, nessun download (C22).
    const { Camoufox } = await import('camoufox-js');
    const launched = (await Camoufox({ headless: true })) as Browser | BrowserContext;
    if ('newContext' in launched) {
        const context = await launched.newContext();
        return { context, close: () => launched.close() };
    }
    return { context: launched, close: () => launched.close() };
}

/**
 * Esegue `body` dentro il perimetro isolato e stampa il JSON finale. `body` restituisce il numero di
 * misure fuori atteso (0 = tutte ok). Ogni harness resta padrone delle sue misure e della sua stampa.
 */
export async function runHarness(name: string, engine: HarnessEngine, body: (run: HarnessRun) => Promise<number>): Promise<void> {
    const counters: HarnessCounters = { externalRequests: 0, blockedAttempts: 0, localhostRequests: 0, pagesLoaded: 0, controlBlockedAttempts: 0 };
    const fixtures = new Map<string, Fixture>();
    fixtures.set('/echo-headers', (req) => JSON.stringify(req.headers));
    const { server, origin } = await startLocalServer(fixtures);
    let phase: 'run' | 'control' = 'run';
    let measuresFailed = 1;
    let launched: { context: BrowserContext; close(): Promise<void> } | null = null;
    try {
        launched = await launchContext(engine);
        const { context } = launched;
        await context.route('**/*', (route: Route) => {
            const url = route.request().url();
            if (isLocalRequestUrl(url)) {
                counters.localhostRequests++;
                return route.continue();
            }
            if (phase === 'control') counters.controlBlockedAttempts++;
            else counters.blockedAttempts++;
            return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        page.on('load', () => counters.pagesLoaded++);
        page.on('requestfinished', (req) => {
            if (!isLocalRequestUrl(req.url())) counters.externalRequests++;
        });
        let n = 0;
        const run: HarnessRun = {
            page,
            engine,
            serve: (html) => {
                const route = `/f/${++n}.html`;
                fixtures.set(route, html);
                return origin + route;
            },
            echoHeadersUrl: () => `${origin}/echo-headers`,
        };
        measuresFailed = await body(run);

        // control-case: il divieto di egress deve essere REALE, non un contatore mai toccato.
        phase = 'control';
        await page.goto(run.serve('<!doctype html><title>control</title>'));
        await page.evaluate(() => fetch('https://www.linkedin.com/', { signal: AbortSignal.timeout(5_000) }).then(() => 'ok', () => 'blocked'));
    } finally {
        if (launched) await launched.close().catch(() => undefined);
        server.close();
        const summary = buildHarnessSummary(name, counters, { sessionDir: HARNESS_SESSION_DIR, dbPath: HARNESS_DB_PATH });
        const exitCode = harnessExitCode(summary, measuresFailed);
        console.log(`HARNESS_RESULT ${JSON.stringify({ ...summary, measures_failed: measuresFailed, exit_code: exitCode })}`);
        process.exitCode = exitCode;
        fs.rmSync(HARNESS_TMP, { recursive: true, force: true, maxRetries: 3 });
    }
}
