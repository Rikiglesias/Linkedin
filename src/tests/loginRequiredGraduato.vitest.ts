/**
 * loginRequiredGraduato.vitest.ts — C27 del contratto `bot-operativo` (blocco A).
 *
 * Il difetto: `checkLogin` (`auth.ts:143`) restituisce `false` sia quando la sessione e' davvero
 * scaduta sia quando LinkedIn risponde 429 o 403. A valle `workflowEntryGuards.ts:112` legge quel
 * `false` come «sloggato» e mette l'account in QUARANTENA con il messaggio «eseguire bot.ps1 login».
 * Cioe': davanti a un rate-limit temporaneo il bot chiede di rifare il login — la reazione peggiore
 * possibile, perche' un'autenticazione nuova sotto throttling aggiunge segnali proprio quando
 * LinkedIn sta gia' guardando. E lo stesso 429, letto da tre punti diversi, produceva tre reazioni
 * diverse: pausa `LINKEDIN_PRE_THROTTLED`, quarantena `LOGIN_REQUIRED`, proxy bruciato.
 *
 * La regola dopo il fix: la CAUSA del fallimento e' un dato, non un booleano. Tre rami distinti —
 * sessione scaduta, esito ignoto (rete/timeout/proxy), throttling della piattaforma — e per il terzo
 * un solo trattamento, da qualunque punto arrivi: pausa lunga con backoff, proxy sticky rilasciato,
 * MAI quarantena e MAI la richiesta di rifare il login.
 *
 * Parte 1 (chunk 1): la politica pura. Parte 2 (chunk 2): l'innesto — il browser produce la causa
 * (`checkLoginDetailed`), un solo handler applica la reazione (`applyLoginFailureAction`), la 2FA
 * finisce nella quarantena PER-ACCOUNT anche quando l'account si chiama `default`, e il login
 * riuscito toglie la pausa `LOGIN_REQUIRED` (mai una pausa da 429).
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ─── Fake `sync_state` in-memory: le chiavi della pausa e della quarantena sono il dato VERIFICATO ──
const syncState = new Map<string, string>();

vi.mock('../db', () => ({
    getDatabase: async () => ({
        run: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('INSERT INTO sync_state')) {
                syncState.set(String(params[0]), String(params[1]));
                return { changes: 1 };
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
        get: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('SELECT value FROM sync_state')) {
                const value = syncState.get(String(params[0]));
                return value === undefined ? undefined : { value };
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
        query: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('SELECT key FROM sync_state')) {
                const prefix = String(params[0]).replace(/%$/, '');
                return [...syncState.entries()]
                    .filter(([key, value]) => key.startsWith(prefix) && value === 'true')
                    .map(([key]) => ({ key }));
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
        withTransaction: async <T>(cb: (tx: { isPostgres: boolean }) => Promise<T>): Promise<T> =>
            cb({ isPostgres: false }),
    }),
}));

const mocks = vi.hoisted(() => ({
    createIncident: vi.fn(async () => 42),
    pushOutboxEvent: vi.fn(async () => {}),
    recordSecurityAuditEvent: vi.fn(async () => {}),
    countRecentIncidents: vi.fn(async () => 0),
    countDistinctIncidentAccounts: vi.fn(async () => ({ count: 1, accounts: ['default'] })),
    releaseStickyProxy: vi.fn(),
    markProxyFailed: vi.fn(),
    sendTelegramAlert: vi.fn(async () => null),
}));

// Repository REALI per pausa e quarantena (sono il comportamento sotto test); mockati solo gli
// incident e l'audit, che vivono su altre tabelle.
vi.mock('../core/repositories', async (importOriginal) => {
    const real = await importOriginal<typeof import('../core/repositories')>();
    return {
        ...real,
        createIncident: mocks.createIncident,
        pushOutboxEvent: mocks.pushOutboxEvent,
        recordSecurityAuditEvent: mocks.recordSecurityAuditEvent,
        countRecentIncidents: mocks.countRecentIncidents,
        countDistinctIncidentAccounts: mocks.countDistinctIncidentAccounts,
    };
});
vi.mock('../proxyManager', () => ({
    releaseStickyProxy: mocks.releaseStickyProxy,
    markProxyFailed: mocks.markProxyFailed,
}));
vi.mock('../telemetry/logger', () => ({
    logInfo: vi.fn(async () => {}),
    logWarn: vi.fn(async () => {}),
    logError: vi.fn(async () => {}),
}));
vi.mock('../telemetry/broadcaster', () => ({
    broadcastCritical: vi.fn(async () => {}),
    broadcastWarning: vi.fn(async () => {}),
}));
vi.mock('../telemetry/liveEvents', () => ({ publishLiveEvent: vi.fn() }));
vi.mock('../telemetry/alerts', () => ({ sendTelegramAlert: mocks.sendTelegramAlert }));
vi.mock('../cloud/cloudBridge', () => ({ bridgeAccountHealth: vi.fn() }));
vi.mock('../core/leadStateService', () => ({ reconcileLeadStatus: vi.fn(async () => {}) }));
vi.mock('../security/redaction', () => ({ sanitizeForLogs: (value: unknown) => value }));
vi.mock('../config', () => ({
    config: {
        autoPauseMinutesOnFailureBurst: 180,
        challengePersistentGate: false,
        challengePauseMinutes: 60,
        proxyFailureCooldownMinutes: 30,
    },
}));

import {
    classifyCheckLoginStatus,
    classifyProbeReason,
    classifyVoyagerStatus,
    resolveLoginFailureAction,
    type LoginCheckOutcome,
} from '../browser/loginFailurePolicy';
import { checkLogin, checkLoginDetailed, probeLinkedInStatus } from '../browser/auth';
import { applyLoginFailureAction } from '../risk/loginFailureHandler';
import { recordSuccessfulAuth } from '../browser/sessionCookieMonitor';
import { getAccountQuarantine, getAutomationPauseState } from '../core/repositories/system';

/** Default REALE letto alla fonte: `domains.ts:68` (`AUTO_PAUSE_MINUTES_ON_FAILURE_BURST`, 180). */
const AUTO_PAUSE = 180;
const opts = { autoPauseMinutes: AUTO_PAUSE };

