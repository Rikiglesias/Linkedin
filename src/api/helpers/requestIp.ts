/**
 * api/helpers/requestIp.ts
 * ─────────────────────────────────────────────────────────────────
 * Utility condivisa per risolvere l'IP della request Express.
 * Unica fonte di verità — elimina duplicazione in server.ts,
 * controlActions.ts e controls.ts.
 */

import type { Request } from 'express';

function normalizeIp(rawIp: string): string {
    const trimmed = rawIp.trim();
    if (!trimmed) return '';
    if (trimmed === '::1') return '127.0.0.1';
    if (trimmed.startsWith('::ffff:')) return trimmed.slice('::ffff:'.length);
    return trimmed;
}

export function resolveRequestIp(req: Request): string {
    const fromExpress = normalizeIp(req.ip ?? '');
    if (fromExpress) return fromExpress;
    const fallback = req.socket?.remoteAddress ?? '';
    return normalizeIp(fallback);
}
