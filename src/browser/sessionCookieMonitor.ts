/**
 * browser/sessionCookieMonitor.ts
 * ─────────────────────────────────────────────────────────────────
 * Monitora l'età dei session cookie LinkedIn e forza la ri-autenticazione
 * quando superano la soglia configurata. Previene lo scenario in cui
 * un cookie compromesso resta attivo indefinitamente.
 *
 * Per ogni session directory mantiene un file `.session-meta.json`
 * con il timestamp dell'ultima autenticazione verificata.
 */

import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { Page } from 'playwright';
import { logInfo, logWarn } from '../telemetry/logger';

const META_FILENAME = '.session-meta.json';

export interface BehavioralProfile {
    avgScrollSpeedPxPerSec: number;
    avgClickDelayMs: number;
    preferredWarmupOrder: 'feed-first' | 'notifications-first' | 'search-first';
    peakActivityHour: number;
    avgSessionDurationMin: number;
    profileVersion: number;
}

interface SessionMeta {
    lastVerifiedAt: string;
    lastVerifiedBy: string;
    createdAt: string;
    rotationCount: number;
    cookieHash?: string;
    behavioralProfile?: BehavioralProfile;
}

const DEFAULT_MAX_AGE_DAYS = 7;

function getMetaPath(sessionDir: string): string {
    return path.join(sessionDir, META_FILENAME);
}

function readMeta(sessionDir: string): SessionMeta | null {
    const metaPath = getMetaPath(sessionDir);
    try {
        if (!fs.existsSync(metaPath)) return null;
        const raw = fs.readFileSync(metaPath, 'utf8');
        return JSON.parse(raw) as SessionMeta;
    } catch {
        return null;
    }
}

function writeMeta(sessionDir: string, meta: SessionMeta): void {
    const metaPath = getMetaPath(sessionDir);
    try {
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    } catch {
        // Non bloccare il flusso se la scrittura fallisce
    }
}

/**
 * Registra una verifica di autenticazione avvenuta con successo.
 * Chiamare dopo ogni `checkLogin()` che ritorna `true`.
 */
export function recordSuccessfulAuth(sessionDir: string, actor: string = 'orchestrator', cookieHash?: string): void {
    const existing = readMeta(sessionDir);
    const now = new Date().toISOString();
    writeMeta(sessionDir, {
        lastVerifiedAt: now,
        lastVerifiedBy: actor,
        createdAt: existing?.createdAt ?? now,
        rotationCount: existing?.rotationCount ?? 0,
        cookieHash: cookieHash ?? existing?.cookieHash,
    });
}

export interface SessionFreshnessCheck {
    fresh: boolean;
    sessionAgeDays: number;
    maxAgeDays: number;
    lastVerifiedAt: string | null;
    needsRotation: boolean;
}

/**
 * Verifica se la sessione è ancora "fresca" in base alla soglia configurata.
 */
export function checkSessionFreshness(
    sessionDir: string,
    maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
): SessionFreshnessCheck {
    const meta = readMeta(sessionDir);
    const safeMaxAge = Math.max(1, maxAgeDays);

    if (!meta) {
        return {
            fresh: true,
            sessionAgeDays: 0,
            maxAgeDays: safeMaxAge,
            lastVerifiedAt: null,
            needsRotation: false,
        };
    }

    const lastVerified = new Date(meta.lastVerifiedAt).getTime();
    const ageDays = (Date.now() - lastVerified) / (24 * 60 * 60 * 1000);

    return {
        fresh: ageDays < safeMaxAge,
        sessionAgeDays: Math.round(ageDays * 10) / 10,
        maxAgeDays: safeMaxAge,
        lastVerifiedAt: meta.lastVerifiedAt,
        needsRotation: ageDays >= safeMaxAge,
    };
}

/**
 * Forza la rotazione della sessione: cancella i cookie LinkedIn
 * dal contesto browser. Al prossimo avvio, sarà necessario re-autenticarsi.
 */
