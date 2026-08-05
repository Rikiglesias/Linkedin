/**
 * integrations/persistEnrichment.ts
 * Funzione condivisa per persistere i risultati di enrichment nel DB.
 * Usata sia dall'enrichmentWorker (job asincrono) sia dall'inviteWorker (enrichment al volo).
 * Centralizzata qui per evitare duplicazione SQL e garantire coerenza.
 */

import { getDatabase } from '../db';

export interface EnrichmentPersistInput {
    leadId: number;
    email?: string | null;
    phone?: string | null;
    companyDomain?: string | null;
    businessEmail?: string | null;
    businessEmailConfidence?: number | null;
    emailConfidence?: number | null;
    companyName?: string | null;
    industry?: string | null;
    seniority?: string | null;
    jobTitle?: string | null;
    location?: string | null;
    source?: string | null;
    domainSource?: string | null;
    deepEnrichment?: {
        department?: string | null;
        socialProfiles?: unknown[];
    } | null;
}

// NB: qui NON vive un guard "lead già arricchito". La selezione dei candidati è di
// `getLeadsNeedingEnrichment` (leadsCore.ts:1412), che fa LEFT JOIN su lead_enrichment_data e
// ri-accoda DI PROPOSITO un lead già arricchito quando manca `business_email` e c'è un
// `account_name` su cui ritentare. Un guard "già presente in tabella" qui spegnerebbe quel ramo.

/**
 * Persiste i risultati di enrichment: aggiorna campi core su leads + salva in lead_enrichment_data.
 */
export async function persistEnrichmentResult(input: EnrichmentPersistInput): Promise<void> {
    const db = await getDatabase();

    await db.run(
        `UPDATE leads SET
            email = COALESCE(email, ?),
            phone = COALESCE(phone, ?),
            company_domain = COALESCE(company_domain, ?),
            business_email = COALESCE(business_email, ?),
            business_email_confidence = CASE
                WHEN business_email IS NOT NULL THEN business_email_confidence
                WHEN ? IS NOT NULL THEN ?
                ELSE business_email_confidence
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
            input.email ?? null,
            input.phone ?? null,
            input.companyDomain ?? null,
            input.businessEmail ?? null,
            input.businessEmail ?? null,
            input.businessEmailConfidence ?? null,
            input.leadId,
        ],
    );

    await db.run(
        `INSERT OR REPLACE INTO lead_enrichment_data
         (lead_id, company_json, phones_json, socials_json, seniority, department, data_points, confidence, sources_json, domain_source, enriched_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
            input.leadId,
            input.companyName || input.companyDomain || input.industry
                ? JSON.stringify({ name: input.companyName, domain: input.companyDomain, industry: input.industry })
                : null,
            input.phone ? JSON.stringify([{ number: input.phone, type: 'work', source: input.source }]) : null,
            input.deepEnrichment?.socialProfiles?.length ? JSON.stringify(input.deepEnrichment.socialProfiles) : null,
            input.seniority ?? null,
            input.deepEnrichment?.department ?? null,
            [input.email, input.phone, input.jobTitle, input.companyName, input.location, input.seniority].filter(
                Boolean,
            ).length,
            input.emailConfidence ?? null,
            JSON.stringify([input.source ?? 'unknown']),
            input.domainSource ?? null,
        ],
    );
}
