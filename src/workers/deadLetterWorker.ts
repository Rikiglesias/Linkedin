import { getDeadLetterJobs, markJobAsDeadLetter, recycleJob } from '../core/repositories';
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
        '504',
    ];

    const terminalPatterns = [
        'page not found',
        'invalid url',
        'user not found',
        'banned',
        'restricted',
        '404',
        'not a valid linkedin url',
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
 * Worker node that queries DEAD_LETTER jobs, analyzes the errors, and decides their fate.
 * DEAD_LETTER jobs are those that have exhausted all their attempts (`attempts >= max_attempts`).
 */
export async function runDeadLetterWorker(options: DeadLetterOptions = {}): Promise<DeadLetterResult> {
    const batchSize = options.batchSize || 100;
    const baseRecycleDelaySec = options.recycleDelaySec || 86400; // default 24h before re-attempting

    let processed = 0;
    let recycled = 0;
    let deadLettered = 0;

    await logInfo(`Starting Dead Letter Worker (batchSize: ${batchSize})`);

    try {
        let hasMore = true;

        while (hasMore) {
            const dlqJobs: JobRecord[] = await getDeadLetterJobs(batchSize);

            if (dlqJobs.length === 0) {
                hasMore = false;
                break;
            }

            for (const job of dlqJobs) {
                processed++;
                const errorMsg = job.last_error || 'Unknown Error';

                // Recycle cap: se il job è già stato riciclato una volta, non riciclarlo di nuovo.
                // Doppio segnale: (1) marker [DLQ_RECYCLED] nel last_error (sopravvive se il jobRunner
                // non lo sovrascrive) e (2) priority >= 50 (recycleJob setta priority=50, i job normali
                // hanno priority 10-30). Il check su priority è il segnale robusto perché il jobRunner
                // NON modifica il campo priority durante retry/dead-letter.
                const alreadyRecycled = errorMsg.includes('[DLQ_RECYCLED]') || job.priority >= 50;
                const recoverable = !alreadyRecycled && isErrorRecoverable(errorMsg);

                if (recoverable) {
                    const jitter = Math.floor(Math.random() * 3600);
                    const delaySec = baseRecycleDelaySec + jitter;

                    // Priority 50 is lower than regular jobs (usually 10 for invites, 30 for checks)
                    await recycleJob(job.id, delaySec, 50, errorMsg.substring(0, 200));
                    recycled++;
                    await logInfo(
                        `Recycled Job ${job.id} (${job.type}) due to recoverable error: ${errorMsg.substring(0, 50)}`,
                    );
                } else {
                    const reason = alreadyRecycled ? 'already_recycled_once' : 'terminal_error';
                    await markJobAsDeadLetter(job.id, `[DLQ_TERMINATED:${reason}] ${errorMsg}`);
                    deadLettered++;
                    await logWarn(
                        `Dead-Lettered Job ${job.id} (${job.type}) reason=${reason}: ${errorMsg.substring(0, 50)}`,
                    );
                }
            }

            if (dlqJobs.length < batchSize) {
                hasMore = false;
            }
        }

        await logInfo(
            `Dead Letter Worker completed. Processed: ${processed}, Recycled: ${recycled}, Dead-Lettered: ${deadLettered}`,
        );

        // M21: Alert Telegram aggregato — se ci sono job terminali, notifica l'utente.
        // Non serve alert per job riciclati (verranno ritentati automaticamente).
        if (deadLettered > 0) {
            try {
                const { sendTelegramAlert } = await import('../telemetry/alerts');
                await sendTelegramAlert(
                    `🗑️ **Dead Letter Queue**\n\n` +
                        `Processati: ${processed}\n` +
                        `Riciclati: ${recycled} (verranno ritentati)\n` +
                        `**Terminati: ${deadLettered}** (errori non recuperabili)\n\n` +
                        `Azione: controlla i log per dettagli o usa \`bot dead-letter --retry\` per forzare il retry.`,
                    'Dead Letter Summary',
                    deadLettered >= 5 ? 'critical' : 'warn',
                ).catch(() => null);
            } catch (alertErr) {
                // A04: dead letter alert failure — tracciare
                void logWarn('dead_letter_worker.a04.alert_failed', {
                    error: alertErr instanceof Error ? alertErr.message : String(alertErr),
                });
            }
        }

        return { processed, recycled, deadLettered };
    } catch (e) {
        await logError('Error in Dead Letter Worker loop:', { error: e instanceof Error ? e.message : String(e) });
        throw e;
    }
}
