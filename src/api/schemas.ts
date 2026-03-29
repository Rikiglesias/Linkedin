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
