/**
 * firstInviteNoQuarantine.vitest.ts — C7 del contratto `bot-operativo` (postcondizione di sistema U2): il PRIMO
 * invito non manda il bot in quarantena e non lo mette in pausa, attraversando l'orchestrator REALE.
 *
 * Reali: `runWorkflow` (`core/orchestrator.ts`), `evaluateWorkflowEntryGuards`, `scheduleJobs`, repository sul DB
 * di test (copia), `riskEngine`, `guardian` euristico, `incidentManager` (spie pass-through: implementazione vera).
 * Mockato SOLO il confine browser/job-runner: `core/jobRunner` (esecuzione job), `browser` (nessun browser si apre:
 * `launchBrowser` lancia), `browser/sessionCookieMonitor` (maturità sessione letta dal filesystem reale → fissata a
 * «matura», altrimenti il test cambia esito il giorno dopo un `bot.ps1 login`), `telemetry/alerts` (Telegram).
 *
 * Stato COSTRUITO (non mockato) perché il percorso reale lo attraversi senza rete: orologio fermo in orario
 * lavorativo feriale; flag runtime «fatto di recente» per canary/heartbeat/backup/rescore (throttle veri, letti dal
 * codice reale); sink eventi NONE (Supabase), site-check post-run OFF (LinkedIn-touch), guardian AI OFF (C21: euristica).
 *
 * Il dry-run NON basterebbe: `runWorkflowInternal` ritorna a `[DRY_RUN]` PRIMA della quarantena STOP e del guardian.
 * Rosso di controllo (mutation): con `pendingRatioMinInvited = 1` lo stesso stato dà `blocked` (STOP/guardian).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
    runQueuedJobs: vi.fn(async () => undefined),
    sendTelegramAlert: vi.fn(async () => undefined),
    launchBrowser: vi.fn(async () => {
        throw new Error('C7: nessun browser deve aprirsi (confine mockato)');
    }),
    quarantineAccount: vi.fn(),
    pauseAutomation: vi.fn(),
}));

vi.mock('../core/jobRunner', () => ({ runQueuedJobs: spies.runQueuedJobs }));
vi.mock('../telemetry/alerts', () => ({ sendTelegramAlert: spies.sendTelegramAlert }));
vi.mock('../browser', () => ({
    launchBrowser: spies.launchBrowser,
    closeBrowser: vi.fn(async () => undefined),
    checkLogin: vi.fn(async () => true),
    runSelectorCanaryDetailed: vi.fn(),
}));
vi.mock('../browser/sessionCookieMonitor', () => ({
    getSessionMaturity: () => ({ maturity: 'established', ageDays: 90, budgetFactor: 1, forceRandomActivityFirst: false }),
}));
vi.mock('../risk/incidentManager', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../risk/incidentManager')>();
    spies.quarantineAccount.mockImplementation(actual.quarantineAccount);
    spies.pauseAutomation.mockImplementation(actual.pauseAutomation);
    return { ...actual, quarantineAccount: spies.quarantineAccount, pauseAutomation: spies.pauseAutomation };
});

import { heuristics } from '../ai/guardian';
import { config } from '../config';
import { runWorkflow } from '../core/orchestrator';
import { getAccountQuarantine, getAutomationPauseState, getRuntimeFlag, setRuntimeFlag } from '../core/repositories';
import { scheduleJobs } from '../core/scheduler';
import { getDatabase } from '../db';
import { freezeClockInsideWorkingHours } from './helpers/fakeWorkingHourClock';

const LIST = '__f1_primo_invito__';
const NEW_LEADS = 10;
const RUN_TAG = `${process.pid}-${Date.now()}`;
/** Throttle reali letti da entry guard e guardie preventive: «fatto adesso» = nessun browser, rete o backup nel test. */
const RECENTLY_DONE_FLAGS = ['canary_last_ok_at', 'heartbeat_last_at', 'db_backup_last_at', 'rescore_last_at'];

let restoreClock: () => void = () => undefined;
const savedFlags = new Map<string, string | null>();
const savedConfig = {
    postRunStateSyncEnabled: config.postRunStateSyncEnabled,
    eventSyncSink: config.eventSyncSink,
    aiGuardianEnabled: config.aiGuardianEnabled,
    pendingRatioMinInvited: config.pendingRatioMinInvited,
    autoPromoteNewLeadsEnabled: config.autoPromoteNewLeadsEnabled,
};

async function leadIdsOfList(): Promise<number[]> {
    const db = await getDatabase();
    return (await db.query<{ id: number }>(`SELECT id FROM leads WHERE list_name = ?`, [LIST])).map((r) => r.id);
}

async function countGlobal(sql: string): Promise<number> {
    const db = await getDatabase();
    return Number((await db.get<{ total: number }>(sql))?.total ?? -1);
}

