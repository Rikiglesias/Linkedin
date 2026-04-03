import { describe, expect, test } from 'vitest';
import { PublicAutomationCommandRequestSchema } from '../api/schemas';
import { mapLegacyTriggerRunWorkflow } from '../automation/types';
import { resolveEnabledOutboxSinks } from '../core/repositories/outboxDeliveries';

describe('automation bridge schemas', () => {
    test('accetta sync-search con payload valido', () => {
        const result = PublicAutomationCommandRequestSchema.safeParse({
            kind: 'sync-search',
            payload: {
                listName: 'target-list',
                searchName: 'search-a',
                maxPages: 3,
            },
            source: 'n8n',
            idempotencyKey: 'sync-search:target-list:2026-03-31',
        });

        expect(result.success).toBe(true);
    });

    test('rifiuta sync-list senza listName e listUrl', () => {
        const result = PublicAutomationCommandRequestSchema.safeParse({
            kind: 'sync-list',
            payload: {
                maxPages: 2,
            },
            source: 'n8n',
            idempotencyKey: 'sync-list:missing-target',
        });

        expect(result.success).toBe(false);
    });

    test('accetta send-messages con payload minimale', () => {
        const result = PublicAutomationCommandRequestSchema.safeParse({
            kind: 'send-messages',
            payload: {},
            source: 'dashboard',
            idempotencyKey: 'send-messages:minimal',
        });

        expect(result.success).toBe(true);
    });
});

describe('legacy trigger-run mapping', () => {
    test('mappa invite su send-invites', () => {
        expect(mapLegacyTriggerRunWorkflow('invite')).toEqual({
            kind: 'send-invites',
            payload: {},
        });
    });

    test('mappa all su workflow-all legacy', () => {
        expect(mapLegacyTriggerRunWorkflow('all')).toEqual({
            kind: 'workflow-all',
            payload: { workflow: 'all' },
        });
    });

    test('ritorna null per workflow non supportato', () => {
        expect(mapLegacyTriggerRunWorkflow('research')).toBeNull();
    });
});

describe('outbox multi-sink resolution', () => {
    test('BOTH abilita entrambi i sink configurati', () => {
        expect(resolveEnabledOutboxSinks('BOTH', true, true)).toEqual(['SUPABASE', 'WEBHOOK']);
    });

    test('BOTH filtra il sink disabilitato', () => {
        expect(resolveEnabledOutboxSinks('BOTH', true, false)).toEqual(['SUPABASE']);
    });

    test('NONE non abilita sink', () => {
        expect(resolveEnabledOutboxSinks('NONE', true, true)).toEqual([]);
    });
});
