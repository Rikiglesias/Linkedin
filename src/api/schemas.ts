/**
 * api/schemas.ts
 * ─────────────────────────────────────────────────────────────────
 * Schema Zod per la validazione degli input delle API.
 * Centralizzati per mantenere consistenza e riusabilità.
 */

import { z } from 'zod';

export const PauseSchema = z.object({
    minutes: z.number().int().min(1).max(10080),
});

export const QuarantineSchema = z.union([
    z.object({
        enabled: z.boolean(),
    }),
    z.object({
        action: z.enum(['set', 'clear']),
    }),
]);

export const ExportLeadsQuerySchema = z.object({
    format: z.enum(['csv', 'json']).default('json'),
    status: z.string().optional(),
    listName: z.string().optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(500)).optional(),
});

const AutomationSourceSchema = z.string().trim().min(1).max(64).default('api_v1');
const AutomationIdempotencyKeySchema = z.string().trim().min(1).max(200);
const OptionalNonEmptyStringSchema = z.string().trim().min(1).optional();

export const SyncSearchAutomationPayloadSchema = z.object({
    searchName: OptionalNonEmptyStringSchema,
    listName: z.string().trim().min(1),
    maxPages: z.number().int().min(0).max(999).optional(),
    limit: z.number().int().min(1).max(10000).optional(),
    enrichment: z.boolean().optional(),
    accountId: OptionalNonEmptyStringSchema,
    noProxy: z.boolean().optional(),
});

export const SyncListAutomationPayloadSchema = z
    .object({
        listName: OptionalNonEmptyStringSchema,
        listUrl: OptionalNonEmptyStringSchema,
        maxPages: z.number().int().min(0).max(999).optional(),
        maxLeads: z.number().int().min(1).max(100000).optional(),
        enrichment: z.boolean().optional(),
        accountId: OptionalNonEmptyStringSchema,
        noProxy: z.boolean().optional(),
    })
    .refine((payload) => !!payload.listName || !!payload.listUrl, {
        message: 'listName o listUrl obbligatori',
        path: ['listName'],
    });

export const SendInvitesAutomationPayloadSchema = z.object({
    listName: OptionalNonEmptyStringSchema,
    noteMode: z.enum(['ai', 'template', 'none']).optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    limit: z.number().int().min(1).max(10000).optional(),
    accountId: OptionalNonEmptyStringSchema,
    skipEnrichment: z.boolean().optional(),
});

export const SendMessagesAutomationPayloadSchema = z.object({
    listName: OptionalNonEmptyStringSchema,
    template: OptionalNonEmptyStringSchema,
    lang: OptionalNonEmptyStringSchema,
    limit: z.number().int().min(1).max(10000).optional(),
    accountId: OptionalNonEmptyStringSchema,
    skipEnrichment: z.boolean().optional(),
});

export const PublicAutomationCommandRequestSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('sync-search'),
        payload: SyncSearchAutomationPayloadSchema,
        source: AutomationSourceSchema,
        idempotencyKey: AutomationIdempotencyKeySchema,
    }),
    z.object({
        kind: z.literal('sync-list'),
        payload: SyncListAutomationPayloadSchema,
        source: AutomationSourceSchema,
        idempotencyKey: AutomationIdempotencyKeySchema,
    }),
    z.object({
        kind: z.literal('send-invites'),
        payload: SendInvitesAutomationPayloadSchema.default({}),
        source: AutomationSourceSchema,
        idempotencyKey: AutomationIdempotencyKeySchema,
    }),
    z.object({
        kind: z.literal('send-messages'),
        payload: SendMessagesAutomationPayloadSchema.default({}),
        source: AutomationSourceSchema,
        idempotencyKey: AutomationIdempotencyKeySchema,
    }),
]);
