import { LeadRecord } from '../types/domain';

/**
 * Inferenza della lingua di outreach dal paese del lead (messaging-rules.md #5:
 * "messaggio in lingua del target, non sempre IT/EN per tutti").
 *
 * `lead.location` è scrapato nella lingua dell'account (es. account IT → "Amsterdam,
 * Olanda Settentrionale, Paesi Bassi"): l'ULTIMO segmento è il paese. Mappa CONSERVATIVA,
 * solo verso lingue con template reali (messages.ts: it/en/fr/es/de/nl). Paese ignoto o
 * location vuota → 'it' (lingua dell'account = comportamento storico, zero regressione).
 *
 * `lead.location` è input scrapato dal profilo target: qui è usato SOLO come chiave di
 * lookup in whitelist (output ∈ insieme chiuso di codici lingua), mai interpolato grezzo
 * in template/log → nessun vettore di injection (messaging-rules.md #8).
 */

// Chiavi normalizzate (lowercase, senza accenti). Solo lingue con template reali.
const COUNTRY_TO_LANG: Record<string, string> = {
    // IT
    italia: 'it',
    italy: 'it',
    // EN
    'regno unito': 'en',
    'gran bretagna': 'en',
    inghilterra: 'en',
    'united kingdom': 'en',
    uk: 'en',
    'stati uniti': 'en',
    "stati uniti d'america": 'en',
    'united states': 'en',
    usa: 'en',
    irlanda: 'en',
    ireland: 'en',
    canada: 'en',
    australia: 'en',
    // FR
    francia: 'fr',
    france: 'fr',
    // ES
    spagna: 'es',
    spain: 'es',
    messico: 'es',
    mexico: 'es',
    argentina: 'es',
    colombia: 'es',
    cile: 'es',
    chile: 'es',
    peru: 'es',
    // DE
    germania: 'de',
    germany: 'de',
    deutschland: 'de',
    austria: 'de',
    // NL
    'paesi bassi': 'nl',
    olanda: 'nl',
    netherlands: 'nl',
    holland: 'nl',
    nederland: 'nl',
};

/** lowercase + trim + rimozione accenti (combining marks U+0300-U+036F), per match robusto. */
function normalizeCountry(raw: string): string {
    return raw
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

/**
 * Lingua di outreach del lead. Conservativo: solo paesi riconosciuti con template;
 * tutto il resto (incl. location vuota) → 'it'.
 */
export function resolveLeadLanguage(lead: Pick<LeadRecord, 'location'>): string {
    const loc = (lead.location ?? '').trim();
    if (!loc) return 'it';
    const country = normalizeCountry(loc.split(',').pop() ?? '');
    return COUNTRY_TO_LANG[country] ?? 'it';
}
