/**
 * schedulerPromotionFlag.vitest.ts — C8 del contratto `bot-operativo`: la promozione bulk NEW→READY_INVITE
 * (`promoteNewLeadsToReadyInvite`, `core/scheduler.ts`) sta dietro `AUTO_PROMOTE_NEW_LEADS_ENABLED`
 * (config `autoPromoteNewLeadsEnabled`, default false) ed è l'UNICO default di comportamento cambiato in F1.
 * Parità dry-run / run reale: con il flag OFF il dry-run non conta i NEW fra i candidati; con il flag ON li
 * conta con lo stesso limite della promozione (`hardInviteCap * 4`).
 *
 * Scheduler REALE sul DB di test (copia): mockate SOLO la promozione (per non spostare 100 lead veri della
 * copia condivisa) e la query dei candidati come spia pass-through (implementazione reale).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
    promote: vi.fn(async (_limit: number) => 0),
    getLeadsByStatusForList: vi.fn(),
}));

vi.mock('../core/repositories', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../core/repositories')>();
    spies.getLeadsByStatusForList.mockImplementation(actual.getLeadsByStatusForList);
    return {
        ...actual,
        promoteNewLeadsToReadyInvite: spies.promote,
        getLeadsByStatusForList: spies.getLeadsByStatusForList,
    };
});

import { config } from '../config';
import { buildLimitsAndRiskDomainConfig } from '../config/domains';
import { scheduleJobs } from '../core/scheduler';
import { getDatabase } from '../db';
import { freezeClockInsideWorkingHours } from './helpers/fakeWorkingHourClock';

const LIST = `__c8_promo_${process.pid}_${Date.now()}__`;
const NEW_LEADS = 5;
const SESSION_LIMIT = 3;

let restoreClock: () => void = () => undefined;
let flagBefore: boolean | undefined;

async function leadIdsOfList(): Promise<number[]> {
    const db = await getDatabase();
    const rows = await db.query<{ id: number }>(`SELECT id FROM leads WHERE list_name = ?`, [LIST]);
    return rows.map((row) => row.id);
}

beforeAll(async () => {
    ({ restore: restoreClock } = freezeClockInsideWorkingHours());
    flagBefore = config.autoPromoteNewLeadsEnabled;
    const db = await getDatabase();
    await db.run(`INSERT OR IGNORE INTO lead_lists (name, source, is_active) VALUES (?, 'import', 1)`, [LIST]);
    for (let i = 0; i < NEW_LEADS; i++) {
        await db.run(
            `INSERT INTO leads (linkedin_url, status, list_name, first_name, last_name, job_title, lead_score)
             VALUES (?, 'NEW', ?, 'C8', ?, 'CTO', 80)`,
            [`https://www.linkedin.com/in/c8-promo-${process.pid}-${Date.now()}-${i}`, LIST, `Lead${i}`],
        );
    }
});

afterAll(async () => {
    config.autoPromoteNewLeadsEnabled = flagBefore as boolean;
    const db = await getDatabase();
    const ids = await leadIdsOfList();
    if (ids.length > 0) {
        const marks = ids.map(() => '?').join(',');
        await db.run(`DELETE FROM lead_events WHERE lead_id IN (${marks})`, ids);
        await db.run(`DELETE FROM leads WHERE id IN (${marks})`, ids);
    }
    await db.run(`DELETE FROM lead_lists WHERE name = ?`, [LIST]);
    restoreClock();
});

describe('C8 — default: la promozione automatica è SPENTA', () => {
    it('autoPromoteNewLeadsEnabled vale false quando AUTO_PROMOTE_NEW_LEADS_ENABLED non è impostata', () => {
        const saved = process.env.AUTO_PROMOTE_NEW_LEADS_ENABLED;
        delete process.env.AUTO_PROMOTE_NEW_LEADS_ENABLED;
        try {
            expect(buildLimitsAndRiskDomainConfig().autoPromoteNewLeadsEnabled).toBe(false);
        } finally {
            if (saved !== undefined) process.env.AUTO_PROMOTE_NEW_LEADS_ENABLED = saved;
        }
    });

    it('flag OFF, run reale: promoteNewLeadsToReadyInvite non viene chiamata', async () => {
        config.autoPromoteNewLeadsEnabled = false;
        spies.promote.mockClear();
        await scheduleJobs('invite', { dryRun: false, listFilter: LIST, sessionLimit: SESSION_LIMIT });
        expect(spies.promote).not.toHaveBeenCalled();
    });

    it('flag OFF, dry-run: una lista con soli NEW dà 0 candidati (parità con il run reale, che non li promuove)', async () => {
        config.autoPromoteNewLeadsEnabled = false;
        spies.getLeadsByStatusForList.mockClear();
        const schedule = await scheduleJobs('invite', { dryRun: true, listFilter: LIST, sessionLimit: SESSION_LIMIT });
        const ourList = schedule.listBreakdown.find((entry) => entry.listName === LIST);
        expect(ourList?.queuedInviteJobs ?? 0).toBe(0);
        const newQueries = spies.getLeadsByStatusForList.mock.calls.filter(
            (call) => call[0] === 'NEW' && call[1] === LIST,
        );
        expect(newQueries).toHaveLength(0);
    });
});

describe('C8 — flag ON: comportamento odierno, con lo stesso limite nel dry-run', () => {
    it('flag ON, run reale: promozione chiamata UNA volta con hardInviteCap * 4', async () => {
        config.autoPromoteNewLeadsEnabled = true;
        spies.promote.mockClear();
        await scheduleJobs('invite', { dryRun: false, listFilter: LIST, sessionLimit: SESSION_LIMIT });
        expect(spies.promote).toHaveBeenCalledTimes(1);
        expect(spies.promote).toHaveBeenCalledWith(config.hardInviteCap * 4);
    });

    it('flag ON, dry-run: i NEW della lista contano come candidati, mai oltre hardInviteCap * 4', async () => {
        config.autoPromoteNewLeadsEnabled = true;
        spies.getLeadsByStatusForList.mockClear();
        const schedule = await scheduleJobs('invite', { dryRun: true, listFilter: LIST, sessionLimit: SESSION_LIMIT });
        const ourList = schedule.listBreakdown.find((entry) => entry.listName === LIST);
        expect(ourList?.queuedInviteJobs ?? 0).toBeGreaterThan(0);
        expect(ourList?.queuedInviteJobs ?? 0).toBeLessThanOrEqual(Math.min(NEW_LEADS, SESSION_LIMIT));
        const newQueries = spies.getLeadsByStatusForList.mock.calls.filter(
            (call) => call[0] === 'NEW' && call[1] === LIST,
        );
        expect(newQueries).toHaveLength(1);
        expect(newQueries[0]?.[2]).toBeLessThanOrEqual(config.hardInviteCap * 4);
    });
});
