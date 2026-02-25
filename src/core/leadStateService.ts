import { appendLeadEvent, getLeadById, pushOutboxEvent, setLeadStatus } from './repositories';
import { LeadStatus } from '../types/domain';

const allowedTransitions: Record<Exclude<LeadStatus, 'PENDING'>, LeadStatus[]> = {
    NEW: ['READY_INVITE', 'BLOCKED'],
    READY_INVITE: ['INVITED', 'SKIPPED', 'BLOCKED'],
    INVITED: ['ACCEPTED', 'BLOCKED'],
    ACCEPTED: ['READY_MESSAGE', 'BLOCKED'],
    READY_MESSAGE: ['MESSAGED', 'BLOCKED'],
    MESSAGED: [],
    SKIPPED: [],
    BLOCKED: [],
};

function normalize(status: LeadStatus): Exclude<LeadStatus, 'PENDING'> {
    if (status === 'PENDING') {
        return 'READY_INVITE';
    }
    return status;
}

export function isValidLeadTransition(fromStatus: LeadStatus, toStatus: LeadStatus): boolean {
    const normalizedFrom = normalize(fromStatus);
    const normalizedTo = normalize(toStatus);
    const nextAllowed = allowedTransitions[normalizedFrom];
    return nextAllowed.includes(normalizedTo);
}

export async function transitionLead(
    leadId: number,
    toStatus: LeadStatus,
    reason: string,
    metadata: Record<string, unknown> = {}
): Promise<void> {
    const lead = await getLeadById(leadId);
    if (!lead) {
        throw new Error(`Lead ${leadId} non trovato.`);
    }

    const fromStatus = normalize(lead.status);
    const targetStatus = normalize(toStatus);
    if (!isValidLeadTransition(fromStatus, targetStatus)) {
        throw new Error(`Transizione non consentita: ${fromStatus} -> ${targetStatus}.`);
    }

    const blockedReason = targetStatus === 'BLOCKED' ? reason : undefined;
    await setLeadStatus(leadId, targetStatus, undefined, blockedReason);
    await appendLeadEvent(leadId, fromStatus, targetStatus, reason, metadata);
    await pushOutboxEvent(
        'lead.transition',
        {
            leadId,
            fromStatus,
            toStatus: targetStatus,
            reason,
            metadata,
        },
        `lead.transition:${leadId}:${fromStatus}:${targetStatus}:${reason}`
    );
}

export async function reconcileLeadStatus(
    leadId: number,
    toStatus: LeadStatus,
    reason: string,
    metadata: Record<string, unknown> = {}
): Promise<void> {
    const lead = await getLeadById(leadId);
    if (!lead) {
        throw new Error(`Lead ${leadId} non trovato.`);
    }

    const fromStatus = normalize(lead.status);
    const targetStatus = normalize(toStatus);
    if (fromStatus === targetStatus) {
        return;
    }

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
        `lead.reconciled:${leadId}:${fromStatus}:${targetStatus}:${reason}`
    );
}
