/**
 * dashboardSession.ts
 * ─────────────────────────────────────────────────────────────────
 * Sorgente UNICA della validazione della sessione dashboard (cookie `dashboard_session`).
 *
 * Estratta da server.ts (CL15) perche' usata da DUE auth-path:
 *   - HTTP middleware (server.ts: hasValidDashboardSession)  -> refresh sliding-window
 *   - WebSocket handshake (wsAuth.ts: isWebSocketAuthorizedAsync) -> read-only
 *
 * Single-source = un solo posto da mantenere/auditare per la validazione del token di sessione,
 * niente drift tra HTTP e WS. wsAuth resta indipendente dal server monolitico (motivo della sua estrazione).
 */

import crypto from 'node:crypto';
import { getDatabase } from '../db';

export const DASHBOARD_SESSION_COOKIE = 'dashboard_session';
export const DASHBOARD_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** SHA-256 del token di sessione: nel DB salviamo solo l'hash, mai il token in chiaro. */
export function hashDashboardSessionToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

interface DashboardSessionRow {
    expires_at: string;
    revoked_at: string | null;
}

/**
 * Valida un token di sessione dashboard contro `dashboard_sessions`.
 * FAIL-CLOSED: token assente/non trovato/revocato/scaduto -> false; qualsiasi errore DB -> false
 * (una sessione non e' MAI considerata valida "in caso di dubbio" — e' un controllo di sicurezza).
 *
 * @param opts.refresh se true, estende la scadenza (sliding-window) come fa l'auth HTTP a ogni richiesta.
 *                     Il path WS passa false (read-only: l'handshake non deve avere side-effect di scrittura).
 */
export async function validateDashboardSessionToken(
    token: string | null | undefined,
    opts: { refresh?: boolean } = {},
): Promise<boolean> {
    if (!token || token.trim().length === 0) {
        return false;
    }
    try {
        const tokenHash = hashDashboardSessionToken(token);
        const db = await getDatabase();
        const row = await db.get<DashboardSessionRow>(
            `SELECT expires_at, revoked_at FROM dashboard_sessions WHERE token_hash = ? LIMIT 1`,
            [tokenHash],
        );
        if (!row || row.revoked_at) {
            return false;
        }
        const expiresAtMs = Date.parse(row.expires_at);
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
            return false;
        }
        if (opts.refresh) {
            const nowIso = new Date().toISOString();
            const refreshedExpiry = new Date(Date.now() + DASHBOARD_SESSION_TTL_MS).toISOString();
            await db.run(`UPDATE dashboard_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?`, [
                nowIso,
                refreshedExpiry,
                tokenHash,
            ]);
        }
        return true;
    } catch {
        // fail-closed: un errore di validazione non deve MAI autorizzare l'accesso.
        return false;
    }
}

/** Estrae il valore del cookie `dashboard_session` da un header Cookie grezzo (per il WS handshake,
 *  che espone http.IncomingMessage e non un Express Request). Ritorna null se assente/malformato. */
export function extractDashboardSessionCookie(rawCookieHeader: string | undefined): string | null {
    if (!rawCookieHeader) return null;
    for (const pair of rawCookieHeader.split(';')) {
        const trimmed = pair.trim();
        const idx = trimmed.indexOf('=');
        if (idx <= 0) continue;
        if (trimmed.slice(0, idx).trim() !== DASHBOARD_SESSION_COOKIE) continue;
        const value = trimmed.slice(idx + 1).trim();
        try {
            return decodeURIComponent(value) || null;
        } catch {
            return value || null;
        }
    }
    return null;
}
