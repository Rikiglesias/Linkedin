import { config } from '../config';
import { LeadRecord } from '../types/domain';
import { logWarn } from '../telemetry/logger';
import { isOpenAIConfigured, requestOpenAIText } from './openaiClient';
import { SemanticChecker } from './semanticChecker';
import { selectVariant, inferHourBucket } from '../ml/abBandit';
import { inferLeadSegment } from '../ml/segments';

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

type NoteTemplate = { variant: string; render: (firstName: string) => string };

const NOTE_TEMPLATES_IT: ReadonlyArray<NoteTemplate> = [
    {
        variant: 'TPL_CASUAL_INTEREST',
        render: (n) =>
            `Ciao ${n}, ho trovato il tuo profilo interessante e mi piacerebbe aggiungerti alla mia rete. A presto!`,
    },
    {
        variant: 'TPL_PROFESSIONAL_FOLLOW',
        render: (n) => `Ciao ${n}, seguo il tuo lavoro con interesse. Sarebbe un piacere connetterci!`,
    },
    {
        variant: 'TPL_COMMON_INTERESTS',
        render: (n) =>
            `Salve ${n}, ho visto il tuo profilo e penso potremmo avere interessi in comune. Ti aggiungo volentieri!`,
    },
    {
        variant: 'TPL_NETWORK_EXPANSION',
        render: (n) =>
            `Ciao ${n}, mi piacerebbe connettermi con te per ampliare la mia rete professionale. Buona giornata!`,
    },
    {
        variant: 'TPL_BACKGROUND_APPRECIATION',
        render: (n) => `Ciao ${n}, ho apprezzato il tuo background professionale. Sarebbe bello entrare in contatto!`,
    },
    {
        variant: 'TPL_ATTENTION_GRABBER',
        render: (n) => `Salve ${n}, il tuo profilo ha attirato la mia attenzione. Ti propongo di connetterci!`,
    },
    {
        variant: 'TPL_MUTUAL_BENEFIT',
        render: (n) => `Ciao ${n}, credo che possiamo trarre reciproco beneficio da questa connessione. A presto!`,
    },
    {
        variant: 'TPL_LIKE_MINDED',
        render: (n) =>
            `Ciao ${n}, mi farebbe piacere allargare la mia rete con professionisti come te. Collegati con me!`,
    },
];

const NOTE_TEMPLATES_EN: ReadonlyArray<NoteTemplate> = [
    {
        variant: 'TPL_CASUAL_INTEREST',
        render: (n) =>
            `Hi ${n}, I found your profile interesting and would love to add you to my network. Looking forward to connecting!`,
    },
    {
        variant: 'TPL_PROFESSIONAL_FOLLOW',
        render: (n) => `Hi ${n}, I've been following your work with interest. It would be great to connect!`,
    },
    {
        variant: 'TPL_COMMON_INTERESTS',
        render: (n) =>
            `Hello ${n}, I came across your profile and think we may share common interests. Happy to connect!`,
    },
    {
        variant: 'TPL_NETWORK_EXPANSION',
        render: (n) => `Hi ${n}, I'd like to connect with you to expand my professional network. Have a great day!`,
    },
    {
        variant: 'TPL_BACKGROUND_APPRECIATION',
        render: (n) => `Hi ${n}, I appreciated your professional background. It would be great to be in touch!`,
    },
];

const NOTE_TEMPLATES_FR: ReadonlyArray<NoteTemplate> = [
    {
        variant: 'TPL_CASUAL_INTEREST',
        render: (n) => `Bonjour ${n}, votre profil m'a intéressé et j'aimerais vous ajouter à mon réseau. Au plaisir !`,
    },
    {
        variant: 'TPL_PROFESSIONAL_FOLLOW',
        render: (n) => `Bonjour ${n}, je suis votre travail avec intérêt. Ce serait un plaisir de nous connecter !`,
    },
    {
        variant: 'TPL_NETWORK_EXPANSION',
        render: (n) =>
            `Bonjour ${n}, j'aimerais élargir mon réseau professionnel avec des profils comme le vôtre. Bonne journée !`,
    },
];

const NOTE_TEMPLATES_ES: ReadonlyArray<NoteTemplate> = [
    {
        variant: 'TPL_CASUAL_INTEREST',
        render: (n) => `Hola ${n}, encontré tu perfil interesante y me gustaría agregarte a mi red. ¡Un saludo!`,
    },
    {
        variant: 'TPL_PROFESSIONAL_FOLLOW',
        render: (n) => `Hola ${n}, sigo tu trabajo con interés. ¡Sería un placer conectar!`,
    },
    {
        variant: 'TPL_NETWORK_EXPANSION',
        render: (n) => `Hola ${n}, me gustaría conectar contigo para ampliar mi red profesional. ¡Buen día!`,
    },
];

const NOTE_TEMPLATES_BY_LANG: Record<string, ReadonlyArray<NoteTemplate>> = {
    it: NOTE_TEMPLATES_IT,
    en: NOTE_TEMPLATES_EN,
    fr: NOTE_TEMPLATES_FR,
    es: NOTE_TEMPLATES_ES,
};

const NOTE_TEMPLATES = NOTE_TEMPLATES_IT;

function getNoteTemplatesForLang(lang?: string): ReadonlyArray<NoteTemplate> {
    if (!lang) return NOTE_TEMPLATES;
    return NOTE_TEMPLATES_BY_LANG[lang] ?? NOTE_TEMPLATES;
}

