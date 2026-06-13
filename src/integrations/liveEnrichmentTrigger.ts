/**
 * Live Enrichment Trigger
 *
 * Aggancio post-scraping: quando un workflow salva lead nuovi, lancia IN BACKGROUND
 * (processo detached da terminale) l'enrichment parallelo dei soli lead mancanti, usando
 * solo le fonti gratuite (`enrich-live` = `enrich-fast --free --drain`). Fire-and-forget:
 * NON blocca il workflow chiamante e non propaga mai eccezioni.
 *
 * Zero browser / zero LinkedIn: l'enrichment usa solo fonti esterne HTTP/DNS → anti-ban-safe.
 *
 * Lock single-instance (file in tmp, posseduto dal PID del figlio): se un live-enrichment è già
 * in corso non ne parte un duplicato. Il suo drain-loop drenerà comunque i lead arrivati nel
 * frattempo. La funzione è SINCRONA → nel daemon single-thread non c'è race tra workflow paralleli.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from '../config';
import { logInfo, logWarn } from '../telemetry/logger';

const LOCK_FILE = path.join(os.tmpdir(), 'linkedin-bot-live-enrich.lock');
/** Oltre questa età il lock è considerato orfano anche se il PID risultasse vivo (backstop). */
const LOCK_STALE_MS = 20 * 60_000;

interface LockData {
    pid: number;
    startedAt: number;
}

/**
 * Lancia (se non già in corso) l'enrichment live in background per i lead non ancora arricchiti.
 * Sincrona e best-effort: ogni errore viene loggato, mai propagato al chiamante.
 */
export function triggerLiveEnrichment(listName?: string): void {
    if (!config.liveEnrichEnabled) {
        return;
    }

    try {
        if (isLockActive()) {
            void logInfo('live_enrich.skip_locked', { listName: listName ?? null });
            return;
        }
        // Lock orfano (PID morto o stale) → rimuovi prima di ripartire.
        clearLock();

        const entry = process.argv[1];
        if (!entry) {
            void logWarn('live_enrich.no_entry', {});
            return;
        }

        // Dev (entry .ts via ts-node/tsx) vs prod (entry .js compilato): nel primo caso il figlio
        // deve ricevere lo stesso loader del padre, altrimenti `node file.ts` fallirebbe.
        const isTs = entry.endsWith('.ts');
        const execArgv = isTs ? (process.execArgv.length > 0 ? process.execArgv : ['-r', 'ts-node/register']) : [];

        const cmdArgs = ['enrich-live'];
        if (listName) {
            cmdArgs.push('--list', listName);
        }

        const child = spawn(process.execPath, [...execArgv, entry, ...cmdArgs], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
        });

        child.on('error', (err) => {
            void logWarn('live_enrich.spawn_error', { error: err.message });
            clearLock();
        });

        if (child.pid) {
            writeLock(child.pid);
            child.unref();
            void logInfo('live_enrich.spawned', { pid: child.pid, listName: listName ?? null });
        } else {
            // Spawn senza pid: il listener 'error' gestirà l'eventuale fallimento.
            child.unref();
        }
    } catch (err) {
        void logWarn('live_enrich.trigger_error', { error: err instanceof Error ? err.message : String(err) });
        clearLock();
    }
}

/** true se un live-enrichment è realmente in corso (file presente, PID vivo, non stale). */
function isLockActive(): boolean {
    try {
        if (!fs.existsSync(LOCK_FILE)) {
            return false;
        }
        const raw = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) as Partial<LockData>;
        const pid = Number(raw.pid);
        const startedAt = Number(raw.startedAt);
        if (!Number.isInteger(pid) || pid <= 0) {
            return false;
        }
        if (!Number.isFinite(startedAt) || Date.now() - startedAt > LOCK_STALE_MS) {
            return false;
        }
        return isProcessAlive(pid);
    } catch {
        return false;
    }
}

/** Cross-platform liveness check via signal 0 (EPERM = esiste ma non accessibile → vivo). */
function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
}

function writeLock(pid: number): void {
    try {
        const data: LockData = { pid, startedAt: Date.now() };
        fs.writeFileSync(LOCK_FILE, JSON.stringify(data));
    } catch {
        // best-effort: l'assenza del lock al più consente un doppio spawn (idempotente lato DB)
    }
}

function clearLock(): void {
    try {
        fs.rmSync(LOCK_FILE, { force: true });
    } catch {
        // best-effort
    }
}
