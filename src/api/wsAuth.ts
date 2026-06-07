/**
 * wsAuth.ts
 * ─────────────────────────────────────────────────────────────────
 * Autenticazione per il WebSocket /ws della dashboard.
 *
 * Estratto da server.ts per testabilita' (la helper e' di sicurezza: un bypass aprirebbe
 * lo stream live a chiunque) e per evitare di importare l'intero server monolitico nei test.
 *
 * L'handshake WebSocket espone un http.IncomingMessage (NON un Express Request), quindi non si
 * possono riusare isApiKeyAuthValid/isBasicAuthValid di server.ts (che usano req.header()).
 */

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from '../config';

/** Confronto timing-safe: stessa primitiva usata dall'auth HTTP in server.ts. Esportata per riuso (es. /metrics). */
export function secureEquals(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    if (aBuffer.length !== bBuffer.length) return false;
    return timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Decide se la connessione WebSocket e' autorizzata.
 * Accetta: token via query (?token=), Bearer/x-api-key header (vs dashboardApiKey) oppure
 * Basic auth header (vs dashboardBasicUser/Password). Fail-closed: nessun match -> false.
 */
export function isWebSocketAuthorized(req: IncomingMessage): boolean {
    const apiKey = config.dashboardApiKey;
    const authorization = (req.headers.authorization ?? '').toString();

    if (apiKey) {
        // 1. token via query param (il client browser non puo' settare header sul WS)
        const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
        const token = url.searchParams.get('token') ?? '';
        if (token.length > 0 && secureEquals(token, apiKey)) return true;
        // 2. x-api-key header
        const apiKeyHeader = (req.headers['x-api-key'] ?? '').toString();
        if (apiKeyHeader && secureEquals(apiKeyHeader.trim(), apiKey)) return true;
        // 3. Bearer header
        if (authorization.toLowerCase().startsWith('bearer ')) {
            const bearer = authorization.slice('bearer '.length).trim();
            if (bearer.length > 0 && secureEquals(bearer, apiKey)) return true;
        }
    }

    // 4. Basic auth header (dashboard protetta solo da basic-auth, senza apiKey configurata)
    if (
        config.dashboardBasicUser &&
        config.dashboardBasicPassword &&
        authorization.toLowerCase().startsWith('basic ')
    ) {
        const encoded = authorization.slice('basic '.length).trim();
        if (encoded) {
            try {
                const decoded = Buffer.from(encoded, 'base64').toString('utf8');
                const idx = decoded.indexOf(':');
                if (idx > 0) {
                    const user = decoded.slice(0, idx);
                    const password = decoded.slice(idx + 1);
                    if (
                        secureEquals(user, config.dashboardBasicUser) &&
                        secureEquals(password, config.dashboardBasicPassword)
                    ) {
                        return true;
                    }
                }
            } catch {
                return false;
            }
        }
    }

    return false;
}
