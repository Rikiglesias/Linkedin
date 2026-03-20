import { describe, it, expect } from 'vitest';
import { inferLeadIndustry, inferCompanySize, inferLeadSegment } from '../ml/segments';

describe('ml/segments — industry inference', () => {
    it('software/tech keyword → tech', () => expect(inferLeadIndustry('Tech Startup', 'Software Developer')).toBe('tech'));
    it('healthcare keyword → healthcare', () => expect(inferLeadIndustry('Health Systems', 'Healthcare Manager')).toBe('healthcare'));
    it('finance keyword → finance', () => expect(inferLeadIndustry('Finance Corp', 'Financial Analyst')).toBe('finance'));
    it('consulting keyword → consulting or other', () => {
        const result = inferLeadIndustry('Consulting Group', 'Management Consultant');
        expect(['consulting', 'other']).toContain(result);
    });
    it('unknown company → other or unknown', () => {
        const result = inferLeadIndustry('XYZ Random Corp', 'Manager');
        expect(['other', 'unknown']).toContain(result);
    });
});

describe('ml/segments — company size', () => {
    it('1 employee → startup', () => expect(inferCompanySize(1)).toBe('startup'));
    it('50 employees → startup', () => expect(inferCompanySize(50)).toBe('startup'));
    it('51 employees → smb', () => expect(inferCompanySize(51)).toBe('smb'));
    it('500 employees → smb', () => expect(inferCompanySize(500)).toBe('smb'));
    it('501 employees → enterprise', () => expect(inferCompanySize(501)).toBe('enterprise'));
    it('0 employees → unknown', () => expect(inferCompanySize(0)).toBe('unknown'));
    it('undefined → unknown', () => expect(inferCompanySize(undefined)).toBe('unknown'));
});

describe('ml/segments — inferLeadSegment comprehensive', () => {
    it('Director → director', () => expect(inferLeadSegment('Director of Engineering')).toBe('director'));
    it('Manager → manager', () => expect(inferLeadSegment('Project Manager')).toBe('manager'));
    it('Founder → c_level', () => expect(inferLeadSegment('Founder & CEO')).toBe('c_level'));
    it('null → unknown', () => expect(inferLeadSegment(null)).toBe('unknown'));
    it('undefined → unknown', () => expect(inferLeadSegment(undefined)).toBe('unknown'));
    it('stringa vuota → unknown', () => expect(inferLeadSegment('')).toBe('unknown'));
    it('solo spazi → unknown', () => expect(inferLeadSegment('   ')).toBe('unknown'));
});