/** Pagina Playwright finta: basta ciò che `checkLogin`/`isLoggedIn`/`probeLinkedInStatus` toccano. */
function paginaFinta(o: { url?: string; gotoStatus?: number; gotoThrows?: Error; liAt?: boolean }) {
    const url = o.url ?? 'https://www.linkedin.com/feed/';
    const goto = o.gotoThrows
        ? vi.fn().mockRejectedValue(o.gotoThrows)
        : vi.fn().mockResolvedValue({ status: () => o.gotoStatus ?? 200 });
    return {
        url: () => url,
        context: () => ({ cookies: async () => (o.liAt ? [{ name: 'li_at', value: 'tok' }] : []) }),
        locator: () => ({ count: async () => 0 }),
        textContent: async () => '',
        goto,
        waitForTimeout: async () => undefined,
    } as unknown as Parameters<typeof checkLogin>[0];
}

/** Minuti che mancano alla scadenza della pausa corrente (null = nessuna pausa o pausa indefinita). */
async function minutiDiPausa(): Promise<number | null> {
    const stato = await getAutomationPauseState();
    if (!stato.paused || !stato.pausedUntil) return null;
    return Math.round((Date.parse(stato.pausedUntil) - Date.now()) / 60_000);
}

describe('C27 — i tre rami del fallimento di login', () => {
    it('(a) logout ESPLICITO: quarantena per-account e pausa 60 minuti', () => {
        const a = resolveLoginFailureAction({ state: 'logged-out' }, opts);
        expect(a.reason).toBe('LOGIN_REQUIRED');
        expect(a.quarantine).toBe(true);
        expect(a.pauseMinutes).toBe(60);
        expect(a.releaseProxy).toBe(false);
    });

    it('(b) timeout di navigazione: esito IGNOTO, pausa breve, MAI quarantena', () => {
        const a = resolveLoginFailureAction({ state: 'unknown', cause: 'timeout' }, opts);
        expect(a.reason).toBe('login_check_unknown');
        expect(a.quarantine).toBe(false);
        expect(a.pauseMinutes).not.toBeNull();
        expect(a.pauseMinutes as number).toBeLessThanOrEqual(15);
    });

    it('(b) errore di proxy: stesso ramo IGNOTO — un proxy lento non e una sessione scaduta', () => {
        const a = resolveLoginFailureAction({ state: 'unknown', cause: 'proxy' }, opts);
        expect(a.reason).toBe('login_check_unknown');
        expect(a.quarantine).toBe(false);
        expect(a.pauseMinutes as number).toBeLessThanOrEqual(15);
    });

    it('(c) 429 dal probe del feed: pausa >= 180, proxy rilasciato, nessuna quarantena', () => {
        const a = resolveLoginFailureAction(classifyProbeReason('HTTP_429_RATE_LIMITED'), opts);
        expect(a.reason).toBe('HTTP_429_RATE_LIMIT');
        expect(a.pauseMinutes as number).toBeGreaterThanOrEqual(180);
        expect(a.releaseProxy).toBe(true);
        expect(a.quarantine).toBe(false);
    });

    it('(c) 429 da checkLogin: STESSO esito, e soprattutto NON LOGIN_REQUIRED', () => {
        const a = resolveLoginFailureAction(classifyCheckLoginStatus(429), opts);
        expect(a.reason).toBe('HTTP_429_RATE_LIMIT');
        expect(a.reason).not.toBe('LOGIN_REQUIRED');
        expect(a.pauseMinutes as number).toBeGreaterThanOrEqual(180);
        expect(a.releaseProxy).toBe(true);
        expect(a.quarantine).toBe(false);
    });

    it('(c) 429 dalla chiamata voyager: STESSO esito, dal terzo punto', () => {
        const a = resolveLoginFailureAction(classifyVoyagerStatus(429), opts);
        expect(a.reason).toBe('HTTP_429_RATE_LIMIT');
        expect(a.pauseMinutes as number).toBeGreaterThanOrEqual(180);
        expect(a.releaseProxy).toBe(true);
        expect(a.quarantine).toBe(false);
    });

    it('(c) 403 bloccato: stesso trattamento del 429, con il suo incident', () => {
        const a = resolveLoginFailureAction(classifyCheckLoginStatus(403), opts);
        expect(a.reason).toBe('HTTP_403_BLOCKED');
        expect(a.pauseMinutes as number).toBeGreaterThanOrEqual(180);
        expect(a.releaseProxy).toBe(true);
        expect(a.quarantine).toBe(false);
    });

    it('i tre punti danno lo STESSO outcome per lo stesso 429: una causa, una reazione', () => {
        const daProbe = classifyProbeReason('HTTP_429_RATE_LIMITED');
        const daCheck = classifyCheckLoginStatus(429);
        const daVoyager = classifyVoyagerStatus(429);
        expect(daProbe).toEqual(daCheck);
        expect(daCheck).toEqual(daVoyager);
    });

    it('sessione viva: nessuna azione, nessuna pausa', () => {
        const a = resolveLoginFailureAction({ state: 'logged-in' } as LoginCheckOutcome, opts);
        expect(a.pauseMinutes).toBeNull();
        expect(a.quarantine).toBe(false);
        expect(a.incidentType).toBeNull();
    });

    it('il probe che riporta SESSION_EXPIRED resta il ramo (a), non si confonde col throttling', () => {
        const a = resolveLoginFailureAction(classifyProbeReason('SESSION_EXPIRED'), opts);
        expect(a.reason).toBe('LOGIN_REQUIRED');
        expect(a.quarantine).toBe(true);
    });

    it('un errore di rete del probe finisce nel ramo IGNOTO, non in quarantena', () => {
        const a = resolveLoginFailureAction(classifyProbeReason('PROBE_ERROR: net::ERR_TIMED_OUT'), opts);
        expect(a.reason).toBe('login_check_unknown');
        expect(a.quarantine).toBe(false);
    });
});

