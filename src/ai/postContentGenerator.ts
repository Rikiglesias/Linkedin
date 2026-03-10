/**
 * ai/postContentGenerator.ts
 * ─────────────────────────────────────────────────────────────────
 * Genera contenuti per post LinkedIn usando AI, con fallback
 * a template predefiniti. Supporta topic custom per campagna.
 */

import { isOpenAIConfigured, requestOpenAIText } from './openaiClient';
import { logWarn } from '../telemetry/logger';
import { config } from '../config';
import { randomElement } from '../utils/random';

export interface PostContentRequest {
    topic?: string;
    industry?: string;
    tone?: 'professional' | 'casual' | 'inspirational' | 'educational' | 'storytelling';
    maxLength?: number;
    language?: string;
    accountContext?: string;
}

export interface PostContentResult {
    content: string;
    topic: string;
    source: 'ai' | 'template';
    model: string | null;
    estimatedReadTimeSeconds: number;
}

const DEFAULT_TOPICS = [
    'leadership e gestione del team',
    'innovazione tecnologica nel B2B',
    'strategie di crescita aziendale',
    'digital transformation',
    'networking professionale efficace',
    'sales e sviluppo business',
    'produttività e smart working',
    'customer success e retention',
];

const TEMPLATE_POSTS: string[] = [
    `Ho notato che le aziende che investono nella formazione continua del team hanno un tasso di retention 2-3x superiore.\n\nNon è solo una questione di budget, ma di cultura aziendale.\n\nQual è la vostra esperienza? Come bilanciate investimento in formazione e risultati a breve termine?\n\n#Leadership #TeamBuilding #Growth`,
    `Una lezione che ho imparato nel B2B: il follow-up non è insistenza, è attenzione.\n\nLa differenza tra un'opportunità persa e una chiusa è spesso nel timing e nella qualità del follow-up.\n\n3 principi che applico:\n1. Personalizzare sempre\n2. Aggiungere valore ad ogni contatto\n3. Rispettare i tempi del cliente\n\nCosa aggiungereste? #Sales #B2B`,
    `Il networking non è collezionare connessioni. È costruire relazioni.\n\nHo smesso di mandare richieste di collegamento generiche e ho iniziato a fare una cosa semplice: leggere i post delle persone prima di contattarle.\n\nRisultato? Tasso di accettazione raddoppiato e conversazioni molto più interessanti.\n\n#Networking #LinkedIn #BusinessDevelopment`,
];

function pickRandomTopic(): string {
    return randomElement(DEFAULT_TOPICS);
}

function pickTemplatePost(): PostContentResult {
    const post = randomElement(TEMPLATE_POSTS);
    return {
        content: post,
        topic: 'general',
        source: 'template',
        model: null,
        estimatedReadTimeSeconds: Math.ceil(post.length / 15),
    };
}

export async function generatePostContent(request: PostContentRequest = {}): Promise<PostContentResult> {
    const topic = request.topic || pickRandomTopic();
    const tone = request.tone || 'professional';
    const maxLength = request.maxLength || 1300;
    const language = request.language || 'italiano';

    if (!isOpenAIConfigured()) {
        return pickTemplatePost();
    }

    const toneDescriptions: Record<string, string> = {
        professional: 'tono professionale e formale, dati e insight concreti',
        casual: 'tono conversazionale e personale, storie ed esperienze',
        inspirational: 'tono ispirazionale e motivante, visione strategica e insight unici',
        educational: 'tono educativo e informativo, spiegazioni chiare e valore pratico',
        storytelling: 'tono narrativo, partendo da un aneddoto personale verso una lezione professionale',
    };

    const systemPrompt = `Sei un ghostwriter LinkedIn esperto. Genera UN post originale in ${language}.

Regole:
- Lunghezza: 600-${maxLength} caratteri
- Struttura: hook forte nella prima riga, corpo con insight/storia, chiusura con domanda aperta
- Tono: ${toneDescriptions[tone] || toneDescriptions.professional}
- Includi 2-4 hashtag rilevanti alla fine
- Usa line break per la leggibilità (righe corte)
- NON usare emoji eccessivi (max 1-2)
- NON inventare statistiche false
- Il post deve sembrare autentico, non generato da AI
${request.accountContext ? `\nContesto account: ${request.accountContext}` : ''}

Rispondi SOLO con il testo del post, senza virgolette o prefissi.`;

    try {
        const content = await requestOpenAIText({
            system: systemPrompt,
            user: `Scrivi un post LinkedIn sul tema: ${topic}`,
            temperature: 0.7,
            maxOutputTokens: 500,
        });

        const cleaned = content
            .replace(/^["']|["']$/g, '')
            .replace(/^Post:\s*/i, '')
            .trim();

        if (cleaned.length < 100) {
            await logWarn('post_generator.content_too_short', { topic, length: cleaned.length });
            return pickTemplatePost();
        }

        return {
            content: cleaned.slice(0, maxLength),
            topic,
            source: 'ai',
            model: config.aiModel,
            estimatedReadTimeSeconds: Math.ceil(cleaned.length / 15),
        };
    } catch (error) {
        await logWarn('post_generator.ai_failed', {
            topic,
            error: error instanceof Error ? error.message : String(error),
        });
        return pickTemplatePost();
    }
}
