/**
 * preventiveGuards.ts — Guardie preventive per resilienza e anti-ban proattivo.
 *
 * C: Heartbeat Telegram periodico (ogni N ore, "bot vivo")
 * A: Backup DB automatico pre-ciclo
 * B: Alert circuit breaker OPEN
 * K: Varianza sessioni giornaliere
 */

import fs from 'fs';
import path from 'path';
import { config, getLocalDateString } from '../config';
import { getRuntimeFlag, setRuntimeFlag, getDailyStat } from './repositories';
import { broadcast } from '../telemetry/broadcaster';
import { logInfo, logWarn } from '../telemetry/logger';

// ─── C: Heartbeat Telegram ───────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 ore

/**
 * Invia un heartbeat Telegram periodico con lo stato del bot.
 * Frequenza: massimo 1 ogni 4 ore. Se il heartbeat non arriva,
 * significa che il bot è morto o bloccato.
 */
export async function sendHeartbeatIfDue(): Promise<void> {
    try {
        const lastRaw = await getRuntimeFlag('heartbeat_last_at');
        if (lastRaw) {
            const elapsed = Date.now() - Date.parse(lastRaw);
            if (elapsed < HEARTBEAT_INTERVAL_MS) return;
        }

        const localDate = getLocalDateString();
        const invites = await getDailyStat(localDate, 'invites_sent');
        const messages = await getDailyStat(localDate, 'messages_sent');
        const errors = await getDailyStat(localDate, 'run_errors');
        const selectorFails = await getDailyStat(localDate, 'selector_failures');

        await broadcast({
            level: 'INFO',
            title: 'Bot Heartbeat',
            body: [
                `Data: ${localDate}`,
                `Inviti: ${invites} | Messaggi: ${messages}`,
                `Errori: ${errors} | Selector fail: ${selectorFails}`,
                `Uptime: attivo`,
            ].join('\n'),
        });

        await setRuntimeFlag('heartbeat_last_at', new Date().toISOString());
        await logInfo('preventive.heartbeat_sent', { localDate, invites, messages, errors });
    } catch (err) {
        await logWarn('preventive.heartbeat_failed', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// ─── A: Backup DB automatico ─────────────────────────────────────────────────

const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 ore
const MAX_BACKUPS = 5;

/**
 * Crea un backup del DB SQLite se non ne è stato fatto uno nelle ultime 6 ore.
 * Mantiene solo gli ultimi 5 backup per non riempire il disco.
 */
export async function backupDbIfDue(): Promise<void> {
    // Solo per SQLite — PostgreSQL ha i suoi meccanismi di backup
    if (config.databaseUrl && config.databaseUrl.startsWith('postgres')) return;

    try {
        const lastRaw = await getRuntimeFlag('db_backup_last_at');
        if (lastRaw) {
            const elapsed = Date.now() - Date.parse(lastRaw);
            if (elapsed < BACKUP_INTERVAL_MS) return;
        }

        const dbPath = path.resolve(config.dbPath || 'data/linkedin_bot.sqlite');
        if (!fs.existsSync(dbPath)) return;

        const backupDir = path.join(path.dirname(dbPath), 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `linkedin_${timestamp}.db`);
        fs.copyFileSync(dbPath, backupPath);

        // Pulizia vecchi backup: mantieni solo MAX_BACKUPS
        const backups = fs
            .readdirSync(backupDir)
            .filter((f) => f.startsWith('linkedin_') && f.endsWith('.db'))
            .sort()
            .reverse();

        for (const old of backups.slice(MAX_BACKUPS)) {
            fs.unlinkSync(path.join(backupDir, old));
        }

        await setRuntimeFlag('db_backup_last_at', new Date().toISOString());
        await logInfo('preventive.db_backup_created', {
            backupPath,
            backupCount: Math.min(backups.length, MAX_BACKUPS),
        });
    } catch (err) {
        await logWarn('preventive.db_backup_failed', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// ─── B: Alert circuit breaker OPEN ───────────────────────────────────────────

/**
 * Verifica lo stato dei circuit breaker e alerta se qualcuno è OPEN.
 * Chiamato una volta per ciclo orchestratore.
 */
export async function alertCircuitBreakerStatus(): Promise<void> {
    try {
        const { getDatabase } = await import('../db');
        const db = await getDatabase();

        // I circuit breaker sono persistiti in runtime_flags con chiave 'cb:*'
        // Il prefisso circuit breaker in integrationPolicy.ts è 'cb::' (doppio due punti)
        const rows = await db.query<{ key: string; value: string }>(
            `SELECT key, value FROM runtime_flags WHERE key LIKE 'cb::%' AND value LIKE '%OPEN%'`,
        );

        if (rows.length === 0) return;

        const openBreakers = rows.map((r) => {
            try {
                const parsed = JSON.parse(r.value) as { state?: string; openedAt?: string };
                return { key: r.key.replace('cb::', ''), state: parsed.state ?? 'OPEN', openedAt: parsed.openedAt };
            } catch {
                return { key: r.key.replace('cb::', ''), state: 'OPEN', openedAt: undefined };
            }
        });

        // Alert solo una volta per giorno per evitare spam
        const localDate = getLocalDateString();
        const alertKey = `cb_alert_date`;
        const lastAlertDate = await getRuntimeFlag(alertKey);
        if (lastAlertDate === localDate) return;

        await setRuntimeFlag(alertKey, localDate);

        const breakerList = openBreakers
            .map((b) => `- ${b.key} (${b.state}${b.openedAt ? `, da ${b.openedAt}` : ''})`)
            .join('\n');

        await broadcast({
            level: 'WARNING',
            title: 'Circuit Breaker OPEN',
            body: `${openBreakers.length} circuit breaker aperti:\n${breakerList}\n\nServizi degradati — il bot sta usando fallback meccanici.`,
        });

        await logWarn('preventive.circuit_breaker_open', {
            count: openBreakers.length,
            breakers: openBreakers.map((b) => b.key),
        });
    } catch (err) {
        await logWarn('preventive.circuit_breaker_check_failed', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// ─── K: Varianza sessioni giornaliere ────────────────────────────────────────

/**
 * Determina se oggi il bot dovrebbe fare una sessione in meno, in più, o saltare.
 * Un umano reale non fa sempre lo stesso numero di sessioni ogni giorno.
 *
 * Ritorna un moltiplicatore:
 *   0.0 = skip giornata (5% probabilità — "giorno libero imprevisto")
 *   0.7 = sessione ridotta (15% — "giornata pigra")
 *   1.0 = normale (60%)
 *   1.2 = sessione extra (15% — "giornata produttiva")
 *   1.5 = raro extra (5% — "deadline urgente")
 *
 * Il moltiplicatore è deterministico per data+account (FNV-1a hash)
 * così lo stesso giorno produce lo stesso risultato anche se il bot riavvia.
 */
export function getSessionVarianceFactor(accountId: string): number {
    const today = getLocalDateString();
    const seed = fnv1aHash(`${accountId}:${today}:session_variance`);
    const roll = (seed % 100) / 100; // 0.00 - 0.99

    if (roll < 0.05) return 0.0; // 5%: skip
    if (roll < 0.2) return 0.7; // 15%: ridotta
    if (roll < 0.8) return 1.0; // 60%: normale
    if (roll < 0.95) return 1.2; // 15%: extra
    return 1.5; // 5%: raro extra
}

function fnv1aHash(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

// ─── Esecuzione batch ────────────────────────────────────────────────────────

/**
 * Esegue tutte le guardie preventive in un colpo.
 * Chiamato dall'orchestratore all'inizio di ogni ciclo.
 * Non-blocking: nessuna guardia può bloccare il workflow.
 */
/**
 * GAP 2: Re-scoring lead stale come parte delle guardie preventive.
 * Ricalcola il score per lead INVITED da >30 giorni (max 20 per ciclo).
 * Non-blocking: se AI down o DB errore, skip silenzioso.
 */
async function rescoreStaleLeadsIfDue(): Promise<void> {
    try {
        const lastRaw = await getRuntimeFlag('rescore_last_at');
        // Max 1 volta ogni 12 ore
        if (lastRaw && Date.now() - Date.parse(lastRaw) < 12 * 60 * 60 * 1000) return;

        const { rescoreStaleLeads } = await import('../ai/leadScorer');
        const result = await rescoreStaleLeads({ maxAgeDays: 30, limit: 20, concurrency: 3 });
        if (result.rescored > 0) {
            await logInfo('preventive.rescore_stale_done', {
                rescored: result.rescored,
                updated: result.updated,
            });
        }
        await setRuntimeFlag('rescore_last_at', new Date().toISOString());
    } catch (err) {
        await logWarn('preventive.rescore_stale_failed', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

export async function runPreventiveGuards(): Promise<void> {
    await Promise.allSettled([
        sendHeartbeatIfDue(),
        backupDbIfDue(),
        alertCircuitBreakerStatus(),
        rescoreStaleLeadsIfDue(),
    ]);
}
