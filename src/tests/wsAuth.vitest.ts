import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage } from 'node:http';

// T6: il WebSocket /ws deve richiedere auth ogni volta che la dashboard auth e' attiva, NON solo
// quando e' configurata un'apiKey. Prima, con basic-auth-only (apiKey vuota), il guard veniva
// saltato e /ws restava aperto a chiunque (fail-open).

const h = vi.hoisted(() => ({
    config: { dashboardApiKey: '', dashboardBasicUser: '', dashboardBasicPassword: '' },
}));
vi.mock('../config', () => ({ config: h.config }));

import { isWebSocketAuthorized } from '../api/wsAuth';

function req(opts: { url?: string; headers?: Record<string, string> }): IncomingMessage {
    return { url: opts.url ?? '/ws', headers: { host: 'localhost', ...(opts.headers ?? {}) } } as unknown as IncomingMessage;
}

function basic(user: string, pass: string): string {
    return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

describe('isWebSocketAuthorized (T6)', () => {
    beforeEach(() => {
        h.config.dashboardApiKey = '';
        h.config.dashboardBasicUser = '';
        h.config.dashboardBasicPassword = '';
    });

    test('apiKey: token query corretto → autorizzato', () => {
        h.config.dashboardApiKey = 'sekret';
        expect(isWebSocketAuthorized(req({ url: '/ws?token=sekret' }))).toBe(true);
    });

    test('apiKey: token query errato senza altri header → negato', () => {
        h.config.dashboardApiKey = 'sekret';
        expect(isWebSocketAuthorized(req({ url: '/ws?token=wrong' }))).toBe(false);
    });

    test('apiKey: header x-api-key corretto → autorizzato', () => {
        h.config.dashboardApiKey = 'sekret';
        expect(isWebSocketAuthorized(req({ headers: { 'x-api-key': 'sekret' } }))).toBe(true);
    });

    test('apiKey: header Bearer corretto → autorizzato', () => {
        h.config.dashboardApiKey = 'sekret';
        expect(isWebSocketAuthorized(req({ headers: { authorization: 'Bearer sekret' } }))).toBe(true);
    });

    test('BUG T6: basic-auth-only (apiKey vuota) con Basic header corretto → autorizzato', () => {
        h.config.dashboardBasicUser = 'admin';
        h.config.dashboardBasicPassword = 'pw';
        expect(isWebSocketAuthorized(req({ headers: { authorization: basic('admin', 'pw') } }))).toBe(true);
    });

    test('basic-auth-only con credenziali errate → negato', () => {
        h.config.dashboardBasicUser = 'admin';
        h.config.dashboardBasicPassword = 'pw';
        expect(isWebSocketAuthorized(req({ headers: { authorization: basic('admin', 'nope') } }))).toBe(false);
    });

    test('basic-auth-only senza header → negato (no fail-open)', () => {
        h.config.dashboardBasicUser = 'admin';
        h.config.dashboardBasicPassword = 'pw';
        expect(isWebSocketAuthorized(req({}))).toBe(false);
    });

    test('nessuna credenziale configurata + header presenti → negato', () => {
        expect(isWebSocketAuthorized(req({ headers: { authorization: basic('x', 'y') } }))).toBe(false);
        expect(isWebSocketAuthorized(req({ url: '/ws?token=anything' }))).toBe(false);
    });
});
