import { describe, it, expect } from 'vitest';
import { buildFollowUpMessage } from '../messages';
import type { LeadRecord } from '../types/domain';

// ─── Helper: minimal LeadRecord builder ──────────────────────────────────────

function makeLead(overrides: Partial<LeadRecord> = {}): LeadRecord {
    return {
        id: 1,
        account_name: 'Acme Corp',
        first_name: 'Marco',
        last_name: 'Rossi',
        job_title: 'CEO',
        website: 'https://acme.com',
        linkedin_url: 'https://linkedin.com/in/marco-rossi',
        status: 'ACCEPTED',
        list_name: 'default',
        invited_at: null,
        accepted_at: null,
        messaged_at: null,
        last_error: null,
        blocked_reason: null,
        about: null,
        experience: null,
        invite_prompt_variant: null,
        lead_score: null,
        confidence_score: null,
        created_at: '2026-01-01',
        updated_at: null,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// buildFollowUpMessage — template resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildFollowUpMessage', () => {
    it('contiene il firstName del lead', () => {
        const msg = buildFollowUpMessage(makeLead({ first_name: 'Luca' }));
        expect(msg).toContain('Luca');
    });

    it('contiene il company hint (account_name)', () => {
        // Il template con id%3=1 usa {{companyHint}}
        const msg = buildFollowUpMessage(makeLead({ id: 1, account_name: 'TestCorp' }));
        expect(msg).toContain('TestCorp');
    });

    it('first_name vuoto → fallback a prima parola di account_name', () => {
        const msg = buildFollowUpMessage(makeLead({ first_name: '', account_name: 'Giovanni SRL' }));
        expect(msg).toContain('Giovanni');
    });

    it('first_name vuoto + account_name tutto MAIUSCOLO → fallback "there"', () => {
        const msg = buildFollowUpMessage(makeLead({ first_name: '', account_name: 'ACME' }));
        expect(msg).toContain('there');
    });

    it('first_name con spazi → trim', () => {
        const msg = buildFollowUpMessage(makeLead({ first_name: '  Anna  ' }));
        expect(msg).toContain('Anna');
        expect(msg).not.toContain('  Anna');
    });

    it('account_name vuoto + website → usa website come company hint', () => {
        const msg = buildFollowUpMessage(makeLead({ id: 1, account_name: '', website: 'https://example.com' }));
        expect(msg).toContain('example.com');
    });

    it('account_name vuoto + website vuoto → fallback generico IT', () => {
        const msg = buildFollowUpMessage(makeLead({ id: 1, account_name: '', website: '' }));
        expect(msg).toContain('la tua realtà');
    });

    it('lingua inglese → template EN', () => {
        const msg = buildFollowUpMessage(makeLead({ first_name: 'John' }), 'en');
        expect(msg).toMatch(/Hi|great to connect|thanks for connecting|nice to be/i);
    });

    it('lingua francese → template FR', () => {
        const msg = buildFollowUpMessage(makeLead({ first_name: 'Pierre' }), 'fr');
        expect(msg).toContain('Bonjour');
    });

    it('lingua spagnola → template ES', () => {
        const msg = buildFollowUpMessage(makeLead({ first_name: 'Carlos' }), 'es');
        expect(msg).toContain('Hola');
    });

    it('lingua tedesca → template DE', () => {
        const msg = buildFollowUpMessage(makeLead({ first_name: 'Hans' }), 'de');
        expect(msg).toContain('Hallo');
    });

    it('lingua olandese → template NL', () => {
        const msg = buildFollowUpMessage(makeLead({ first_name: 'Jan' }), 'nl');
        expect(msg).toContain('Hoi');
    });

    it('lingua sconosciuta → fallback IT', () => {
        const msg = buildFollowUpMessage(makeLead({ first_name: 'Test' }), 'jp');
        expect(msg).toMatch(/Ciao|piacere|grazie/);
    });

    it('template selection deterministica per lead ID', () => {
        const lead = makeLead({ id: 42 });
        const msg1 = buildFollowUpMessage(lead);
        const msg2 = buildFollowUpMessage(lead);
        expect(msg1).toBe(msg2);
    });

    it('lead ID diversi → possono dare template diversi', () => {
        const messages = new Set<string>();
        for (let i = 0; i < 6; i++) {
            messages.add(buildFollowUpMessage(makeLead({ id: i })));
        }
        // Con 3 template IT e 6 ID, ci aspettiamo almeno 2 messaggi diversi
        expect(messages.size).toBeGreaterThanOrEqual(2);
    });

    it('company hint EN fallback → "your company"', () => {
        const msg = buildFollowUpMessage(makeLead({ id: 1, account_name: '', website: '' }), 'en');
        expect(msg).toContain('your company');
    });

    it('company hint FR fallback → "votre entreprise"', () => {
        const msg = buildFollowUpMessage(makeLead({ id: 1, account_name: '', website: '' }), 'fr');
        expect(msg).toContain('votre entreprise');
    });

    it('messaggio non vuoto per qualsiasi combinazione', () => {
        const langs = ['it', 'en', 'fr', 'es', 'de', 'nl', undefined];
        for (const lang of langs) {
            const msg = buildFollowUpMessage(makeLead(), lang);
            expect(msg.length).toBeGreaterThan(50);
        }
    });

    it('nessun placeholder irrisolto nel messaggio', () => {
        const langs = ['it', 'en', 'fr', 'es', 'de', 'nl'];
        for (const lang of langs) {
            for (let id = 0; id < 6; id++) {
                const msg = buildFollowUpMessage(makeLead({ id }), lang);
                expect(msg).not.toContain('{{');
                expect(msg).not.toContain('}}');
            }
        }
    });
});
