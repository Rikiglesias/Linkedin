import { beforeEach, describe, expect, test, vi } from 'vitest';

// Blinda il fix transientFailure (2026-06-13): il worker NON deve persistere (= marcare il lead come
// arricchito) quando l'enrichment fallisce per causa TRANSIENT (proxy esausto/timeout/circuit). Senza
// questo skip, i lead senza account_name verrebbero persi per sempre (non rientrano nella query di
// re-enrichment). I no-data VERI (senza transient) restano marcati (CC-23). Vedi improvements-proposed.

const { enrichLeadAutoMock, persistMock, getMock, incrementCapMock } = vi.hoisted(() => ({
    enrichLeadAutoMock: vi.fn(),
    persistMock: vi.fn(async () => undefined),
    getMock: vi.fn(),
    incrementCapMock: vi.fn(async () => undefined),
}));

vi.mock('../integrations/leadEnricher', () => ({ enrichLeadAuto: enrichLeadAutoMock }));
vi.mock('../integrations/persistEnrichment', () => ({ persistEnrichmentResult: persistMock }));
vi.mock('../db', () => ({ getDatabase: vi.fn(async () => ({ get: getMock })) }));
vi.mock('../integrations/enrichmentDailyCap', () => ({ incrementEnrichmentDailyCount: incrementCapMock }));
vi.mock('../telemetry/logger', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

import { processEnrichmentJob } from '../workers/enrichmentWorker';
import type { WorkerContext } from '../workers/context';

const LEAD_ROW = {
    id: 7,
    first_name: 'Jane',
    last_name: 'Roe',
    account_name: 'Acme',
    website: null,
    linkedin_url: null,
    company_domain: null,
    location: null,
    gdpr_opt_out: 0,
};

const CONTEXT = { dryRun: false, accountId: 'acc-test', localDate: '2026-06-13' } as unknown as WorkerContext;

const EMPTY_ENRICH = {
    email: null,
    phone: null,
    companyDomain: null,
    businessEmail: null,
    businessEmailConfidence: 0,
    emailConfidence: 0,
    companyName: null,
    industry: null,
    seniority: null,
    jobTitle: null,
    location: null,
    source: 'none',
    domainSource: null,
    deepEnrichment: null,
};

describe('processEnrichmentJob — skip persist su transientFailure', () => {
    beforeEach(() => {
        enrichLeadAutoMock.mockReset();
        persistMock.mockClear();
        getMock.mockReset();
        incrementCapMock.mockClear();
    });

    test('transientFailure=true → NON persiste (lead ri-tentabile), skip pulito', async () => {
        getMock.mockResolvedValueOnce(LEAD_ROW);
        enrichLeadAutoMock.mockResolvedValueOnce({ ...EMPTY_ENRICH, transientFailure: true });

        const res = await processEnrichmentJob({ leadId: 7 }, CONTEXT);

        expect(persistMock).not.toHaveBeenCalled();
        expect(res.success).toBe(true);
        expect(res.processedCount).toBe(0);
        // I transient NON consumano il daily cap (il lead sarà ri-tentato) — niente incremento.
        expect(incrementCapMock).not.toHaveBeenCalled();
    });

    test('enrichment riuscito → persiste normalmente', async () => {
        getMock.mockResolvedValueOnce(LEAD_ROW);
        enrichLeadAutoMock.mockResolvedValueOnce({
            ...EMPTY_ENRICH,
            email: 'jane@acme.com',
            businessEmail: 'jane@acme.com',
            source: 'apollo',
        });

        const res = await processEnrichmentJob({ leadId: 7 }, CONTEXT);

        expect(persistMock).toHaveBeenCalledTimes(1);
        expect(res.processedCount).toBe(1);
        // Enrichment completato → consuma 1 sul daily cap (passa context.localDate all'helper SSOT).
        expect(incrementCapMock).toHaveBeenCalledWith('2026-06-13');
    });

    test('no-data senza transient → persiste comunque (marca per evitare re-enrichment, CC-23)', async () => {
        getMock.mockResolvedValueOnce(LEAD_ROW);
        enrichLeadAutoMock.mockResolvedValueOnce({ ...EMPTY_ENRICH }); // transientFailure undefined

        const res = await processEnrichmentJob({ leadId: 7 }, CONTEXT);

        expect(persistMock).toHaveBeenCalledTimes(1);
        expect(res.processedCount).toBe(1);
        // Anche il no-data VERO persiste (CC-23) → completato → consuma 1 sul daily cap.
        expect(incrementCapMock).toHaveBeenCalledWith('2026-06-13');
    });
});
