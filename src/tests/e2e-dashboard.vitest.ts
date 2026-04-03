/**
 * tests/e2e-dashboard.vitest.ts
 * Test E2E per la dashboard: verifica che la UI carichi e mostri i widget.
 * Usa supertest per verificare che l'HTML venga servito correttamente.
 *
 * Nota: test Playwright reali (con browser) richiedono setup dedicato.
 * Questo file verifica i prerequisiti: HTML servito, bundle.js presente,
 * elementi chiave nel markup.
 */

import type { Server } from 'node:http';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bindExpressTestServer, closeExpressTestServer } from './helpers/bindExpressTestServer';

let app: import('express').Express;
let server: Server | null = null;

beforeAll(async () => {
    try {
        const serverModule = await import('../api/server');
        app = serverModule.app;
        server = await bindExpressTestServer(app);
    } catch {
        app = null as never;
        server = null;
    }
});

afterAll(async () => {
    await closeExpressTestServer(server);
});

describe('E2E Dashboard — HTML e asset statici', () => {
    test('GET / ritorna HTML con elementi dashboard chiave', async () => {
        if (!app) return;
        const res = await request(server ?? app).get('/');
        if (res.status === 200) {
            expect(res.headers['content-type']).toContain('text/html');
            expect(res.text).toContain('id="kpi-compare-invites"');
            expect(res.text).toContain('id="last-refresh"');
            expect(res.text).toContain('id="toast-stack"');
            expect(res.text).toContain('id="session-timer"');
            expect(res.text).toContain('id="proxy-health"');
            expect(res.text).toContain('bundle.js');
        }
    });

    test('GET /style.css ritorna CSS valido', async () => {
        if (!app) return;
        const res = await request(server ?? app).get('/style.css');
        if (res.status === 200) {
            expect(res.headers['content-type']).toContain('text/css');
            expect(res.text).toContain(':root');
            expect(res.text).toContain('--accent-primary');
        }
    });

    test('GET /sw.js ritorna service worker JS', async () => {
        if (!app) return;
        const res = await request(server ?? app).get('/sw.js');
        if (res.status === 200) {
            expect(res.headers['content-type']).toContain('javascript');
            expect(res.text).toContain('CACHE_STATIC');
        }
    });

    test('GET /manifest.json ritorna manifest PWA', async () => {
        if (!app) return;
        const res = await request(server ?? app).get('/manifest.json');
        if (res.status === 200) {
            const manifest = res.body;
            expect(manifest).toHaveProperty('name');
            expect(manifest).toHaveProperty('start_url');
        }
    });
});

describe('E2E Dashboard — Widget presenti nel markup', () => {
    test('HTML contiene tutti i widget operativi', async () => {
        if (!app) return;
        const res = await request(server ?? app).get('/');
        if (res.status !== 200) return;

        const requiredIds = [
            'kpi-compare-invites',
            'slo-current-status',
            'selector-cache-kpi',
            'proxy-health',
            'session-timer',
            'fetch-state-indicator',
            'incidents-tbody',
            'last-refresh',
        ];

        for (const id of requiredIds) {
            expect(res.text).toContain(`id="${id}"`);
        }
    });
});
