import {
    clearAutomationPause,
    createIncident,
    countDistinctIncidentAccounts,
    countRecentIncidents,
    pushOutboxEvent,
    recordSecurityAuditEvent,
    setAccountQuarantine,
    setAutomationPause,
    setRuntimeFlag,
} from '../core/repositories';
import { logWarn } from '../telemetry/logger';
import { sanitizeForLogs } from '../security/redaction';
import { broadcastCritical, broadcastWarning } from '../telemetry/broadcaster';
import { bridgeAccountHealth } from '../cloud/cloudBridge';
import { publishLiveEvent } from '../telemetry/liveEvents';
import { reconcileLeadStatus } from '../core/leadStateService';
import { config } from '../config';

function resolveAccountId(details: Record<string, unknown>): string {
    const accountId = details.accountId;
    if (typeof accountId === 'string' && accountId.trim().length > 0) {
        return accountId.trim();
    }
    return 'default';
}

async function recordAuditSafe(payload: Parameters<typeof recordSecurityAuditEvent>[0]): Promise<void> {
    try {
        await recordSecurityAuditEvent(payload);
    } catch {
        // audit is best-effort and must not block incident handling
    }
}

export async function quarantineAccount(type: string, details: Record<string, unknown>): Promise<number> {
    const incidentId = await createIncident(type, 'CRITICAL', details);
    // G5-F2: quarantena per-account. Se `details.accountId` manca (incidente non attribuibile,
    // es. SELECTOR_FAILURE_BURST platform-wide) resolveAccountId → 'default' → flag GLOBALE
    // legacy che blocca tutti gli account (fail-safe).
    await setAccountQuarantine(resolveAccountId(details), true);
    // F3 ai-stack: classifica la sorgente DOPO l'insert (l'incident corrente è incluso nel conteggio).
    // La classificazione arricchisce alert/dashboard (WHAT/WHY/DO), NON cambia il fail-safe sopra.
    const source = await classifyIncidentSource(type);
    await recordAuditSafe({
        category: 'incident',
        action: 'quarantine_account',
        actor: 'system',
        accountId: resolveAccountId(details),
        entityType: 'account_incident',
        entityId: String(incidentId),
        result: 'ALLOW',
        metadata: { type, details, sourceClassification: source.classification },
    });
    await pushOutboxEvent(
        'incident.opened',
        {
            incidentId,
            type,
            severity: 'CRITICAL',
            details,
            sourceClassification: source.classification,
            affectedAccounts: source.affectedAccounts,
        },
        `incident.opened:${incidentId}`,
    );
    // Multi-channel broadcast (include Telegram via broadcaster.ts → sendToTelegram).
    // Prima c'era anche sendTelegramAlert diretto → doppio messaggio Telegram per ogni evento.
    broadcastCritical(
        `CRITICAL incident #${incidentId}: ${type}`,
        `Account messo in quarantena.\n\nDettagli:\n${JSON.stringify(sanitizeForLogs(details), null, 2).substring(0, 600)}`,
        details,
        source.recommendation, // L5-LI.1 "DO": recommendation come azione strutturata, non annegata nel body (A11-1)
    ).catch(() => {});
    // Replica cloud: aggiorna health account a RED (non-bloccante)
    bridgeAccountHealth(resolveAccountId(details), 'RED', type);
    publishLiveEvent('incident.opened', {
        incidentId,
        type,
        severity: 'CRITICAL',
        details,
        quarantined: true,
        sourceClassification: source.classification,
        affectedAccounts: source.affectedAccounts,
    });
    return incidentId;
}

export async function setQuarantine(enabled: boolean, accountId?: string): Promise<void> {
    // G5-F2: senza accountId opera sul flag GLOBALE legacy (comportamento storico di
    // unquarantine/API). Con accountId opera sul flag del singolo account.
    await setAccountQuarantine(accountId, enabled);
    if (!enabled) {
        await setRuntimeFlag('challenge_review_pending', 'false');
    }
    await recordAuditSafe({
        category: 'runtime_control',
        action: enabled ? 'quarantine_enable' : 'quarantine_disable',
        actor: 'system',
        result: 'ALLOW',
        metadata: { enabled, accountId: accountId ?? 'default' },
    });
    publishLiveEvent('system.quarantine', { enabled, accountId: accountId ?? 'default' });
}

export async function pauseAutomation(
    type: string,
    details: Record<string, unknown>,
    baseMinutes: number | null,
): Promise<number> {
    // baseMinutes === null => pausa indefinita (manual resume): usata dal challenge gate persistente (A9).
    let finalMinutes = baseMinutes;

    // Exponential Backoff implementation (solo per 429, che passa sempre un numero).
    if (type.includes('429') || type === 'HTTP_429_RATE_LIMIT') {
        const recentIncidents = await countRecentIncidents(type, 24); // count same incidents in last 24h
        const backoffMultiplier = Math.pow(2, recentIncidents);
        finalMinutes = Math.min(24 * 60, Math.floor((baseMinutes ?? 0) * backoffMultiplier)); // max 24h
        details = {
            ...details,
            recentIncidents,
            backoffMultiplier,
            baseMinutes,
            finalMinutes,
        };
    }

    const incidentId = await createIncident(type, 'WARN', details);
    const pausedUntil = await setAutomationPause(finalMinutes, type);
    await recordAuditSafe({
        category: 'runtime_control',
        action: 'pause_automation',
        actor: 'system',
        accountId: resolveAccountId(details),
        entityType: 'account_incident',
        entityId: String(incidentId),
        result: 'ALLOW',
        metadata: { type, finalMinutes, pausedUntil, details },
    });
    await pushOutboxEvent(
        'automation.paused',
        {
            incidentId,
            type,
            severity: 'WARN',
            pausedUntil,
            details,
        },
        `automation.paused:${incidentId}`,
    );
    // Multi-channel broadcast (include Telegram via broadcaster.ts → sendToTelegram).
    // Prima c'era anche sendTelegramAlert diretto → doppio messaggio Telegram per ogni evento.
    broadcastWarning(
        `WARN incident #${incidentId}: ${type}`,
        `Automazione in pausa fino a ${pausedUntil ?? 'manual resume'}.\n\nDettagli:\n${JSON.stringify(sanitizeForLogs(details), null, 2).substring(0, 600)}`,
        details,
    ).catch(() => {});
    // Replica cloud: aggiorna health account a YELLOW (non-bloccante)
    bridgeAccountHealth(resolveAccountId(details), 'YELLOW', type, pausedUntil ?? null);
    publishLiveEvent('automation.paused', {
        incidentId,
        type,
        severity: 'WARN',
        pausedUntil,
        details,
    });
    return incidentId;
}