/** Altri file della suite scrivono pausa/quarantena sullo stesso DB: si aspetta lo stato libero, con tetto. */
async function waitForNoPauseOrQuarantine(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const paused = (await getAutomationPauseState()).paused;
        const quarantined = await getAccountQuarantine('default');
        if (!paused && !quarantined) return;
        if (Date.now() > deadline) throw new Error(`C7: DB di test ancora in pausa/quarantena dopo ${timeoutMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

beforeAll(async () => {
    ({ restore: restoreClock } = freezeClockInsideWorkingHours('default'));
    config.postRunStateSyncEnabled = false;
    config.eventSyncSink = 'NONE';
    config.aiGuardianEnabled = false;
    config.autoPromoteNewLeadsEnabled = false;

    const nowIso = new Date().toISOString();
    for (const key of RECENTLY_DONE_FLAGS) {
        savedFlags.set(key, await getRuntimeFlag(key));
        await setRuntimeFlag(key, nowIso);
    }

    const db = await getDatabase();
    await db.run(`INSERT OR IGNORE INTO lead_lists (name, source, is_active) VALUES (?, 'import', 1)`, [LIST]);
    for (let i = 0; i < NEW_LEADS; i++) {
        await db.run(
            `INSERT INTO leads (linkedin_url, status, list_name, first_name, last_name, job_title, lead_score)
             VALUES (?, 'NEW', ?, 'F1', ?, 'CTO', 80)`,
            [`https://www.linkedin.com/in/f1-c7-${RUN_TAG}-${i}`, LIST, `Nuovo${i}`],
        );
    }
    // Il primo invito: 1 INVITED ancora pending (1/1 = 100% pending sotto campione).
    await db.run(
        `INSERT INTO leads (linkedin_url, status, list_name, first_name, last_name, job_title, lead_score, invited_at)
         VALUES (?, 'INVITED', ?, 'F1', 'PrimoInvitato', 'CTO', 80, CURRENT_TIMESTAMP)`,
        [`https://www.linkedin.com/in/f1-c7-${RUN_TAG}-invited`, LIST],
    );
});

afterAll(async () => {
    const db = await getDatabase();
    const ids = await leadIdsOfList();
    for (const id of ids) {
        await db.run(`DELETE FROM jobs WHERE idempotency_key LIKE ?`, [`invite:${id}:%`]);
    }
    if (ids.length > 0) {
        const marks = ids.map(() => '?').join(',');
        await db.run(`DELETE FROM lead_events WHERE lead_id IN (${marks})`, ids);
        await db.run(`DELETE FROM leads WHERE id IN (${marks})`, ids);
    }
    await db.run(`DELETE FROM lead_lists WHERE name = ?`, [LIST]);
    for (const [key, value] of savedFlags) {
        if (value === null) await db.run(`DELETE FROM sync_state WHERE key = ?`, [key]);
        else await setRuntimeFlag(key, value);
    }
    Object.assign(config, savedConfig);
    restoreClock();
});

describe('C7 — il primo invito attraversa runWorkflow reale senza quarantena né pausa', () => {
    it('baseline costruito: campione globale sotto pendingRatioMinInvited, lista senza BLOCKED/SKIPPED', async () => {
        const invitedTotal = await countGlobal(`SELECT COUNT(*) AS total FROM leads WHERE invited_at IS NOT NULL`);
        expect(invitedTotal).toBeGreaterThanOrEqual(1);
        expect(invitedTotal).toBeLessThan(config.pendingRatioMinInvited);
        const db = await getDatabase();
        const rows = await db.query<{ status: string; total: number }>(
            `SELECT status, COUNT(*) AS total FROM leads WHERE list_name = ? GROUP BY status`,
            [LIST],
        );
        const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.total)]));
        expect(byStatus['NEW']).toBe(NEW_LEADS);
        expect(byStatus['INVITED']).toBe(1);
        expect(byStatus['BLOCKED'] ?? 0).toBe(0);
        expect(byStatus['SKIPPED'] ?? 0).toBe(0);
    });

    it('runWorkflow(invite, dryRun:false) sulla lista: non blocked, 0 quarantineAccount, 0 pauseAutomation', async () => {
        await waitForNoPauseOrQuarantine();
        spies.quarantineAccount.mockClear();
        spies.pauseAutomation.mockClear();

        const result = await runWorkflow({
            workflow: 'invite',
            dryRun: false,
            listFilter: LIST,
            sessionLimit: 1,
            noteMode: 'none',
        });

        expect(result.status, `blocked: ${JSON.stringify(result.blocked)}`).not.toBe('blocked');
        expect(result.status).toBe('completed');
        expect(spies.quarantineAccount).not.toHaveBeenCalled();
        expect(spies.pauseAutomation).not.toHaveBeenCalled();
        expect(spies.launchBrowser).not.toHaveBeenCalled();
        expect(spies.runQueuedJobs).toHaveBeenCalledTimes(1);
    });

    it('il guardian euristico (C21) non vede la lista del primo invito come critical', async () => {
        const schedule = await scheduleJobs('invite', { dryRun: true, listFilter: LIST, sessionLimit: 1 });
        const decision = heuristics(schedule);
        expect(decision.severity, decision.summary).not.toBe('critical');
        expect(schedule.riskSnapshot.action).not.toBe('STOP');
    });

    it('rosso di controllo: con pendingRatioMinInvited = 1 lo STESSO stato viene bloccato (STOP o guardian)', async () => {
        config.pendingRatioMinInvited = 1;
        // Nel controllo la quarantena/pausa NON deve scrivere sul DB condiviso: si osserva la chiamata, non l'effetto.
        spies.quarantineAccount.mockImplementation(async () => undefined);
        spies.pauseAutomation.mockImplementation(async () => undefined);
        spies.quarantineAccount.mockClear();
        spies.pauseAutomation.mockClear();
        try {
            const result = await runWorkflow({
                workflow: 'invite',
                dryRun: false,
                listFilter: LIST,
                sessionLimit: 1,
                noteMode: 'none',
            });
            expect(result.status).toBe('blocked');
            expect(['RISK_STOP_THRESHOLD', 'AI_GUARDIAN_PREEMPTIVE']).toContain(result.blocked?.reason);
            expect(
                spies.quarantineAccount.mock.calls.length + spies.pauseAutomation.mock.calls.length,
            ).toBeGreaterThanOrEqual(1);
        } finally {
            config.pendingRatioMinInvited = savedConfig.pendingRatioMinInvited;
        }
    });
});
