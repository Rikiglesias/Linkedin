import { getFailedJobs, markJobAsDeadLetter, recycleJob } from '../core/repositories';
import { JobRecord } from '../types/domain';
import { logInfo, logError, logWarn } from '../telemetry/logger';

export interface DeadLetterOptions {
    batchSize?: number;
    recycleDelaySec?: number;
}

export interface DeadLetterResult {
    processed: number;
    recycled: number;
    deadLettered: number;
}

/**
 * Heuristics to determine if an error is temporary (network, timeout, proxy)
 * or terminal (account blocked, missing lead, validation error).
 */
export function isErrorRecoverable(errorMsg: string): boolean {
    const lowerError = errorMsg.toLowerCase();

    const recoverablePatterns = [
        'timeout',
        'network',
        'econnrefused',
        'target closed',
        'page target is closed',
        'navigation failed',
        'proxy error',
        'rate limit',
        '429',
        '502',
        '503',
        '504'
    ];

    const terminalPatterns = [
        'page not found',
        'invalid url',
        'user not found',
        'banned',
        'restricted',
        '404',
        'not a valid linkedin url'
    ];

    // Tratta le regex come superabili per default, a meno che non ci sia una keyword terminale.
    // L'idea è che se è semplicemente 'Timeout waiting for selector X', il selettore potrebbe essere stato offuscato e lo svilupperemo o fisseremo.
    // Quindi ricicliamo il job con bassa probabilità per provarlo con nuovi selettori la prossima volta.

    for (const terminal of terminalPatterns) {
        if (lowerError.includes(terminal)) {
            return false;
        }
    }

    for (const recoverable of recoverablePatterns) {
        if (lowerError.includes(recoverable)) {
            return true;
        }
    }

    // Se l'errore è completamente sconosciuto (es. un selettore rotto "failed to find element .pv-text-details"), 
    // lo consideriamo riciclabile perché vogliamo che il job giri nuovamente quando faremo git pull del fix.
    return true;
}

/**
 * Worker node that queries FAILED jobs, analyzes the errors, and decides their fate.
 * FAILED jobs are those that have exhausted all their attempts (`attempts >= max_attempts`).
 */
export async function runDeadLetterWorker(options: DeadLetterOptions = {}): Promise<DeadLetterResult> {
    const batchSize = options.batchSize || 100;
    const baseRecycleDelaySec = options.recycleDelaySec || 86400; // default 24h before re-attempting

    let processed = 0;
    let recycled = 0;
    let deadLettered = 0;

    logInfo(`Starting Dead Letter Worker (batchSize: ${batchSize})`);

    try {
        let hasMore = true;

        while (hasMore) {
            const failedJobs: JobRecord[] = await getFailedJobs(batchSize);

            if (failedJobs.length === 0) {
                hasMore = false;
                break;
            }

            for (const job of failedJobs) {
                processed++;
                const errorMsg = job.last_error || 'Unknown Error';

                const recoverable = isErrorRecoverable(errorMsg);

                if (recoverable) {
                    // Calculate a delay, perhaps adding jitter so they don't all run together
                    const jitter = Math.floor(Math.random() * 3600);
                    const delaySec = baseRecycleDelaySec + jitter;

                    // Priority 50 is lower than regular jobs (usually 10 for invites, 30 for checks)
                    await recycleJob(job.id, delaySec, 50);
                    recycled++;
                    logInfo(`Recycled Job ${job.id} (${job.type}) due to recoverable error: ${errorMsg.substring(0, 50)}`);
                } else {
                    await markJobAsDeadLetter(job.id, `Terminated. Original error: ${errorMsg}`);
                    deadLettered++;
                    logWarn(`Dead-Lettered Job ${job.id} (${job.type}) due to terminal error: ${errorMsg.substring(0, 50)}`);
                }
            }

            // To avoid infinite loops, if the number of fetched jobs is less than batch size, we are done
            if (failedJobs.length < batchSize) {
                hasMore = false;
            }
        }

        logInfo(`Dead Letter Worker completed. Processed: ${processed}, Recycled: ${recycled}, Dead-Lettered: ${deadLettered}`);

        return { processed, recycled, deadLettered };
    } catch (e) {
        logError('Error in Dead Letter Worker loop:', { error: e instanceof Error ? e.message : String(e) });
        throw e;
    }
}
