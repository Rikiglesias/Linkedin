import { config } from '../config';
import { generateInviteNote } from '../noteGenerator';
import { LeadRecord } from '../types/domain';
import { logWarn } from '../telemetry/logger';
import { requestOpenAIText } from './openaiClient';

export interface PersonalizedInviteNoteResult {
    note: string;
    source: 'template' | 'ai';
    model: string | null;
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
    const template = trimToMaxChars(generateInviteNote(lead.first_name ?? ''), INVITE_NOTE_MAX_CHARS);

    if (config.inviteNoteMode !== 'ai' || !config.openaiApiKey) {
        return {
            note: template,
            source: 'template',
            model: null,
        };
    }

    const systemPrompt = [
        'Sei un assistant B2B per inviti LinkedIn in italiano.',
        'Genera una singola nota breve e naturale (1-2 frasi).',
        `Massimo ${INVITE_NOTE_MAX_CHARS} caratteri.`,
        'Niente link, niente emoji, niente claim aggressivi.',
        'Tono professionale, rispettoso, umano.',
    ].join(' ');

    const userPrompt = JSON.stringify({
        firstName: safeFirstName(lead),
        company: lead.account_name,
        role: lead.job_title,
        fallbackTemplate: template,
    });

    try {
        const generated = await requestOpenAIText({
            system: systemPrompt,
            user: `Dati lead: ${userPrompt}`,
            maxOutputTokens: 120,
            temperature: 0.7,
        });
        const finalNote = trimToMaxChars(generated, INVITE_NOTE_MAX_CHARS);
        if (!finalNote) {
            return {
                note: template,
                source: 'template',
                model: null,
            };
        }
        return {
            note: finalNote,
            source: 'ai',
            model: config.aiModel,
        };
    } catch (error) {
        await logWarn('ai.invite_note.fallback_template', {
            leadId: lead.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            note: template,
            source: 'template',
            model: null,
        };
    }
}
