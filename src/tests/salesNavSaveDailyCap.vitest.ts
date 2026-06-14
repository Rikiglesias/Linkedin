import { beforeEach, describe, expect, test, vi } from 'vitest';

// Blinda l'SSOT del daily cap save SalesNav (T4): chiave salesnav_saves_count:${localDate},
// incremento di +amount (i lead salvati), best-effort (un errore di scrittura NON propaga), e
// isSalesNavSaveDailyCapReached opt-in (cap 0 = disabilitato → sempre false).

const { getRuntimeFlagMock, setRuntimeFlagMock, logWarnMock, configMock } = vi.hoisted(() => ({
    getRuntimeFlagMock: vi.fn(async () => '0'),
    setRuntimeFlagMock: vi.fn(async () => undefined),
    logWarnMock: vi.fn(async () => undefined),
    configMock: { salesNavSyncMaxSavesPerDay: 0 },
}));

vi.mock('../core/repositories', () => ({ getRuntimeFlag: getRuntimeFlagMock, setRuntimeFlag: setRuntimeFlagMock }));
vi.mock('../config', () => ({ getLocalDateString: () => '2026-06-13', config: configMock }));
vi.mock('../telemetry/logger', () => ({ logWarn: logWarnMock }));

import {
    incrementSalesNavSaveDailyCount,
    getSalesNavSaveDailyCount,
    isSalesNavSaveDailyCapReached,
} from '../salesnav/salesNavSaveDailyCap';

describe('salesNavSaveDailyCap — SSOT daily cap save SalesNav', () => {
    beforeEach(() => {
        getRuntimeFlagMock.mockClear();
        getRuntimeFlagMock.mockResolvedValue('0');
        setRuntimeFlagMock.mockClear();
        logWarnMock.mockClear();
        configMock.salesNavSyncMaxSavesPerDay = 0;
    });

    test('increment con localDate esplicito → legge e scrive salesnav_saves_count:<date> += amount', async () => {
        getRuntimeFlagMock.mockResolvedValueOnce('4');
        await incrementSalesNavSaveDailyCount(5, '2026-06-10');
        expect(getRuntimeFlagMock).toHaveBeenCalledWith('salesnav_saves_count:2026-06-10');
        expect(setRuntimeFlagMock).toHaveBeenCalledWith('salesnav_saves_count:2026-06-10', '9');
    });

    test('increment senza localDate → usa getLocalDateString()', async () => {
        await incrementSalesNavSaveDailyCount(3);
        expect(setRuntimeFlagMock).toHaveBeenCalledWith('salesnav_saves_count:2026-06-13', '3');
    });

    test('amount <= 0 → no-op (non scrive)', async () => {
        await incrementSalesNavSaveDailyCount(0, '2026-06-10');
        await incrementSalesNavSaveDailyCount(-2, '2026-06-10');
        expect(setRuntimeFlagMock).not.toHaveBeenCalled();
    });

    test('counter assente (null) → parte da 0', async () => {
        getRuntimeFlagMock.mockResolvedValueOnce(null as unknown as string);
        await incrementSalesNavSaveDailyCount(7, '2026-06-10');
        expect(setRuntimeFlagMock).toHaveBeenCalledWith('salesnav_saves_count:2026-06-10', '7');
    });

    test('best-effort: errore di scrittura NON propaga (logWarn, nessun throw)', async () => {
        setRuntimeFlagMock.mockRejectedValueOnce(new Error('db down'));
        await expect(incrementSalesNavSaveDailyCount(1, '2026-06-10')).resolves.toBeUndefined();
        expect(logWarnMock).toHaveBeenCalledWith(
            'salesnav_save.cap_increment_failed',
            expect.objectContaining({ error: 'db down' }),
        );
    });

    test('getSalesNavSaveDailyCount → parsea il flag (0 se assente)', async () => {
        getRuntimeFlagMock.mockResolvedValueOnce('42');
        expect(await getSalesNavSaveDailyCount('2026-06-10')).toBe(42);
        getRuntimeFlagMock.mockResolvedValueOnce(null as unknown as string);
        expect(await getSalesNavSaveDailyCount('2026-06-10')).toBe(0);
    });

    test('isSalesNavSaveDailyCapReached: cap 0 (disabilitato) → sempre false, non legge il flag', async () => {
        configMock.salesNavSyncMaxSavesPerDay = 0;
        expect(await isSalesNavSaveDailyCapReached('2026-06-10')).toBe(false);
        expect(getRuntimeFlagMock).not.toHaveBeenCalled();
    });

    test('isSalesNavSaveDailyCapReached: cap attivo e count >= cap → true; count < cap → false', async () => {
        configMock.salesNavSyncMaxSavesPerDay = 100;
        getRuntimeFlagMock.mockResolvedValueOnce('100');
        expect(await isSalesNavSaveDailyCapReached('2026-06-10')).toBe(true);
        getRuntimeFlagMock.mockResolvedValueOnce('99');
        expect(await isSalesNavSaveDailyCapReached('2026-06-10')).toBe(false);
    });
});
