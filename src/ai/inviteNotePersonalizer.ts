import { config } from '../config';
import { generateInviteNote } from '../noteGenerator';
import { LeadRecord } from '../types/domain';
import { logWarn } from '../telemetry/logger';
import { requestOpenAIText } from './openaiClient';
import { SemanticChecker } from './semanticChecker';

export interface PersonalizedInviteNoteResult {
    note: string;
    source: 'template' | 'ai';
    model: string | null;
    variant: string | null;
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
        company: lead.account_name,
        role: lead.job_title,
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

            if (SemanticChecker.isTooSimilar(candidate, 0.85)) {
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

    SemanticChecker.remember(finalNote);
    return {
        note: finalNote,
        source: 'ai',
        model: config.aiModel,
        variant: variantId,
    };
}
