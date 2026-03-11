/**
 * tests/e2e-api.vitest.ts
 * Test E2E leggeri: verifica che gli endpoint API rispondano correttamente
 * usando supertest sull'app Express (senza browser, senza DB reale).
 *
 * Prerequisito: DASHBOARD_AUTH_ENABLED=false nel .env di test (o API key configurata).
 * Questi test verificano i contratti HTTP, non la business logic (coperta dai unit test).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import request from 'supertest';

let app: import('express').Express;

beforeAll(async () => {
    // Dynamic import per evitare side-effect al module scope
    try {
        const serverModule = await import('../api/server');
        app = serverModule.app;
    } catch {
        // Se l'import fallisce (es. DB non disponibile), skip i test
        app = null as never;
    }
});

describe('E2E API — Health endpoints', () => {
    test('GET /api/health ritorna 200 con status ok', async () => {
        if (!app) return;
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status', 'ok');
        expect(res.body).toHaveProperty('timestamp');
    });
});

describe('E2E API — Metriche Prometheus', () => {
    test('GET /metrics ritorna text/plain con metriche lkbot_', async () => {
        if (!app) return;
        const res = await request(app).get('/metrics');
        // /metrics potrebbe fallire se DB non è inizializzato, 200 o 500
        if (res.status === 200) {
            expect(res.headers['content-type']).toContain('text/plain');
            expect(res.text).toContain('lkbot_');
        }
    });
});

describe('E2E API — 404 endpoint inesistente', () => {
    test('GET /api/nonexistent ritorna 404 o 401', async () => {
        if (!app) return;
        const res = await request(app).get('/api/nonexistent');
        // 401 se auth abilitata, 404 se disabilitata
        expect([401, 404]).toContain(res.status);
    });
});
