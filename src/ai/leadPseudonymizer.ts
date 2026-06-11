/**
 * ai/leadPseudonymizer.ts
 * F0.5 ai-stack: feature ANONIME per il decision engine (zero-PII verso il cloud).
 *
 * REGOLA D'ORO: l'output contiene SOLO enum chiusi, booleani e numeri (più una
 * region coarse alfabetica) — MAI nome/email/telefono/URL/azienda/testo libero
 * del lead. Le stringhe di enrichment (seniority/industry free-text) sono usate
 * esclusivamente come INPUT dell'inferenza, mai emesse raw.
 * Garanzia meccanica: property test in tests/leadPseudonymizer.vitest.ts
 * (l'output serializzato non contiene alcun valore PII di input).
 */

import { inferLeadSegment, inferLeadIndustry, type LeadSegment, type LeadIndustry } from '../ml/segments';
import type { PageObservation } from '../browser/observePageContext';

export type NormalizedSeniority = 'c_suite' | 'vp' | 'director' | 'manager' | 'senior' | 'entry';
export type NormalizedConnectionDegree = '1st' | '2nd' | '3rd_plus';

/** Sottoinsieme del lead rilevante per la pseudonimizzazione (campi PII = solo input). */
export interface PseudonymizableLead {
    title?: string;
    company?: string;
    score?: number;
    location?: string;
    /** Enrichment free-text: SOLO input di normalizzazione, mai emesso raw. */
    seniority?: string;
    /** Enrichment free-text: SOLO input di inferenza industry, mai emesso raw. */
    industry?: string;
    email?: string;
    businessEmail?: string;
    phone?: string;
}

export interface AnonymousLeadFeatures {
    segment: LeadSegment;
    industry: LeadIndustry;
    seniority?: NormalizedSeniority;
    /** Componente geografica coarse (solo alfabetica, tipicamente il paese). */
    region?: string;
    leadScore?: number;
    hasVerifiedEmail: boolean;
    hasPhone: boolean;
    connectionDegree?: NormalizedConnectionDegree;
    hasConnectButton?: boolean;
}

export interface ChatSignals {
    messageCount: number;
    lastFrom: 'lead' | 'us' | 'unknown';
    leadHasReplied: boolean;
}

// Ordine = precedenza: il primo match vince. vp PRIMA di c_suite perché
// "vice president" contiene "president" (il solo "President" resta c_suite).
const SENIORITY_RULES: ReadonlyArray<[NormalizedSeniority, RegExp]> = [
    ['vp', /\b(vp|vice[- ]?president)\b/],
    ['c_suite', /\b(c[- ]?suite|c[- ]?level|chief|cxo|ceo|cto|cfo|coo|owner|founder|president)\b/],
    ['director', /\b(director|head)\b/],
    ['manager', /\b(manager|lead)\b/],
    ['senior', /\bsenior\b/],
    ['entry', /\b(entry|junior|intern|trainee)\b/],
];

/** Normalizza la seniority free-text dell'enrichment su vocabolario chiuso; nessun match → undefined. */
export function normalizeSeniority(raw: string | null | undefined): NormalizedSeniority | undefined {
    if (!raw) return undefined;
    const value = raw.toLowerCase();
    for (const [level, pattern] of SENIORITY_RULES) {
        if (pattern.test(value)) return level;
    }
    return undefined;
}

function normalizeConnectionDegree(raw: string | null | undefined): NormalizedConnectionDegree | undefined {
    if (!raw) return undefined;
    const value = raw.toLowerCase();
    if (value.includes('1st')) return '1st';
    if (value.includes('2nd')) return '2nd';
    if (value.includes('3rd')) return '3rd_plus';
    return undefined;
}

/**
 * Riduce la location a una componente geografica coarse: ultima parte dopo la virgola
 * (tipicamente il paese), SOLO se alfabetica (niente cifre: scarta CAP/civici),
 * max 3 parole / 40 caratteri. Caso senza virgola: emessa la sola componente se
 * alfabetica (città-level accettato come coarse). Altrimenti undefined.
 */
export function coarseRegion(location: string | null | undefined): string | undefined {
    if (!location) return undefined;
    const lastPart = location.split(',').pop()?.trim() ?? '';
    if (!lastPart || /\d/.test(lastPart)) return undefined;
    if (lastPart.length > 40 || lastPart.split(/\s+/).length > 3) return undefined;
    return lastPart;
}

/**
 * Distilla i messaggi chat (formato chatMessageExtractor: prefissi 'THEM: ' / 'ME: ')
 * in segnali anonimi: il TESTO della conversazione non esce mai.
 */
export function distillChatSignals(chatMessages: string[] | undefined): ChatSignals | undefined {
    if (!chatMessages || chatMessages.length === 0) return undefined;
    const last = chatMessages[chatMessages.length - 1];
    const lastFrom = last.startsWith('THEM:') ? 'lead' : last.startsWith('ME:') ? 'us' : 'unknown';
    return {
        messageCount: chatMessages.length,
        lastFrom,
        leadHasReplied: chatMessages.some((m) => m.startsWith('THEM:')),
    };
}

/**
 * Estrae le feature anonime del lead per il prompt decisionale.
 * company/industry-enrichment alimentano l'inferenza dell'enum industry ma non escono mai.
 */
export function pseudonymizeLead(
    lead: PseudonymizableLead | undefined,
    pageObservation?: Pick<PageObservation, 'connectionDegree' | 'hasConnectButton'>,
): AnonymousLeadFeatures {
    const title = lead?.title ?? null;
    const industryInput = [lead?.company ?? '', lead?.industry ?? ''].join(' ').trim() || null;
    return {
        segment: inferLeadSegment(title),
        industry: inferLeadIndustry(industryInput, title),
        seniority: normalizeSeniority(lead?.seniority),
        region: coarseRegion(lead?.location),
        leadScore: typeof lead?.score === 'number' ? lead.score : undefined,
        hasVerifiedEmail: Boolean(lead?.email || lead?.businessEmail),
        hasPhone: Boolean(lead?.phone),
        connectionDegree: normalizeConnectionDegree(pageObservation?.connectionDegree),
        hasConnectButton: pageObservation?.hasConnectButton,
    };
}