export async function resumeAutomation(): Promise<void> {
    await clearAutomationPause();
    await setRuntimeFlag('challenge_review_pending', 'false');
    await recordAuditSafe({
        category: 'runtime_control',
        action: 'resume_automation',
        actor: 'system',
        result: 'ALLOW',
    });
    publishLiveEvent('automation.resumed', {});
}

/**
 * A13 + F3 ai-stack: classifica un incident come "account-specific" o "platform-wide".
 * Euristica: stesso type su 3+ account distinti nelle ultime 24h → probabile cambiamento
 * LinkedIn (selettori, UI, rate limit); su 1-2 account → problema specifico dell'account.
 * F3: riscritta sopra la repository PG-portabile (la versione storica era ORFANA e rotta:
 * interrogava la tabella inesistente `incidents`/`created_at` → catch silenzioso → sempre
 * 'unknown'). Wired in quarantineAccount: arricchisce alert/dashboard, mai il fail-safe.
 */
export async function classifyIncidentSource(incidentType: string): Promise<{
    classification: 'account_specific' | 'platform_wide' | 'unknown';
    affectedAccounts: number;
    recommendation: string;
}> {
    try {
        const { count: affectedAccounts } = await countDistinctIncidentAccounts(incidentType, 24);
        if (affectedAccounts >= 3) {
            return {
                classification: 'platform_wide',
                affectedAccounts,
                recommendation: `Stesso errore "${incidentType}" su ${affectedAccounts} account nelle ultime 24h — probabile cambiamento LinkedIn. DO: verificare selettori e UI prima di riattivare gli account.`,
            };
        }
        if (affectedAccounts >= 1) {
            return {
                classification: 'account_specific',
                affectedAccounts,
                recommendation: `Errore "${incidentType}" su ${affectedAccounts} account nelle ultime 24h — probabile problema specifico dell'account. DO: verificare stato/credenziali/proxy dell'account colpito.`,
            };
        }
        return {
            classification: 'unknown',
            affectedAccounts: 0,
            recommendation: 'Nessun incident recente di questo tipo.',
        };
    } catch (error) {
        // F3: niente catch silenzioso — il fallimento della classificazione è osservabile,
        // ma non blocca mai la gestione dell'incident (best-effort by-design).
        await logWarn('incident.classification_failed', {
            incidentType,
            error: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
        return { classification: 'unknown', affectedAccounts: 0, recommendation: 'Classificazione non disponibile.' };
    }
}

export interface ChallengeDetectionInput {
    source: string;
    accountId?: string;
    leadId?: number;
    linkedinUrl?: string;
    jobId?: number;
    jobType?: string;
    message?: string;
    extra?: Record<string, unknown>;
}

export async function handleChallengeDetected(input: ChallengeDetectionInput): Promise<number> {
    const details: Record<string, unknown> = {
        source: input.source,
        accountId: (input.accountId ?? 'default').trim() || 'default',
        leadId: input.leadId ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        jobId: input.jobId ?? null,
        jobType: input.jobType ?? null,
        message: input.message ?? 'Challenge/CAPTCHA rilevato',
        detectedAt: new Date().toISOString(),
        ...(input.extra ?? {}),
    };

    // Anti-ban (A9): account flaggato da challenge → gate PERSISTENTE (pausa indefinita, manual
    // resume via dashboard/API dopo verifica umana) se challengePersistentGate; altrimenti pausa
    // temporizzata legacy. Niente auto-resume su account flaggato = niente escalation ban.
    const challengePauseValue = config.challengePersistentGate ? null : config.challengePauseMinutes;
    const incidentId = await pauseAutomation('CHALLENGE_DETECTED', details, challengePauseValue);

    if (typeof input.leadId === 'number' && Number.isFinite(input.leadId)) {
        try {
            await reconcileLeadStatus(input.leadId, 'REVIEW_REQUIRED', 'challenge_detected_review_queue', {
                incidentId,
                source: input.source,
                accountId: details.accountId,
            });
        } catch {
            // best effort: challenge handling must continue even if lead transition fails
        }
    }

    await pushOutboxEvent(
        'challenge.review_queued',
        {
            incidentId,
            ...details,
        },
        `challenge.review_queued:${incidentId}:${input.leadId ?? 'none'}:${input.source}`,
    );
    await setRuntimeFlag('challenge_review_pending', 'true');
    await setRuntimeFlag('challenge_review_last_incident_id', String(incidentId));
    publishLiveEvent('challenge.review_queued', {
        incidentId,
        ...details,
    });

    return incidentId;
}
