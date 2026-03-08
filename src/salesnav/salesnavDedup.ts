/**
 * salesnav/salesnavDedup.ts
 * ─────────────────────────────────────────────────────────────────
 * Deduplicazione per-persona per Sales Navigator bulk save.
 *
 * 3 livelli di dedup (migration 036):
 *   1. URL LinkedIn (/in/username) — match esatto, dedup forte
 *   2. URL SalesNav (/sales/lead/xxx) — match esatto, dedup forte
 *   3. Hash nome+azienda — fuzzy, warning only (omonimi = non blocco)
 *
 * extractProfileUrlsFromPage() estrae i dati dal DOM delle card lead.
 * Le scritture in salesnav_list_members avvengono SOLO DOPO
 * "Save to list" confermato — mai prima.
 */

import { createHash } from 'crypto';
import type { Page } from 'playwright';
import { getDatabase } from '../db';
import { logInfo, logWarn } from '../telemetry/logger';

export interface ExtractedProfile {
    salesnavUrl: string | null;
    linkedinUrl: string | null;
    name: string;
    company: string;
    title: string;
    nameCompanyHash: string;
}

export interface DedupResult {
    totalOnPage: number;
    alreadySaved: number;
    newProfiles: number;
    fuzzyWarnings: number;
}

/**
 * Genera l'hash SHA1 nome+azienda per dedup fuzzy (livello 3).
 * Normalizza: lowercase, trim, rimuove spazi multipli.
 */
function computeNameCompanyHash(name: string, company: string): string {
    const normalized = `${name.toLowerCase().trim().replace(/\s+/g, ' ')}|${company.toLowerCase().trim().replace(/\s+/g, ' ')}`;
    return createHash('sha1').update(normalized).digest('hex');
}

/**
 * Estrae i profili visibili dalla pagina dei risultati Sales Navigator.
 * Strategia DOM primary: cerca anchors con URL SalesNav/LinkedIn e
 * testo strutturato delle card per nome/azienda/titolo.
 */
export async function extractProfileUrlsFromPage(page: Page): Promise<ExtractedProfile[]> {
    const profiles = await page.evaluate(() => {
        const results: Array<{
            salesnavUrl: string | null;
            linkedinUrl: string | null;
            name: string;
            company: string;
            title: string;
        }> = [];

        // SalesNav lead cards: ogni card ha un link al profilo SalesNav
        const leadLinks = document.querySelectorAll<HTMLAnchorElement>(
            'a[href*="/sales/lead/"], a[href*="/sales/people/"]',
        );

        const seen = new Set<string>();
        for (const link of leadLinks) {
            const href = link.getAttribute('href') ?? '';
            // Evita duplicati per link multipli nella stessa card
            const leadId = href.match(/\/(lead|people)\/([^,/?]+)/)?.[2];
            if (!leadId || seen.has(leadId)) continue;
            seen.add(leadId);

            // Risali alla card container
            const card =
                link.closest('[data-x--lead-card]') ??
                link.closest('li[class*="search-results"]') ??
                link.closest('li') ??
                link.closest('article') ??
                link.parentElement?.parentElement;

            const nameEl =
                card?.querySelector('[data-anonymize="person-name"]') ??
                card?.querySelector('span.result-lockup__name') ??
                link;
            const name = (nameEl?.textContent ?? '').trim();

            const companyEl =
                card?.querySelector('[data-anonymize="company-name"]') ??
                card?.querySelector('span.result-lockup__subtitle') ??
                card?.querySelector('a[href*="/sales/company/"]');
            const company = (companyEl?.textContent ?? '').trim();

            const titleEl =
                card?.querySelector('[data-anonymize="title"]') ??
                card?.querySelector('span.result-lockup__highlight-keyword');
            const title = (titleEl?.textContent ?? '').trim();

            // Cerca anche il link LinkedIn classico (se visibile)
            const linkedinLink = card?.querySelector<HTMLAnchorElement>(
                'a[href*="linkedin.com/in/"]',
            );
            const linkedinUrl = linkedinLink
                ? (linkedinLink.getAttribute('href')?.match(/linkedin\.com\/in\/[^/?]+/)?.[0] ?? null)
                : null;

            const salesnavUrl = href.startsWith('http')
                ? href.split('?')[0]
                : `https://www.linkedin.com${href.split('?')[0]}`;

            results.push({
                salesnavUrl,
                linkedinUrl: linkedinUrl ? `https://www.${linkedinUrl}` : null,
                name,
                company,
                title,
            });
        }

        return results;
    });

    return profiles.map((p) => ({
        ...p,
        nameCompanyHash: computeNameCompanyHash(p.name, p.company),
    }));
}

