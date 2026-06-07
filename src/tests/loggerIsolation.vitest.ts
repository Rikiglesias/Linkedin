import { describe, test, expect, vi, beforeEach } from 'vitest';

// Ondata-1: il logger non deve propagare il fallimento della scrittura DB (recordRunLog).
// Prima un errore di recordRunLog rompeva publishLiveEvent e il chiamante.

const h = vi.hoisted(() => ({
    recordRunLog: vi.fn(),
    publishLiveEvent: vi.fn(),
    getCorrelationId: vi.fn(),
    captureError: vi.fn(),
}));

vi.mock('../core/repositories/system', () => ({ recordRunLog: h.recordRunLog }));
vi.mock('../telemetry/liveEvents', () => ({ publishLiveEvent: h.publishLiveEvent }));
vi.mock('../telemetry/correlation', () => ({ getCorrelationId: h.getCorrelationId }));
vi.mock('../telemetry/sentry', () => ({ captureError: h.captureError }));

import { logInfo } from '../telemetry/logger';

describe('logger isola il fallimento di recordRunLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.getCorrelationId.mockReturnValue(undefined);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    test('recordRunLog che lancia non propaga e publishLiveEvent gira comunque', async () => {
        h.recordRunLog.mockRejectedValue(new Error('DB down'));

        await expect(logInfo('test.event', { a: 1 })).resolves.toBeUndefined();
        expect(h.publishLiveEvent).toHaveBeenCalledWith('run.log', expect.objectContaining({ event: 'test.event' }));
    });
});
