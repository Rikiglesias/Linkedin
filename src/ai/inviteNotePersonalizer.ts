import { config } from '../config';
import { LeadRecord } from '../types/domain';
import { logWarn } from '../telemetry/logger';
import { requestOpenAIText } from './openaiClient';
import { SemanticChecker } from './semanticChecker';

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface TemplateNoteResult {
    note: string;
    variant: string;
}

export interface PersonalizedInviteNoteResult {
    note: string;
    source: 'template' | 'ai';
    model: string | null;
    variant: string | null;
}

// ─── Template base (ex noteGenerator.ts) ─────────────────────────────────────

const NOTE_TEMPLATES: ReadonlyArray<{ variant: string; render: (firstName: string) => string }> = [
    { variant: 'TPL_CASUAL_INTEREST', render: (n) => `Ciao ${n}, ho trovato il tuo profilo interessante e mi piacerebbe aggiungerti alla mia rete. A presto!` },
    { variant: 'TPL_PROFESSIONAL_FOLLOW', render: (n) => `Ciao ${n}, seguo il tuo lavoro con interesse. Sarebbe un piacere connetterci!` },
    { variant: 'TPL_COMMON_INTERESTS', render: (n) => `Salve ${n}, ho visto il tuo profilo e penso potremmo avere interessi in comune. Ti aggiungo volentieri!` },
    { variant: 'TPL_NETWORK_EXPANSION', render: (n) => `Ciao ${n}, mi piacerebbe connettermi con te per ampliare la mia rete professionale. Buona giornata!` },
    { variant: 'TPL_BACKGROUND_APPRECIATION', render: (n) => `Ciao ${n}, ho apprezzato il tuo background professionale. Sarebbe bello entrare in contatto!` },
    { variant: 'TPL_ATTENTION_GRABBER', render: (n) => `Salve ${n}, il tuo profilo ha attirato la mia attenzione. Ti propongo di connetterci!` },
    { variant: 'TPL_MUTUAL_BENEFIT', render: (n) => `Ciao ${n}, credo che possiamo trarre reciproco beneficio da questa connessione. A presto!` },
    { variant: 'TPL_LIKE_MINDED', render: (n) => `Ciao ${n}, mi farebbe piacere allargare la mia rete con professionisti come te. Collegati con me!` },
];

/**
 * Genera una nota di invito da template (pseudo-casuale).
 * Usabile standalone o come fallback AI.
 */
export function generateInviteNote(firstName: string): TemplateNoteResult {
    const name = firstName.trim() || 'collega';
    const index = Math.floor(Math.random() * NOTE_TEMPLATES.length);
    const selected = NOTE_TEMPLATES[index] ?? NOTE_TEMPLATES[0];
    if (!selected) return { note: `Ciao ${name}`, variant: 'TPL_FALLBACK' };
    return { note: selected.render(name), variant: selected.variant };
}

const INVITE_NOTE_MAX_CHARS = 300;

function trimToMaxChars(input: string, maxChars: number = INVITE_NOTE_MAX_CHARS): string {
    const normalized = input.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxChars) return normalized;
    return normalized.slice(0, maxChars).trim();
}

function safeFirstName(lead: LeadRecord): string {
    const value = (lead.first_name ?? '').trim();
    if (value) return value;
    return 'collega';
}

export async function buildPersonalizedInviteNote(lead: LeadRecord): Promise<PersonalizedInviteNoteResult> {
    const tplResult = generateInviteNote(lead.first_name ?? '');
    const templateText = trimToMaxChars(tplResult.note, INVITE_NOTE_MAX_CHARS);

    if (config.inviteNoteMode !== 'ai' || !config.openaiApiKey) {
        return {
            note: templateText,
            source: 'template',
            model: null,
            variant: tplResult.variant,
        };
    }

    // Varianti Prompt A/B Testing
    const isVariantB = Math.random() > 0.5;
    const variantId = isVariantB ? 'AI_VAR_B_VALUE' : 'AI_VAR_A_DIRECT';

    let systemPrompt = '';

    if (isVariantB) {
        systemPrompt = [
            'Sei un top performer del social selling B2B su LinkedIn.',
            'Crea una brevissima nota di connessione (max 2 frasi) estraendo valore dal profilo dell\'utente.',
            'Fai una leva specifica su qualcosa del suo About o Experience per dimostrare che hai letto il profilo.',
            `Massimo ${INVITE_NOTE_MAX_CHARS} caratteri.`,
            'Non vendere nulla, cerca solo di avviare una conversazione interessante.',
            'Niente emoji, niente ciao generici.'
        ].join(' ');
    } else {
        systemPrompt = [
            'Sei un assistant B2B per inviti LinkedIn in italiano.',
            'Genera una singola nota breve, sincera e genuina (1-2 frasi).',
            `Massimo ${INVITE_NOTE_MAX_CHARS} caratteri.`,
            'Tono professionale ma colloquiale (non troppo formale). Niente link, niente emoji.',
        ].join(' ');
    }

    const userData: Record<string, string> = {
        firstName: safeFirstName(lead),
        company: lead.account_name ?? '',
        role: lead.job_title ?? '',
    };

    if (lead.about) userData.aboutProfile = lead.about;
    if (lead.experience) userData.experienceProfile = lead.experience;

    const userPrompt = JSON.stringify(userData);

    let finalNote = '';
    let attempt = 0;
    const baseTemp = isVariantB ? 0.8 : 0.6;

    while (attempt < 3) {
        attempt++;
        try {
            const generated = await requestOpenAIText({
                system: systemPrompt,
                user: `Dati lead: ${userPrompt}`,
                maxOutputTokens: 120,
                temperature: baseTemp + (attempt * 0.15),
            });
            const candidate = trimToMaxChars(generated, INVITE_NOTE_MAX_CHARS);

            if (!candidate) continue;

            if (await SemanticChecker.isTooSimilar(candidate, 0.85)) {
                await logWarn('ai.invite_note.too_similar_retry', { leadId: lead.id, attempt });
                continue;
            }

            finalNote = candidate;
            break;
        } catch (error) {
            await logWarn('ai.invite_note.error', {
                leadId: lead.id,
                error: error instanceof Error ? error.message : String(error),
            });
            break;
        }
    }

    if (!finalNote) {
        await logWarn('ai.invite_note.fallback_template', { leadId: lead.id, reason: 'Exhausted attempts or API error' });
        return {
            note: templateText,
            source: 'template',
            model: null,
            variant: tplResult.variant,
        };
    }

    await SemanticChecker.remember(finalNote);
    return {
        note: finalNote,
        source: 'ai',
        model: config.aiModel,
        variant: variantId,
    };
}
