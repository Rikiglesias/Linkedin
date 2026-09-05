/**
 * leadInviteEligibility.ts — eleggibilità UNICA di un lead all'invito (contratto bot-operativo C9).
 *
 * Gli stessi cinque filtri, in due forme che devono dire la stessa cosa:
 *  - per SINGOLO lead (`evaluateLeadInviteEligibility`): usata da `lead-approve`, risponde col NOME del filtro
 *    e con la mossa per sanarlo;
 *  - per INSIEME (`countEligibleInviteCandidates`, `previewEligibleInviteCandidates`): usata dal preflight di
 *    send-invites, che così promette solo i candidati che lo scheduler accoda davvero.
 *
 * Le clausole SQL (GDPR, campagna attiva) sono le stesse di `getLeadsByStatusForList` (`repositories/leadsCore.ts`);
 * la lista attiva è la condizione di `listLeadCampaignConfigs(true)` che governa lo scheduler. Lo score conta solo
 * con un `minScore` > 0 in vigore, esattamente come nella query dei candidati: un lead senza score è ineleggibile
 * quando si chiede una soglia, non in assoluto (parità con il run reale; il DB reale non ha score NULL, misurato 2026-09-05).
 */
import { getDatabase } from '../db';
import type { LeadRecord, LeadStatus } from '../types/domain';
import { getLeadById } from './repositories';
import {
    ACTIVE_CAMPAIGN_STATE_PREDICATE,
    GDPR_NO_CONTACT_CLAUSE,
    INVITE_NO_ACTIVE_CAMPAIGN_CLAUSE,
} from './repositories/leadsCore';

export const INVITE_INELIGIBILITY_FILTERS = [
    'list_name_empty',
    'list_inactive',
    'gdpr_opt_out',
    'campaign_active',
    'score_below_min',
] as const;
export type InviteIneligibilityFilter = (typeof INVITE_INELIGIBILITY_FILTERS)[number];

export interface InviteEligibilityOptions {
    /** Score minimo richiesto; 0/assente = nessun filtro sullo score (come `--min-score` di send-invites). */
    minScore?: number;
}

export type InviteEligibilityVerdict =
    | { eligible: true; lead: LeadRecord }
    | {
          eligible: false;
          filter: InviteIneligibilityFilter | 'not_found';
          /** Cosa non va, in parole. */
          detail: string;
          /** La mossa per sanarlo: comando copiabile quando esiste, altrimenti detto chiaro che non c'è. */
          fix: string;
          lead: LeadRecord | null;
      };

export interface InviteCandidateQuery {
    /** Stato dei candidati (default READY_INVITE: è ciò che lo scheduler accoda). */
    status?: LeadStatus;
    listName?: string | null;
    minScore?: number;
}

/** Lista attiva: la stessa condizione di `listLeadCampaignConfigs(true)` (`lead_lists.is_active = 1`). */
export const INVITE_LIST_ACTIVE_CLAUSE = `AND TRIM(COALESCE(leads.list_name, '')) <> ''
          AND EXISTS (SELECT 1 FROM lead_lists ll WHERE ll.name = leads.list_name AND ll.is_active = 1)`;

function buildCandidateWhere(query: InviteCandidateQuery): { where: string; params: unknown[] } {
    const params: unknown[] = [query.status ?? 'READY_INVITE'];
    let where = `status = ?
          ${INVITE_LIST_ACTIVE_CLAUSE}
          ${GDPR_NO_CONTACT_CLAUSE}
          ${INVITE_NO_ACTIVE_CAMPAIGN_CLAUSE}`;
    if (query.listName) {
        where += ` AND list_name = ?`;
        params.push(query.listName);
    }
    if (query.minScore !== undefined && query.minScore > 0) {
        where += ` AND lead_score IS NOT NULL AND lead_score >= ?`;
        params.push(query.minScore);
    }
    return { where, params };
}

