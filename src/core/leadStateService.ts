import {
    adjustLeadScore,
    appendLeadEvent,
    getLeadById,
    pushOutboxEvent,
    setLeadStatus,
    recordSecurityAuditEvent,
} from './repositories';
import { getDatabase } from '../db';
import { withTransaction } from './repositories/shared';
import { LeadStatus } from '../types/domain';
import { publishLiveEvent } from '../telemetry/liveEvents';
import { sendTelegramAlert } from '../telemetry/alerts';
import { logWarn } from '../telemetry/logger';

const allowedTransitions: Record<LeadStatus, LeadStatus[]> = {
    NEW: ['READY_INVITE', 'BLOCKED', 'REVIEW_REQUIRED', 'DEAD'],
    READY_INVITE: ['INVITED', 'SKIPPED', 'BLOCKED', 'REVIEW_REQUIRED', 'DEAD'],
    INVITED: ['ACCEPTED', 'CONNECTED', 'BLOCKED', 'REVIEW_REQUIRED', 'WITHDRAWN', 'DEAD'],
    ACCEPTED: ['READY_MESSAGE', 'CONNECTED', 'BLOCKED', 'REVIEW_REQUIRED', 'DEAD'],
    CONNECTED: ['READY_MESSAGE', 'BLOCKED', 'REVIEW_REQUIRED', 'DEAD'],
    READY_MESSAGE: ['MESSAGED', 'BLOCKED', 'REVIEW_REQUIRED', 'DEAD'],
    MESSAGED: ['REPLIED', 'REVIEW_REQUIRED'],
    REPLIED: ['BLOCKED', 'REVIEW_REQUIRED', 'DEAD'],
    SKIPPED: ['REVIEW_REQUIRED', 'READY_INVITE'],
    BLOCKED: [],
    DEAD: [],
    REVIEW_REQUIRED: ['READY_INVITE', 'READY_MESSAGE', 'INVITED', 'BLOCKED', 'DEAD', 'WITHDRAWN'],
    WITHDRAWN: ['READY_INVITE', 'DEAD'],
};

export function isValidLeadTransition(fromStatus: LeadStatus, toStatus: LeadStatus): boolean {
    const nextAllowed = allowedTransitions[fromStatus];
    return nextAllowed.includes(toStatus);
}

