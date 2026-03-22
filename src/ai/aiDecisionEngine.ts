/**
 * R02: AI Decision Engine — l'AI GUIDA il bot, non è un accessorio.
 *
 * 5 punti decisionali dove l'AI ragiona (oggi tutti hardcoded):
 *   1. PRIMA di navigare → strategia navigazione
 *   2. SUL profilo → decidere SE invitare/skip
 *   3. PRIMA del messaggio → leggere chat, adattare contenuto
 *   4. PRIMA del follow-up → verificare se il lead è attivo
 *   5. NELLA inbox → analisi conversazione completa
 *
 * Se AI non disponibile (Ollama down, timeout) → fallback al comportamento
 * meccanico attuale (zero regressione).
 *
 * Il Decision Engine non prende azioni — ritorna una DECISIONE strutturata
 * che il worker esegue o ignora.
 */

import { config } from '../config';
import { logInfo, logWarn } from '../telemetry/logger';
import type { PageObservation } from '../browser/observePageContext';

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface AIDecisionRequest {
    /** Tipo di decisione richiesta */
    point: 'pre_invite' | 'pre_message' | 'pre_follow_up' | 'inbox_reply' | 'navigation';
    /** Dati lead dal DB */
    lead?: {
        id: number;
        name?: string;
        title?: string;
        company?: string;
        score?: number;
        about?: string;
    };
    /** Stato sessione corrente */
    session?: {
        invitesSent: number;
        messagesSent: number;
        riskScore: number;
        pendingRatio: number;
        duration: number;
        challengeCount: number;
    };
    /** Osservazione pagina (da observePageContext) */
    pageObservation?: PageObservation;
    /** Ultimi messaggi nella chat (per inbox/message) */
    chatMessages?: string[];
    /** Contesto aggiuntivo */
    extra?: Record<string, unknown>;
}

export interface AIDecisionResponse {
    /** Azione raccomandata */
    action: 'PROCEED' | 'SKIP' | 'DEFER' | 'NOTIFY_HUMAN';
    /** Confidenza nella decisione 0-1 */
    confidence: number;
    /** Motivazione leggibile (loggata per debugging) */
    reason: string;
    /** Strategia navigazione suggerita (solo per point='navigation') */
    navigationStrategy?: 'search_organic' | 'feed_organic' | 'direct';
    /** Contesto per il messaggio (solo per point='pre_message' o 'inbox_reply') */
    messageContext?: string;
    /** Delay suggerito in secondi prima dell'azione */
    suggestedDelaySec?: number;
}

// ─── Implementazione ─────────────────────────────────────────────────────────

const DECISION_TIMEOUT_MS = 8_000;

/**
 * Chiede all'AI di prendere una decisione su un punto critico del workflow.
 * Timeout: 8s — se l'AI è lenta, fallback a PROCEED (comportamento meccanico).
 * Non lancia mai eccezioni.
 */
export async function aiDecide(request: AIDecisionRequest): Promise<AIDecisionResponse> {
    // Se AI non configurata → fallback immediato
    if (!config.aiPersonalizationEnabled) {
        return mechanicalFallback(request, 'ai_not_configured');
    }

    try {
        const prompt = buildDecisionPrompt(request);
        const { requestOpenAIText } = await import('./openaiClient');

        // Timeout reale con Promise.race: se l'AI non risponde entro DECISION_TIMEOUT_MS,
        // fallback meccanico. Il timeout di fetchWithRetryPolicy (config.aiRequestTimeoutMs)
        // potrebbe essere più lungo — questo è il cap specifico per le decisioni.
        const aiPromise = requestOpenAIText({
            system: 'You are a LinkedIn outreach decision engine. Respond ONLY with valid JSON.',
            user: prompt,
            maxOutputTokens: 200,
            temperature: 0.3,
        });
        const timeoutPromise = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), DECISION_TIMEOUT_MS),
        );

        const response = await Promise.race([aiPromise, timeoutPromise]);

        if (!response) {
            return mechanicalFallback(request, response === null ? 'timeout' : 'empty_ai_response');
        }

        const parsed = parseDecisionResponse(response, request);
        await logInfo('ai_decision_engine.decided', {
            point: request.point,
            leadId: request.lead?.id,
            action: parsed.action,
            confidence: parsed.confidence,
            reason: parsed.reason.substring(0, 80),
        });
        return parsed;
    } catch (err) {
        await logWarn('ai_decision_engine.fallback', {
            point: request.point,
            leadId: request.lead?.id,
            error: err instanceof Error ? err.message : String(err),
        });
        return mechanicalFallback(request, 'ai_error');
    }
}

/**
 * Fallback meccanico — il comportamento attuale del bot (sempre PROCEED).
 * Zero regressione: se l'AI non è disponibile, il bot fa esattamente quello che faceva prima.
 */
function mechanicalFallback(_request: AIDecisionRequest, reason: string): AIDecisionResponse {
    return {
        action: 'PROCEED',
        confidence: 0.5,
        reason: `Mechanical fallback: ${reason}`,
    };
}

