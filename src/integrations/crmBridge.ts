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
import { fetchWithRetryPolicy } from '../core/integrationPolicy';

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface CRMLead {
    linkedinUrl: string;
    fullName?: string;
    email?: string;
    company?: string;
    status: string;
}

function splitFullName(fullName?: string): { firstName: string; lastName: string } {
    const normalized = (fullName ?? '').trim().replace(/\s+/g, ' ');
    if (!normalized) {
        return { firstName: '', lastName: '' };
    }
    const parts = normalized.split(' ');
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ');
    return { firstName, lastName };
}

function cleanLinkedinUrl(raw: string | undefined): string {
    return (raw ?? '').trim();
}

// ─── HubSpot ─────────────────────────────────────────────────────────────────

/** Invia/aggiorna un contatto in HubSpot tramite REST API v3. */
export async function pushToHubSpot(lead: CRMLead): Promise<boolean> {
    if (!config.hubspotApiKey) return false;

    try {
        const names = splitFullName(lead.fullName);
        const body = {
            properties: {
                linkedin_url: lead.linkedinUrl,
                firstname: names.firstName,
                lastname: names.lastName,
                email: lead.email || '',
                company: lead.company || '',
                bot_status: lead.status,
                hs_lead_status: mapStatusToHubSpot(lead.status),
            }
        };

        const res = await fetchWithRetryPolicy('https://api.hubapi.com/crm/v3/objects/contacts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.hubspotApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        }, {
            integration: 'hubspot.push_contact',
            circuitKey: 'hubspot.contacts',
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

        const res = await fetchWithRetryPolicy(url, {
            headers: { 'Authorization': `Bearer ${config.hubspotApiKey}` }
        }, {
            integration: 'hubspot.pull_contacts',
            circuitKey: 'hubspot.contacts',
        });

        if (!res.ok) return 0;
        const data = await res.json() as { results?: Array<{ properties: Record<string, string> }> };

        const db = await getDatabase();
        let imported = 0;

        for (const contact of data.results || []) {
            const props = contact.properties;
            const linkedinUrl = cleanLinkedinUrl(props.linkedin_url);
            if (!linkedinUrl || !linkedinUrl.includes('linkedin.com')) continue;
            const names = splitFullName(`${props.firstname || ''} ${props.lastname || ''}`.trim());

            const insertResult = await db.run(
                `INSERT INTO leads (
                    account_name,
                    first_name,
                    last_name,
                    job_title,
                    website,
                    linkedin_url,
                    status,
                    list_name,
                    created_at,
                    updated_at
                )
                 VALUES (?, ?, ?, ?, ?, ?, 'READY_INVITE', 'hubspot', datetime('now'), datetime('now'))
                 ON CONFLICT(linkedin_url) DO NOTHING`,
                [
                    props.company || '',
                    names.firstName,
                    names.lastName,
                    '',
                    '',
                    linkedinUrl,
                ]
            );
            if ((insertResult.changes ?? 0) > 0) {
                imported++;
            }
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

        const res = await fetchWithRetryPolicy(`${config.salesforceInstanceUrl}/services/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        }, {
            integration: 'salesforce.oauth_token',
            circuitKey: 'salesforce.oauth',
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
        const names = splitFullName(lead.fullName);
        const body = {
            LinkedIn_URL__c: lead.linkedinUrl,
            FirstName: names.firstName,
            LastName: names.lastName || 'Unknown',
            Account: { Name: lead.company || '' },
            Bot_Status__c: lead.status,
        };

        const res = await fetchWithRetryPolicy(`${config.salesforceInstanceUrl}/services/data/v58.0/sobjects/Contact`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        }, {
            integration: 'salesforce.push_contact',
            circuitKey: 'salesforce.contacts',
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
