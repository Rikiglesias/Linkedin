import { describe, it, expect } from 'vitest';
import { generateClientReport, formatClientReportText } from '../telemetry/clientReport';

describe('clientReport — advanced edge cases', () => {
    it('hot leads → suggerimento risposta entro 24h', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 30,
            weeklyAcceptances: 10,
            weeklyMessagesSent: 20,
            weeklyReplies: 5,
            weeklyFollowUpsSent: 3,
            pendingRatio: 0.3,
            riskScore: 20,
            hotLeadsCount: 5,
            expiredInvitesCount: 0,
            accountHealth: 'GREEN',
        });
        expect(report.suggestions.some((s) => s.includes('lead caldi'))).toBe(true);
    });

    it('risk score alto → suggerimento rallentamento', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 50,
            weeklyAcceptances: 15,
            weeklyMessagesSent: 30,
            weeklyReplies: 8,
            weeklyFollowUpsSent: 5,
            pendingRatio: 0.4,
            riskScore: 55,
            hotLeadsCount: 0,
            expiredInvitesCount: 0,
            accountHealth: 'YELLOW',
        });
        expect(report.suggestions.some((s) => s.includes('Risk score'))).toBe(true);
    });

    it('account RED → suggerimento verifica manuale', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 10,
            weeklyAcceptances: 1,
            weeklyMessagesSent: 5,
            weeklyReplies: 0,
            weeklyFollowUpsSent: 1,
            pendingRatio: 0.8,
            riskScore: 70,
            hotLeadsCount: 0,
            expiredInvitesCount: 30,
            accountHealth: 'RED',
        });
        expect(report.suggestions.some((s) => s.includes('stato critico'))).toBe(true);
    });

    it('lista performance: migliore vs peggiore → suggerimento concentra budget', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 60,
            weeklyAcceptances: 20,
            weeklyMessagesSent: 40,
            weeklyReplies: 10,
            weeklyFollowUpsSent: 5,
            pendingRatio: 0.3,
            riskScore: 15,
            hotLeadsCount: 0,
            expiredInvitesCount: 0,
            accountHealth: 'GREEN',
            listBreakdown: [
                { name: 'Lista A', invitesSent: 30, acceptanceRate: 50 },
                { name: 'Lista B', invitesSent: 30, acceptanceRate: 10 },
            ],
        });
        expect(report.suggestions.some((s) => s.includes('performa 2x'))).toBe(true);
    });

    it('formatClientReportText con grade A → "Tutto procede bene"', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 50,
            weeklyAcceptances: 25,
            weeklyMessagesSent: 30,
            weeklyReplies: 12,
            weeklyFollowUpsSent: 5,
            pendingRatio: 0.2,
            riskScore: 10,
            hotLeadsCount: 0,
            expiredInvitesCount: 0,
            accountHealth: 'GREEN',
        });
        expect(report.overallGrade).toBe('A');
        expect(report.suggestions.length).toBe(0);
        const text = formatClientReportText(report);
        expect(text).toContain('Tutto procede bene');
    });

    it('acceptance rate eccellente → benchmark note positiva', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 50,
            weeklyAcceptances: 25,
            weeklyMessagesSent: 0,
            weeklyReplies: 0,
            weeklyFollowUpsSent: 0,
            pendingRatio: 0.2,
            riskScore: 10,
            hotLeadsCount: 0,
            expiredInvitesCount: 0,
            accountHealth: 'GREEN',
        });
        expect(report.benchmarkNotes.some((n) => n.includes('ECCELLENTE') || n.includes('BUONO'))).toBe(true);
    });
});
