import { describe, it, expect } from 'vitest';
import { generateClientReport, formatClientReportText } from '../telemetry/clientReport';

describe('clientReport — comprehensive final', () => {
    it('expired invites > 10 → suggerimento ritiro', () => {
        const r = generateClientReport({
            weeklyInvitesSent: 50,
            weeklyAcceptances: 15,
            weeklyMessagesSent: 20,
            weeklyReplies: 5,
            weeklyFollowUpsSent: 3,
            pendingRatio: 0.4,
            riskScore: 25,
            hotLeadsCount: 0,
            expiredInvitesCount: 15,
            accountHealth: 'GREEN',
        });
        expect(r.suggestions.some((s) => s.includes('scaduti'))).toBe(true);
    });

    it('response rate eccellente → benchmark positivo', () => {
        const r = generateClientReport({
            weeklyInvitesSent: 30,
            weeklyAcceptances: 10,
            weeklyMessagesSent: 20,
            weeklyReplies: 8,
            weeklyFollowUpsSent: 3,
            pendingRatio: 0.3,
            riskScore: 15,
            hotLeadsCount: 0,
            expiredInvitesCount: 0,
            accountHealth: 'GREEN',
        });
        expect(r.benchmarkNotes.some((n) => n.includes('BUONO') || n.includes('media'))).toBe(true);
    });

    it('acceptance rate basso → suggerimento migliorare profilo', () => {
        const r = generateClientReport({
            weeklyInvitesSent: 100,
            weeklyAcceptances: 10,
            weeklyMessagesSent: 30,
            weeklyReplies: 5,
            weeklyFollowUpsSent: 5,
            pendingRatio: 0.5,
            riskScore: 40,
            hotLeadsCount: 0,
            expiredInvitesCount: 0,
            accountHealth: 'YELLOW',
        });
        expect(r.benchmarkNotes.some((n) => n.includes('sotto') || n.includes('basso'))).toBe(true);
    });

    it('formatClientReportText contiene emoji', () => {
        const r = generateClientReport({
            weeklyInvitesSent: 30,
            weeklyAcceptances: 10,
            weeklyMessagesSent: 20,
            weeklyReplies: 5,
            weeklyFollowUpsSent: 3,
            pendingRatio: 0.3,
            riskScore: 20,
            hotLeadsCount: 0,
            expiredInvitesCount: 0,
            accountHealth: 'GREEN',
        });
        const text = formatClientReportText(r);
        expect(text).toContain('📊');
    });

    it('formatClientReportText con suggerimenti → contiene 💡', () => {
        const r = generateClientReport({
            weeklyInvitesSent: 50,
            weeklyAcceptances: 5,
            weeklyMessagesSent: 20,
            weeklyReplies: 1,
            weeklyFollowUpsSent: 3,
            pendingRatio: 0.7,
            riskScore: 60,
            hotLeadsCount: 3,
            expiredInvitesCount: 20,
            accountHealth: 'RED',
        });
        const text = formatClientReportText(r);
        expect(text).toContain('💡');
    });

    it('overallGrade è A, B, C o D', () => {
        const grades = ['A', 'B', 'C', 'D'];
        const r = generateClientReport({
            weeklyInvitesSent: 30,
            weeklyAcceptances: 10,
            weeklyMessagesSent: 20,
            weeklyReplies: 5,
            weeklyFollowUpsSent: 3,
            pendingRatio: 0.3,
            riskScore: 20,
            hotLeadsCount: 0,
            expiredInvitesCount: 0,
            accountHealth: 'GREEN',
        });
        expect(grades).toContain(r.overallGrade);
    });
});
