/**
 * ai/ollamaLifecycle.ts
 * Avvio/arresto ON-DEMAND del server Ollama locale.
 *
 * Ollama non è più in autostart di Windows, ma il bot lo usa come provider AI locale
 * per la guard zero-PII (providerRegistry.ts): i purpose con PII del lead risolvono SOLO
 * a endpoint locale o template. Quindi al lancio di un run operativo assicuriamo che il
 * server sia su, e a fine run lo spegniamo SOLO se l'abbiamo avviato noi.
 *
 * Contratto (best-effort, non blocca mai il run):
 * - probe `${ollamaEndpoint}/api/tags` (timeout 2s). 200 → già su (utente/Odysseus) → non toccare.
 * - giù → `ollama serve` detached/nascosto → poll `/api/tags` fino a 200 (timeout 30s, poll 1s).
 *   ACK≠EFFETTO: si attende la CONDIZIONE reale (HTTP 200), non un tempo fisso.
 * - timeout scaduto → log e il bot prosegue comunque (il registry ha il fallback template).
 * - a fine run: stop SOLO del processo avviato da noi (startedByUs); mai un'istanza preesistente.
 *
 * Endpoint remoto (OLLAMA_ENDPOINT non-loopback) → gestito altrove: non avviamo un server locale.
 * AI_PROVIDER=template → AI locale disattivata: niente da gestire.
 * Env OLLAMA_FLASH_ATTENTION/OLLAMA_KV_CACHE_TYPE: già a livello User → ereditati dal processo figlio.
 */

import { spawn, type ChildProcess } from 'child_process';
import { config } from '../config';
import { logInfo, logWarn } from '../telemetry/logger';

const OLLAMA_PROBE_TIMEOUT_MS = 2_000;
const OLLAMA_START_TIMEOUT_MS = 30_000;
const OLLAMA_POLL_INTERVAL_MS = 1_000;

let ensured = false;
let startedByUs = false;
let stopped = false;
let child: ChildProcess | null = null;

/** true se l'endpoint punta a un host loopback (server locale gestibile da noi). */
export function isLoopbackEndpoint(endpoint: string): boolean {
    try {
        const host = new URL(endpoint).hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    } catch {
        return false;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Probe `/api/tags` con timeout esplicito. Ritorna true solo su risposta 2xx. */
async function probeOllama(timeoutMs: number): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const base = config.ollamaEndpoint.replace(/\/+$/, '');
        const res = await fetch(`${base}/api/tags`, { signal: controller.signal });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Assicura che il server Ollama locale sia raggiungibile, avviandolo se necessario.
 * Idempotente per processo, best-effort: non lancia mai eccezioni, non blocca il run.
 */
export async function ensureOllamaRunning(): Promise<void> {
    if (ensured) return;
    ensured = true;

    // AI locale disattivata da config → niente da gestire.
    if (config.aiProvider === 'template') return;

    // Endpoint remoto → non è nostro compito avviare un server: lo gestisce chi lo ospita.
    const endpoint = config.ollamaEndpoint;
    if (!endpoint || !isLoopbackEndpoint(endpoint)) return;

    // 1. Probe: se già su (utente/Odysseus) non tocchiamo nulla.
    if (await probeOllama(OLLAMA_PROBE_TIMEOUT_MS)) return;

    // 2. Avvio detached/nascosto. `ollama serve` (ollama.exe risolto da PATH) È il server.
    try {
        child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (err) {
        void logWarn('ollama.spawn_throw', { error: err instanceof Error ? err.message : String(err) });
        return;
    }
    startedByUs = true;
    let childAlive = true;
    // Se il figlio muore (es. porta già in uso perché qualcun altro l'ha alzato nel frattempo),
    // NON è nostro: startedByUs=false così non proviamo a fermare un'istanza altrui.
    child.on('error', (err) => {
        childAlive = false;
        startedByUs = false;
        void logWarn('ollama.spawn_error', { error: err.message });
    });
    child.on('exit', () => {
        childAlive = false;
        startedByUs = false;
    });
    child.unref();
    void logInfo('ollama.starting', { pid: child.pid ?? null, endpoint });

    // 3. Poll fino a 200 (condizione reale), non un tempo fisso.
    const deadline = Date.now() + OLLAMA_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (!childAlive) {
            void logWarn('ollama.start_child_exited', {});
            return;
        }
        await sleep(OLLAMA_POLL_INTERVAL_MS);
        if (await probeOllama(OLLAMA_PROBE_TIMEOUT_MS)) {
            void logInfo('ollama.ready', { pid: child.pid ?? null });
            return;
        }
    }
    // Timeout: se il figlio è ancora vivo resta nostro (verrà fermato a fine run); il bot
    // prosegue comunque col fallback template del registry.
    void logWarn('ollama.start_timeout', { timeoutMs: OLLAMA_START_TIMEOUT_MS });
}

/**
 * Termina il processo `ollama serve` E i suoi sottoprocessi `runner`.
 * `ollama serve` spawna un `runner` per-modello che tiene il modello in VRAM: su Windows
 * `child.kill` termina solo il parent e lascia il runner ORFANO (leak VRAM ~GB, verificato
 * dal vivo). `taskkill /T /F` uccide l'intero albero; su POSIX il figlio è leader del suo
 * process group (detached) → `kill(-pid)` uccide il gruppo.
 */
function killProcessTree(pid: number): Promise<void> {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            const tk = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true,
            });
            tk.on('error', () => resolve());
            tk.on('exit', () => resolve());
        } else {
            try {
                process.kill(-pid, 'SIGTERM');
            } catch {
                try {
                    process.kill(pid, 'SIGTERM');
                } catch {
                    /* già terminato */
                }
            }
            resolve();
        }
    });
}

/** Ferma Ollama SOLO se l'abbiamo avviato noi. Idempotente. */
export async function stopOllamaIfStarted(): Promise<void> {
    if (!startedByUs || stopped || !child) return;
    stopped = true;
    const pid = child.pid;
    try {
        if (typeof pid === 'number') {
            await killProcessTree(pid);
        } else {
            child.kill('SIGTERM');
        }
        void logInfo('ollama.stopped', { pid: pid ?? null });
    } catch (err) {
        void logWarn('ollama.stop_error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
        child = null;
        startedByUs = false;
    }
}
