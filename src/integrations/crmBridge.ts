/**
 * crmBridge.ts — CRM Sync (HubSpot + Salesforce)
 *
 * Sincronizzazione bidirezionale:
 *   PUSH: quando un lead cambia stato significativo → invia evento al CRM
 *   PULL: recupera nuovi contatti dal CRM → upserta come lead con status READY_INVITE
 *
 * HubSpot: Private App Token (HUBSPOT_API_KEY)
 * Salesforce: OAuth2 Client Credentials flow
 *
 * Entrambi i canali sono opzionali: se le chiavi non sono configurate
 * le funzioni ritornano silenziosamente senza errori.
 */

import { config } from '../config';
import { logInfo, logWarn } from '../telemetry/logger';
import { getDatabase } from '../db';

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface CRMLead {
    linkedinUrl: string;
    fullName?: string;
    email?: string;
    company?: string;
    status: string;
}

// ─── HubSpot ─────────────────────────────────────────────────────────────────

/** Invia/aggiorna un contatto in HubSpot tramite REST API v3. */
export async function pushToHubSpot(lead: CRMLead): Promise<boolean> {
    if (!config.hubspotApiKey) return false;

    try {
        const body = {
            properties: {
                linkedin_url: lead.linkedinUrl,
                firstname: (lead.fullName || '').split(' ')[0] || '',
                lastname: (lead.fullName || '').split(' ').slice(1).join(' ') || '',
                email: lead.email || '',
                company: lead.company || '',
                bot_status: lead.status,
                hs_lead_status: mapStatusToHubSpot(lead.status),
            }
        };

        const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.hubspotApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok && res.status !== 409) {
            // 409 = contact già esistente, ignorabile
            const errText = await res.text().catch(() => '');
            await logWarn('crm.hubspot.push_failed', { status: res.status, body: errText.substring(0, 200) });
            return false;
        }

        await logInfo('crm.hubspot.pushed', { linkedinUrl: lead.linkedinUrl, status: lead.status });
        return true;
    } catch (err: unknown) {
        await logWarn('crm.hubspot.error', { error: err instanceof Error ? err.message : String(err) });
        return false;
    }
}

function mapStatusToHubSpot(status: string): string {
    const map: Record<string, string> = {
        'READY_INVITE': 'NEW',
        'INVITED': 'IN_PROGRESS',
        'ACCEPTED': 'OPEN',
        'MESSAGED': 'IN_PROGRESS',
        'REPLIED': 'CONNECTED',
        'WITHDRAWN': 'UNQUALIFIED',
    };
    return map[status] || 'NEW';
}

/** Recupera nuovi contatti da HubSpot (aggiornati nelle ultime 24h). */
export async function pullFromHubSpot(): Promise<number> {
    if (!config.hubspotApiKey) return 0;

    try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const url = `https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=linkedin_url,firstname,lastname,company&filterGroups=[{"filters":[{"propertyName":"lastmodifieddate","operator":"GTE","value":"${since}"}]}]`;

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${config.hubspotApiKey}` }
        });

        if (!res.ok) return 0;
        const data = await res.json() as { results?: Array<{ properties: Record<string, string> }> };

        const db = await getDatabase();
        let imported = 0;

        for (const contact of data.results || []) {
            const props = contact.properties;
            const linkedinUrl = props.linkedin_url;
            if (!linkedinUrl || !linkedinUrl.includes('linkedin.com')) continue;

            await db.run(
                `INSERT INTO leads (linkedin_url, full_name, company_name, status, source, created_at)
                 VALUES (?, ?, ?, 'READY_INVITE', 'hubspot', datetime('now'))
                 ON CONFLICT(linkedin_url) DO NOTHING`,
                [linkedinUrl, `${props.firstname || ''} ${props.lastname || ''}`.trim(), props.company || '']
            );
            imported++;
        }

        if (imported > 0) await logInfo('crm.hubspot.pulled', { count: imported });
        return imported;
    } catch (err: unknown) {
        await logWarn('crm.hubspot.pull_error', { error: err instanceof Error ? err.message : String(err) });
        return 0;
    }
}

// ─── Salesforce ───────────────────────────────────────────────────────────────

let _salesforceToken: { access_token: string; expiresAt: number } | null = null;

async function getSalesforceToken(): Promise<string | null> {
    if (!config.salesforceInstanceUrl || !config.salesforceClientId || !config.salesforceClientSecret) return null;

    if (_salesforceToken && Date.now() < _salesforceToken.expiresAt) {
        return _salesforceToken.access_token;
    }

    try {
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: config.salesforceClientId,
            client_secret: config.salesforceClientSecret,
        });

        const res = await fetch(`${config.salesforceInstanceUrl}/services/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        if (!res.ok) return null;
        const data = await res.json() as { access_token: string; expires_in?: number };
        _salesforceToken = {
            access_token: data.access_token,
            expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
        };
        return _salesforceToken.access_token;
    } catch {
        return null;
    }
}

/** Upserta un lead in Salesforce come Contact. */
export async function pushToSalesforce(lead: CRMLead): Promise<boolean> {
    const token = await getSalesforceToken();
    if (!token) return false;

    try {
        const body = {
            LinkedIn_URL__c: lead.linkedinUrl,
            FirstName: (lead.fullName || '').split(' ')[0] || '',
            LastName: (lead.fullName || '').split(' ').slice(1).join(' ') || 'Unknown',
            Account: { Name: lead.company || '' },
            Bot_Status__c: lead.status,
        };

        const res = await fetch(`${config.salesforceInstanceUrl}/services/data/v58.0/sobjects/Contact`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok && res.status !== 400) {
            await logWarn('crm.salesforce.push_failed', { status: res.status });
            return false;
        }

        return true;
    } catch (err: unknown) {
        await logWarn('crm.salesforce.error', { error: err instanceof Error ? err.message : String(err) });
        return false;
    }
}

// ─── Fan-out pubblico ─────────────────────────────────────────────────────────

/** Invia l'evento a tutti i CRM configurati (fire-and-forget). */
export function pushLeadToCRM(lead: CRMLead): void {
    if (config.hubspotApiKey) pushToHubSpot(lead).catch(() => { });
    if (config.salesforceClientId) pushToSalesforce(lead).catch(() => { });
}

/** Pull da tutti i CRM configurati (fire-and-forget). */
export async function pullLeadsFromCRM(): Promise<void> {
    if (config.hubspotApiKey) {
        const n = await pullFromHubSpot().catch(() => 0);
        if (n > 0) console.log(`[CRM] Importati ${n} nuovi lead da HubSpot`);
    }
    // Salesforce SOQL pull: omesso nella versione base — richiede mapping
    // personalizzato per ogni customer. Si aggiunge tramite plugin.
}