export async function transitionLead(
    leadId: number,
    toStatus: LeadStatus,
    reason: string,
    metadata: Record<string, unknown> = {},
): Promise<void> {
    const db = await getDatabase();

    // Operazioni DB atomiche: se appendLeadEvent o pushOutboxEvent falliscono,
    // lo status viene rollbackato (prima era non-atomico — CC-6).
    // AsyncLocalStorage garantisce che getLeadById/setLeadStatus/appendLeadEvent/
    // pushOutboxEvent usino lo stesso client transazionale.
    const { lead, fromStatus, targetStatus } = await withTransaction(db, async () => {
        const txLead = await getLeadById(leadId);
        if (!txLead) {
            throw new Error(`Lead ${leadId} non trovato.`);
        }

        const txFromStatus = txLead.status;
        const txTargetStatus = toStatus;
        if (!isValidLeadTransition(txFromStatus, txTargetStatus)) {
            throw new Error(`Transizione non consentita: ${txFromStatus} -> ${txTargetStatus}.`);
        }

        const blockedReason = txTargetStatus === 'BLOCKED' ? reason : undefined;
        await setLeadStatus(leadId, txTargetStatus, undefined, blockedReason);
        await appendLeadEvent(leadId, txFromStatus, txTargetStatus, reason, metadata);
        await pushOutboxEvent(
            'lead.transition',
            {
                leadId,
                fromStatus: txFromStatus,
                toStatus: txTargetStatus,
                reason,
                metadata,
            },
            `lead.transition:${leadId}:${txFromStatus}:${txTargetStatus}:${reason}`,
        );

        return { lead: txLead, fromStatus: txFromStatus, targetStatus: txTargetStatus };
    });

    // Post-transaction side-effects (non-blocking, non-rollbackabili)
    publishLiveEvent('lead.transition', {
        leadId,
        fromStatus,
        toStatus: targetStatus,
        reason,
        metadata,
    });

    // AI Decision Feedback: registra outcome per correlazione con decisioni AI.
    // Mappa stato → outcome per il feedback loop.
    const outcomeMap: Partial<Record<LeadStatus, string>> = {
        ACCEPTED: 'accepted',
        READY_MESSAGE: 'accepted',
        REPLIED: 'replied',
        CONNECTED: 'connected',
        WITHDRAWN: 'withdrawn',
        BLOCKED: 'blocked',
        DEAD: 'dead',
    };
    const feedbackOutcome = outcomeMap[targetStatus];
    if (feedbackOutcome) {
        // Registra outcome per tutti i decision point rilevanti del lead
        import('../ai/decisionFeedback')
            .then(({ recordDecisionOutcome }) => {
                const points =
                    targetStatus === 'ACCEPTED' || targetStatus === 'READY_MESSAGE'
                        ? ['pre_invite']
                        : targetStatus === 'REPLIED'
                          ? ['pre_message', 'pre_follow_up']
                          : ['pre_invite', 'pre_message', 'pre_follow_up'];
                for (const point of points) {
                    recordDecisionOutcome(leadId, point, feedbackOutcome).catch((e) =>
                        logWarn('lead_state.feedback_record_failed', {
                            leadId,
                            point,
                            outcome: feedbackOutcome,
                            error: e instanceof Error ? e.message : String(e),
                        }),
                    );
                }
            })
            .catch((e) =>
                logWarn('lead_state.feedback_import_failed', {
                    leadId,
                    targetStatus: targetStatus as string,
                    error: e instanceof Error ? e.message : String(e),
                }),
            );
    }

    if (targetStatus === 'ACCEPTED' && fromStatus !== 'ACCEPTED') {
        const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Lead Sconosciuto';
        void sendTelegramAlert(
            `🤝 **${name}** ha accettato l'invito!\nLinkedIn: ${lead.linkedin_url || 'N/A'}\n_Aggiunto in coda messaggi intro._`,
            'Lead Accettato',
            'info',
        ).catch((e) =>
            logWarn('lead_state.telegram_alert_failed', {
                leadId,
                event: 'accepted',
                error: e instanceof Error ? e.message : String(e),
            }),
        );
        // Engagement score boost: accettazione = segnale positivo → score +10 (cap 100)
        void adjustLeadScore(leadId, 10).catch((e) =>
            logWarn('lead_state.score_adjust_failed', {
                leadId,
                delta: 10,
                error: e instanceof Error ? e.message : String(e),
            }),
        );
    } else if (targetStatus === 'REPLIED' && fromStatus !== 'REPLIED') {
        const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Lead Sconosciuto';
        void sendTelegramAlert(
            `💬 **${name}** ti ha risposto organicamente!\nControlla i messaggi: ${lead.linkedin_url || 'N/A'}`,
            'Nuova Risposta',
            'warn',
        ).catch((e) =>
            logWarn('lead_state.telegram_alert_failed', {
                leadId,
                event: 'replied',
                error: e instanceof Error ? e.message : String(e),
            }),
        );
        // Engagement score boost: risposta = segnale molto positivo → score +15 (cap 100)
        void adjustLeadScore(leadId, 15).catch((e) =>
            logWarn('lead_state.score_adjust_failed', {
                leadId,
                delta: 15,
                error: e instanceof Error ? e.message : String(e),
            }),
        );
    } else if (targetStatus === 'WITHDRAWN') {
        // Engagement score penalty: invito ritirato (non accettato) = segnale negativo → score -10 (floor 0)
        void adjustLeadScore(leadId, -10).catch((e) =>
            logWarn('lead_state.score_adjust_failed', {
                leadId,
                delta: -10,
                error: e instanceof Error ? e.message : String(e),
            }),
        );
    }
}