export async function rotateSessionCookies(
    page: Page,
    sessionDir: string,
    reason: string = 'manual_rotation',
): Promise<boolean> {
    try {
        const context = page.context();
        const cookies = await context.cookies('https://www.linkedin.com');
        const linkedinCookies = cookies.filter((c) => c.domain.includes('linkedin.com'));

        if (linkedinCookies.length === 0) {
            await logInfo('session_cookie.rotation_skipped', { reason: 'no_linkedin_cookies' });
            return false;
        }

        await context.clearCookies();

        const meta = readMeta(sessionDir);
        const now = new Date().toISOString();
        writeMeta(sessionDir, {
            lastVerifiedAt: now,
            lastVerifiedBy: `rotation:${reason}`,
            createdAt: meta?.createdAt ?? now,
            rotationCount: (meta?.rotationCount ?? 0) + 1,
        });

        await logInfo('session_cookie.rotated', {
            sessionDir,
            reason,
            cookiesCleared: linkedinCookies.length,
            rotationCount: (meta?.rotationCount ?? 0) + 1,
        });

        return true;
    } catch (error) {
        await logWarn('session_cookie.rotation_failed', {
            sessionDir,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

/**
 * Restituisce il riepilogo dello stato della sessione per diagnostica.
 */
export function getSessionMetaSummary(sessionDir: string): SessionMeta | null {
    return readMeta(sessionDir);
}

/**
 * Rileva anomalie nel session cookie LinkedIn:
 * - Cookie cambiato senza rotazione esplicita (segnale di invalidazione server-side)
 * - Cookie scomparso (sessione scaduta/revocata)
 * Ritorna null se tutto OK, altrimenti il tipo di anomalia.
 */
export async function detectSessionCookieAnomaly(
    page: Page,
    sessionDir: string,
): Promise<{ anomaly: 'COOKIE_CHANGED' | 'COOKIE_MISSING'; previous: string | null; current: string | null } | null> {
    const meta = readMeta(sessionDir);
    const previousHash = meta?.cookieHash ?? null;

    let currentHash: string | null = null;
    try {
        const cookies = await page.context().cookies('https://www.linkedin.com');
        const liAt = cookies.find((c) => c.name === 'li_at' && c.value.trim().length > 0);
        if (liAt) {
            currentHash = crypto.createHash('sha256').update(liAt.value).digest('hex').slice(0, 16);
        }
    } catch {
        return null;
    }

    if (!currentHash) {
        if (previousHash) {
            await logWarn('session_cookie.anomaly.missing', {
                sessionDir,
                previousHash,
                message: 'Cookie li_at scomparso — possibile invalidazione server-side. Verifica manualmente il login su LinkedIn. Se funziona, il cookie verrà rigenerato al prossimo avvio.',
            });
            return { anomaly: 'COOKIE_MISSING', previous: previousHash, current: null };
        }
        return null;
    }

    if (previousHash && currentHash !== previousHash) {
        await logWarn('session_cookie.anomaly.changed', {
            sessionDir,
            previousHash,
            currentHash,
            message: 'Cookie li_at cambiato senza rotazione esplicita — LinkedIn potrebbe aver rigenerato la sessione.',
        });
        // Aggiorna il meta con il nuovo hash per non ri-alertare
        if (meta) {
            writeMeta(sessionDir, { ...meta, cookieHash: currentHash });
        }
        return { anomaly: 'COOKIE_CHANGED', previous: previousHash, current: currentHash };
    }

    // Se non avevamo un hash precedente, salvalo ora (prima volta)
    if (!previousHash && currentHash && meta) {
        writeMeta(sessionDir, { ...meta, cookieHash: currentHash });
    }

    return null;
}

// ─── Session Maturity ────────────────────────────────────────────────────────

export type SessionMaturity = 'new' | 'warm' | 'established';

export interface SessionMaturityResult {
    maturity: SessionMaturity;
    ageDays: number;
    /** Budget multiplier based on maturity (0.3 new, 0.6 warm, 1.0 established) */
    budgetFactor: number;
    /** Se true, suggerisce attività random prima delle azioni di valore */
    forceRandomActivityFirst: boolean;
}

/**
 * Calcola la maturità della sessione basandosi sull'età del file .session-meta.json.
 * Le sessioni nuove (cookie freschi) partono con budget ridotto per evitare
 * detection da parte di LinkedIn.
 *
 * - `new` (0-2 giorni): 30% budget, forza random activity prima
 * - `warm` (2-7 giorni): 60% budget
 * - `established` (7+ giorni): 100% budget
 */
export function getSessionMaturity(sessionDir: string): SessionMaturityResult {
    const meta = readMeta(sessionDir);

    if (!meta) {
        // Nessun meta → sessione mai verificata, trattala come nuovissima
        return {
            maturity: 'new',
            ageDays: 0,
            budgetFactor: 0.3,
            forceRandomActivityFirst: true,
        };
    }

    const createdMs = new Date(meta.createdAt).getTime();
    const ageDays = Number.isFinite(createdMs)
        ? (Date.now() - createdMs) / (24 * 60 * 60 * 1000)
        : 0;

    if (ageDays < 2) {
        return {
            maturity: 'new',
            ageDays: Math.round(ageDays * 10) / 10,
            budgetFactor: 0.3,
            forceRandomActivityFirst: true,
        };
    }

    if (ageDays < 7) {
        return {
            maturity: 'warm',
            ageDays: Math.round(ageDays * 10) / 10,
            budgetFactor: 0.6,
            forceRandomActivityFirst: false,
        };
    }

    return {
        maturity: 'established',
        ageDays: Math.round(ageDays * 10) / 10,
        budgetFactor: 1.0,
        forceRandomActivityFirst: false,
    };
}

// ─── AB-1: Behavioral Fingerprint Cross-Session ─────────────────────────────

const BEHAVIORAL_PROFILE_VERSION = 1;

/**
 * Genera un profilo comportamentale iniziale deterministico per account.
 * Usa FNV-1a sull'accountId per creare valori "personali" unici ma stabili.
 * Simula un umano con abitudini coerenti: velocità scroll, delay click,
 * ordine navigazione preferito, orario di punta.
 */
function generateInitialProfile(accountId: string): BehavioralProfile {
    let hash = 0x811c9dc5;
    const seed = `behavioral:${accountId}`;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    const h = hash >>> 0;

    const warmupOrders: BehavioralProfile['preferredWarmupOrder'][] = [
        'feed-first', 'notifications-first', 'search-first',
    ];

    return {
        avgScrollSpeedPxPerSec: 120 + (h % 180),
        avgClickDelayMs: 800 + (h % 1200),
        preferredWarmupOrder: warmupOrders[h % 3] ?? 'feed-first',
        peakActivityHour: 9 + (h % 4),
        avgSessionDurationMin: 18 + (h % 15),
        profileVersion: BEHAVIORAL_PROFILE_VERSION,
    };
}

/**
 * Applica drift lento al profilo: ±5% su valori numerici per simulare
 * la naturale evoluzione delle abitudini umane nel tempo.
 */
function applyProfileDrift(profile: BehavioralProfile): BehavioralProfile {
    const drift = (value: number, maxPct: number): number => {
        const delta = value * maxPct * (Math.random() * 2 - 1);
        return Math.round(value + delta);
    };

    return {
        ...profile,
        avgScrollSpeedPxPerSec: Math.max(60, drift(profile.avgScrollSpeedPxPerSec, 0.05)),
        avgClickDelayMs: Math.max(300, drift(profile.avgClickDelayMs, 0.05)),
        avgSessionDurationMin: Math.max(10, drift(profile.avgSessionDurationMin, 0.05)),
        profileVersion: BEHAVIORAL_PROFILE_VERSION,
    };
}

/**
 * Ritorna il profilo comportamentale per una sessione.
 * Se non esiste, lo genera deterministicamente dall'accountId.
 * Se esiste, applica drift lento (~5%) e lo persiste — MA solo una volta al giorno.
 * C12 fix: senza il cap giornaliero, 10 riavvii/giorno → drift 50% cumulativo.
 * Il caller usa questi valori per modulare delay, scroll speed, ordine warmup.
 */
export function getBehavioralProfile(sessionDir: string, accountId: string): BehavioralProfile {
    const meta = readMeta(sessionDir);
    const existing = meta?.behavioralProfile;

    if (existing && existing.profileVersion === BEHAVIORAL_PROFILE_VERSION) {
        // C12: Drift max 1 volta al giorno — evita accumulo con riavvii frequenti.
        // Controlla se il meta è stato scritto oggi; se sì, ritorna il profilo as-is.
        const lastWrittenDate = meta?.lastVerifiedAt
            ? new Date(meta.lastVerifiedAt).toISOString().slice(0, 10)
            : null;
        const today = new Date().toISOString().slice(0, 10);
        if (lastWrittenDate === today) {
            return existing; // Già driftato oggi — ritorna senza modifiche
        }

        const drifted = applyProfileDrift(existing);
        if (meta) {
            writeMeta(sessionDir, { ...meta, behavioralProfile: drifted });
        }
        return drifted;
    }

    const initial = generateInitialProfile(accountId);
    if (meta) {
        writeMeta(sessionDir, { ...meta, behavioralProfile: initial });
    }
    return initial;
}
