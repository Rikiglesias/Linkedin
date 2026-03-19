import { describe, it, expect } from 'vitest';
import { addBreadcrumb, formatBreadcrumbs } from '../workers/context';
import type { WorkerContext } from '../workers/context';

function makeMinimalContext(): WorkerContext {
    return {
        session: {} as WorkerContext['session'],
        dryRun: false,
        localDate: '2025-01-01',
        accountId: 'test-account',
    };
}

describe('workers/context — breadcrumbs', () => {
    it('addBreadcrumb aggiunge un breadcrumb', () => {
        const ctx = makeMinimalContext();
        addBreadcrumb(ctx, 'test.action', 'detail');
        expect(ctx.breadcrumbs).toBeDefined();
        expect(ctx.breadcrumbs?.length).toBe(1);
    });

    it('addBreadcrumb max 20 breadcrumbs (circolare)', () => {
        const ctx = makeMinimalContext();
        for (let i = 0; i < 30; i++) {
            addBreadcrumb(ctx, `action-${i}`);
        }
        expect(ctx.breadcrumbs?.length).toBeLessThanOrEqual(20);
    });

    it('formatBreadcrumbs senza breadcrumbs → messaggio default', () => {
        const ctx = makeMinimalContext();
        expect(formatBreadcrumbs(ctx)).toBe('(nessun breadcrumb)');
    });

    it('formatBreadcrumbs con breadcrumbs → stringa formattata', () => {
        const ctx = makeMinimalContext();
        addBreadcrumb(ctx, 'step1', 'primo');
        addBreadcrumb(ctx, 'step2', 'secondo');
        const formatted = formatBreadcrumbs(ctx);
        expect(formatted).toContain('step1');
        expect(formatted).toContain('step2');
    });

    it('breadcrumb ha action', () => {
        const ctx = makeMinimalContext();
        addBreadcrumb(ctx, 'test.action');
        const bc = ctx.breadcrumbs?.[0];
        expect(bc?.action).toBe('test.action');
    });
});
