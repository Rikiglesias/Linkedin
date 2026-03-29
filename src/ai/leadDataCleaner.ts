import { requestOpenAIText } from './openaiClient';
import { logWarn } from '../telemetry/logger';

export interface CleanedLeadData {
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    accountName: string | null;
    inferredEmail: string | null;
    linkedinHeadline: string | null;
    location: string | null;
    industry: string | null;
    cleaned: boolean;
}

const CONNECTION_DEGREE_RE = /^(collegamento di )?\d+°?\s*(grado)?$/i;
const DEGREE_ONLY_RE = /^\d+°?$/;

function isGarbageValue(value: string | null | undefined): boolean {
    if (!value || !value.trim()) return true;
    const v = value.trim();
    return CONNECTION_DEGREE_RE.test(v) || DEGREE_ONLY_RE.test(v);
}

/**
 * Pulisce e arricchisce i dati di un lead usando GPT.
 * Corregge nomi duplicati, rimuove valori spazzatura (gradi di connessione),
 * inferisce email aziendale se possibile.
 */
export async function cleanLeadDataWithAI(lead: {
    firstName: string;
    lastName: string;
    jobTitle: string;
    accountName: string;
    linkedinUrl: string;
    website?: string | null;
}): Promise<CleanedLeadData> {
    const rawFirst = (lead.firstName ?? '').trim();
    const rawLast = (lead.lastName ?? '').trim();
    const rawTitle = (lead.jobTitle ?? '').trim();
    const rawCompany = (lead.accountName ?? '').trim();

    // Se tutti i campi sono già puliti (non spazzatura, nomi non duplicati), skip AI
    const titleDirty = isGarbageValue(rawTitle);
    const companyDirty = isGarbageValue(rawCompany);
    const nameDuplicated = rawLast.toLowerCase().includes(rawFirst.toLowerCase()) && rawFirst.length > 2;

    if (!titleDirty && !companyDirty && !nameDuplicated) {
        return {
            firstName: rawFirst || null,
            lastName: rawLast || null,
            jobTitle: rawTitle || null,
            accountName: rawCompany || null,
            inferredEmail: null,
            linkedinHeadline: null,
            location: null,
            industry: null,
            cleaned: false,
        };
    }

    const systemPrompt = `Sei un data analyst specializzato in lead B2B LinkedIn. Ricevi dati grezzi estratti da Sales Navigator che possono essere sporchi.

PROBLEMI COMUNI:
- "Collegamento di 3° grado" o "2°" al posto del job title → è il grado di connessione LinkedIn, NON il titolo
- "3°" o "2°" al posto del nome azienda → è il grado di connessione, NON l'azienda
- Nome duplicato nel cognome (es. firstName="Marco", lastName="Rossi Marco Rossi")
- firstName e lastName invertiti

REGOLE:
1. Se job_title è un grado di connessione ("Collegamento di X° grado", "2°", "3°"), metti null
2. Se account_name è un grado ("2°", "3°"), metti null
3. Se il cognome contiene il nome ripetuto, puliscilo (es. "Calvo Kimberlee Calvo" → "Calvo")
4. Cerca di inferire l'email aziendale nel formato nome.cognome@dominio.com se hai il website/dominio
5. Se riesci a dedurre headline, location o industry dal nome/azienda, aggiungili

Rispondi SOLO con JSON:
{
  "firstName": "string|null",
  "lastName": "string|null",
  "jobTitle": "string|null",
  "accountName": "string|null",
  "inferredEmail": "string|null",
  "linkedinHeadline": "string|null",
  "location": "string|null",
  "industry": "string|null"
}`;

    const userPrompt = JSON.stringify({
        firstName: rawFirst,
        lastName: rawLast,
        jobTitle: rawTitle,
        accountName: rawCompany,
        linkedinUrl: lead.linkedinUrl,
        website: lead.website ?? null,
    });

    try {
        const generated = await requestOpenAIText({
            system: systemPrompt,
            user: userPrompt,
            maxOutputTokens: 250,
            temperature: 0.1,
        });

        const cleaned = generated
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        const parsed = JSON.parse(cleaned);

        return {
            firstName: typeof parsed.firstName === 'string' ? parsed.firstName.trim() || null : rawFirst || null,
            lastName: typeof parsed.lastName === 'string' ? parsed.lastName.trim() || null : rawLast || null,
            jobTitle: typeof parsed.jobTitle === 'string' ? parsed.jobTitle.trim() || null : null,
            accountName: typeof parsed.accountName === 'string' ? parsed.accountName.trim() || null : null,
            inferredEmail: typeof parsed.inferredEmail === 'string' ? parsed.inferredEmail.trim() || null : null,
            linkedinHeadline:
                typeof parsed.linkedinHeadline === 'string' ? parsed.linkedinHeadline.trim() || null : null,
            location: typeof parsed.location === 'string' ? parsed.location.trim() || null : null,
            industry: typeof parsed.industry === 'string' ? parsed.industry.trim() || null : null,
            cleaned: true,
        };
    } catch (error) {
        await logWarn('ai.lead_data_cleaner.failed', {
            firstName: rawFirst,
            lastName: rawLast,
            error: error instanceof Error ? error.message : String(error),
        });
        // Fallback: pulisci solo con regex locali senza AI
        return {
            firstName: rawFirst || null,
            lastName: nameDuplicated ? rawLast.replace(new RegExp(rawFirst, 'gi'), '').trim() : rawLast || null,
            jobTitle: titleDirty ? null : rawTitle || null,
            accountName: companyDirty ? null : rawCompany || null,
            inferredEmail: null,
            linkedinHeadline: null,
            location: null,
            industry: null,
            cleaned: true,
        };
    }
}
