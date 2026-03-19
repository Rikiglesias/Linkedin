import { describe, it, expect } from 'vitest';
import { inferLeadSegment, inferLeadIndustry, inferCompanySize } from '../ml/segments';

describe('ml/segments — advanced', () => {
    describe('inferLeadSegment', () => {
        it('CEO → c_suite', () => {
            expect(inferLeadSegment('CEO')).toBe('c_level');
        });

        it('CTO → c_suite', () => {
            expect(inferLeadSegment('CTO')).toBe('c_level');
        });

        it('VP Sales → vp', () => {
            expect(inferLeadSegment('VP Sales')).toBe('director');
        });

        it('Head of Marketing → director', () => {
            expect(inferLeadSegment('Head of Marketing')).toBe('director');
        });

        it('Software Engineer → individual_contributor', () => {
            expect(inferLeadSegment('Software Engineer')).toBe('individual');
        });

        it('case insensitive', () => {
            expect(inferLeadSegment('ceo')).toBe(inferLeadSegment('CEO'));
        });
    });

    describe('inferLeadIndustry', () => {
        it('tech company → tech', () => {
            expect(inferLeadIndustry('Google', 'Software Developer')).toBe('tech');
        });

        it('null → unknown', () => {
            expect(inferLeadIndustry(null, null)).toBe('unknown');
        });

        it('stringa vuota → unknown', () => {
            expect(inferLeadIndustry('', '')).toBe('unknown');
        });
    });

    describe('inferCompanySize', () => {
        it('10 employees → startup', () => {
            expect(inferCompanySize(10)).toBe('startup');
        });

        it('200 employees → smb', () => {
            expect(inferCompanySize(200)).toBe('smb');
        });

        it('null → unknown', () => {
            expect(inferCompanySize(null)).toBe('unknown');
        });

        it('1000 employees → enterprise', () => {
            expect(inferCompanySize(1000)).toBe('enterprise');
        });
    });
});
