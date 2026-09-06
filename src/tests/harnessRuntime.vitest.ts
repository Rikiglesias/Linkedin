/**
 * harnessRuntime.vitest.ts — C28: le parti PURE del runtime condiviso degli harness.
 *
 * Il runtime (harnessRuntime.ts) è ciò che rende gli harness `harness:*` isolati e osservabili:
 * decide quali richieste sono locali, compone il JSON finale e mappa il JSON su un exit code.
 * Qui si provano queste decisioni senza browser; il browser vero lo esercita `npm run harness:all`.
 */
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { buildHarnessSummary, harnessExitCode, isLocalRequestUrl, type HarnessCounters } from './harnessRuntime';

const TMP = os.tmpdir();

function counters(over: Partial<HarnessCounters> = {}): HarnessCounters {
    return {
        externalRequests: 0,
        blockedAttempts: 0,
        localhostRequests: 3,
        pagesLoaded: 1,
        controlBlockedAttempts: 1,
        ...over,
    };
}

const paths = {
    sessionDir: path.join(TMP, 'harness-session-x'),
    dbPath: path.join(TMP, 'harness-db-x', 'linkedin_bot.sqlite'),
};

describe('isLocalRequestUrl', () => {
    it('accetta solo 127.0.0.1 / localhost / [::1] e gli schemi senza rete', () => {
        expect(isLocalRequestUrl('http://127.0.0.1:4567/fixture.html')).toBe(true);
        expect(isLocalRequestUrl('http://localhost:4567/x')).toBe(true);
        expect(isLocalRequestUrl('http://[::1]:4567/x')).toBe(true);
        expect(isLocalRequestUrl('about:blank')).toBe(true);
        expect(isLocalRequestUrl('data:text/html,ciao')).toBe(true);
    });

    it('rifiuta ogni host esterno, LinkedIn compreso', () => {
        expect(isLocalRequestUrl('https://www.linkedin.com/feed/')).toBe(false);
        expect(isLocalRequestUrl('https://127.0.0.1.evil.example/')).toBe(false);
        expect(isLocalRequestUrl('http://10.0.0.5/')).toBe(false);
        expect(isLocalRequestUrl('non-un-url')).toBe(false);
    });
});

describe('buildHarnessSummary', () => {
    it('espone i contatori con i nomi del contratto C28 e i path effettivi', () => {
        const s = buildHarnessSummary('dom', counters(), paths);
        expect(s).toEqual({
            harness: 'dom',
            external_requests: 0,
            blocked_attempts: 0,
            localhost_requests: 3,
            pages_loaded: 1,
            session_dir: paths.sessionDir,
            db_path: paths.dbPath,
            control: { blocked_attempts: 1 },
        });
    });
});

describe('harnessExitCode', () => {
    it('0 quando tutto è nell atteso', () => {
        expect(harnessExitCode(buildHarnessSummary('dom', counters(), paths), 0)).toBe(0);
    });

    it('2 (sonda rotta) se nessuna richiesta locale o nessuna pagina caricata', () => {
        expect(harnessExitCode(buildHarnessSummary('dom', counters({ localhostRequests: 0 }), paths), 0)).toBe(2);
        expect(harnessExitCode(buildHarnessSummary('dom', counters({ pagesLoaded: 0 }), paths), 0)).toBe(2);
    });

    it('1 se una misura fallisce, se esce una richiesta esterna, o se il control-case non viene bloccato', () => {
        expect(harnessExitCode(buildHarnessSummary('dom', counters(), paths), 1)).toBe(1);
        expect(harnessExitCode(buildHarnessSummary('dom', counters({ externalRequests: 1 }), paths), 0)).toBe(1);
        expect(harnessExitCode(buildHarnessSummary('dom', counters({ blockedAttempts: 1 }), paths), 0)).toBe(1);
        expect(harnessExitCode(buildHarnessSummary('dom', counters({ controlBlockedAttempts: 0 }), paths), 0)).toBe(1);
    });

    it('1 se sessionDir o dbPath non sono in tmpdir o puntano ai dati reali', () => {
        const reali = {
            sessionDir: path.resolve('data', 'session'),
            dbPath: path.resolve('data', 'linkedin_bot.sqlite'),
        };
        expect(harnessExitCode(buildHarnessSummary('dom', counters(), reali), 0)).toBe(1);
        expect(harnessExitCode(buildHarnessSummary('dom', counters(), { ...paths, sessionDir: path.resolve('data', 'session') }), 0)).toBe(1);
    });
});
