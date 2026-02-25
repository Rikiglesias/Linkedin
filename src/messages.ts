import { LeadRecord } from './types/domain';

const templates: string[] = [
    `Ciao {{firstName}},\n\npiacere di connetterci qui su LinkedIn.\nSeguo aziende nel tuo settore e ho visto alcuni punti dove spesso si sblocca crescita commerciale con piccoli cambi operativi.\n\nSe ti va, facciamo una call di 15 minuti questa settimana?`,
    `Ciao {{firstName}},\n\ngrazie del collegamento.\nHo dato un'occhiata a {{companyHint}} e credo ci sia spazio per uno scambio utile su acquisizione e pipeline.\n\nTi andrebbe una breve call di 15 minuti?`,
    `Ciao {{firstName}},\n\npiacere di essere in contatto.\nLavoro su progetti che aiutano team come il tuo a migliorare conversione e tempi di risposta commerciale.\n\nSe hai 15 minuti nei prossimi giorni, ti racconto due idee concrete.`,
];

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

function getCompanyHint(lead: LeadRecord): string {
    if (lead.account_name.trim()) {
        return lead.account_name.trim();
    }
    if (lead.website.trim()) {
        return lead.website.trim();
    }
    return 'la tua realtà';
}

function resolveTemplate(template: string, lead: LeadRecord): string {
    return template
        .replaceAll('{{firstName}}', resolveFirstName(lead))
        .replaceAll('{{companyHint}}', getCompanyHint(lead));
}

export function buildFollowUpMessage(lead: LeadRecord): string {
    const index = lead.id % templates.length;
    return resolveTemplate(templates[index], lead);
}
