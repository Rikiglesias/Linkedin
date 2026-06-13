import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { persistStickyProxy, loadPersistedStickyProxy } from '../proxyManager';
import { recordSuccessfulAuth } from '../browser/sessionCookieMonitor';

// SEC5: la password del proxy sticky NON deve più essere persistita in chiaro in `.session-meta.json`.
// L'identità (server+username+type+weekNumber) resta per ri-matchare la entry ESATTA del pool al riuso;
// la password viene ri-derivata dal pool/config (getStickyProxy), mai letta dal disco.
describe('proxy sticky persistence (SEC5: no password su disco)', () => {
    let sessionDir: string;

    const proxy = {
        server: 'http://gw.oxylabs.io:7777',
        username: 'customer-acme-cc-IT-sessid-abc123',
        password: 'super-secret-pw',
        type: 'mobile' as const,
    };

    beforeEach(() => {
        sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sticky-meta-'));
    });

    afterEach(() => {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    });

    test('persistStickyProxy NON scrive la password nel file', () => {
        persistStickyProxy(sessionDir, proxy, 42);
        const raw = fs.readFileSync(path.join(sessionDir, '.session-meta.json'), 'utf8');
        expect(raw).not.toContain('super-secret-pw');
        expect(raw).not.toContain('password');
        // L'identità del proxy sticky resta (serve a ri-matchare la entry del pool).
        expect(JSON.parse(raw).stickyProxy).toEqual({
            server: proxy.server,
            username: proxy.username,
            type: 'mobile',
            weekNumber: 42,
        });
    });

    test('loadPersistedStickyProxy ritorna l identità senza password', () => {
        persistStickyProxy(sessionDir, proxy, 42);
        const loaded = loadPersistedStickyProxy(sessionDir);
        expect(loaded).toEqual({
            server: proxy.server,
            username: proxy.username,
            type: 'mobile',
            weekNumber: 42,
        });
        expect(loaded).not.toHaveProperty('password');
    });

    test('retro-compat: un file vecchio con password in chiaro NON la espone al load', () => {
        // File scritto dal codice PRE-SEC5 (password su disco): il load la ignora completamente.
        const metaPath = path.join(sessionDir, '.session-meta.json');
        fs.writeFileSync(
            metaPath,
            JSON.stringify({
                stickyProxy: {
                    server: proxy.server,
                    username: proxy.username,
                    password: 'legacy-pw-on-disk',
                    type: 'mobile',
                    weekNumber: 7,
                },
            }),
            'utf8',
        );
        const loaded = loadPersistedStickyProxy(sessionDir);
        expect(loaded).not.toHaveProperty('password');
        expect(loaded?.server).toBe(proxy.server);
        expect(loaded?.username).toBe(proxy.username);
        expect(loaded?.weekNumber).toBe(7);
    });

    test('il primo re-persist ripulisce la password di un file legacy', () => {
        const metaPath = path.join(sessionDir, '.session-meta.json');
        fs.writeFileSync(
            metaPath,
            JSON.stringify({ stickyProxy: { ...proxy, weekNumber: 7 } }),
            'utf8',
        );
        persistStickyProxy(sessionDir, proxy, 8);
        const raw = fs.readFileSync(metaPath, 'utf8');
        expect(raw).not.toContain('super-secret-pw');
        expect(JSON.parse(raw).stickyProxy.weekNumber).toBe(8);
    });

    test('persist preserva le altre chiavi del meta (non sovrascrive il file intero)', () => {
        const metaPath = path.join(sessionDir, '.session-meta.json');
        fs.writeFileSync(metaPath, JSON.stringify({ cookieMeta: { lastVerifiedAt: 'x' } }), 'utf8');
        persistStickyProxy(sessionDir, proxy, 1);
        const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        expect(parsed.cookieMeta).toEqual({ lastVerifiedAt: 'x' });
        expect(parsed.stickyProxy.server).toBe(proxy.server);
    });

    test('server o weekNumber assenti → load ritorna null', () => {
        const metaPath = path.join(sessionDir, '.session-meta.json');
        fs.writeFileSync(metaPath, JSON.stringify({ stickyProxy: { server: proxy.server } }), 'utf8');
        expect(loadPersistedStickyProxy(sessionDir)).toBeNull();
    });

    test('sessionDir undefined → no-op (persist) e null (load)', () => {
        expect(() => persistStickyProxy(undefined, proxy, 1)).not.toThrow();
        expect(loadPersistedStickyProxy(undefined)).toBeNull();
    });

    test('recordSuccessfulAuth (writeMeta) NON cancella lo stickyProxy persistito (AB-2)', () => {
        // Path runtime reale: persist sticky → un checkLogin OK scrive il meta cookie. Prima del fix
        // writeMeta sovrascriveva il file cancellando stickyProxy → AB-2 non sopravviveva ai riavvii.
        persistStickyProxy(sessionDir, proxy, 42);
        recordSuccessfulAuth(sessionDir, 'orchestrator', 'cookiehash123');

        // Lo sticky proxy deve sopravvivere alla scrittura del meta cookie.
        const loaded = loadPersistedStickyProxy(sessionDir);
        expect(loaded?.server).toBe(proxy.server);
        expect(loaded?.weekNumber).toBe(42);

        // …e il meta cookie è stato comunque scritto (entrambe le chiavi coesistono nel file).
        const parsed = JSON.parse(fs.readFileSync(path.join(sessionDir, '.session-meta.json'), 'utf8'));
        expect(parsed.lastVerifiedBy).toBe('orchestrator');
        expect(parsed.cookieHash).toBe('cookiehash123');
        expect(parsed.stickyProxy.server).toBe(proxy.server);
        // La password resta fuori dal disco anche dopo il giro completo (invariante SEC5).
        expect(fs.readFileSync(path.join(sessionDir, '.session-meta.json'), 'utf8')).not.toContain('super-secret-pw');
    });
});
