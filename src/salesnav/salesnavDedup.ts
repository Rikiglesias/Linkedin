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
    firstName: string;
    lastName: string;
    company: string;
    title: string;
    location: string;
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
            firstName: string;
            lastName: string;
            company: string;
            title: string;
            location: string;
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

            // Split nome/cognome: "Mario Rossi" → firstName="Mario", lastName="Rossi"
            const nameParts = name.split(/\s+/).filter(Boolean);
            const firstName = nameParts[0] ?? '';
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

            // Pattern "grado di connessione" che inquinano company/title
            const connectionDegreeRe = /^[1-4]°$|collegamento di \d+° grado|\d+(?:st|nd|rd|th) degree|degree connection/i;

            // ── Company: prova selettori specifici, poi fallback testo card ──
            const companyEl =
                card?.querySelector('[data-anonymize="company-name"]') ??
                card?.querySelector('a[href*="/sales/company/"]') ??
                card?.querySelector('[class*="company"]') ??
                card?.querySelector('[class*="account-name"]');
            let company = (companyEl?.textContent ?? '').trim();
            // Scarta valori che sono gradi di connessione, non aziende
            if (connectionDegreeRe.test(company)) company = '';

            // ── Title: prova selettori specifici ──
            const titleEl =
                card?.querySelector('[data-anonymize="title"]') ??
                card?.querySelector('span.result-lockup__highlight-keyword') ??
                card?.querySelector('[class*="body-text"]');
            let title = (titleEl?.textContent ?? '').trim();
            // Scarta valori che sono gradi di connessione, non titoli
            if (connectionDegreeRe.test(title)) title = '';

            // ── Location: prova selettori specifici ──
            const locationEl =
                card?.querySelector('[data-anonymize="location"]') ??
                card?.querySelector('[data-anonymize="geography"]') ??
                card?.querySelector('span.result-lockup__misc-item') ??
                card?.querySelector('[class*="member-location"]') ??
                card?.querySelector('[class*="geography"]') ??
                card?.querySelector('[class*="location"]');
            let location = (locationEl?.textContent ?? '').trim();

            // ── FALLBACK TESTUALE: se i selettori specifici non trovano nulla,
            // parsa il testo completo della card. SalesNav mostra sempre:
            //   Nome
            //   Titolo at Azienda (o "presso" in italiano)
            //   Località
            // ──
            if (card && (!company || !title)) {
                const cardText = ((card as HTMLElement).innerText || card.textContent || '').trim();
                const lines = cardText
                    .split('\n')
                    .map((l: string) => l.replace(/\s+/g, ' ').trim())
                    .filter((l: string) => l.length > 1)
                    // Rimuovi righe di navigazione/pulsanti
                    .filter((l: string) => !/^(select|save|view|message|connect|inmail|more|seleziona|salva|visualizza|messaggio|collegati|altro)$/i.test(l))
                    // Rimuovi la riga del nome (già estratto)
                    .filter((l: string) => l !== name);

                // La riga "titolo at/presso azienda" contiene " at " o " presso "
                if (!company || !title) {
                    const titleCompanyLine = lines.find(
                        (l: string) => / (?:at|presso|@|bei|chez|en) /i.test(l),
                    );
                    if (titleCompanyLine) {
                        const parts = titleCompanyLine.split(/ (?:at|presso|@|bei|chez|en) /i);
                        if (!title && parts[0]) title = parts[0].trim();
                        if (!company && parts[1]) company = parts[1].trim();
                    }
                }

                // Se company non trovata: cerca link a company page
                if (!company) {
                    const companyLink = card.querySelector<HTMLAnchorElement>(
                        'a[href*="/sales/company/"], a[href*="/company/"]',
                    );
                    if (companyLink) {
                        company = (companyLink.textContent ?? '').trim();
                    }
                }

                // Se location non trovata: cerca pattern città tipico nelle righe rimanenti
                if (!location && lines.length > 0) {
                    // Location è spesso l'ultima riga breve (< 60 char) con virgola
                    const locationLine = lines.find(
                        (l: string) => l.length < 60 && /,/.test(l) && !/\d{4}/.test(l) && l !== company && l !== title,
                    );
                    if (locationLine) location = locationLine;
                }
            }

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
                firstName,
                lastName,
                company,
                title,
                location,
            });
        }

        return results;
    });

    // Filtra profili senza dati identificativi sufficienti:
    // serve almeno un URL O un nome non vuoto per dedup affidabile
    const validProfiles = profiles.filter((p) => {
        const hasUrl = !!p.salesnavUrl || !!p.linkedinUrl;
        const hasName = p.name.length > 0;
        if (!hasUrl && !hasName) {
            void logWarn('salesnav.dedup.profile_skipped', {
                reason: 'no_identifying_data',
                salesnavUrl: p.salesnavUrl,
                linkedinUrl: p.linkedinUrl,
            });
        }
        return hasUrl || hasName;
    });

    return validProfiles.map((p) => ({
        ...p,
        nameCompanyHash: p.name.length > 0 && p.company.length > 0
            ? computeNameCompanyHash(p.name, p.company)
            : '',
    })) as ExtractedProfile[];
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

    // H05: Batch dedup — carica TUTTI i membri della lista in Set una volta sola.
    // Prima: 3 query DB per profilo × 25 profili/pagina = 75 query SELECT per pagina.
    // Ora: 3 query totali (una per LinkedIn URL, una per SalesNav URL, una per hash).
    const existingLinkedinUrls = new Set<string>();
    const existingSalesnavUrls = new Set<string>();
    const existingHashes = new Map<string, string>(); // hash → profile_name

    const linkedinRows = await db.query<{ linkedin_url: string }>(
        'SELECT linkedin_url FROM salesnav_list_members WHERE list_name = ? AND linkedin_url IS NOT NULL',
        [listName],
    );
    for (const row of linkedinRows) existingLinkedinUrls.add(row.linkedin_url);

    const salesnavRows = await db.query<{ salesnav_url: string }>(
        'SELECT salesnav_url FROM salesnav_list_members WHERE list_name = ? AND salesnav_url IS NOT NULL',
        [listName],
    );
    for (const row of salesnavRows) existingSalesnavUrls.add(row.salesnav_url);

    const hashRows = await db.query<{ name_company_hash: string; profile_name: string }>(
        'SELECT name_company_hash, profile_name FROM salesnav_list_members WHERE list_name = ? AND name_company_hash IS NOT NULL AND name_company_hash != \'\'',
        [listName],
    );
    for (const row of hashRows) existingHashes.set(row.name_company_hash, row.profile_name);

    for (const profile of profiles) {
        // Level 1: LinkedIn URL match (O(1) Set lookup)
        if (profile.linkedinUrl && existingLinkedinUrls.has(profile.linkedinUrl)) {
            alreadySaved++;
            continue;
        }

        // Level 2: SalesNav URL match (O(1) Set lookup)
        if (profile.salesnavUrl && existingSalesnavUrls.has(profile.salesnavUrl)) {
            alreadySaved++;
            continue;
        }

        // Level 3: Fuzzy name+company hash (warning only, non blocco)
        if (profile.nameCompanyHash && profile.nameCompanyHash.length > 0) {
            const existingName = existingHashes.get(profile.nameCompanyHash);
            if (existingName) {
                fuzzyWarnings++;
                void logWarn('salesnav.dedup.fuzzy_match', {
                    listName,
                    newName: profile.name,
                    existingName,
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
                 (list_name, linkedin_url, salesnav_url, profile_name, first_name, last_name, company, title, location, name_company_hash, run_id, search_index, page_number)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    listName,
                    profile.linkedinUrl,
                    profile.salesnavUrl,
                    profile.name || null,
                    profile.firstName || null,
                    profile.lastName || null,
                    profile.company || null,
                    profile.title || null,
                    profile.location || null,
                    profile.nameCompanyHash || null,
                    runId,
                    searchIndex,
                    pageNumber,
                ],
            );
            inserted++;
        } catch {
            // UNIQUE constraint violation — profilo già presente, ignora
        }

        // Arricchisci record esistenti: aggiorna campi NULL con dati nuovi
        if (profile.salesnavUrl) {
            const updates: string[] = [];
            const values: unknown[] = [];
            if (profile.firstName) { updates.push('first_name = ?'); values.push(profile.firstName); }
            if (profile.lastName) { updates.push('last_name = ?'); values.push(profile.lastName); }
            if (profile.company) { updates.push('company = ?'); values.push(profile.company); }
            if (profile.title) { updates.push('title = ?'); values.push(profile.title); }
            if (profile.location) { updates.push('location = ?'); values.push(profile.location); }
            if (profile.nameCompanyHash) { updates.push('name_company_hash = ?'); values.push(profile.nameCompanyHash); }
            if (updates.length > 0) {
                // Aggiorna solo campi ancora NULL (non sovrascrivere dati esistenti)
                const setClauses = updates.map(u => {
                    const col = u.split(' = ')[0];
                    return `${col} = COALESCE(${col}, ?)`;
                });
                values.push(listName, profile.salesnavUrl);
                await db.run(
                    `UPDATE salesnav_list_members SET ${setClauses.join(', ')} WHERE list_name = ? AND salesnav_url = ?`,
                    values,
                ).catch(() => {});
            }
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