/**
 * Genera una nota di invito da template (pseudo-casuale).
 * Usabile standalone o come fallback AI.
 */
export function generateInviteNote(firstName: string, lang?: string): TemplateNoteResult {
    const fallbackGreeting = lang === 'en' ? 'Hi' : lang === 'fr' ? 'Bonjour' : lang === 'es' ? 'Hola' : 'Ciao';
    const fallbackName =
        lang === 'en' ? 'colleague' : lang === 'fr' ? 'collègue' : lang === 'es' ? 'colega' : 'collega';
    const name = firstName.trim() || fallbackName;
    const pool = getNoteTemplatesForLang(lang);
    const index = Math.floor(Math.random() * pool.length);
    const selected = pool[index] ?? pool[0];
    if (!selected) return { note: `${fallbackGreeting} ${name}`, variant: 'TPL_FALLBACK' };
    return { note: selected.render(name), variant: selected.variant };
}

function generateInviteNoteByVariant(firstName: string, variant: string, lang?: string): TemplateNoteResult {
    const fallbackName =
        lang === 'en' ? 'colleague' : lang === 'fr' ? 'collègue' : lang === 'es' ? 'colega' : 'collega';
    const name = firstName.trim() || fallbackName;
    const pool = getNoteTemplatesForLang(lang);
    const selected = pool.find((item) => item.variant === variant) ?? pool[0];
    if (!selected) {
        return { note: `Hi ${name}`, variant: 'TPL_FALLBACK' };
    }
    return { note: selected.render(name), variant: selected.variant };
}

const INVITE_NOTE_MAX_CHARS = 300;

function trimToMaxChars(input: string, maxChars: number = INVITE_NOTE_MAX_CHARS): string {
    const normalized = input.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxChars) return normalized;
    return normalized.slice(0, maxChars).trim();
}

function safeFirstName(lead: LeadRecord, lang?: string): string {
    const value = (lead.first_name ?? '').trim();
    if (value) return value;
    return lang === 'en' ? 'colleague' : lang === 'fr' ? 'collègue' : lang === 'es' ? 'colega' : 'collega';
}

export async function buildPersonalizedInviteNote(
    lead: LeadRecord,
    lang?: string,
): Promise<PersonalizedInviteNoteResult> {
    const segmentKey = inferLeadSegment(lead.job_title);
    const pool = getNoteTemplatesForLang(lang);
    const templateVariants = pool.map((template) => template.variant);
    const hourBucket = inferHourBucket(new Date().getHours());
    const selectedTemplateVariant = await selectVariant(templateVariants, { segmentKey, hourBucket }).catch(() => null);
    const tplResult = selectedTemplateVariant
        ? generateInviteNoteByVariant(lead.first_name ?? '', selectedTemplateVariant, lang)
        : generateInviteNote(lead.first_name ?? '', lang);
    const templateText = trimToMaxChars(tplResult.note, INVITE_NOTE_MAX_CHARS);

    if (config.inviteNoteMode !== 'ai' || !config.aiPersonalizationEnabled || !isOpenAIConfigured()) {
        return {
            note: templateText,
            source: 'template',
            model: null,
            variant: tplResult.variant,
        };
    }

    // Varianti Prompt A/B Testing
    const variantId = await selectVariant(['AI_VAR_A_DIRECT', 'AI_VAR_B_VALUE'], { segmentKey, hourBucket }).catch(
        () => (Math.random() > 0.5 ? 'AI_VAR_B_VALUE' : 'AI_VAR_A_DIRECT'),
    );
    const isVariantB = variantId === 'AI_VAR_B_VALUE';

    let systemPrompt = '';

    if (isVariantB) {
        systemPrompt = [
            'Sei un top performer del social selling B2B su LinkedIn.',
            "Crea una brevissima nota di connessione (max 2 frasi) estraendo valore dal profilo dell'utente.",
            'Fai una leva specifica su qualcosa del suo About o Experience per dimostrare che hai letto il profilo.',
            `Massimo ${INVITE_NOTE_MAX_CHARS} caratteri.`,
            'Non vendere nulla, cerca solo di avviare una conversazione interessante.',
            'Niente emoji, niente ciao generici.',
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
                temperature: baseTemp + attempt * 0.15,
            });
            const candidate = trimToMaxChars(generated, INVITE_NOTE_MAX_CHARS);

            if (!candidate) continue;

            try {
                if (await SemanticChecker.isTooSimilar(candidate, 0.85, lead.id)) {
                    await logWarn('ai.invite_note.too_similar_retry', { leadId: lead.id, attempt });
                    continue;
                }
            } catch {
                await logWarn('ai.invite_note.semantic_checker_error', { leadId: lead.id, attempt });
                // Semantic checker down — use candidate as-is (better than losing a valid AI note)
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
        await logWarn('ai.invite_note.fallback_template', {
            leadId: lead.id,
            reason: 'Exhausted attempts or API error',
        });
        return {
            note: templateText,
            source: 'template',
            model: null,
            variant: tplResult.variant,
        };
    }

    await SemanticChecker.remember(finalNote, lead.id);
    return {
        note: finalNote,
        source: 'ai',
        model: config.aiModel,
        variant: variantId,
    };
}
