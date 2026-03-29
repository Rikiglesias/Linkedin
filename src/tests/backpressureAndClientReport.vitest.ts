import { describe, it, expect } from 'vitest';
import {
    clampBackpressureLevel,
    computeBackpressureBatchSize,
    computeNextBackpressureLevel,
} from '../sync/backpressure';
import { generateClientReport, formatClientReportText } from '../telemetry/clientReport';

describe('Backpressure (M20)', () => {
    it('clampBackpressureLevel clamps tra 1 e 8', () => {
        expect(clampBackpressureLevel(0)).toBe(1);
        expect(clampBackpressureLevel(1)).toBe(1);
        expect(clampBackpressureLevel(5)).toBe(5);
        expect(clampBackpressureLevel(8)).toBe(8);
        expect(clampBackpressureLevel(10)).toBe(8);
        expect(clampBackpressureLevel(NaN)).toBe(1);
        expect(clampBackpressureLevel(-5)).toBe(1);
    });

    it('computeBackpressureBatchSize riduce con livello alto', () => {
        const base = 20;
        expect(computeBackpressureBatchSize(base, 1)).toBe(20);
        expect(computeBackpressureBatchSize(base, 2)).toBe(10);
        expect(computeBackpressureBatchSize(base, 4)).toBe(5);
        expect(computeBackpressureBatchSize(base, 8)).toBe(2);
    });

    it('batch size mai < 1', () => {
        expect(computeBackpressureBatchSize(1, 8)).toBe(1);
        expect(computeBackpressureBatchSize(0, 1)).toBe(1);
    });

    it('livello scende con zero failure', () => {
        const next = computeNextBackpressureLevel({
            currentLevel: 5,
            sent: 10,
            failed: 0,
            permanentFailures: 0,
        });
        expect(next).toBe(4);
    });

    it('livello sale con failure', () => {
        const next = computeNextBackpressureLevel({
            currentLevel: 3,
            sent: 10,
            failed: 5,
            permanentFailures: 0,
        });
        expect(next).toBeGreaterThan(3);
    });

    it('livello sale di 2 con permanent failure', () => {
        const next = computeNextBackpressureLevel({
            currentLevel: 2,
            sent: 10,
            failed: 3,
            permanentFailures: 1,
        });
        expect(next).toBe(4);
    });

    it('livello invariato con zero sent e zero failed', () => {
        const next = computeNextBackpressureLevel({
            currentLevel: 3,
            sent: 0,
            failed: 0,
            permanentFailures: 0,
        });
        expect(next).toBe(3);
    });
});

describe('Client Report (A15)', () => {
    it('genera report con buone metriche → grade A o B', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 50,
            weeklyAcceptances: 20,
            weeklyMessagesSent: 30,
            weeklyReplies: 10,
            weeklyFollowUpsSent: 5,
            pendingRatio: 0.3,
            riskScore: 20,
            hotLeadsCount: 3,
            expiredInvitesCount: 2,
            accountHealth: 'GREEN',
        });
        expect(['A', 'B']).toContain(report.overallGrade);
        expect(report.summary).toContain('Inviti inviati: 50');
        expect(report.benchmarkNotes.length).toBeGreaterThan(0);
    });

    it('genera report con metriche scarse → grade C o D', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 100,
            weeklyAcceptances: 5,
            weeklyMessagesSent: 50,
            weeklyReplies: 2,
            weeklyFollowUpsSent: 10,
            pendingRatio: 0.7,
            riskScore: 60,
            hotLeadsCount: 0,
            expiredInvitesCount: 20,
            accountHealth: 'RED',
        });
        expect(['C', 'D']).toContain(report.overallGrade);
        expect(report.suggestions.length).toBeGreaterThan(0);
    });

    it('suggerisce ritiro inviti se pending alto', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 50,
            weeklyAcceptances: 10,
            weeklyMessagesSent: 20,
            weeklyReplies: 5,
            weeklyFollowUpsSent: 3,
            pendingRatio: 0.6,
            riskScore: 30,
            hotLeadsCount: 0,
            expiredInvitesCount: 15,
            accountHealth: 'YELLOW',
        });
        expect(report.suggestions.some((s) => s.includes('Pending ratio'))).toBe(true);
    });

    it('zero attività → suggerimento verifica bot', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 0,
            weeklyAcceptances: 0,
            weeklyMessagesSent: 0,
            weeklyReplies: 0,
            weeklyFollowUpsSent: 0,
            pendingRatio: 0,
            riskScore: 0,
            hotLeadsCount: 0,
            expiredInvitesCount: 0,
            accountHealth: 'GREEN',
        });
        expect(report.suggestions.some((s) => s.includes('Nessuna attività'))).toBe(true);
    });

    it('formatClientReportText produce testo leggibile', () => {
        const report = generateClientReport({
            weeklyInvitesSent: 30,
            weeklyAcceptances: 10,
            weeklyMessagesSent: 20,
            weeklyReplies: 8,
            weeklyFollowUpsSent: 5,
            pendingRatio: 0.3,
            riskScore: 15,
            hotLeadsCount: 2,
            expiredInvitesCount: 0,
            accountHealth: 'GREEN',
        });
        const text = formatClientReportText(report);
        expect(text).toContain('Report Settimanale');
        expect(text).toContain('Benchmark');
        expect(text.length).toBeGreaterThan(100);
    });
});
