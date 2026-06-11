/**
 * tests/incidentClassification.vitest.ts
 * F3 ai-stack: classifyIncidentSource wired (era orfana e rotta: tabella `incidents` inesistente)
 * + repository PG-portabile. Verifica: soglie di classificazione, niente catch silenzioso,
 * arricchimento alert/liveEvent in quarantineAccount SENZA cambiare il fail-safe quarantena.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    countDistinctIncidentAccounts: vi.fn(),
    createIncident: vi.fn(async () => 42),
    setAccountQuarantine: vi.fn(async () => {}),
    pushOutboxEvent: vi.fn(async () => {}),
    recordSecurityAuditEvent: vi.fn(async () => {}),
    setAutomationPause: vi.fn(async () => null),
    clearAutomationPause: vi.fn(async () => {}),
    setRuntimeFlag: vi.fn(async () => {}),
    countRecentIncidents: vi.fn(async () => 0),
    broadcastCritical: vi.fn(async () => {}),
    broadcastWarning: vi.fn(async () => {}),
    publishLiveEvent: vi.fn(),
    bridgeAccountHealth: vi.fn(),
    logWarn: vi.fn(async () => {}),
}));

vi.mock('../core/repositories', () => ({
    countDistinctIncidentAccounts: mocks.countDistinctIncidentAccounts,
    createIncident: mocks.createIncident,
    setAccountQuarantine: mocks.setAccountQuarantine,
    pushOutboxEvent: mocks.pushOutboxEvent,
    recordSecurityAuditEvent: mocks.recordSecurityAuditEvent,
    setAutomationPause: mocks.setAutomationPause,
    clearAutomationPause: mocks.clearAutomationPause,
    setRuntimeFlag: mocks.setRuntimeFlag,
    countRecentIncidents: mocks.countRecentIncidents,
}));

vi.mock('../telemetry/logger', () => ({
    logWarn: mocks.logWarn,
    logInfo: vi.fn(async () => {}),
    logError: vi.fn(async () => {}),
}));

vi.mock('../telemetry/broadcaster', () => ({
    broadcastCritical: mocks.broadcastCritical,
    broadcastWarning: mocks.broadcastWarning,
}));

vi.mock('../telemetry/liveEvents', () => ({
    publishLiveEvent: mocks.publishLiveEvent,
}));

vi.mock('../cloud/cloudBridge', () => ({
    bridgeAccountHealth: mocks.bridgeAccountHealth,
}));

vi.mock('../core/leadStateService', () => ({
    reconcileLeadStatus: vi.fn(async () => {}),
}));

vi.mock('../security/redaction', () => ({
    sanitizeForLogs: (value: unknown) => value,
}));

vi.mock('../config', () => ({
    config: { challengePersistentGate: false, challengePauseMinutes: 60 },
}));

import { classifyIncidentSource, quarantineAccount } from '../risk/incidentManager';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.createIncident.mockResolvedValue(42);
});

describe('classifyIncidentSource — soglie', () => {
    it('3+ account distinti → platform_wide con DO sui selettori', async () => {
        mocks.countDistinctIncidentAccounts.mockResolvedValue({ count: 3, accounts: ['a', 'b', 'c'] });
        const result = await classifyIncidentSource('SELECTOR_FAILURE_BURST');
        expect(result.classification).toBe('platform_wide');
        expect(result.affectedAccounts).toBe(3);
        expect(result.recommendation).toContain('selettori');
    });

    it('1 account → account_specific con DO sull\'account', async () => {
        mocks.countDistinctIncidentAccounts.mockResolvedValue({ count: 1, accounts: ['a'] });
        const result = await classifyIncidentSource('LOGIN_MISSING');
        expect(result.classification).toBe('account_specific');
        expect(result.recommendation).toContain('account');
    });

    it('0 incident recenti → unknown', async () => {
        mocks.countDistinctIncidentAccounts.mockResolvedValue({ count: 0, accounts: [] });
        const result = await classifyIncidentSource('MAI_VISTO');
        expect(result.classification).toBe('unknown');
    });

    it('repository fallisce → unknown MA osservabile (logWarn, niente catch silenzioso)', async () => {
        mocks.countDistinctIncidentAccounts.mockRejectedValue(new Error('db down'));
        const result = await classifyIncidentSource('SELECTOR_FAILURE_BURST');
        expect(result.classification).toBe('unknown');
        expect(mocks.logWarn).toHaveBeenCalledWith(
            'incident.classification_failed',
            expect.objectContaining({ incidentType: 'SELECTOR_FAILURE_BURST', error: 'db down' }),
        );
    });
});

describe('quarantineAccount — wire della classificazione (fail-safe INVARIATO)', () => {
    it('alert CRITICAL include la recommendation (WHAT/WHY/DO) e liveEvent la classification', async () => {
        mocks.countDistinctIncidentAccounts.mockResolvedValue({ count: 3, accounts: ['a', 'b', 'c'] });
        await quarantineAccount('SELECTOR_FAILURE_BURST', { workflow: 'invites' });
        expect(mocks.broadcastCritical).toHaveBeenCalledWith(
            expect.stringContaining('SELECTOR_FAILURE_BURST'),
            expect.stringContaining('probabile cambiamento LinkedIn'),
            expect.anything(),
        );
        expect(mocks.publishLiveEvent).toHaveBeenCalledWith(
            'incident.opened',
            expect.objectContaining({ sourceClassification: 'platform_wide', affectedAccounts: 3 }),
        );
    });

    it('senza accountId la quarantena resta GLOBALE (default) — la classificazione non ammorbidisce', async () => {
        mocks.countDistinctIncidentAccounts.mockResolvedValue({ count: 1, accounts: ['default'] });
        await quarantineAccount('SELECTOR_FAILURE_BURST', { workflow: 'invites' });
        expect(mocks.setAccountQuarantine).toHaveBeenCalledWith('default', true);
    });

    it('con accountId la quarantena è per-account (G5-F2 invariato)', async () => {
        mocks.countDistinctIncidentAccounts.mockResolvedValue({ count: 1, accounts: ['acc-1'] });
        await quarantineAccount('LOGIN_MISSING', { accountId: 'acc-1' });
        expect(mocks.setAccountQuarantine).toHaveBeenCalledWith('acc-1', true);
    });

    it('classificazione fallita → quarantena e alert procedono comunque (best-effort)', async () => {
        mocks.countDistinctIncidentAccounts.mockRejectedValue(new Error('db down'));
        const incidentId = await quarantineAccount('SELECTOR_FAILURE_BURST', { workflow: 'invites' });
        expect(incidentId).toBe(42);
        expect(mocks.setAccountQuarantine).toHaveBeenCalledWith('default', true);
        expect(mocks.broadcastCritical).toHaveBeenCalled();
    });
});
