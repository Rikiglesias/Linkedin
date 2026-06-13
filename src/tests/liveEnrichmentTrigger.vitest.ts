import { beforeEach, describe, expect, test, vi } from 'vitest';

// vi.hoisted: le variabili usate nei factory di vi.mock (hoisted in cima al file) vanno
// inizializzate qui, altrimenti "Cannot access before initialization".
const { spawnMock, fsState, configState } = vi.hoisted(() => ({
    spawnMock: vi.fn(),
    fsState: { exists: false, content: '' },
    configState: { liveEnrichEnabled: true, liveEnrichConcurrency: 8, liveEnrichLimit: 200 },
}));

// Mock child_process.spawn: cattura le chiamate e restituisce un child fittizio.
vi.mock('child_process', () => ({ spawn: spawnMock }));

// Mock fs: lock file simulato in memoria (existsSync/readFileSync/writeFileSync/rmSync).
vi.mock('fs', () => ({
    existsSync: vi.fn(() => fsState.exists),
    readFileSync: vi.fn(() => fsState.content),
    writeFileSync: vi.fn((_path: string, data: string) => {
        fsState.content = data;
        fsState.exists = true;
    }),
    rmSync: vi.fn(() => {
        fsState.exists = false;
        fsState.content = '';
    }),
}));

vi.mock('../config', () => ({ config: configState }));
vi.mock('../telemetry/logger', () => ({ logInfo: vi.fn(), logWarn: vi.fn() }));

import { triggerLiveEnrichment } from '../integrations/liveEnrichmentTrigger';

function fakeChild(pid: number | undefined = 12345) {
    return { pid, on: vi.fn(), unref: vi.fn() };
}

describe('triggerLiveEnrichment', () => {
    beforeEach(() => {
        spawnMock.mockReset();
        spawnMock.mockReturnValue(fakeChild());
        fsState.exists = false;
        fsState.content = '';
        configState.liveEnrichEnabled = true;
    });

    test('no-op quando liveEnrichEnabled=false', () => {
        configState.liveEnrichEnabled = false;
        triggerLiveEnrichment('Lista A');
        expect(spawnMock).not.toHaveBeenCalled();
    });

    test('spawna una volta il comando enrich-live quando nessun lock è attivo', () => {
        triggerLiveEnrichment('Lista A');
        expect(spawnMock).toHaveBeenCalledTimes(1);
        const args = spawnMock.mock.calls[0]?.[1] as string[];
        expect(args).toContain('enrich-live');
        expect(args).toContain('--list');
        expect(args).toContain('Lista A');
    });

    test('NON spawna un duplicato se un live-enrichment è già in corso (lock attivo, PID vivo)', () => {
        // PID del processo di test stesso = sicuramente vivo; startedAt recente → lock attivo.
        fsState.exists = true;
        fsState.content = JSON.stringify({ pid: process.pid, startedAt: Date.now() });
        triggerLiveEnrichment('Lista A');
        expect(spawnMock).not.toHaveBeenCalled();
    });

    test('spawna se il lock è orfano (PID morto)', () => {
        fsState.exists = true;
        // PID inesistente → process.kill(pid, 0) lancia ESRCH → lock orfano → ri-spawn.
        fsState.content = JSON.stringify({ pid: 2147483640, startedAt: Date.now() });
        triggerLiveEnrichment('Lista A');
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    test('spawna se il lock è stale (startedAt troppo vecchio)', () => {
        fsState.exists = true;
        fsState.content = JSON.stringify({ pid: process.pid, startedAt: Date.now() - 60 * 60_000 });
        triggerLiveEnrichment('Lista A');
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });
});
