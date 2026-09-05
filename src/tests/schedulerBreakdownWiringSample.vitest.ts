/**
 * schedulerBreakdownWiringSample.vitest.ts — review blocco 2 (2026-09-05): il wiring contesto→breakdown dello scheduler
 * (`applyAdaptiveContextToBreakdown`) e la scelta della lista peggiore per l'alert per-lista (`selectWorstPendingList`)
 * sono funzioni pure testate direttamente. Dimenticare un campo di campione nel breakdown = guardian (C21) fail-open
 * silenzioso; l'alert per-lista senza campione mandava «100% pending» al primo invito. Il percorso E2E attraverso
 * `scheduleJobs` è coperto da C7 (blocco 3).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    applyAdaptiveContextToBreakdown,
    evaluateAdaptiveBudgetContext,
    selectWorstPendingList,
    type ListScheduleBreakdown,
} from '../core/scheduler';

function makeList(overrides: Partial<ListScheduleBreakdown> = {}): ListScheduleBreakdown {
    return {
        listName: 'lista',
        inviteBudget: 0,
        messageBudget: 0,
        queuedInviteJobs: 0,
        queuedCheckJobs: 0,
        queuedMessageJobs: 0,
        adaptiveFactor: 1,
        adaptiveReasons: [],
        pendingRatio: 0,
        blockedRatio: 0,
        pendingInvitedTotal: 0,
        pendingSampleSufficient: false,
        blockedSampleSufficient: false,
        maxScheduledDelaySec: 0,
        ...overrides,
    };
}

beforeAll(async () => {
    const { config } = await import('../config');
    config.adaptiveCapsEnabled = true;
    config.adaptiveCapsPendingStop = 0.65;
    config.adaptiveCapsPendingWarn = 0.45;
    config.adaptiveCapsBlockedWarn = 0.15;
    config.adaptiveCapsMinFactor = 0.2;
    config.adaptiveCapsWarnFactor = 0.7;
    config.lowActivityBudgetFactor = 0.5;
    config.pendingRatioMinInvited = 20;
});

describe('applyAdaptiveContextToBreakdown — ogni campo del contesto arriva nel breakdown', () => {
    it('copia factor, reasons, ratio e i tre campi di campione (guardia anti fail-open)', () => {
        const context = evaluateAdaptiveBudgetContext({ INVITED: 20, BLOCKED: 5 }, 'NORMAL', { invitedTotal: 25 });
        const breakdown = applyAdaptiveContextToBreakdown(makeList(), context);

        const mapping: Record<string, keyof ListScheduleBreakdown> = {
            factor: 'adaptiveFactor',
            reasons: 'adaptiveReasons',
            pendingRatio: 'pendingRatio',
            blockedRatio: 'blockedRatio',
            pendingInvitedTotal: 'pendingInvitedTotal',
            pendingSampleSufficient: 'pendingSampleSufficient',
            blockedSampleSufficient: 'blockedSampleSufficient',
        };
        for (const [contextKey, breakdownKey] of Object.entries(mapping)) {
            expect(breakdown[breakdownKey], `campo ${contextKey}`).toEqual(
                (context as unknown as Record<string, unknown>)[contextKey],
            );
        }
        // Nessun campo del contesto sfugge alla mappa: un campo nuovo senza wiring fa cadere questo test.
        expect(Object.keys(context).sort()).toEqual(Object.keys(mapping).sort());
        expect(breakdown.pendingSampleSufficient).toBe(true);
        expect(breakdown.blockedSampleSufficient).toBe(true);
    });
});

describe('selectWorstPendingList — alert per-lista solo sopra campione', () => {
    it('ignora la lista al primo invito (1.0 sotto campione) e sceglie la peggiore sopra campione', () => {
        const worst = selectWorstPendingList(
            [
                makeList({ listName: 'primo-invito', pendingRatio: 1, pendingSampleSufficient: false }),
                makeList({ listName: 'b', pendingRatio: 0.7, pendingSampleSufficient: true }),
                makeList({ listName: 'c', pendingRatio: 0.8, pendingSampleSufficient: true }),
            ],
            0.65,
        );
        expect(worst?.listName).toBe('c');
    });

    it('tutte sotto campione → nessun alert', () => {
        expect(
            selectWorstPendingList([makeList({ pendingRatio: 1, pendingSampleSufficient: false })], 0.65),
        ).toBeUndefined();
    });

    it('sopra campione sotto soglia → nessun alert (come oggi)', () => {
        expect(
            selectWorstPendingList([makeList({ pendingRatio: 0.5, pendingSampleSufficient: true })], 0.65),
        ).toBeUndefined();
    });
});

describe('sentinelle: i call-site reali usano le funzioni pure', () => {
    const src = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8');

    it('scheduleJobs copia il contesto con applyAdaptiveContextToBreakdown', () => {
        expect(src('core/scheduler.ts')).toContain('applyAdaptiveContextToBreakdown(breakdown, context)');
    });

    it("l'orchestrator sceglie la lista da allertare con selectWorstPendingList", () => {
        expect(src('core/orchestrator.ts')).toContain(
            'selectWorstPendingList(listBreakdown, config.compliancePendingRatioAlertThreshold)',
        );
    });
});
