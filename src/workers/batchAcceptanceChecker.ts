/**
 * workers/batchAcceptanceChecker.ts — Verifica accettazione inviti in batch.
 *
 * Invece di visitare il profilo di ogni lead INVITED individualmente (100 visite),
 * visita l'invitation manager (/mynetwork/invitation-manager/sent/) UNA SOLA volta
 * e verifica tutti gli inviti pending in un colpo.
 *
 * Chiamato all'inizio della sessione, PRIMA dei job individuali.
 * I lead trovati nell'invitation manager con stato "pending" restano INVITED.
 * I lead NON trovati → probabilmente accettati → schedulati per acceptance check individuale.
 *
 * Questo riduce del 90%+ le visite profilo per acceptance check.
 */

import type { Page } from 'playwright';
import { humanDelay, simulateHumanReading } from '../browser/humanBehavior';
import { logInfo, logWarn } from '../telemetry/logger';
import { getDatabase } from '../db';
import { normalizeLinkedInUrl } from '../linkedinUrl';

export interface BatchAcceptanceResult {
    totalInvited: number;
    pendingFound: number;
    probablyAccepted: number;
    errors: number;
    durationMs: number;
}

/**
 * Visita l'invitation manager e raccoglie gli URL dei lead con invito ancora pending.
 * I lead INVITED nel DB che NON appaiono nella lista pending → probabilmente accettati.
 */
export async function runBatchAcceptanceCheck(
    page: Page,
    accountId: string,
): Promise<BatchAcceptanceResult> {
    const startMs = Date.now();
    const result: BatchAcceptanceResult = {
        totalInvited: 0,
        pendingFound: 0,
        probablyAccepted: 0,
        errors: 0,
        durationMs: 0,
    };

    try {
        const db = await getDatabase();

        // Carica tutti i lead INVITED da >2 giorni (stessa logica di H13)
        const invitedLeads = await db.query<{ id: number; linkedin_url: string }>(
            `SELECT id, linkedin_url FROM leads
             WHERE status = 'INVITED'
               AND invited_at IS NOT NULL
               AND invited_at <= DATETIME('now', '-2 days')
             ORDER BY invited_at ASC
             LIMIT 200`,
        );

        if (invitedLeads.length === 0) {
            result.durationMs = Date.now() - startMs;
            return result;
        }

        result.totalInvited = invitedLeads.length;

        // Naviga all'invitation manager
        await page.goto('https://www.linkedin.com/mynetwork/invitation-manager/sent/', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
        await humanDelay(page, 2000, 4000);
        await simulateHumanReading(page);

        // Raccoglie tutti gli URL dei lead con invito pending dalla pagina
        const pendingUrls = new Set<string>();

        // Scroll per caricare tutti gli inviti (LinkedIn usa lazy loading)
        for (let scroll = 0; scroll < 10; scroll++) {
            const urls = await page.evaluate(() => {
                const links = document.querySelectorAll('a[href*="/in/"]');
                return Array.from(links).map((a) => (a as HTMLAnchorElement).href);
            });

            for (const url of urls) {
                const normalized = normalizeLinkedInUrl(url);
                if (normalized) pendingUrls.add(normalized.toLowerCase().replace(/\/+$/, ''));
            }

            // Scroll per caricare più inviti
            await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
            await humanDelay(page, 800, 1500);

            // Check se "Show more" / "Mostra altro" è visibile
            const showMore = page.locator('button:has-text("Show more"), button:has-text("Mostra altro")').first();
            if ((await showMore.count()) > 0 && (await showMore.isVisible().catch(() => false))) {
                await showMore.click().catch(() => null);
                await humanDelay(page, 1500, 3000);
            } else {
                // Se non c'è "Show more", abbiamo caricato tutto
                const atBottom = await page.evaluate(() =>
                    window.scrollY + window.innerHeight >= document.body.scrollHeight - 200
                ).catch(() => true);
                if (atBottom) break;
            }
        }

        await logInfo('batch_acceptance.pending_urls_collected', {
            accountId,
            pendingUrlsCount: pendingUrls.size,
            totalInvited: invitedLeads.length,
        });

        // Confronta con i lead INVITED nel DB
        // Lead INVITED nel DB ma NON nella lista pending → probabilmente accettati
        for (const lead of invitedLeads) {
            const normalizedUrl = lead.linkedin_url.toLowerCase().replace(/\/+$/, '');
            if (!pendingUrls.has(normalizedUrl)) {
                // Questo lead NON è nella lista pending → probabilmente accettato (o rifiutato)
                // Marca per acceptance check individuale con priorità alta
                try {
                    await db.run(
                        `UPDATE leads SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'INVITED'`,
                        [lead.id],
                    );
                    result.probablyAccepted++;
                } catch (updateErr) {
                    result.errors++;
                    void logWarn('batch_acceptance.update_failed', {
                        leadId: lead.id,
                        error: updateErr instanceof Error ? updateErr.message : String(updateErr),
                    });
                }
            } else {
                result.pendingFound++;
            }
        }

        await logInfo('batch_acceptance.completed', {
            accountId,
            totalInvited: result.totalInvited,
            pendingFound: result.pendingFound,
            probablyAccepted: result.probablyAccepted,
            errors: result.errors,
        });
    } catch (err) {
        await logWarn('batch_acceptance.failed', {
            accountId,
            error: err instanceof Error ? err.message : String(err),
        });
        result.errors++;
    }

    result.durationMs = Date.now() - startMs;
    return result;
}
