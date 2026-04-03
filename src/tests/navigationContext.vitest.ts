import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../browser/humanBehavior', () => ({
    ensureVisualCursorOverlay: vi.fn(async () => undefined),
    ensureInputBlock: vi.fn(async () => undefined),
    humanDelay: vi.fn(async () => undefined),
    simulateHumanReading: vi.fn(async () => undefined),
}));

vi.mock('../browser/humanClick', () => ({
    clickLocatorHumanLike: vi.fn(async () => undefined),
}));

vi.mock('../salesnav/bulkSaveHelpers', () => ({
    isInputBlockSuspended: vi.fn(() => false),
}));

vi.mock('../telemetry/logger', () => ({
    logInfo: vi.fn(async () => undefined),
    logWarn: vi.fn(async () => undefined),
}));

import { clickLocatorHumanLike } from '../browser/humanClick';
import { navigateToProfileForMessage, navigateToProfileWithContext } from '../browser/navigationContext';

function createFakePage(targetVisible: boolean) {
    const gotoCalls: string[] = [];

    const createLocator = (selector: string) => ({
        first: () => createLocator(selector),
        nth: () => createLocator(selector),
        isVisible: async () => targetVisible && selector.includes('/in/'),
    });

    return {
        gotoCalls,
        page: {
            goto: async (url: string) => {
                gotoCalls.push(url);
                return null;
            },
            locator: (selector: string) => createLocator(selector),
            waitForURL: async () => undefined,
            waitForTimeout: async () => undefined,
        },
    };
}

describe('navigationContext anti-direct-profile policy', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    test('invite navigation non usa goto diretto al profilo quando i risultati search non trovano il target', async () => {
        const profileUrl = 'https://www.linkedin.com/in/mario-rossi/';
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
        const { page, gotoCalls } = createFakePage(false);

        const result = await navigateToProfileWithContext(
            page as never,
            profileUrl,
            { name: 'Mario Rossi', job_title: 'Marketing Manager', company: 'Acme' },
            'acc-1',
            0,
        );

        expect(result.success).toBe(false);
        expect(gotoCalls).not.toContain(profileUrl);
        expect(gotoCalls.some((url) => url.includes('/search/results/people/'))).toBe(true);
        randomSpy.mockRestore();
    });

    test('message navigation apre il profilo solo via search result click umano', async () => {
        const profileUrl = 'https://www.linkedin.com/in/giulia-bianchi/';
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);
        const { page, gotoCalls } = createFakePage(true);

        const result = await navigateToProfileForMessage(page as never, profileUrl, 'acc-2');

        expect(result.success).toBe(true);
        expect(gotoCalls).not.toContain(profileUrl);
        expect(gotoCalls.some((url) => url.includes('/search/results/people/'))).toBe(true);
        expect(clickLocatorHumanLike).toHaveBeenCalledTimes(1);
        randomSpy.mockRestore();
    });

    test('preferred direct strategy resta anti-teleport e passa dai risultati search', async () => {
        const profileUrl = 'https://www.linkedin.com/in/laura-verdi/';
        const { page, gotoCalls } = createFakePage(true);

        const result = await navigateToProfileForMessage(page as never, profileUrl, 'acc-3', 'direct');

        expect(result.success).toBe(true);
        expect(result.strategy).toBe('direct');
        expect(gotoCalls).not.toContain(profileUrl);
        expect(gotoCalls.some((url) => url.includes('/search/results/people/'))).toBe(true);
    });
});
