import { LeadRecord } from './types/domain';

const templatesByLang: Record<string, string[]> = {
    it: [
        `Ciao {{firstName}},\n\npiacere di connetterci qui su LinkedIn.\nSeguo aziende nel tuo settore e ho visto alcuni punti dove spesso si sblocca crescita commerciale con piccoli cambi operativi.\n\nSe ti va, facciamo una call di 15 minuti questa settimana?`,
        `Ciao {{firstName}},\n\ngrazie del collegamento.\nHo dato un'occhiata a {{companyHint}} e credo ci sia spazio per uno scambio utile su acquisizione e pipeline.\n\nTi andrebbe una breve call di 15 minuti?`,
        `Ciao {{firstName}},\n\npiacere di essere in contatto.\nLavoro su progetti che aiutano team come il tuo a migliorare conversione e tempi di risposta commerciale.\n\nSe hai 15 minuti nei prossimi giorni, ti racconto due idee concrete.`,
    ],
    en: [
        `Hi {{firstName}},\n\ngreat to connect here on LinkedIn.\nI work with companies in your space and noticed a few areas where small operational tweaks often unlock commercial growth.\n\nWould you have 15 minutes for a quick call this week?`,
        `Hi {{firstName}},\n\nthanks for connecting.\nI took a look at {{companyHint}} and I think there's room for a useful exchange on pipeline and acquisition.\n\nWould a brief 15-minute call work for you?`,
        `Hi {{firstName}},\n\nnice to be in touch.\nI work on projects that help teams like yours improve conversion rates and commercial response times.\n\nIf you have 15 minutes in the coming days, I'd love to share a couple of concrete ideas.`,
    ],
    fr: [
        `Bonjour {{firstName}},\n\nravi de nous connecter sur LinkedIn.\nJe travaille avec des entreprises de votre secteur et j'ai identifié des leviers de croissance commerciale souvent sous-exploités.\n\nAuriez-vous 15 minutes pour un échange cette semaine ?`,
        `Bonjour {{firstName}},\n\nmerci pour la connexion.\nJ'ai regardé {{companyHint}} et je pense qu'il y a matière à un échange utile sur l'acquisition et le pipeline.\n\nUn appel de 15 minutes vous conviendrait ?`,
    ],
    es: [
        `Hola {{firstName}},\n\nun gusto conectar aquí en LinkedIn.\nTrabajo con empresas de tu sector y he visto áreas donde pequeños cambios operativos suelen desbloquear crecimiento comercial.\n\n¿Tendrías 15 minutos para una llamada esta semana?`,
        `Hola {{firstName}},\n\ngracias por conectar.\nEché un vistazo a {{companyHint}} y creo que hay espacio para un intercambio útil sobre adquisición y pipeline.\n\n¿Te iría bien una breve llamada de 15 minutos?`,
    ],
    de: [
        `Hallo {{firstName}},\n\nschön, dass wir uns hier auf LinkedIn vernetzen.\nIch arbeite mit Unternehmen in Ihrem Bereich und habe einige Punkte identifiziert, wo kleine operative Änderungen oft kommerzielles Wachstum freisetzen.\n\nHätten Sie 15 Minuten für einen kurzen Austausch diese Woche?`,
    ],
    nl: [
        `Hoi {{firstName}},\n\nleuk om te connecten op LinkedIn.\nIk werk met bedrijven in jouw sector en heb een paar punten gezien waar kleine operationele aanpassingen vaak commerciële groei opleveren.\n\nHeb je 15 minuten voor een kort gesprek deze week?`,
    ],
};

/**
 * Restituisce il primo nome da usare nel messaggio.
 * Priorità: first_name (da Sales Navigator) → prima parola di account_name → fallback generico.
 */
function resolveFirstName(lead: LeadRecord): string {
    if (lead.first_name && lead.first_name.trim()) {
        return lead.first_name.trim();
    }
    // Fallback: prima parola di account_name se sembra un nome proprio
    const clean = lead.account_name.trim();
    if (clean) {
        const firstWord = clean.split(/\s+/)[0];
        // Usa la prima parola solo se non è tutta maiuscola (es. "ACME" → scarta)
        if (firstWord !== firstWord.toUpperCase()) {
            return firstWord;
        }
    }
    return 'there';
}

const companyFallbackByLang: Record<string, string> = {
    it: 'la tua realtà',
    en: 'your company',
    fr: 'votre entreprise',
    es: 'tu empresa',
    de: 'Ihr Unternehmen',
    nl: 'je bedrijf',
};

function getCompanyHint(lead: LeadRecord, lang?: string): string {
    if (lead.account_name.trim()) {
        return lead.account_name.trim();
    }
    if (lead.website.trim()) {
        return lead.website.trim();
    }
    return companyFallbackByLang[lang ?? 'it'] ?? companyFallbackByLang.it;
}

function resolveTemplate(template: string, lead: LeadRecord, lang?: string): string {
    return template
        .replaceAll('{{firstName}}', resolveFirstName(lead))
        .replaceAll('{{companyHint}}', getCompanyHint(lead, lang));
}

export function buildFollowUpMessage(lead: LeadRecord, lang?: string): string {
    const pool = templatesByLang[lang ?? 'it'] ?? templatesByLang.it;
    const index = lead.id % pool.length;
    return resolveTemplate(pool[index], lead, lang);
}
