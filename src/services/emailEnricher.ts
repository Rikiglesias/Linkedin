import { logInfo, logError, logWarn } from '../telemetry/logger';
import { getDatabase } from '../db';

export interface EnrichmentConfig {
    provider: 'hunter' | 'dropcontact' | 'mock';
    apiKey?: string;
}

export interface EnrichmentResult {
    success: boolean;
    email?: string | null;
    phone?: string | null;
    statusDetail: string;
}

export class EmailEnricherService {
    private config: EnrichmentConfig;

    constructor(config?: EnrichmentConfig) {
        // Usa mock di default per sviluppo se non configurato
        this.config = config ?? { provider: 'mock' };
    }

    /**
     * Tenta di risolvere i dati di contatto. In caso di fallimento o limite API,
     * non propaga l'errore per preservare il lifecycle della drip campaign.
     */
    public async enrichLeadContactData(
        leadId: number,
        firstName: string,
        lastName: string,
        companyName: string,
        website?: string,
    ): Promise<EnrichmentResult> {
        try {
            await logInfo('enrichment.job_started', { leadId, provider: this.config.provider });

            const db = await getDatabase();
            const gdprRow = await db.get<{ gdpr_opt_out: number }>(`SELECT gdpr_opt_out FROM leads WHERE id = ?`, [
                leadId,
            ]);
            if (gdprRow?.gdpr_opt_out === 1) {
                await logWarn('enrichment.gdpr_opt_out', {
                    leadId,
                    reason: 'Lead ha gdpr_opt_out=1, enrichment skippato per compliance GDPR.',
                });
                return { success: false, statusDetail: 'gdpr_opt_out' };
            }

            if (this.config.provider === 'mock' || !this.config.apiKey) {
                await logWarn('enrichment.api_missing_or_mock', {
                    leadId,
                    reason: 'API key mancante o forzato MOCK mode. Lo step verrà bypassato.',
                });
                return { success: false, statusDetail: 'skipped_no_api_key' };
            }

            // Implementazione Adapter "Hunter.io" di base come wrapper asincrono
            if (this.config.provider === 'hunter') {
                return await this.callHunterAPI(leadId, firstName, lastName, companyName, website);
            }

            // Implementazione DropContact, eccetera...

            return { success: false, statusDetail: 'unsupported_provider' };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            await logError('enrichment.fatal_error', { leadId, error: msg });
            return { success: false, statusDetail: `error: ${msg}` };
        }
    }

    private async callHunterAPI(
        leadId: number,
        firstName: string,
        lastName: string,
        companyName: string,
        website?: string,
    ): Promise<EnrichmentResult> {
        // Il dominio o il workspace URL è cruciale per usare Email Finder di Hunter
        const targetDomain = website ? this.extractDomain(website) : this.extractDomain(companyName);

        if (!targetDomain) {
            await logWarn('enrichment.hunter.missing_domain', { leadId });
            return { success: false, statusDetail: 'missing_domain_for_hunter' };
        }

        const url = new URL('https://api.hunter.io/v2/email-finder');
        url.searchParams.append('domain', targetDomain);
        url.searchParams.append('first_name', firstName);
        url.searchParams.append('last_name', lastName);
        const apiKey = this.config.apiKey ?? '';
        url.searchParams.append('api_key', apiKey);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            // E.g. Rate Limit (429) o Non Trovato (404)
            if (response.status === 429) {
                await logWarn('enrichment.hunter.rate_limited', { leadId });
                return { success: false, statusDetail: 'rate_limit_exceeded' };
            }
            if (response.status === 404) {
                await logInfo('enrichment.hunter.not_found', { leadId });
                return { success: true, email: null, statusDetail: 'email_not_found' };
            }
            throw new Error(`Hunter API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const foundEmail = data?.data?.email ?? null;
        const foundPhone = data?.data?.phone_number ?? null; // Hunter raramente fornisce telefoni

        if (foundEmail) {
            await this.updateLeadContactOnDB(leadId, foundEmail, foundPhone);
        }

        return {
            success: true,
            email: foundEmail,
            phone: foundPhone,
            statusDetail: foundEmail ? 'enriched' : 'no_data',
        };
    }

    private extractDomain(input: string): string | null {
        // Tenta di estrarre un dominio da un URL o pulisce il nome azienda per provarlo come dominio .com
        try {
            if (input.startsWith('http')) {
                const url = new URL(input);
                return url.hostname.replace(/^www\./, '');
            }
            // Fallback euristico se l'utente ha inserito "Microsoft" -> cerchiamo microsoft.com (limitato, ma hunter permette company name finders sulle API separate)
            const clean = input.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (clean.length > 2) return `${clean}.com`;
            return null;
        } catch {
            return null;
        }
    }

    private async updateLeadContactOnDB(leadId: number, email: string | null, phone: string | null): Promise<void> {
        const db = await getDatabase();
        await db.run(
            `UPDATE leads SET email = COALESCE(email, ?), phone = COALESCE(phone, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [email, phone, leadId],
        );
        await logInfo('enrichment.db_updated', { leadId, emailSet: !!email, phoneSet: !!phone });
    }
}

// Esporto singleton factory
let defaultEnricher: EmailEnricherService | null = null;
export function getEmailEnricher(): EmailEnricherService {
    if (!defaultEnricher) {
        // Si aspetta la config. Da .env
        defaultEnricher = new EmailEnricherService({
            provider: (process.env.ENRICHMENT_PROVIDER as 'hunter' | 'dropcontact') ?? 'mock',
            apiKey: process.env.ENRICHMENT_API_KEY,
        });
    }
    return defaultEnricher;
}
