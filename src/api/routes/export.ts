/**
 * api/routes/export.ts
 * ─────────────────────────────────────────────────────────────────
 * Export dati lead in CSV/JSON per GDPR data portability (Art. 20)
 * e per analisi esterne.
 */

import { Router, type Request, type Response } from 'express';
import { getDatabase } from '../../db';
import { handleApiError, sendApiV1 } from '../utils';
import { ExportLeadsQuerySchema } from '../schemas';
import { recordSecurityAuditEvent } from '../../core/repositories';

const router = Router();

function escapeCsvField(value: unknown): string {
    let str = value === null || value === undefined ? '' : String(value);
    // Prevent CSV formula injection: prefix dangerous first characters with apostrophe
    if (str.length > 0 && /^[=+\-@\t]/.test(str)) {
        str = `'${str}`;
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

interface LeadExportRow {
    id: number;
    account_name: string;
    first_name: string;
    last_name: string;
    job_title: string;
    linkedin_url: string;
    status: string;
    list_name: string;
    lead_score: number | null;
    confidence_score: number | null;
    consent_basis: string | null;
    consent_recorded_at: string | null;
    gdpr_opt_out: number;
    email: string | null;
    phone: string | null;
    invited_at: string | null;
    accepted_at: string | null;
    messaged_at: string | null;
    created_at: string;
    updated_at: string;
}

const CSV_COLUMNS: (keyof LeadExportRow)[] = [
    'id',
    'account_name',
    'first_name',
    'last_name',
    'job_title',
    'linkedin_url',
    'status',
    'list_name',
    'lead_score',
    'confidence_score',
    'consent_basis',
    'consent_recorded_at',
    'gdpr_opt_out',
    'email',
    'phone',
    'invited_at',
    'accepted_at',
    'messaged_at',
    'created_at',
    'updated_at',
];

router.get('/leads', async (req: Request, res: Response) => {
    try {
        const parsed = ExportLeadsQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            handleApiError(res, parsed.error, 'api.export.leads.validation');
            return;
        }
        const { format, status, listName } = parsed.data;
        const limit = Math.min(parsed.data.limit ?? 500, 500);

        const db = await getDatabase();

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (status) {
            conditions.push('status = ?');
            params.push(status);
        }
        if (listName) {
            conditions.push('list_name = ?');
            params.push(listName);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        params.push(limit);

        const rows = await db.query<LeadExportRow>(
            `SELECT id, account_name, first_name, last_name, job_title,
                    linkedin_url, status, list_name, lead_score, confidence_score,
                    consent_basis, consent_recorded_at, gdpr_opt_out,
                    email, phone, invited_at, accepted_at, messaged_at,
                    created_at, updated_at
             FROM leads ${whereClause}
             ORDER BY id ASC
             LIMIT ?`,
            params,
        );

        const requestIp = req.ip ?? req.socket?.remoteAddress ?? '';
        void recordSecurityAuditEvent({
            category: 'data_export',
            action: 'export_leads',
            actor: requestIp,
            result: 'ALLOW',
            metadata: { format, status: status ?? null, listName: listName ?? null, count: rows.length, limit },
        }).catch(() => null);

        if (format === 'csv') {
            const header = CSV_COLUMNS.join(',');
            const lines = rows.map((row) => CSV_COLUMNS.map((col) => escapeCsvField(row[col])).join(','));
            const csv = [header, ...lines].join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="leads_export_${new Date().toISOString().slice(0, 10)}.csv"`,
            );
            res.send(csv);
            return;
        }

        sendApiV1(res, { count: rows.length, leads: rows });
    } catch (err) {
        handleApiError(res, err, 'api.export.leads');
    }
});

router.get('/posts', async (_req: Request, res: Response) => {
    try {
        const db = await getDatabase();
        const rows = await db
            .query(
                `SELECT id, account_id, content, topic, source, model, status,
                    published_at, engagement_likes, engagement_comments,
                    created_at, updated_at
             FROM published_posts
             ORDER BY created_at DESC
             LIMIT 1000`,
            )
            .catch(() => []);
        sendApiV1(res, { count: rows.length, posts: rows });
    } catch (err) {
        handleApiError(res, err, 'api.export.posts');
    }
});

export default router;
