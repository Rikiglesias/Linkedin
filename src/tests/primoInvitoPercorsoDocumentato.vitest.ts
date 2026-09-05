/**
 * primoInvitoPercorsoDocumentato.vitest.ts — C10 del contratto `bot-operativo`: il percorso documentato resta vero ED
 * È ESEGUITO.
 *  (a) `docs/GUIDA.md` documenta `.\bot.ps1 lead-approve <id>` nella sezione del primo invito, il flag
 *      `AUTO_PROMOTE_NEW_LEADS_ENABLED` (default, effetto, come riattivarlo) e la lista .env del primo run
 *      (`USE_JA3_PROXY=false`, `--limit 1 --no-enrich`), che NON contiene `HARD_INVITE_CAP=1`.
 *  (b) Sul DB di test: prima dell'approvazione il preflight di send-invites (0 READY_INVITE, 1 NEW) stampa il comando
 *      `lead-approve <id>` esatto; dopo `lead-approve`, il servizio invocato con gli argomenti ESATTI della CLI
 *      (`runSendInvitesWorkflow({ limit: 1, dryRun: true, skipEnrichment: true })`, `workflowCommands.ts`) ottiene
 *      1 candidato in anteprima.
 * Mockato solo ciò che legge l'AMBIENTE della macchina (stato proxy/sessione del preflight, TTY): DB, eleggibilità,
 * scheduler e orchestrator in dry-run sono reali.
 */
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../workflows/preflight/configInspector', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../workflows/preflight/configInspector')>();
    return {
        ...actual,
        collectConfigStatus: async () => ({
            proxyConfigured: true,
            apolloConfigured: false,
            hunterConfigured: false,
            clearbitConfigured: false,
            aiConfigured: false,
            supabaseConfigured: false,
            growthModelEnabled: false,
            weeklyStrategyEnabled: false,
            warmupEnabled: false,
            budgetInvites: 10,
            budgetMessages: 10,
            invitesSentToday: 0,
            messagesSentToday: 0,
            weeklyInvitesSent: 0,
            weeklyInviteLimit: 100,
            proxyIpReputation: null,
            staleAccounts: [],
            noLoginAccounts: [],
        }),
    };
});
vi.mock('../cli/stdinHelper', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../cli/stdinHelper')>();
    return { ...actual, isInteractiveTTY: () => false };
});
vi.mock('../telemetry/alerts', () => ({ sendTelegramAlert: vi.fn(async () => undefined) }));

import { config } from '../config';
import { approveLeadForInvite } from '../core/leadApproval';
import { getDatabase } from '../db';
import { executeSendInvitesWorkflow } from '../workflows/services/sendInvitesService';
import { freezeClockInsideWorkingHours } from './helpers/fakeWorkingHourClock';

const ROOT = process.cwd();
const GUIDA = fs.readFileSync(path.join(ROOT, 'docs', 'GUIDA.md'), 'utf8');
const REPORT = fs.readFileSync(path.join(ROOT, 'docs', 'tracking', 'STATO_BOT_360_2026-09-02.md'), 'utf8');