export async function countEligibleInviteCandidates(query: InviteCandidateQuery = {}): Promise<number> {
    const db = await getDatabase();
    const { where, params } = buildCandidateWhere(query);
    const row = await db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM leads WHERE ${where}`, params);
    return Number(row?.cnt ?? 0);
}

export interface InviteCandidatePreviewRow {
    first_name: string;
    last_name: string;
    job_title: string | null;
    lead_score: number | null;
}

export async function previewEligibleInviteCandidates(
    query: InviteCandidateQuery = {},
    limit = 5,
): Promise<InviteCandidatePreviewRow[]> {
    const db = await getDatabase();
    const { where, params } = buildCandidateWhere(query);
    return db.query<InviteCandidatePreviewRow>(
        `SELECT first_name, last_name, job_title, lead_score FROM leads WHERE ${where}
         ORDER BY lead_score DESC NULLS LAST LIMIT ?`,
        [...params, Math.max(1, Math.floor(limit))],
    );
}

/**
 * Il primo lead NEW eleggibile (score più alto, poi più vecchio): è l'id che il preflight di send-invites suggerisce
 * per `lead-approve` (C10). Null se nessun NEW passa i filtri.
 */
export async function findFirstEligibleNewLeadId(listName?: string | null, minScore?: number): Promise<number | null> {
    const db = await getDatabase();
    const { where, params } = buildCandidateWhere({ status: 'NEW', listName, minScore });
    const row = await db.get<{ id: number }>(
        `SELECT id FROM leads WHERE ${where} ORDER BY COALESCE(lead_score, -1) DESC, created_at ASC, id ASC LIMIT 1`,
        params,
    );
    return row ? Number(row.id) : null;
}

interface LeadEligibilityRow {
    list_name: string | null;
    gdpr_opt_out: number | null;
    lead_score: number | null;
}

export async function evaluateLeadInviteEligibility(
    leadId: number,
    options: InviteEligibilityOptions = {},
): Promise<InviteEligibilityVerdict> {
    const lead = await getLeadById(leadId);
    if (!lead) {
        return {
            eligible: false,
            filter: 'not_found',
            detail: `lead ${leadId} non trovato`,
            fix: 'controlla l\'id con `.\\bot.ps1 funnel` o dalla dashboard',
            lead: null,
        };
    }
    const db = await getDatabase();
    const raw = await db.get<LeadEligibilityRow>(
        `SELECT list_name, gdpr_opt_out, lead_score FROM leads WHERE id = ?`,
        [leadId],
    );
    const fail = (filter: InviteIneligibilityFilter, detail: string, fix: string): InviteEligibilityVerdict => ({
        eligible: false,
        filter,
        detail,
        fix,
        lead,
    });

    const listName = (raw?.list_name ?? '').trim();
    if (!listName) {
        return fail(
            'list_name_empty',
            'il lead non appartiene a nessuna lista (list_name vuoto): lo scheduler lavora per lista',
            '`.\\bot.ps1 sync-list --list "<lista>"` per ri-sincronizzarlo dentro una lista',
        );
    }

    const listRow = await db.get<{ is_active: number }>(`SELECT is_active FROM lead_lists WHERE name = ? LIMIT 1`, [
        listName,
    ]);
    if (!listRow || Number(listRow.is_active) !== 1) {
        return fail(
            'list_inactive',
            `la lista "${listName}" non è attiva: lo scheduler non la considera`,
            `\`.\\bot.ps1 list-config --list "${listName}" --active true\``,
        );
    }

    if (Number(raw?.gdpr_opt_out ?? 0) === 1) {
        return fail(
            'gdpr_opt_out',
            'il lead ha chiesto di non essere contattato (opt-out GDPR)',
            'nessun comando: l\'opt-out si rispetta, il lead non va invitato',
        );
    }

    // Stesso predicato della clausola NOT EXISTS usata da conteggio/anteprima/scheduler: qui serve il NOME della campagna.
    const campaign = await db.get<{ name: string }>(
        `SELECT c.name FROM lead_campaign_state lcs
         JOIN campaigns c ON lcs.campaign_id = c.id
         WHERE lcs.lead_id = ? AND ${ACTIVE_CAMPAIGN_STATE_PREDICATE}
         LIMIT 1`,
        [leadId],
    );
    if (campaign) {
        return fail(
            'campaign_active',
            `il lead è già dentro la campagna attiva "${campaign.name}" (lead_campaign_state ENROLLED/PENDING)`,
            'chiudi o metti in pausa quella campagna dal pannello di controllo, poi riprova',
        );
    }

    const minScore = options.minScore ?? 0;
    const score = raw?.lead_score ?? null;
    if (minScore > 0 && (score === null || score < minScore)) {
        return fail(
            'score_below_min',
            score === null ? `score assente (richiesto >= ${minScore})` : `score ${score} sotto la soglia ${minScore}`,
            `\`.\\bot.ps1 sync-list --list "${listName}"\` ricalcola lo score, oppure abbassa --min-score`,
        );
    }

    return { eligible: true, lead };
}
