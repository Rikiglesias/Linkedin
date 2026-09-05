/**
 * leadApproval.ts — approvazione manuale di un lead all'invito (`lead-approve`, contratto bot-operativo C9).
 *
 * Ordine fisso, tutto dentro UNA transazione: verifica (eleggibilità + stato NEW) → transizione NEW→READY_INVITE
 * con evento `manual_approval` → ricontrollo (stato letto di nuovo + eleggibilità ancora vera). Se un passo non
 * regge, la transazione torna indietro e il lead resta NEW senza evento.
 */
import { getDatabase } from '../db';
import {
    evaluateLeadInviteEligibility,
    type InviteEligibilityOptions,
    type InviteIneligibilityFilter,
} from './leadInviteEligibility';
import { transitionLead } from './leadStateService';
import { getLeadById } from './repositories';
import { withTransaction } from './repositories/shared';

export interface ApproveLeadOptions extends InviteEligibilityOptions {
    /** Motivo libero, registrato nei metadati dell'evento `manual_approval`. */
    reason?: string;
}

export type LeadApprovalRejection = {
    approved: false;
    leadId: number;
    filter: InviteIneligibilityFilter | 'not_found' | 'status_not_new';
    detail: string;
    fix: string;
};

export type LeadApprovalResult =
    | { approved: true; leadId: number; listName: string; nextCommand: string }
    | LeadApprovalRejection;

/** Il comando del primo invito come lo documenta la GUIDA: anteprima, un solo lead, senza nota, senza enrichment. */
export function buildFirstInviteDryRunCommand(listName: string): string {
    return `.\\bot.ps1 send-invites --list "${listName}" --limit 1 --note none --no-enrich --dry-run`;
}

class LeadApprovalRejected extends Error {
    constructor(readonly rejection: LeadApprovalRejection) {
        super(rejection.detail);
    }
}

export async function approveLeadForInvite(
    leadId: number,
    options: ApproveLeadOptions = {},
): Promise<LeadApprovalResult> {
    const db = await getDatabase();
    try {
        return await withTransaction(db, async () => {
            // 1) verifica — dentro la transazione: nessuna finestra fra controllo e transizione.
            const verdict = await evaluateLeadInviteEligibility(leadId, options);
            if (!verdict.eligible) {
                throw new LeadApprovalRejected({
                    approved: false,
                    leadId,
                    filter: verdict.filter,
                    detail: verdict.detail,
                    fix: verdict.fix,
                });
            }
            if (verdict.lead.status !== 'NEW') {
                throw new LeadApprovalRejected({
                    approved: false,
                    leadId,
                    filter: 'status_not_new',
                    detail: `il lead è già ${verdict.lead.status}: si approva solo un lead NEW`,
                    fix:
                        verdict.lead.status === 'READY_INVITE'
                            ? `è già in coda: ${buildFirstInviteDryRunCommand(verdict.lead.list_name)}`
                            : 'nessuna approvazione manuale da questo stato',
                });
            }

            // 2) transizione — `transitionLead` rilegge lo stato e valida NEW→READY_INVITE nel suo savepoint.
            await transitionLead(leadId, 'READY_INVITE', 'manual_approval', {
                source: 'cli:lead-approve',
                note: options.reason ?? null,
                minScore: options.minScore ?? 0,
            });

            // 3) ricontrollo — stato riletto e filtri ancora veri, altrimenti rollback.
            const after = await getLeadById(leadId);
            if (!after || after.status !== 'READY_INVITE') {
                throw new Error(`lead-approve: ricontrollo fallito, stato ${after?.status ?? 'assente'} dopo la transizione`);
            }
            const recheck = await evaluateLeadInviteEligibility(leadId, options);
            if (!recheck.eligible) {
                throw new LeadApprovalRejected({
                    approved: false,
                    leadId,
                    filter: recheck.filter,
                    detail: `ricontrollo dopo la transizione: ${recheck.detail}`,
                    fix: recheck.fix,
                });
            }

            return {
                approved: true,
                leadId,
                listName: after.list_name,
                nextCommand: buildFirstInviteDryRunCommand(after.list_name),
            };
        });
    } catch (error) {
        if (error instanceof LeadApprovalRejected) return error.rejection;
        throw error;
    }
}
