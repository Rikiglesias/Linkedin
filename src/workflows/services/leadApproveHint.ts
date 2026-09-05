/**
 * leadApproveHint.ts — il testo del preflight di send-invites quando non c'è nulla in coda (contratto bot-operativo C10).
 *
 * Con AUTO_PROMOTE_NEW_LEADS_ENABLED=false (C8) «0 READY_INVITE» non si sana con sync-list ed enrichment: il passo
 * successivo è `lead-approve <id>` su un lead NEW eleggibile (C9). Qui il messaggio porta il comando ESATTO, con l'id
 * calcolato dalla stessa eleggibilità, così l'operatore copia e lancia. Funzioni pure: le usano il warning critico
 * del preflight e la `nextAction` del blocco NO_WORK_AVAILABLE, che devono dire la stessa cosa.
 */
import type { PreflightWarning } from '../types';

export interface LeadApproveHint {
    /** Id di un lead NEW eleggibile all'invito (eleggibilità di C9), null se nessuno lo è. */
    firstEligibleNewLeadId: number | null;
    /** Quanti lead NEW ci sono (nel perimetro del preflight). */
    newCount: number;
    /** Lista filtrata dall'operatore, se presente. */
    listName: string | null;
}

export function buildLeadApproveCommand(leadId: number): string {
    return `.\\bot.ps1 lead-approve ${leadId}`;
}

function syncListCommand(listName: string | null): string {
    return `.\\bot.ps1 sync-list --list "${listName ?? '<lista>'}"`;
}

/** Cosa fare adesso, in una riga: la stessa per warning e nextAction. */
export function buildLeadApproveNextAction(hint: LeadApproveHint): string {
    if (hint.firstEligibleNewLeadId !== null) {
        return `Approva a mano il primo lead e rilancia send-invites: ${buildLeadApproveCommand(hint.firstEligibleNewLeadId)}`;
    }
    if (hint.newCount > 0) {
        return (
            `${hint.newCount} lead NEW ma nessuno è eleggibile all'invito (lista attiva? opt-out GDPR? campagna attiva? score?): ` +
            'prova `.\\bot.ps1 lead-approve <id>` su un lead: ti dice il filtro che lo ferma e come sanarlo'
        );
    }
    return `Nessun lead NEW da approvare: importa o sincronizza prima una lista con ${syncListCommand(hint.listName)}`;
}

/** Il warning critico del preflight quando READY_INVITE = 0. */
export function buildZeroReadyInviteWarning(hint: LeadApproveHint): PreflightWarning {
    return {
        level: 'critical',
        message: `Nessun lead READY_INVITE — ${buildLeadApproveNextAction(hint)}`,
    };
}
