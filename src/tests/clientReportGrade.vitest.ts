import { describe, it, expect } from 'vitest';
import { generateClientReport } from '../telemetry/clientReport';

const base = {
    weeklyInvitesSent: 40,
    weeklyAcceptances: 15,
    weeklyMessagesSent: 25,
    weeklyReplies: 8,
    weeklyFollowUpsSent: 5,
    pendingRatio: 0.3,
    riskScore: 20,
    hotLeadsCount: 0,
    expiredInvitesCount: 0,
    accountHealth: 'GREEN' as const,
};

describe('clientReport — grade calculation', () => {
    it('acceptance 50%+ response 25%+ risk<30 → A', () => {
        const r = generateClientReport({ ...base, weeklyAcceptances: 25, weeklyReplies: 10, riskScore: 15 });
        expect(r.overallGrade).toBe('A');
    });

    it('acceptance 30% risk<50 → B', () => {
        const r = generateClientReport({ ...base, weeklyAcceptances: 12, riskScore: 35 });
        expect(['A', 'B']).toContain(r.overallGrade);
    });

    it('acceptance 15% → C', () => {
        const r = generateClientReport({ ...base, weeklyAcceptances: 6, weeklyReplies: 2, riskScore: 55 });
        expect(['C', 'D']).toContain(r.overallGrade);
    });

    it('acceptance 5% → D', () => {
        const r = generateClientReport({
            ...base,
            weeklyInvitesSent: 100,
            weeklyAcceptances: 5,
            weeklyReplies: 1,
            riskScore: 70,
        });
        expect(r.overallGrade).toBe('D');
    });

    it('zero inviti → D (nessun dato)', () => {
        const r = generateClientReport({
            ...base,
            weeklyInvitesSent: 0,
            weeklyAcceptances: 0,
            weeklyMessagesSent: 0,
            weeklyReplies: 0,
        });
        expect(r.overallGrade).toBe('D');
    });

    it('benchmark notes non vuote con dati', () => {
        const r = generateClientReport(base);
        expect(r.benchmarkNotes.length).toBeGreaterThan(0);
    });

    it('summary contiene tutte le metriche chiave', () => {
        const r = generateClientReport(base);
        expect(r.summary).toContain('Inviti inviati');
        expect(r.summary).toContain('Accettati');
        expect(r.summary).toContain('Messaggi inviati');
        expect(r.summary).toContain('Risposte ricevute');
        expect(r.summary).toContain('Risk score');
    });

    it('lista breakdown con singola lista → nessun suggerimento concentra', () => {
        const r = generateClientReport({
            ...base,
            listBreakdown: [{ name: 'Unica', invitesSent: 40, acceptanceRate: 30 }],
        });
        expect(r.suggestions.every((s) => !s.includes('performa 2x'))).toBe(true);
    });
});