function buildDecisionPrompt(request: AIDecisionRequest): string {
    const parts: string[] = [
        'You are an AI assistant helping a LinkedIn outreach bot make smart decisions.',
        'Respond with a JSON object: { "action": "PROCEED"|"SKIP"|"DEFER"|"NOTIFY_HUMAN", "confidence": 0.0-1.0, "reason": "brief explanation" }',
        '',
    ];

    switch (request.point) {
        case 'pre_invite':
            parts.push('DECISION: Should we send a connection invite to this person?');
            if (request.lead) {
                parts.push(`Lead: ${request.lead.name ?? 'Unknown'}, ${request.lead.title ?? 'Unknown title'} at ${request.lead.company ?? 'Unknown company'}`);
                if (request.lead.score) parts.push(`Lead score: ${request.lead.score}/100`);
                if (request.lead.about) parts.push(`About: ${request.lead.about.substring(0, 200)}`);
            }
            if (request.pageObservation) {
                parts.push(`Profile page: name="${request.pageObservation.profileName}", headline="${request.pageObservation.profileHeadline}"`);
                parts.push(`Connection: ${request.pageObservation.connectionDegree ?? 'unknown'}, Connect button: ${request.pageObservation.hasConnectButton}`);
            }
            if (request.session) {
                parts.push(`Session: ${request.session.invitesSent} invites sent, risk=${request.session.riskScore}/100, pending=${(request.session.pendingRatio * 100).toFixed(0)}%`);
            }
            parts.push('SKIP if: profile seems irrelevant, risk is high, or pending ratio > 60%. PROCEED if: good fit.');
            break;

        case 'pre_message':
            parts.push('DECISION: Should we send a message to this person? What context should we use?');
            if (request.lead) {
                parts.push(`Lead: ${request.lead.name ?? 'Unknown'}, ${request.lead.title ?? 'Unknown title'} at ${request.lead.company ?? 'Unknown company'}`);
            }
            if (request.chatMessages && request.chatMessages.length > 0) {
                parts.push(`Recent chat messages: ${request.chatMessages.slice(-3).join(' | ')}`);
            }
            parts.push('If they already replied → SKIP (they started a conversation). Add "messageContext" with suggested approach.');
            break;

        case 'pre_follow_up':
            parts.push('DECISION: Should we send a follow-up to this person?');
            if (request.lead) {
                parts.push(`Lead: ${request.lead.name ?? 'Unknown'}, ${request.lead.title ?? 'Unknown title'}`);
            }
            if (request.chatMessages && request.chatMessages.length > 0) {
                parts.push(`Last messages: ${request.chatMessages.slice(-3).join(' | ')}`);
                parts.push('If the last message is FROM THEM → SKIP (they replied, no follow-up needed).');
            }
            break;

        case 'inbox_reply':
            parts.push('DECISION: How should we handle this inbox conversation?');
            if (request.chatMessages && request.chatMessages.length > 0) {
                parts.push(`Full conversation: ${request.chatMessages.join(' | ')}`);
            }
            parts.push('PROCEED for positive/questions intent. NOTIFY_HUMAN for complex situations. SKIP for spam/irrelevant.');
            break;

        case 'navigation':
            parts.push('DECISION: How should we navigate to this profile?');
            if (request.session) {
                parts.push(`Session: ${request.session.invitesSent} invites, risk=${request.session.riskScore}/100`);
            }
            parts.push('Add "navigationStrategy": "search_organic"|"feed_organic"|"direct".');
            break;
    }

    return parts.join('\n');
}

function parseDecisionResponse(raw: string, _request: AIDecisionRequest): AIDecisionResponse {
    try {
        // Estrai JSON dalla risposta (l'AI potrebbe aggiungere testo attorno)
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { action: 'PROCEED', confidence: 0.5, reason: 'Mechanical fallback: no_json_in_response' };
        }

        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        const action = String(parsed.action ?? 'PROCEED').toUpperCase();
        const validActions = ['PROCEED', 'SKIP', 'DEFER', 'NOTIFY_HUMAN'];

        return {
            action: validActions.includes(action) ? action as AIDecisionResponse['action'] : 'PROCEED',
            confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
            reason: String(parsed.reason ?? 'AI decision'),
            messageContext: typeof parsed.messageContext === 'string' ? parsed.messageContext : undefined,
            navigationStrategy: typeof parsed.navigationStrategy === 'string'
                ? parsed.navigationStrategy as AIDecisionResponse['navigationStrategy']
                : undefined,
            suggestedDelaySec: typeof parsed.suggestedDelaySec === 'number'
                ? Math.max(0, Math.min(60, parsed.suggestedDelaySec))
                : undefined,
        };
    } catch {
        return { action: 'PROCEED', confidence: 0.5, reason: 'Mechanical fallback: json_parse_error' };
    }
}
