import { config } from '../config';
import { buildFollowUpMessage } from '../messages';
import { LeadRecord } from '../types/domain';
import { isOpenAIConfigured, requestOpenAIText } from './openaiClient';
import { logWarn } from '../telemetry/logger';
import { SemanticChecker } from './semanticChecker';

export interface PersonalizedMessageResult {
    message: string;
    source: 'template' | 'ai';
    model: string | null;
}

export interface FollowUpContextHint {
    intent?: string | null;
    subIntent?: string | null;
    entities?: string[];
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
    if (!config.aiPersonalizationEnabled || !isOpenAIConfigured()) {
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

    let finalMessage = '';
    let attempt = 0;

    while (attempt < 3) {
        attempt++;
        try {
            const generated = await requestOpenAIText({
                system: systemPrompt,
                user: `Dati lead: ${userPrompt}`,
                maxOutputTokens: 220,
                temperature: 0.6 + (attempt * 0.15),
            });
            const candidate = trimToMaxChars(generated, config.aiMessageMaxChars);

            if (!candidate) continue;

            if (await SemanticChecker.isTooSimilar(candidate, 0.85)) {
                await logWarn('ai.personalization.too_similar_retry', { leadId: lead.id, attempt });
                continue;
            }

            finalMessage = candidate;
            break;
        } catch (error) {
            await logWarn('ai.personalization.error', {
                leadId: lead.id,
                error: error instanceof Error ? error.message : String(error),
            });
            break; // Se fallisce API usciamo dal loop e andiamo in fallback
        }
    }

    if (!finalMessage) {
        await logWarn('ai.personalization.fallback_template', { leadId: lead.id, reason: 'Exhausted attempts or error' });
        return {
            message: trimToMaxChars(template, config.aiMessageMaxChars),
            source: 'template',
            model: null,
        };
    }

    await SemanticChecker.remember(finalMessage);
    return {
        message: finalMessage,
        source: 'ai',
        model: config.aiModel,
    };
}

/**
 * Genera un reminder breve per lead in silenzio dopo N giorni dal primo messaggio.
 * Tono: caldo, non invasivo, senza pressione. Max 300 char.
 */
export async function buildFollowUpReminderMessage(
    lead: LeadRecord,
    daysSince: number,
    hint?: FollowUpContextHint
): Promise<PersonalizedMessageResult> {
    const FOLLOW_UP_MAX_CHARS = 300;

    // Template fallback
    const firstName = safeFirstName(lead);
    const intent = (hint?.intent ?? '').toUpperCase();
    const subIntent = (hint?.subIntent ?? '').toUpperCase();
    const entities = (hint?.entities ?? []).map((item) => item.toLowerCase());
    const hasPriceEntity = entities.includes('prezzo') || entities.includes('pricing') || subIntent === 'PRICE_INQUIRY';
    const hasCompetitorEntity = entities.includes('competitor') || subIntent === 'COMPETITOR_MENTION';

    let fallback = `Ciao ${firstName}, volevo riprendere i contatti dopo il mio messaggio di qualche giorno fa. Sei disponibile per una breve chiacchierata?`;
    if (intent === 'QUESTIONS' && hasPriceEntity) {
        fallback = `Ciao ${firstName}, se ti va posso condividere una panoramica sintetica su costi e modalità operative, così valuti con più contesto.`;
    } else if (intent === 'QUESTIONS' && hasCompetitorEntity) {
        fallback = `Ciao ${firstName}, posso mandarti un confronto rapido con le alternative che state valutando, in modo molto pratico e senza impegno.`;
    } else if (intent === 'POSITIVE' || subIntent === 'CALL_REQUESTED') {
        fallback = `Ciao ${firstName}, grazie ancora per l'apertura. Se vuoi possiamo fissare una call breve e andare subito al punto.`;
    } else if (intent === 'NEGATIVE' || intent === 'NOT_INTERESTED') {
        fallback = `Ciao ${firstName}, ti scrivo solo per lasciare aperto il contatto. Se in futuro ha senso, ci risentiamo volentieri.`;
    }
    const fallbackTrimmed = trimToMaxChars(fallback, FOLLOW_UP_MAX_CHARS);

    if (!config.aiPersonalizationEnabled || !isOpenAIConfigured()) {
        return { message: fallbackTrimmed, source: 'template', model: null };
    }

    const systemPrompt = [
        'Sei un assistant B2B per outreach LinkedIn in italiano.',
        'Scrivi un follow-up breve, caldo e non invadente — NON menzionare mai che stai facendo "follow-up".',
        'Tono: naturale, umano, curioso. Niente pressione, niente emoji, niente link.',
        `Massimo ${FOLLOW_UP_MAX_CHARS} caratteri. Solo il testo del messaggio, niente altro.`,
    ].join(' ');

    const userPrompt = JSON.stringify({
        firstName,
        company: lead.account_name || '',
        role: lead.job_title || '',
        daysSinceLastMessage: daysSince,
        intentHint: intent || null,
        subIntentHint: subIntent || null,
        entitiesHint: entities,
        fallback: fallbackTrimmed,
    });

    try {
        const generated = await requestOpenAIText({
            system: systemPrompt,
            user: `Dati lead: ${userPrompt}`,
            maxOutputTokens: 120,
            temperature: 0.75,
        });
        const candidate = trimToMaxChars(generated, FOLLOW_UP_MAX_CHARS);
        if (candidate) {
            return { message: candidate, source: 'ai', model: config.aiModel };
        }
    } catch (err) {
        await logWarn('ai.follow_up_reminder.error', {
            leadId: lead.id,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    return { message: fallbackTrimmed, source: 'template', model: null };
}
