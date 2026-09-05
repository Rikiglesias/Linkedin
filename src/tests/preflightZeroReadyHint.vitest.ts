/**
 * preflightZeroReadyHint.vitest.ts — C10 del contratto `bot-operativo`: il preflight di send-invites con 0 READY_INVITE
 * e ≥1 NEW non dice più «esegui prima sync-list con enrichment» ma stampa il comando ESATTO del passo successivo,
 * `.\bot.ps1 lead-approve <id>`, con l'id di un lead NEW davvero eleggibile (stessa eleggibilità di C9).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findFirstEligibleNewLeadId } from '../core/leadInviteEligibility';
import { getDatabase } from '../db';
import { buildLeadApproveNextAction, buildZeroReadyInviteWarning } from '../workflows/services/leadApproveHint';

const TAG = `${process.pid}-${Date.now()}`;
const LIST = `__c10_hint_${TAG}__`;
const OTHER = `__c10_altra_${TAG}__`;
const ids: number[] = [];
let eligibleId = 0;

beforeAll(async () => {
    const db = await getDatabase();
    await db.run(`INSERT OR IGNORE INTO lead_lists (name, source, is_active) VALUES (?, 'import', 1)`, [LIST]);
    await db.run(`INSERT OR IGNORE INTO lead_lists (name, source, is_active) VALUES (?, 'import', 1)`, [OTHER]);
    const seeds: Array<{ key: string; list: string; score: number | null; gdpr: 0 | 1 }> = [
        { key: 'gdpr', list: LIST, score: 95, gdpr: 1 },
        { key: 'eligible', list: LIST, score: 80, gdpr: 0 },
        { key: 'other', list: OTHER, score: 99, gdpr: 0 },
    ];
    for (const seed of seeds) {
        const inserted = await db.run(
            `INSERT INTO leads (linkedin_url, status, list_name, first_name, last_name, job_title, lead_score, gdpr_opt_out)
             VALUES (?, 'NEW', ?, 'C10', ?, 'CTO', ?, ?)`,
            [`https://www.linkedin.com/in/c10-${TAG}-${seed.key}`, seed.list, seed.key, seed.score, seed.gdpr],
        );
        ids.push(Number(inserted.lastID));
        if (seed.key === 'eligible') eligibleId = Number(inserted.lastID);
    }
});

afterAll(async () => {
    const db = await getDatabase();
    if (ids.length > 0) {
        const marks = ids.map(() => '?').join(',');
        await db.run(`DELETE FROM lead_events WHERE lead_id IN (${marks})`, ids);
        await db.run(`DELETE FROM leads WHERE id IN (${marks})`, ids);
    }
    await db.run(`DELETE FROM lead_lists WHERE name IN (?, ?)`, [LIST, OTHER]);
});

describe('C10 — testo del preflight a 0 READY_INVITE', () => {
    it('con un lead NEW eleggibile: warning critical col comando esatto lead-approve <id>', () => {
        const warning = buildZeroReadyInviteWarning({ firstEligibleNewLeadId: 42, newCount: 3, listName: 'Lista X' });
        expect(warning.level).toBe('critical');
        expect(warning.message).toContain('.\\bot.ps1 lead-approve 42');
        expect(warning.message).toContain('READY_INVITE');
        expect(warning.message).not.toContain('enrichment');
    });

    it('con NEW presenti ma nessuno eleggibile: dice che non sono eleggibili e come scoprire il filtro', () => {
        const warning = buildZeroReadyInviteWarning({ firstEligibleNewLeadId: null, newCount: 3, listName: null });
        expect(warning.level).toBe('critical');
        expect(warning.message).toMatch(/nessuno è eleggibile/i);
        expect(warning.message).toContain('lead-approve <id>');
    });

    it('senza NEW: rimanda a sync-list (non c\'è nulla da approvare)', () => {
        const warning = buildZeroReadyInviteWarning({ firstEligibleNewLeadId: null, newCount: 0, listName: 'Lista X' });
        expect(warning.level).toBe('critical');
        expect(warning.message).toContain('.\\bot.ps1 sync-list --list "Lista X"');
    });

    it('nextAction del blocco NO_WORK_AVAILABLE porta lo stesso comando del warning', () => {
        const hint = { firstEligibleNewLeadId: 42, newCount: 3, listName: 'Lista X' };
        expect(buildLeadApproveNextAction(hint)).toContain('.\\bot.ps1 lead-approve 42');
        expect(buildLeadApproveNextAction({ ...hint, firstEligibleNewLeadId: null, newCount: 0 })).toContain('sync-list');
    });
});

describe('C10 — l\'id suggerito è di un lead NEW eleggibile (eleggibilità di C9, non il primo NEW qualsiasi)', () => {
    it('salta il lead con opt-out GDPR anche se ha lo score più alto e resta dentro la lista', async () => {
        expect(await findFirstEligibleNewLeadId(LIST)).toBe(eligibleId);
    });

    it('rispetta --min-score: nessun eleggibile → null', async () => {
        expect(await findFirstEligibleNewLeadId(LIST, 90)).toBeNull();
    });
});
