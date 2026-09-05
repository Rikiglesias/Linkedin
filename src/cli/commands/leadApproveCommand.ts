/**
 * leadApproveCommand.ts — `lead-approve <id> [--reason <testo>] [--min-score <n>]`
 *
 * Porta a mano UN lead da NEW a READY_INVITE (la coda di send-invites). Con AUTO_PROMOTE_NEW_LEADS_ENABLED=false
 * (default, C8) è il passo che l'operatore fa per il primo invito. Lead non eleggibile → exit 1 col NOME del
 * filtro e la mossa per sanarlo (C9).
 */
import { approveLeadForInvite } from '../../core/leadApproval';
import { getOptionValue, getPositionalArgs, parseIntStrict } from '../cliParser';

export const LEAD_APPROVE_USAGE = 'lead-approve <id> [--reason <testo>] [--min-score <n>]';

export async function runLeadApproveCommand(args: string[]): Promise<void> {
    // Convenzione di tutti i comandi CLI: l'id è il PRIMO positional, e deve essere solo cifre (mai «il primo numero
    // ovunque sia»: `lead-approve --reason 100 42` non deve scambiare 100 per l'id).
    const first = getPositionalArgs(args)[0];
    const idRaw = first !== undefined && /^\d+$/.test(first) ? first : undefined;
    if (!idRaw) {
        console.error(`[lead-approve] Manca l'id del lead. Uso: .\\bot.ps1 ${LEAD_APPROVE_USAGE}`);
        console.error('[lead-approve] Gli id si leggono con `.\\bot.ps1 funnel` oppure dalla dashboard.');
        process.exitCode = 1;
        return;
    }

    const minScoreRaw = getOptionValue(args, '--min-score');
    const minScore = minScoreRaw !== undefined ? parseIntStrict(minScoreRaw, '--min-score') : undefined;
    const reason = getOptionValue(args, '--reason');

    const result = await approveLeadForInvite(Number(idRaw), { reason, minScore });
    if (!result.approved) {
        console.error(`[lead-approve] Lead ${result.leadId} NON approvato — filtro: ${result.filter}. ${result.detail}.`);
        console.error(`[lead-approve] Per sanarlo: ${result.fix}`);
        process.exitCode = 1;
        return;
    }

    console.log(
        `[lead-approve] Lead ${result.leadId} approvato: NEW → READY_INVITE nella lista "${result.listName}" (evento manual_approval).`,
    );
    console.log(`[lead-approve] Prossimo passo, anteprima senza inviare: ${result.nextCommand}`);
    console.log('[lead-approve] Poi, a schermo, lo stesso comando senza --dry-run.');
}
