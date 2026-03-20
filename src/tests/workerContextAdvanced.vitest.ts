import { describe, it, expect } from 'vitest';
import { addBreadcrumb, formatBreadcrumbs } from '../workers/context';
import type { WorkerContext } from '../workers/context';

function ctx(): WorkerContext {
    return { session: {} as WorkerContext['session'], dryRun: false, localDate: '2025-01-01', accountId: 'test' };
}

describe('workerContext — breadcrumbs advanced', () => {
    it('breadcrumb ha action e detail', () => {
        const c = ctx();
        addBreadcrumb(c, 'step1', 'detail1');
        expect(c.breadcrumbs?.[0]?.action).toBe('step1');
        expect(c.breadcrumbs?.[0]?.detail).toBe('detail1');
    });

    it('breadcrumb senza detail → detail undefined', () => {
        const c = ctx();
        addBreadcrumb(c, 'step_no_detail');
        expect(c.breadcrumbs?.[0]?.detail).toBeUndefined();
    });

    it('20 breadcrumbs → circolare (ultimi 20)', () => {
        const c = ctx();
        for (let i = 0; i < 25; i++) addBreadcrumb(c, `s${i}`);
        expect(c.breadcrumbs?.length).toBe(20);
        // Il primo breadcrumb dovrebbe essere s5 (i primi 5 eliminati)
        expect(c.breadcrumbs?.[0]?.action).toBe('s5');
    });

    it('formatBreadcrumbs con 1 breadcrumb → contiene action', () => {
        const c = ctx();
        addBreadcrumb(c, 'only_one');
        expect(formatBreadcrumbs(c)).toContain('only_one');
    });

    it('formatBreadcrumbs con 0 → messaggio default', () => {
        expect(formatBreadcrumbs(ctx())).toContain('nessun');
    });

    it('breadcrumbs inizialmente undefined', () => {
        expect(ctx().breadcrumbs).toBeUndefined();
    });

    it('primo addBreadcrumb inizializza array', () => {
        const c = ctx();
        addBreadcrumb(c, 'first');
        expect(Array.isArray(c.breadcrumbs)).toBe(true);
    });
});