/**
 * Controlla quanti profili estratti sono già presenti in salesnav_list_members.
 * Restituisce un DedupResult con conteggi utili per il report.
 */
export async function checkDuplicates(
    listName: string,
    profiles: ExtractedProfile[],
): Promise<DedupResult> {
    const db = await getDatabase();
    let alreadySaved = 0;
    let fuzzyWarnings = 0;

    for (const profile of profiles) {
        // Level 1: LinkedIn URL match
        if (profile.linkedinUrl) {
            const existsByLinkedin = await db.get<{ id: number }>(
                'SELECT id FROM salesnav_list_members WHERE list_name = ? AND linkedin_url = ?',
                [listName, profile.linkedinUrl],
            );
            if (existsByLinkedin) {
                alreadySaved++;
                continue;
            }
        }

        // Level 2: SalesNav URL match
        if (profile.salesnavUrl) {
            const existsBySalesnav = await db.get<{ id: number }>(
                'SELECT id FROM salesnav_list_members WHERE list_name = ? AND salesnav_url = ?',
                [listName, profile.salesnavUrl],
            );
            if (existsBySalesnav) {
                alreadySaved++;
                continue;
            }
        }

        // Level 3: Fuzzy name+company hash (warning only, non blocco)
        if (profile.nameCompanyHash) {
            const fuzzyMatch = await db.get<{ id: number; profile_name: string }>(
                'SELECT id, profile_name FROM salesnav_list_members WHERE list_name = ? AND name_company_hash = ?',
                [listName, profile.nameCompanyHash],
            );
            if (fuzzyMatch) {
                fuzzyWarnings++;
                void logWarn('salesnav.dedup.fuzzy_match', {
                    listName,
                    newName: profile.name,
                    existingName: fuzzyMatch.profile_name,
                    hash: profile.nameCompanyHash.substring(0, 8),
                });
            }
        }
    }

    return {
        totalOnPage: profiles.length,
        alreadySaved,
        newProfiles: profiles.length - alreadySaved,
        fuzzyWarnings,
    };
}

/**
 * Salva i profili estratti in salesnav_list_members.
 * DA CHIAMARE SOLO DOPO "Save to list" confermato su LinkedIn.
 * Usa INSERT OR IGNORE per gestire race condition e re-run.
 */
export async function saveExtractedProfiles(
    listName: string,
    profiles: ExtractedProfile[],
    runId: number,
    searchIndex: number,
    pageNumber: number,
): Promise<number> {
    const db = await getDatabase();
    let inserted = 0;

    for (const profile of profiles) {
        try {
            await db.run(
                `INSERT OR IGNORE INTO salesnav_list_members
                 (list_name, linkedin_url, salesnav_url, profile_name, company, title, name_company_hash, run_id, search_index, page_number)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    listName,
                    profile.linkedinUrl,
                    profile.salesnavUrl,
                    profile.name,
                    profile.company,
                    profile.title,
                    profile.nameCompanyHash,
                    runId,
                    searchIndex,
                    pageNumber,
                ],
            );
            inserted++;
        } catch {
            // UNIQUE constraint violation — profilo già presente, ignora
        }
    }

    void logInfo('salesnav.dedup.profiles_saved', {
        listName,
        runId,
        searchIndex,
        pageNumber,
        attempted: profiles.length,
        inserted,
    });

    return inserted;
}
