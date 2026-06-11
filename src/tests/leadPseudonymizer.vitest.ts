import { describe, it, expect } from 'vitest';
import {
    pseudonymizeLead,
    coarseRegion,
    distillChatSignals,
    normalizeSeniority,
} from '../ai/leadPseudonymizer';

// F0.5 ai-stack: la garanzia meccanica della regola d'oro — l'output del
// pseudonymizer non contiene MAI i valori PII di input (property test).

const PII_LEAD = {
    title: 'Chief Technology Officer',
    company: 'Acme S.p.A.',
    score: 87,
    location: 'Via Roma 1, 20121 Milano, Italia',
    seniority: 'C-Suite Executive Leadership',
    industry: 'Information Technology & Services',
    email: 'mario.rossi@acme.com',
    businessEmail: 'm.rossi@acme-corp.it',
    phone: '+393331234567',
};

const PII_SENTINELS = [
    'Acme S.p.A.',
    'Acme',
    'mario.rossi@acme.com',
    'm.rossi@acme-corp.it',
    '+393331234567',
    'Via Roma 1',
    '20121',
    'Information Technology & Services',
    'C-Suite Executive Leadership',
];

describe('pseudonymizeLead — property anti-PII (regola d\'oro)', () => {
    it('l\'output serializzato non contiene alcun valore PII di input', () => {
        const features = pseudonymizeLead(PII_LEAD, {
            connectionDegree: '2nd',
            hasConnectButton: true,
        });
        const serialized = JSON.stringify(features);
        for (const sentinel of PII_SENTINELS) {
            expect(serialized).not.toContain(sentinel);
        }
    });

    it('i campi categoriali appartengono ai vocabolari chiusi', () => {
        const features = pseudonymizeLead(PII_LEAD, { connectionDegree: '2nd', hasConnectButton: true });
        expect(['c_level', 'founder', 'director', 'manager', 'individual', 'unknown']).toContain(features.segment);
        expect([
            'tech',
            'finance',
            'healthcare',
            'education',
            'manufacturing',
            'retail',
            'consulting',
            'nonprofit',
            'other',
            'unknown',
        ]).toContain(features.industry);
        expect([undefined, 'c_suite', 'vp', 'director', 'manager', 'senior', 'entry']).toContain(features.seniority);
        expect([undefined, '1st', '2nd', '3rd_plus']).toContain(features.connectionDegree);
    });

    it('estrae i segnali giusti: CTO Acme tech, email/phone boolean, score numerico', () => {
        const features = pseudonymizeLead(PII_LEAD);
        expect(features.segment).toBe('c_level');
        expect(features.industry).toBe('tech');
        expect(features.seniority).toBe('c_suite');
        expect(features.leadScore).toBe(87);
        expect(features.hasVerifiedEmail).toBe(true);
        expect(features.hasPhone).toBe(true);
        expect(features.region).toBe('Italia');
    });

    it('lead undefined → feature unknown senza crash', () => {
        const features = pseudonymizeLead(undefined);
        expect(features.segment).toBe('unknown');
        expect(features.industry).toBe('unknown');
        expect(features.hasVerifiedEmail).toBe(false);
        expect(features.hasPhone).toBe(false);
        expect(features.region).toBeUndefined();
        expect(features.seniority).toBeUndefined();
    });

    it('enrichment industry free-text alimenta l\'inferenza senza uscire raw', () => {
        const features = pseudonymizeLead({
            title: 'Analyst',
            company: 'XYZ Holding',
            industry: 'Investment Banking & Financial Services',
        });
        expect(features.industry).toBe('finance');
        expect(JSON.stringify(features)).not.toContain('Investment Banking');
        expect(JSON.stringify(features)).not.toContain('XYZ');
    });
});

describe('coarseRegion — edge cases', () => {
    it('location standard → ultima componente (paese)', () => {
        expect(coarseRegion('Milano, Lombardia, Italia')).toBe('Italia');
    });

    it('senza virgola e alfabetica → emessa (città-level coarse, dichiarato)', () => {
        expect(coarseRegion('Germany')).toBe('Germany');
    });

    it('componente con cifre (CAP/civico) → scartata', () => {
        expect(coarseRegion('Via Roma 1, 20121 Milano')).toBeUndefined();
        expect(coarseRegion('20121 Milano')).toBeUndefined();
    });

    it('vuota/undefined/troppo lunga → undefined', () => {
        expect(coarseRegion('')).toBeUndefined();
        expect(coarseRegion(undefined)).toBeUndefined();
        expect(coarseRegion(null)).toBeUndefined();
        expect(coarseRegion('a, una componente decisamente troppo lunga per essere un paese reale')).toBeUndefined();
        expect(coarseRegion('x, one two three four')).toBeUndefined();
    });
});

describe('distillChatSignals — tag reali THEM:/ME: (chatMessageExtractor)', () => {
    it('ultimo messaggio del lead → lastFrom lead, replied true', () => {
        const signals = distillChatSignals(['ME: ciao Mario, piacere', 'THEM: ciao! volentieri sentiamoci']);
        expect(signals).toEqual({ messageCount: 2, lastFrom: 'lead', leadHasReplied: true });
    });

    it('ultimo messaggio nostro senza risposte → lastFrom us, replied false', () => {
        const signals = distillChatSignals(['ME: primo messaggio', 'ME: reminder']);
        expect(signals).toEqual({ messageCount: 2, lastFrom: 'us', leadHasReplied: false });
    });

    it('messaggi senza tag → lastFrom unknown, comunque contati', () => {
        const signals = distillChatSignals(['testo senza prefisso']);
        expect(signals).toEqual({ messageCount: 1, lastFrom: 'unknown', leadHasReplied: false });
    });

    it('vuoto/undefined → undefined', () => {
        expect(distillChatSignals([])).toBeUndefined();
        expect(distillChatSignals(undefined)).toBeUndefined();
    });
});

describe('normalizeSeniority — whitelist chiusa con precedenza', () => {
    it('match noti', () => {
        expect(normalizeSeniority('C-Suite')).toBe('c_suite');
        expect(normalizeSeniority('Vice President of Sales')).toBe('vp');
        expect(normalizeSeniority('Head of Engineering')).toBe('director');
        expect(normalizeSeniority('senior manager')).toBe('manager'); // manager prima di senior nella precedenza
        expect(normalizeSeniority('Senior Developer')).toBe('senior');
        expect(normalizeSeniority('Junior Analyst')).toBe('entry');
    });

    it('free-text sconosciuto → undefined (mai stringa raw)', () => {
        expect(normalizeSeniority('Esperto Verticale di Nicchia')).toBeUndefined();
        expect(normalizeSeniority('')).toBeUndefined();
        expect(normalizeSeniority(undefined)).toBeUndefined();
    });
});
