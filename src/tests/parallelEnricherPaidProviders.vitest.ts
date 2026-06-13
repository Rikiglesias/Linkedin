import { beforeEach, describe, expect, test, vi } from 'vitest';

// Verifica che il flag paidProviders (live enrichment = solo fonti gratuite) sia propagato
// dal motore parallelo fino a enrichLeadAuto, e che la diff-query a vuoto non arricchisca nulla.

// vi.hoisted: variabili usate nei factory di vi.mock (hoisted), inizializzate qui.
const { enrichLeadAutoMock, queryMock, runMock } = vi.hoisted(() => ({
    enrichLeadAutoMock: vi.fn(),
    queryMock: vi.fn(),
    runMock: vi.fn(async () => undefined),
}));

vi.mock('../integrations/leadEnricher', () => ({
    enrichLeadAuto: enrichLeadAutoMock,
}));

vi.mock('../db', () => ({
    getDatabase: vi.fn(async () => ({ query: queryMock, run: runMock })),
}));
vi.mock('../cloud/cloudBridge', () => ({ bridgeLeadUpsert: vi.fn() }));
vi.mock('../telemetry/logger', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

import { enrichLeadsParallel } from '../integrations/parallelEnricher';

const FAKE_LEAD = {
    id: 1,
    first_name: 'John',
    last_name: 'Doe',
    account_name: 'Acme',
    website: null,
    linkedin_url: null,
    company_domain: null,
    location: null,
};

describe('enrichLeadsParallel — propagazione paidProviders', () => {
    beforeEach(() => {
        enrichLeadAutoMock.mockReset();
        queryMock.mockReset();
        runMock.mockClear();
    });

    test('paidProviders=false è passato a enrichLeadAuto (live = solo fonti gratuite)', async () => {
        queryMock.mockResolvedValueOnce([FAKE_LEAD]);
        enrichLeadAutoMock.mockResolvedValueOnce({
            email: 'john@acme.com',
            phone: null,
            companyDomain: 'acme.com',
            jobTitle: null,
            businessEmail: 'john@acme.com',
            businessEmailConfidence: 80,
            emailConfidence: 80,
            source: 'email_guesser',
            enrichmentSources: { email: 'email_guesser' },
        });

        const report = await enrichLeadsParallel({ limit: 10, concurrency: 5, paidProviders: false });

        expect(enrichLeadAutoMock).toHaveBeenCalledWith(FAKE_LEAD, { paidProviders: false });
        expect(report.total).toBe(1);
        expect(report.enriched).toBe(1);
        expect(report.emailsFound).toBe(1);
    });

    test('default (nessun flag) = paidProviders undefined → comportamento invariato', async () => {
        queryMock.mockResolvedValueOnce([FAKE_LEAD]);
        enrichLeadAutoMock.mockResolvedValueOnce({
            email: null,
            phone: null,
            companyDomain: null,
            jobTitle: null,
            businessEmail: null,
            businessEmailConfidence: 0,
            emailConfidence: 0,
            source: 'none',
            enrichmentSources: {},
        });

        await enrichLeadsParallel({ limit: 10, concurrency: 5 });

        expect(enrichLeadAutoMock).toHaveBeenCalledWith(FAKE_LEAD, { paidProviders: undefined });
    });

    test('diff-query vuota → report a zero, enrichLeadAuto mai chiamato', async () => {
        queryMock.mockResolvedValueOnce([]);
        const report = await enrichLeadsParallel({ limit: 10, concurrency: 5, paidProviders: false });
        expect(report.total).toBe(0);
        expect(enrichLeadAutoMock).not.toHaveBeenCalled();
    });
});