export async function transitionLeadAtomic(
    leadId: number,
    steps: Array<{ toStatus: LeadStatus; reason: string; metadata?: Record<string, unknown> }>,
): Promise<void> {
    const db = await getDatabase();
    await withTransaction(db, async () => {
        for (const step of steps) {
            const lead = await getLeadById(leadId);
            if (!lead) {
                throw new Error(`Lead ${leadId} non trovato.`);
            }
            const fromStatus = lead.status;
            const targetStatus = step.toStatus;
            if (!isValidLeadTransition(fromStatus, targetStatus)) {
                throw new Error(`Transizione non consentita: ${fromStatus} -> ${targetStatus}.`);
            }
            const blockedReason = targetStatus === 'BLOCKED' ? step.reason : undefined;
            await setLeadStatus(leadId, targetStatus, undefined, blockedReason);
            await appendLeadEvent(leadId, fromStatus, targetStatus, step.reason, step.metadata ?? {});
            await pushOutboxEvent(
                'lead.transition',
                { leadId, fromStatus, toStatus: targetStatus, reason: step.reason, metadata: step.metadata ?? {} },
                `lead.transition:${leadId}:${fromStatus}:${targetStatus}:${step.reason}`,
            );
            publishLiveEvent('lead.transition', {
                leadId,
                fromStatus,
                toStatus: targetStatus,
                reason: step.reason,
                metadata: step.metadata ?? {},
            });
        }
    });

    // Post-transaction notifications (non-blocking)
    const lead = await getLeadById(leadId);
    if (lead) {
        const finalStatus = lead.status;

        // AI Decision Feedback: registra outcome per correlazione (stessa logica di transitionLead).
        // Senza questo, transitionLeadAtomic (usata per accettazioni) non chiudeva mai il feedback loop.
        const outcomeMap: Partial<Record<LeadStatus, string>> = {
            ACCEPTED: 'accepted',
            READY_MESSAGE: 'accepted',
            REPLIED: 'replied',
            CONNECTED: 'connected',
            WITHDRAWN: 'withdrawn',
            BLOCKED: 'blocked',
            DEAD: 'dead',
        };
        const feedbackOutcome = outcomeMap[finalStatus];
        if (feedbackOutcome) {
            import('../ai/decisionFeedback')
                .then(({ recordDecisionOutcome }) => {
                    const points =
                        finalStatus === 'ACCEPTED' || finalStatus === 'READY_MESSAGE'
                            ? ['pre_invite']
                            : finalStatus === 'REPLIED'
                              ? ['pre_message', 'pre_follow_up']
                              : ['pre_invite', 'pre_message', 'pre_follow_up'];
                    for (const point of points) {
                        recordDecisionOutcome(leadId, point, feedbackOutcome).catch((e) =>
                            logWarn('lead_state.feedback_record_failed', {
                                leadId,
                                point,
                                outcome: feedbackOutcome,
                                error: e instanceof Error ? e.message : String(e),
                            }),
                        );
                    }
                })
                .catch((e) =>
                    logWarn('lead_state.feedback_import_failed', {
                        leadId,
                        targetStatus: finalStatus as string,
                        error: e instanceof Error ? e.message : String(e),
                    }),
                );
        }

        if (finalStatus === 'ACCEPTED') {
            const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Lead Sconosciuto';
            void sendTelegramAlert(
                `🤝 **${name}** ha accettato l'invito!\nLinkedIn: ${lead.linkedin_url || 'N/A'}\n_Aggiunto in coda messaggi intro._`,
                'Lead Accettato',
                'info',
            ).catch((e) =>
                logWarn('lead_state.telegram_alert_failed', {
                    leadId,
                    event: 'accepted_atomic',
                    error: e instanceof Error ? e.message : String(e),
                }),
            );
            void adjustLeadScore(leadId, 10).catch((e) =>
                logWarn('lead_state.score_adjust_failed', {
                    leadId,
                    delta: 10,
                    error: e instanceof Error ? e.message : String(e),
                }),
            );
        }
    }
}

export async function reconcileLeadStatus(
    leadId: number,
    toStatus: LeadStatus,
    reason: string,
    metadata: Record<string, unknown> = {},
): Promise<void> {
    const lead = await getLeadById(leadId);
    if (!lead) {
        throw new Error(`Lead ${leadId} non trovato.`);
    }

    const fromStatus = lead.status;
    const targetStatus = toStatus;
    if (fromStatus === targetStatus) {
        return;
    }

    // BYPASS_REASON: reconcile forces status without transition validation.
    // Used for admin corrections and recovery from stuck states.
    await logWarn('lead_state.reconcile_bypass', {
        leadId,
        from: fromStatus,
        to: targetStatus,
        reason,
    });
    void recordSecurityAuditEvent({
        category: 'lead_state',
        action: 'reconcile_bypass',
        entityType: 'lead',
        entityId: String(leadId),
        result: 'ALLOW',
        metadata: { from: fromStatus, to: targetStatus, reason },
    }).catch(() => null);
    await setLeadStatus(leadId, targetStatus);
    await appendLeadEvent(leadId, fromStatus, targetStatus, reason, {
        ...metadata,
        reconcile: true,
    });
    await pushOutboxEvent(
        'lead.reconciled',
        {
            leadId,
            fromStatus,
            toStatus: targetStatus,
            reason,
            metadata,
        },
        `lead.reconciled:${leadId}:${fromStatus}:${targetStatus}:${reason}`,
    );
    publishLiveEvent('lead.reconciled', {
        leadId,
        fromStatus,
        toStatus: targetStatus,
        reason,
        metadata,
    });
}
