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

import fs from 'fs';
import path from 'path';
import { Page } from 'playwright';
import { logInfo, logWarn } from '../telemetry/logger';

const META_FILENAME = '.session-meta.json';

interface SessionMeta {
    lastVerifiedAt: string;
    lastVerifiedBy: string;
    createdAt: string;
    rotationCount: number;
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
export function recordSuccessfulAuth(sessionDir: string, actor: string = 'orchestrator'): void {
    const existing = readMeta(sessionDir);
    const now = new Date().toISOString();
    writeMeta(sessionDir, {
        lastVerifiedAt: now,
        lastVerifiedBy: actor,
        createdAt: existing?.createdAt ?? now,
        rotationCount: existing?.rotationCount ?? 0,
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
