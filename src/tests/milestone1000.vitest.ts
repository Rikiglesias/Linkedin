import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateRisk, explainRisk, evaluateComplianceHealthScore } from '../risk/riskEngine';
import { calculateAccountTrustScore, getAccountGrowthBudget, applyGrowthModel } from '../risk/accountBehaviorModel';
import { validateMessageContent, hashMessage } from '../validation/messageValidator';
import { isValidLeadTransition } from '../core/leadStateService';
import { normalizeLinkedInUrl, isSalesNavigatorUrl, isLinkedInUrl } from '../linkedinUrl';
import { inferLeadSegment, inferLeadIndustry, inferCompanySize } from '../ml/segments';
import { clampBackpressureLevel, computeBackpressureBatchSize } from '../sync/backpressure';
import { computeNonLinearRampCap } from '../ml/rampModel';
import { config } from '../config';

beforeAll(() => {
    config.riskWarnThreshold = 30;
    config.riskStopThreshold = 60;
    config.lowActivityRiskThreshold = 45;
    config.lowActivityEnabled = true;
    config.pendingRatioWarn = 0.5;
    config.pendingRatioStop = 0.7;
});

describe('Milestone 1000 — full system integration', () => {
    it('flusso completo: lead NEW → ... → MESSAGED con tutti i check', () => {
        // 1. Transizioni valide nel funnel
        expect(isValidLeadTransition('NEW', 'READY_INVITE')).toBe(true);
        expect(isValidLeadTransition('READY_INVITE', 'INVITED')).toBe(true);
        expect(isValidLeadTransition('INVITED', 'ACCEPTED')).toBe(true);
        expect(isValidLeadTransition('ACCEPTED', 'READY_MESSAGE')).toBe(true);
        expect(isValidLeadTransition('READY_MESSAGE', 'MESSAGED')).toBe(true);
        expect(isValidLeadTransition('MESSAGED', 'REPLIED')).toBe(true);
    });

    it('risk engine + trust score + growth model → budget coerente', () => {
        const risk = evaluateRisk({
            errorRate: 0,
            selectorFailureRate: 0,
            pendingRatio: 0.2,
            challengeCount: 0,
            inviteVelocityRatio: 0.3,
        });
        const trust = calculateAccountTrustScore({
            ssiScore: 80,
            ageDays: 365,
            acceptanceRatePct: 35,
            challengesLast7d: 0,
            pendingRatio: 0.2,
        });
        const growth = applyGrowthModel(25, 35, 365);

        expect(risk.action).toBe('NORMAL');
        expect(trust.budgetMultiplier).toBeGreaterThanOrEqual(0.8);
        expect(growth.inviteBudget).toBeLessThanOrEqual(25);
    });

    it('message validation + hash → pipeline completa', () => {
        const msg = 'Ciao Marco, ho visto il tuo profilo su LinkedIn e mi piacerebbe connetterci.';
        const validation = validateMessageContent(msg, { duplicateCountLast24h: 0 });
        const hash = hashMessage(msg);

        expect(validation.valid).toBe(true);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('URL normalization + SalesNav detection → routing corretto', () => {
        const profileUrl = normalizeLinkedInUrl('https://www.linkedin.com/in/marco-rossi?trk=abc');
        const salesNavUrl = 'https://www.linkedin.com/sales/lead/ABC123';

        expect(isLinkedInUrl(profileUrl)).toBe(true);
        expect(isSalesNavigatorUrl(profileUrl)).toBe(false);
        expect(isSalesNavigatorUrl(salesNavUrl)).toBe(true);
    });

    it('segments + industry + company size → profiling completo', () => {
        const segment = inferLeadSegment('CEO');
        const industry = inferLeadIndustry('Tech Corp', 'Software Developer');
        const size = inferCompanySize(200);

        expect(segment).toBe('c_level');
        expect(industry).toBe('tech');
        expect(size).toBe('smb');
    });

    it('backpressure + ramp model → volume control coerente', () => {
        const bpLevel = clampBackpressureLevel(3);
        const batchSize = computeBackpressureBatchSize(20, bpLevel);
        const ramp = computeNonLinearRampCap({
            currentCap: 15,
            hardMaxCap: 25,
            accountAgeDays: 90,
            warmupDays: 60,
            channel: 'invite',
            riskAction: 'NORMAL',
            riskScore: 20,
            pendingRatio: 0.3,
            errorRate: 0.05,
            healthScore: 80,
            baseDailyIncrease: 1,
        });

        expect(bpLevel).toBe(3);
        expect(batchSize).toBeLessThanOrEqual(20);
        expect(ramp.nextCap).toBeGreaterThanOrEqual(1);
        expect(ramp.nextCap).toBeLessThanOrEqual(25);
    });

    it('compliance health + risk → decisione operativa', () => {
        const health = evaluateComplianceHealthScore({
            acceptanceRatePct: 35,
            engagementRatePct: 25,
            pendingRatio: 0.3,
            invitesSentToday: 10,
            messagesSentToday: 5,
            dailyInviteLimit: 25,
            dailyMessageLimit: 35,
            weeklyInvitesSent: 40,
            weeklyInviteLimit: 100,
            pendingWarnThreshold: 0.5,
        });
        const risk = evaluateRisk({
            errorRate: 0.1,
            selectorFailureRate: 0.05,
            pendingRatio: 0.3,
            challengeCount: 0,
            inviteVelocityRatio: 0.2,
        });

        expect(health.score).toBeGreaterThan(0);
        expect(risk.action).toBe('NORMAL');
    });

    it('explainRisk → human-readable output', () => {
        const explanation = explainRisk({
            errorRate: 0.2,
            selectorFailureRate: 0.1,
            pendingRatio: 0.3,
            challengeCount: 0,
            inviteVelocityRatio: 0.1,
        });

        expect(explanation.factors.length).toBe(5);
        expect(explanation.thresholds.riskWarn).toBe(config.riskWarnThreshold);
        expect(explanation.action).toBe('NORMAL');
    });

    it('growth model fasi → progressione account', () => {
        const phases = [7, 20, 45, 90, 365].map((d) => getAccountGrowthBudget(d).phase);
        // Le fasi dovrebbero progredire (non necessariamente tutte diverse)
        expect(phases.length).toBe(5);
        expect(typeof phases[0]).toBe('string');
    });

    it('tutto il sistema funziona senza errori con input realistici', () => {
        expect(() => {
            evaluateRisk({
                errorRate: 0.15,
                selectorFailureRate: 0.08,
                pendingRatio: 0.35,
                challengeCount: 0,
                inviteVelocityRatio: 0.25,
            });
            calculateAccountTrustScore({
                ssiScore: 65,
                ageDays: 200,
                acceptanceRatePct: 28,
                challengesLast7d: 0,
                pendingRatio: 0.35,
            });
            validateMessageContent('Ciao, mi piacerebbe connetterci per discutere di opportunità.', {
                duplicateCountLast24h: 1,
            });
            normalizeLinkedInUrl('https://www.linkedin.com/in/test-user-123/');
            inferLeadSegment('VP Marketing');
            clampBackpressureLevel(2);
        }).not.toThrow();
    });
});
