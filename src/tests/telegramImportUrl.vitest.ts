import { describe, test, expect, vi } from 'vitest';

// Ondata-1: la validazione URL Sales Navigator passava da includes('linkedin.com/sales')
// (aggirabile con sottodomini/path) a new URL() + hostname esatto.

// Mock delle dipendenze pesanti per non caricare il browser stack importando il modulo.
vi.mock('../core/salesNavigatorSync', () => ({ runSalesNavigatorListSync: vi.fn() }));
vi.mock('../telemetry/alerts', () => ({ sendTelegramAlert: vi.fn() }));
vi.mock('../config', () => ({ config: {} }));

import { isSalesNavigatorUrl } from '../cloud/telegramAiImporter';

describe('isSalesNavigatorUrl (T-telegram-import)', () => {
    test('URL Sales Navigator validi → true', () => {
        expect(isSalesNavigatorUrl('https://www.linkedin.com/sales/lists/people/123')).toBe(true);
        expect(isSalesNavigatorUrl('https://linkedin.com/sales/lead/abc')).toBe(true);
        expect(isSalesNavigatorUrl('http://www.linkedin.com/sales/search')).toBe(true);
    });

    test('host malevolo che contiene la stringa → false (non piu aggirabile)', () => {
        expect(isSalesNavigatorUrl('https://evil.com/linkedin.com/sales')).toBe(false);
        expect(isSalesNavigatorUrl('https://www.linkedin.com.evil.com/sales')).toBe(false);
    });

    test('linkedin.com ma path non /sales → false', () => {
        expect(isSalesNavigatorUrl('https://www.linkedin.com/in/john')).toBe(false);
    });

    test('non-URL → false (no crash)', () => {
        expect(isSalesNavigatorUrl('not a url')).toBe(false);
        expect(isSalesNavigatorUrl('')).toBe(false);
    });
});
