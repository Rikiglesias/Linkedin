import { config } from '../config';
import { buildFollowUpMessage } from '../messages';
import { LeadRecord } from '../types/domain';
import { requestOpenAIText } from './openaiClient';
import { logWarn } from '../telemetry/logger';

export interface PersonalizedMessageResult {
    message: string;
    source: 'template' | 'ai';
    model: string | null;
}

function trimToMaxChars(input: string, maxChars: number): string {
    const normalized = input.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (normalized.length <= maxChars) {
        return normalized;
    }
    return normalized.slice(0, maxChars).trim();
}

function safeFirstName(lead: LeadRecord): string {
    const value = (lead.first_name ?? '').trim();
    if (value) return value;
    return 'there';
}

export async function buildPersonalizedFollowUpMessage(lead: LeadRecord): Promise<PersonalizedMessageResult> {
    const template = buildFollowUpMessage(lead);
    if (!config.aiPersonalizationEnabled || !config.openaiApiKey) {
        return {
            message: trimToMaxChars(template, config.aiMessageMaxChars),
            source: 'template',
            model: null,
        };
    }

    const systemPrompt = [
        'Sei un assistant B2B per outreach LinkedIn in italiano.',
        'Genera un singolo messaggio breve, naturale, professionale.',
        `Massimo ${config.aiMessageMaxChars} caratteri.`,
        'Niente hype, niente emoji, niente claim aggressivi, niente link.',
        'Mantieni tono rispettoso e personalizzato sul profilo.',
    ].join(' ');

    const userPrompt = JSON.stringify({
        firstName: safeFirstName(lead),
        lastName: lead.last_name,
        company: lead.account_name,
        role: lead.job_title,
        website: lead.website,
        fallbackTemplate: template,
    });

    try {
        const generated = await requestOpenAIText({
            system: systemPrompt,
            user: `Dati lead: ${userPrompt}`,
            maxOutputTokens: 220,
            temperature: 0.6,
        });
        const finalMessage = trimToMaxChars(generated, config.aiMessageMaxChars);
        if (!finalMessage) {
            return {
                message: trimToMaxChars(template, config.aiMessageMaxChars),
                source: 'template',
                model: null,
            };
        }
        return {
            message: finalMessage,
            source: 'ai',
            model: config.aiModel,
        };
    } catch (error) {
        await logWarn('ai.personalization.fallback_template', {
            leadId: lead.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            message: trimToMaxChars(template, config.aiMessageMaxChars),
            source: 'template',
            model: null,
        };
    }
}

