import { describe, it, expect } from 'vitest';
import { suggestConfigProfile, CONFIG_PROFILES } from '../config/schema';

describe('suggestConfigProfile — exhaustive boundaries', () => {
    it('0 giorni, 0 connessioni → conservative', () => expect(suggestConfigProfile(0, 0)).toBe('conservative'));
    it('89 giorni, 499 connessioni → conservative', () => expect(suggestConfigProfile(89, 499)).toBe('conservative'));
    it('90 giorni, 500 connessioni → moderate', () => expect(suggestConfigProfile(90, 500)).toBe('moderate'));
    it('364 giorni, 2999 connessioni → moderate', () => expect(suggestConfigProfile(364, 2999)).toBe('moderate'));
    it('365 giorni, 3000 connessioni → aggressive', () => expect(suggestConfigProfile(365, 3000)).toBe('aggressive'));
    it('1000 giorni, 10000 connessioni → aggressive', () => expect(suggestConfigProfile(1000, 10000)).toBe('aggressive'));
    it('365 giorni, 500 connessioni → moderate (connessioni basse)', () => expect(suggestConfigProfile(365, 500)).toBe('moderate'));
    it('30 giorni, 5000 connessioni → conservative (giorni bassi)', () => expect(suggestConfigProfile(30, 5000)).toBe('conservative'));
});

describe('CONFIG_PROFILES — internal consistency', () => {
    it('conservative.caps.followUpMax <= aggressive.caps.followUpMax', () => {
        expect(CONFIG_PROFILES.conservative.caps.followUpMax).toBeLessThanOrEqual(CONFIG_PROFILES.aggressive.caps.followUpMax);
    });

    it('conservative.timing.challengePauseMinutes >= aggressive.timing.challengePauseMinutes', () => {
        expect(CONFIG_PROFILES.conservative.timing.challengePauseMinutes)
            .toBeGreaterThanOrEqual(CONFIG_PROFILES.aggressive.timing.challengePauseMinutes);
    });

    it('moderate è tra conservative e aggressive per hardInviteCap', () => {
        expect(CONFIG_PROFILES.moderate.caps.hardInviteCap)
            .toBeGreaterThanOrEqual(CONFIG_PROFILES.conservative.caps.hardInviteCap);
        expect(CONFIG_PROFILES.moderate.caps.hardInviteCap)
            .toBeLessThanOrEqual(CONFIG_PROFILES.aggressive.caps.hardInviteCap);
    });

    it('moderate è tra conservative e aggressive per riskStopThreshold', () => {
        expect(CONFIG_PROFILES.moderate.risk.riskStopThreshold)
            .toBeGreaterThanOrEqual(CONFIG_PROFILES.conservative.risk.riskStopThreshold);
        expect(CONFIG_PROFILES.moderate.risk.riskStopThreshold)
            .toBeLessThanOrEqual(CONFIG_PROFILES.aggressive.risk.riskStopThreshold);
    });
});
