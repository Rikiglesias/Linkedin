/**
 * workers/messagePrebuildWorker.ts
 * Batch job offline: pre-genera messaggi AI per lead READY_MESSAGE.
 * Eseguito nel loop SENZA browser — riduce la latenza durante la sessione operativa.
 *
 * Flusso:
 *   1. Trova lead READY_MESSAGE senza messaggio pre-built
 *   2. Per ciascuno, chiama buildPersonalizedFollowUpMessage (AI o template)
 *   3. Salva il messaggio in prebuilt_messages
 *   4. Il messageWorker lo consuma durante la sessione browser (zero latenza AI)
 *   5. Messaggi non usati scadono dopo 48h (expireOldPrebuiltMessages)
 */

import { getLeadById } from '../core/repositories/leadsCore';
import {
    getLeadsWithoutPrebuiltMessage,
    savePrebuiltMessage,
    expireOldPrebuiltMessages,
} from '../core/repositories/prebuiltMessages';
import { buildPersonalizedFollowUpMessage } from '../ai/messagePersonalizer';
import { hashMessage } from '../validation/messageValidator';
import { logInfo, logWarn } from '../telemetry/logger';

export interface MessagePrebuildReport {
    generated: number;
    failed: number;
    expired: number;
    skipped: number;
}

/**
 * Esegue il batch di pre-generazione messaggi.
 * @param limit — numero massimo di messaggi da pre-generare per ciclo
 */
export async function runMessagePrebuild(limit: number = 10): Promise<MessagePrebuildReport> {
    const report: MessagePrebuildReport = { generated: 0, failed: 0, expired: 0, skipped: 0 };

    // 1. Scadenza messaggi vecchi non usati
    report.expired = await expireOldPrebuiltMessages(48);

    // 2. Trova lead senza messaggio pre-built
    const leadIds = await getLeadsWithoutPrebuiltMessage(limit);
    if (leadIds.length === 0) {
        return report;
    }

    // 3. Genera messaggi in sequenza (non parallelo — rispetta rate limit AI)
    for (const leadId of leadIds) {
        try {
            const lead = await getLeadById(leadId);
            if (!lead || lead.status !== 'READY_MESSAGE') {
                report.skipped++;
                continue;
            }

            const result = await buildPersonalizedFollowUpMessage(lead);
            if (!result.message) {
                report.skipped++;
                continue;
            }

            const msgHash = hashMessage(result.message);
            await savePrebuiltMessage(
                leadId,
                result.message,
                msgHash,
                result.source,
                result.model,
            );
            report.generated++;
        } catch (error) {
            report.failed++;
            await logWarn('message_prebuild.error', {
                leadId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    if (report.generated > 0 || report.expired > 0) {
        await logInfo('message_prebuild.batch_complete', { ...report });
    }

    return report;
}
