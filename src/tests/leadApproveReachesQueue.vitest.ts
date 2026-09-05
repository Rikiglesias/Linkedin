/**
 * leadApproveReachesQueue.vitest.ts — C9 del contratto `bot-operativo`: `lead-approve <id> [--reason <testo>]` porta il
 * lead fino alla CODA con l'ordine verifica → transizione → ricontrollo (NEW→READY_INVITE, evento `manual_approval`,
 * in transazione). Un lead NON eleggibile resta NEW senza evento, exit ≠ 0 col NOME del filtro e il comando per
 * sanarlo — cinque filtri, cinque casi negativi: `list_name` vuoto · lista non attiva · clausola GDPR · campagna attiva
 * (`lead_campaign_state` ENROLLED/PENDING) · `lead_score` NULL o sotto `minScore`.
 * La funzione di eleggibilità è UNICA: la usa anche il conteggio del preflight di `send-invites`, che deve coincidere
 * con i candidati che lo scheduler accoda davvero (dry-run reale sul DB di test).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { runLeadApproveCommand } from '../cli/commands/leadApproveCommand';
import { config } from '../config';
import { approveLeadForInvite } from '../core/leadApproval';
import { countEligibleInviteCandidates, evaluateLeadInviteEligibility } from '../core/leadInviteEligibility';
import { scheduleJobs } from '../core/scheduler';
import { getDatabase } from '../db';
import { freezeClockInsideWorkingHours } from './helpers/fakeWorkingHourClock';

const TAG = `${process.pid}-${Date.now()}`;
const ACTIVE = `__c9_attiva_${TAG}__`;
const INACTIVE = `__c9_inattiva_${TAG}__`;
const CAMPAIGN = `__c9_campagna_${TAG}__`;

type Seed = { key: string; status: 'NEW' | 'READY_INVITE'; list: string; score: number | null; gdpr?: 1 };

const SEEDS: Seed[] = [
    { key: 'ok', status: 'NEW', list: ACTIVE, score: 80 },
    { key: 'ok2', status: 'NEW', list: ACTIVE, score: 75 },
    { key: 'emptyList', status: 'NEW', list: '', score: 80 },
    { key: 'inactiveList', status: 'NEW', list: INACTIVE, score: 80 },
    { key: 'gdpr', status: 'NEW', list: ACTIVE, score: 80, gdpr: 1 },
    { key: 'campaign', status: 'NEW', list: ACTIVE, score: 80 },
    { key: 'nullScore', status: 'NEW', list: ACTIVE, score: null },
    // Due READY_INVITE che lo scheduler NON accoda: il conteggio del preflight non deve prometterli.
    { key: 'readyGdpr', status: 'READY_INVITE', list: ACTIVE, score: 80, gdpr: 1 },
    { key: 'readyCampaign', status: 'READY_INVITE', list: ACTIVE, score: 80 },
];

const ids = new Map<string, number>();
let campaignId = 0;
let restoreClock: () => void = () => undefined;
let flagBefore = config.autoPromoteNewLeadsEnabled;

async function statusOf(key: string): Promise<string> {
    const db = await getDatabase();
    return (await db.get<{ status: string }>(`SELECT status FROM leads WHERE id = ?`, [ids.get(key)]))?.status ?? '?';
}

async function approvalEventsOf(key: string): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM lead_events WHERE lead_id = ? AND reason = 'manual_approval'`,
        [ids.get(key)],
    );
    return Number(row?.total ?? -1);
}

beforeAll(async () => {
    ({ restore: restoreClock } = freezeClockInsideWorkingHours());
    flagBefore = config.autoPromoteNewLeadsEnabled;
    config.autoPromoteNewLeadsEnabled = false;
    const db = await getDatabase();
    await db.run(`INSERT OR IGNORE INTO lead_lists (name, source, is_active) VALUES (?, 'import', 1)`, [ACTIVE]);
    await db.run(`INSERT OR IGNORE INTO lead_lists (name, source, is_active) VALUES (?, 'import', 0)`, [INACTIVE]);
    const campaign = await db.run(`INSERT INTO campaigns (name, active) VALUES (?, 1)`, [CAMPAIGN]);
    campaignId = Number(campaign.lastID);
    for (const seed of SEEDS) {
        const inserted = await db.run(
            `INSERT INTO leads (linkedin_url, status, list_name, first_name, last_name, job_title, lead_score, gdpr_opt_out)
             VALUES (?, ?, ?, 'C9', ?, 'CTO', ?, ?)`,
            [`https://www.linkedin.com/in/c9-${TAG}-${seed.key}`, seed.status, seed.list, seed.key, seed.score, seed.gdpr ?? 0],
        );
        ids.set(seed.key, Number(inserted.lastID));
    }
    for (const key of ['campaign', 'readyCampaign']) {
        await db.run(`INSERT INTO lead_campaign_state (lead_id, campaign_id, status) VALUES (?, ?, 'ENROLLED')`, [
            ids.get(key),
            campaignId,
        ]);
    }
});

afterAll(async () => {
    config.autoPromoteNewLeadsEnabled = flagBefore;
    const db = await getDatabase();
    const all = [...ids.values()];
    if (all.length > 0) {
        const marks = all.map(() => '?').join(',');
        for (const id of all) await db.run(`DELETE FROM jobs WHERE idempotency_key LIKE ?`, [`invite:${id}:%`]);
        await db.run(`DELETE FROM lead_campaign_state WHERE lead_id IN (${marks})`, all);
        await db.run(`DELETE FROM lead_events WHERE lead_id IN (${marks})`, all);
        await db.run(`DELETE FROM leads WHERE id IN (${marks})`, all);
    }
    if (campaignId > 0) await db.run(`DELETE FROM campaigns WHERE id = ?`, [campaignId]);
    await db.run(`DELETE FROM lead_lists WHERE name IN (?, ?)`, [ACTIVE, INACTIVE]);
    process.exitCode = undefined;
    restoreClock();
});

describe('C9 — lead eleggibile: verifica → transizione → ricontrollo, poi è un candidato dello scheduler', () => {
    it('approva il lead: READY_INVITE con evento manual_approval e il comando successivo pronto', async () => {
        const result = await approveLeadForInvite(ids.get('ok') as number, { reason: 'primo invito di prova' });
        expect(result.approved, JSON.stringify(result)).toBe(true);
        expect(await statusOf('ok')).toBe('READY_INVITE');
        expect(await approvalEventsOf('ok')).toBe(1);
        if (result.approved) {
            expect(result.nextCommand).toContain(`send-invites --list "${ACTIVE}" --limit 1 --note none --no-enrich --dry-run`);
        }
    });

    it('il dry-run dello scheduler conta il lead approvato (1 candidato, non i READY_INVITE esclusi)', async () => {
        const schedule = await scheduleJobs('invite', { dryRun: true, listFilter: ACTIVE, sessionLimit: 5 });
        const ourList = schedule.listBreakdown.find((entry) => entry.listName === ACTIVE);
        expect(ourList?.queuedInviteJobs).toBe(1);
    });

    it('il conteggio del preflight usa la stessa eleggibilità: 1 = candidati dello scheduler', async () => {
        expect(await countEligibleInviteCandidates({ listName: ACTIVE })).toBe(1);
        expect(await countEligibleInviteCandidates({ listName: ACTIVE, minScore: 90 })).toBe(0);
    });
});

describe('C9 — cinque filtri, cinque negativi: il lead resta NEW, nessun evento, filtro nominato con la mossa per sanarlo', () => {
    // Lo score conta solo con un minScore in vigore (parità con la query dei candidati dello scheduler).
    const cases: Array<{ key: string; filter: string; options?: { minScore?: number } }> = [
        { key: 'emptyList', filter: 'list_name_empty' },
        { key: 'inactiveList', filter: 'list_inactive' },
        { key: 'gdpr', filter: 'gdpr_opt_out' },
        { key: 'campaign', filter: 'campaign_active' },
        { key: 'nullScore', filter: 'score_below_min', options: { minScore: 50 } },
    ];

    for (const testCase of cases) {
        it(`${testCase.key} → filtro ${testCase.filter}`, async () => {
            const verdict = await evaluateLeadInviteEligibility(ids.get(testCase.key) as number, testCase.options);
            expect(verdict.eligible).toBe(false);
            if (!verdict.eligible) {
                expect(verdict.filter).toBe(testCase.filter);
                expect(verdict.detail.length).toBeGreaterThan(0);
                expect(verdict.fix.length).toBeGreaterThan(0);
            }
            const result = await approveLeadForInvite(ids.get(testCase.key) as number, testCase.options);
            expect(result.approved).toBe(false);
            if (!result.approved) expect(result.filter).toBe(testCase.filter);
            expect(await statusOf(testCase.key)).toBe('NEW');
            expect(await approvalEventsOf(testCase.key)).toBe(0);
        });
    }

    it('score sotto --min-score → score_below_min anche con score presente', async () => {
        const verdict = await evaluateLeadInviteEligibility(ids.get('ok2') as number, { minScore: 90 });
        expect(verdict.eligible).toBe(false);
        if (!verdict.eligible) expect(verdict.filter).toBe('score_below_min');
        expect(await statusOf('ok2')).toBe('NEW');
    });
});

describe('C9 — CLI lead-approve', () => {
    it('lead non eleggibile: exit code 1, output col nome del filtro e il comando per sanarlo', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            process.exitCode = undefined;
            await runLeadApproveCommand([String(ids.get('inactiveList'))]);
            expect(process.exitCode).toBe(1);
            const output = [...log.mock.calls, ...error.mock.calls].map((call) => call.join(' ')).join('\n');
            expect(output).toContain('list_inactive');
            expect(output).toContain(`list-config --list "${INACTIVE}" --active true`);
        } finally {
            process.exitCode = undefined;
            log.mockRestore();
            error.mockRestore();
        }
    });

    it('lead eleggibile: exit code 0 e stampa il dry-run del primo invito con i flag esatti', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            process.exitCode = undefined;
            await runLeadApproveCommand([String(ids.get('ok2')), '--reason', 'via CLI']);
            expect(process.exitCode ?? 0).toBe(0);
            expect(await statusOf('ok2')).toBe('READY_INVITE');
            const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
            expect(output).toContain(`.\\bot.ps1 send-invites --list "${ACTIVE}" --limit 1 --note none --no-enrich --dry-run`);
        } finally {
            log.mockRestore();
        }
    });

    it('senza id: exit code 1 e sintassi nel messaggio', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            process.exitCode = undefined;
            await runLeadApproveCommand([]);
            expect(process.exitCode).toBe(1);
            expect(error.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('lead-approve <id>');
        } finally {
            process.exitCode = undefined;
            error.mockRestore();
        }
    });
});