describe('C27 — innesto: il browser produce la causa, un solo handler applica la reazione', () => {
    let sessionDir: string;

    beforeEach(() => {
        syncState.clear();
        vi.clearAllMocks();
        mocks.createIncident.mockResolvedValue(42);
        mocks.countRecentIncidents.mockResolvedValue(0);
        sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c27-login-'));
    });
    afterEach(() => {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    });

    it('checkLoginDetailed: 429 sul feed → throttled 429, e il booleano checkLogin resta false', async () => {
        expect(await checkLoginDetailed(paginaFinta({ gotoStatus: 429, liAt: true }))).toEqual({ state: 'throttled', status: 429 });
        expect(await checkLogin(paginaFinta({ gotoStatus: 429, liAt: true }))).toBe(false);
    });

    it('checkLoginDetailed: redirect a /login → logged-out; cookie presente e feed servito → logged-in', async () => {
        expect(await checkLoginDetailed(paginaFinta({ url: 'https://www.linkedin.com/login' }))).toEqual({ state: 'logged-out' });
        expect(await checkLoginDetailed(paginaFinta({ liAt: true }))).toEqual({ state: 'logged-in' });
    });

    it('checkLoginDetailed: timeout di navigazione → unknown/timeout; errore di proxy → unknown/proxy', async () => {
        const timeout = await checkLoginDetailed(paginaFinta({ gotoThrows: new Error('page.goto: Timeout 60000ms exceeded.') }));
        expect(timeout).toEqual({ state: 'unknown', cause: 'timeout' });
        const proxy = await checkLoginDetailed(paginaFinta({ gotoThrows: new Error('net::ERR_PROXY_CONNECTION_FAILED') }));
        expect(proxy).toEqual({ state: 'unknown', cause: 'proxy' });
    });

    it('2FA sull account `default`: quarantena PER-ACCOUNT (account_quarantine:default), flag globale ASSENTE', async () => {
        const esito = await checkLoginDetailed(paginaFinta({ url: 'https://www.linkedin.com/checkpoint/challenge/abc' }), {
            accountId: 'default',
        });
        // `quarantineApplied: true` non e' cosmetico: e' il segnale che dice alla politica di NON
        // ri-quarantenare. Qui la scrittura e' riuscita davvero (la riga sotto lo prova).
        expect(esito).toEqual({ state: 'two-factor', quarantineApplied: true });
        expect(syncState.get('account_quarantine:default')).toBe('true');
        expect(syncState.has('account_quarantine')).toBe(false);
        expect(mocks.createIncident).toHaveBeenCalledWith('LOGIN_2FA_REQUIRED', 'CRITICAL', expect.objectContaining({ accountId: 'default' }));
    });

    it('2FA con la scrittura di quarantena ROTTA: l esito lo DICE, non lo nasconde in un console.error', async () => {
        // Prima della review pre-push il fallimento moriva in un `console.error` e l'esito era
        // identico al caso riuscito: nessuno a valle poteva rimediare. Ora il chiamante lo sa.
        mocks.createIncident.mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'));
        const esito = await checkLoginDetailed(paginaFinta({ url: 'https://www.linkedin.com/checkpoint/challenge/abc' }), {
            accountId: 'default',
        });
        expect(esito).toEqual({ state: 'two-factor', quarantineApplied: false });
        expect(syncState.has('account_quarantine:default')).toBe(false);
    });

    it('2FA sull account `default`: il secondo account NON e in quarantena', async () => {
        await checkLoginDetailed(paginaFinta({ url: 'https://www.linkedin.com/checkpoint/challenge/abc' }), { accountId: 'default' });
        expect(await getAccountQuarantine('default')).toBe(true);
        expect(await getAccountQuarantine('acc-2')).toBe(false);
    });

    it('handler sul 429: UN solo incident HTTP_429_RATE_LIMIT, pausa >= 180, proxy marcato e rilasciato, nessuna quarantena', async () => {
        const proxy = { server: 'http://gw.example:7777', type: 'mobile' as const };
        await applyLoginFailureAction(resolveLoginFailureAction(classifyCheckLoginStatus(429), opts), {
            accountId: 'default',
            sessionDir,
            proxy,
            source: 'test',
        });
        expect(mocks.createIncident).toHaveBeenCalledTimes(1);
        expect(mocks.createIncident).toHaveBeenCalledWith('HTTP_429_RATE_LIMIT', 'WARN', expect.objectContaining({ accountId: 'default' }));
        expect((await getAutomationPauseState()).reason).toBe('HTTP_429_RATE_LIMIT');
        expect((await minutiDiPausa()) as number).toBeGreaterThanOrEqual(179);
        expect(mocks.markProxyFailed).toHaveBeenCalledWith(proxy, undefined);
        expect(mocks.releaseStickyProxy).toHaveBeenCalledWith(path.resolve(sessionDir));
        expect(syncState.has('account_quarantine:default')).toBe(false);
        expect(syncState.has('account_quarantine')).toBe(false);
    });

    it('handler sul logout: quarantena per-account + pausa 60 LOGIN_REQUIRED, UN solo incident (CRITICAL), proxy intatto', async () => {
        await applyLoginFailureAction(resolveLoginFailureAction({ state: 'logged-out' }, opts), {
            accountId: 'acc-1',
            sessionDir,
            proxy: { server: 'http://gw.example:7777' },
            source: 'test',
        });
        expect(syncState.get('account_quarantine:acc-1')).toBe('true');
        expect(mocks.createIncident).toHaveBeenCalledTimes(1);
        expect(mocks.createIncident).toHaveBeenCalledWith('LOGIN_REQUIRED', 'CRITICAL', expect.objectContaining({ accountId: 'acc-1' }));
        expect((await getAutomationPauseState()).reason).toBe('LOGIN_REQUIRED');
        expect((await minutiDiPausa()) as number).toBeGreaterThanOrEqual(59);
        expect((await minutiDiPausa()) as number).toBeLessThanOrEqual(60);
        expect(mocks.markProxyFailed).not.toHaveBeenCalled();
        expect(mocks.releaseStickyProxy).not.toHaveBeenCalled();
    });

    it('handler sull esito ignoto: pausa <= 15, NESSUN incident, nessuna quarantena; con causa proxy lo sticky viene lasciato', async () => {
        await applyLoginFailureAction(resolveLoginFailureAction({ state: 'unknown', cause: 'proxy' }, opts), {
            accountId: 'acc-1',
            sessionDir,
            proxy: { server: 'http://gw.example:7777' },
            source: 'test',
        });
        expect(mocks.createIncident).not.toHaveBeenCalled();
        expect(syncState.has('account_quarantine:acc-1')).toBe(false);
        expect((await getAutomationPauseState()).reason).toBe('login_check_unknown');
        expect((await minutiDiPausa()) as number).toBeLessThanOrEqual(15);
        expect(mocks.releaseStickyProxy).toHaveBeenCalledWith(path.resolve(sessionDir));
        expect(mocks.markProxyFailed).toHaveBeenCalledWith({ server: 'http://gw.example:7777' }, 'timeout');
    });

    it('recordSuccessfulAuth toglie la pausa LOGIN_REQUIRED: dopo il login il bot non aspetta un ora', async () => {
        await applyLoginFailureAction(resolveLoginFailureAction({ state: 'logged-out' }, opts), { accountId: 'acc-1', source: 'test' });
        expect((await getAutomationPauseState()).paused).toBe(true);
        await recordSuccessfulAuth(sessionDir, 'login');
        expect((await getAutomationPauseState()).paused).toBe(false);
    });

    it('recordSuccessfulAuth NON toglie una pausa da 429: il login non e il rimedio del throttling', async () => {
        await applyLoginFailureAction(resolveLoginFailureAction(classifyCheckLoginStatus(429), opts), { accountId: 'acc-1', source: 'test' });
        await recordSuccessfulAuth(sessionDir, 'login');
        const stato = await getAutomationPauseState();
        expect(stato.paused).toBe(true);
        expect(stato.reason).toBe('HTTP_429_RATE_LIMIT');
    });

    it('2FA gia quarantenata alla fonte: nessuna SECONDA quarantena e nessuna pausa', async () => {
        // Il canary chiama l'handler per OGNI esito diverso da `logged-in`, 2FA inclusa: se la politica
        // qui chiedesse di nuovo quarantena/pausa, un solo checkpoint 2FA produrrebbe due incident.
        await applyLoginFailureAction(resolveLoginFailureAction({ state: 'two-factor', quarantineApplied: true }, opts), {
            accountId: 'acc-1',
            sessionDir,
            proxy: { server: 'http://gw.example:7777' },
            source: 'test',
        });
        expect(mocks.createIncident).not.toHaveBeenCalled();
        expect(syncState.has('account_quarantine:acc-1')).toBe(false);
        expect((await getAutomationPauseState()).paused).toBe(false);
        expect(mocks.releaseStickyProxy).not.toHaveBeenCalled();
    });

    it('2FA con quarantena FALLITA alla fonte: qui scatta la seconda rete, l account non resta libero', async () => {
        // Trovato dalla review pre-push del blocco A: `checkLoginDetailed` quarantena e, se la
        // scrittura fallisce, lo diceva solo a `console.error`. Con la politica che si fidava sempre,
        // l'account restava fuori quarantena con una challenge 2FA pendente e il ciclo dopo il bot
        // rientrava nella stessa pagina. Ora l'esito viaggia nel tipo e qui c'e' il rimedio.
        await applyLoginFailureAction(resolveLoginFailureAction({ state: 'two-factor', quarantineApplied: false }, opts), {
            accountId: 'acc-1',
            sessionDir,
            proxy: { server: 'http://gw.example:7777' },
            source: 'test',
        });
        expect(syncState.has('account_quarantine:acc-1')).toBe(true);
        // Resta UN solo incident (quello della quarantena) e nessuna pausa globale: la 2FA blocca
        // l'account, non l'intera automazione degli altri account.
        expect((await getAutomationPauseState()).paused).toBe(false);
        expect(mocks.releaseStickyProxy).not.toHaveBeenCalled();
    });

    it('probeLinkedInStatus: 403 sul feed → HTTP_403_BLOCKED, non SESSION_EXPIRED (era il buco gemello del 429)', async () => {
        const esito = await probeLinkedInStatus(paginaFinta({ gotoStatus: 403 }));
        expect(esito.ok).toBe(false);
        expect(esito.reason).toBe('HTTP_403_BLOCKED');
        expect(resolveLoginFailureAction(classifyProbeReason(esito.reason), opts).reason).toBe('HTTP_403_BLOCKED');
    });
});
