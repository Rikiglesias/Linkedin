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

export const IncidentResolveParamsSchema = z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
});

export const CommentSuggestionParamsSchema = z.object({
    leadId: z.string().regex(/^\d+$/).transform(Number),
    suggestionIndex: z.string().regex(/^\d+$/).transform(Number),
});

export const CommentApproveBodySchema = z.object({
    comment: z.string().min(1).max(500).optional(),
});

export const CsvImportSchema = z.object({
    filePath: z.string().min(1),
    listName: z.string().min(1).max(200).default('default'),
});

export const ExportLeadsQuerySchema = z.object({
    format: z.enum(['csv', 'json']).default('json'),
    status: z.string().optional(),
    listName: z.string().optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(500)).optional(),
});

export const PaginationSchema = z.object({
    page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1)).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(500)).optional(),
});