/** Testo della sezione della GUIDA il cui titolo parla di «primo invito», fino al titolo successivo. */
function primoInvitoSection(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((line) => /^#{2,4}\s.*primo invito/i.test(line));
    if (start === -1) return '';
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^#{2,4}\s/.test(lines[i] ?? '')) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join('\n');
}

describe('C10 (a) — la GUIDA documenta il percorso del primo invito', () => {
    const section = primoInvitoSection(GUIDA);

    it('esiste una sezione «primo invito» con lead-approve dentro', () => {
        expect(section.length, 'sezione del primo invito assente').toBeGreaterThan(0);
        expect(section).toContain('.\\bot.ps1 lead-approve');
    });

    it('spiega AUTO_PROMOTE_NEW_LEADS_ENABLED: default false, effetto, come riattivarlo', () => {
        expect(section).toContain('AUTO_PROMOTE_NEW_LEADS_ENABLED');
        expect(section).toMatch(/AUTO_PROMOTE_NEW_LEADS_ENABLED=true/);
    });

    it('lista .env del primo run: USE_JA3_PROXY=false e canary con --limit 1 --no-enrich; MAI HARD_INVITE_CAP=1', () => {
        expect(section).toContain('USE_JA3_PROXY=false');
        expect(section).toContain('--limit 1');
        expect(section).toContain('--no-enrich');
        expect(section).toContain('--dry-run');
        expect(section).not.toMatch(/HARD_INVITE_CAP\s*=\s*1\b/);
    });

    it('lead-approve è citato almeno 2 volte nella GUIDA e il report porta la nota datata 2026-09-03', () => {
        expect((GUIDA.match(/lead-approve/g) ?? []).length).toBeGreaterThanOrEqual(2);
        expect((REPORT.match(/Corretto 2026-09-03/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
});

describe('C10 (b) — il percorso viene ESEGUITO sul DB di test', () => {
    const TAG = `${process.pid}-${Date.now()}`;
    const LIST = `__c10_primo_${TAG}__`;
    let leadId = 0;
    let restoreClock: () => void = () => undefined;
    const savedFlag = config.autoPromoteNewLeadsEnabled;

    beforeAll(async () => {
        ({ restore: restoreClock } = freezeClockInsideWorkingHours());
        config.autoPromoteNewLeadsEnabled = false;
        const db = await getDatabase();
        await db.run(`INSERT OR IGNORE INTO lead_lists (name, source, is_active) VALUES (?, 'import', 1)`, [LIST]);
        const inserted = await db.run(
            `INSERT INTO leads (linkedin_url, status, list_name, first_name, last_name, job_title, lead_score)
             VALUES (?, 'NEW', ?, 'C10', 'PrimoLead', 'CTO', 80)`,
            [`https://www.linkedin.com/in/c10-primo-${TAG}`, LIST],
        );
        leadId = Number(inserted.lastID);
    });

    afterAll(async () => {
        config.autoPromoteNewLeadsEnabled = savedFlag;
        const db = await getDatabase();
        await db.run(`DELETE FROM jobs WHERE idempotency_key LIKE ?`, [`invite:${leadId}:%`]);
        await db.run(`DELETE FROM lead_events WHERE lead_id = ?`, [leadId]);
        await db.run(`DELETE FROM leads WHERE id = ?`, [leadId]);
        await db.run(`DELETE FROM lead_lists WHERE name = ?`, [LIST]);
        restoreClock();
    });

    // `runSendInvitesWorkflow` (CLI, `workflowCommands.ts:63-73`) passa questi stessi campi a `executeSendInvitesWorkflow`
    // e poi stampa/invia il report: qui si invoca il servizio con gli argomenti ESATTI, senza il formatter.
    it('prima dell\'approvazione: 0 READY_INVITE e 1 NEW → il preflight stampa lead-approve <id> ESATTO', async () => {
        const result = await executeSendInvitesWorkflow({ listName: LIST, limit: 1, dryRun: true, skipEnrichment: true });
        expect(result.blocked?.reason).toBe('PRECONDITION_FAILED');
        const warnings = result.artifacts?.preflight?.warnings ?? [];
        const hint = warnings.find((warning) => warning.message.includes('lead-approve'));
        expect(hint, JSON.stringify(warnings)).toBeDefined();
        expect(hint?.message).toContain(`.\\bot.ps1 lead-approve ${leadId}`);
        // Anche chi legge solo il report (non-TTY: scheduler, PM2) vede il comando nella «Prossima azione».
        expect(result.nextAction).toContain(`.\\bot.ps1 lead-approve ${leadId}`);
    });

    it('dopo lead-approve: il servizio con gli argomenti ESATTI della CLI vede 1 candidato in anteprima', async () => {
        const approval = await approveLeadForInvite(leadId, { reason: 'C10' });
        expect(approval.approved, JSON.stringify(approval)).toBe(true);

        const result = await executeSendInvitesWorkflow({ listName: LIST, limit: 1, dryRun: true, skipEnrichment: true });
        expect(result.blocked, JSON.stringify(result.blocked)).toBeNull();
        expect(result.artifacts?.candidateCount).toBe(1);
        expect(result.artifacts?.previewLeads?.[0]?.label).toBe('C10 PrimoLead');
        expect(result.summary['dry_run']).toBe('SI');
    });
});
