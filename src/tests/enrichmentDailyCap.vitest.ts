import { beforeEach, describe, expect, test, vi } from 'vitest';

// Blinda l'SSOT del daily cap enrichment (incrementEnrichmentDailyCount): la chiave è
// enrichment_count:${localDate} (combacia col reader scheduler), l'incremento è +1, e un errore
// di scrittura NON propaga (best-effort → non deve far fallire un enrichment già persistito).

const { getRuntimeFlagMock, setRuntimeFlagMock, logWarnMock } = vi.hoisted(() => ({
    getRuntimeFlagMock: vi.fn(async () => '0'),
    setRuntimeFlagMock: vi.fn(async () => undefined),
    logWarnMock: vi.fn(async () => undefined),
}));

vi.mock('../core/repositories', () => ({ getRuntimeFlag: getRuntimeFlagMock, setRuntimeFlag: setRuntimeFlagMock }));
vi.mock('../config', () => ({ getLocalDateString: () => '2026-06-13' }));
vi.mock('../telemetry/logger', () => ({ logWarn: logWarnMock }));

import { incrementEnrichmentDailyCount } from '../integrations/enrichmentDailyCap';

describe('incrementEnrichmentDailyCount — SSOT daily cap enrichment', () => {
    beforeEach(() => {
        getRuntimeFlagMock.mockClear();
        getRuntimeFlagMock.mockResolvedValue('0');
        setRuntimeFlagMock.mockClear();
        logWarnMock.mockClear();
    });

    test('localDate esplicito → legge e scrive enrichment_count:<date> incrementato di 1', async () => {
        getRuntimeFlagMock.mockResolvedValueOnce('4');
        await incrementEnrichmentDailyCount('2026-06-10');
        expect(getRuntimeFlagMock).toHaveBeenCalledWith('enrichment_count:2026-06-10');
        expect(setRuntimeFlagMock).toHaveBeenCalledWith('enrichment_count:2026-06-10', '5');
    });

    test('senza localDate → usa getLocalDateString() (stessa chiave del reader scheduler)', async () => {
        await incrementEnrichmentDailyCount();
        expect(setRuntimeFlagMock).toHaveBeenCalledWith('enrichment_count:2026-06-13', '1');
    });

    test('counter assente (null) → parte da 0 → scrive 1', async () => {
        getRuntimeFlagMock.mockResolvedValueOnce(null as unknown as string);
        await incrementEnrichmentDailyCount('2026-06-10');
        expect(setRuntimeFlagMock).toHaveBeenCalledWith('enrichment_count:2026-06-10', '1');
    });

    test('best-effort: un errore di scrittura NON propaga (logWarn, nessun throw)', async () => {
        setRuntimeFlagMock.mockRejectedValueOnce(new Error('db down'));
        await expect(incrementEnrichmentDailyCount('2026-06-10')).resolves.toBeUndefined();
        expect(logWarnMock).toHaveBeenCalledWith(
            'enrichment.cap_increment_failed',
            expect.objectContaining({ error: 'db down' }),
        );
    });
});
