/**
 * postExtractorWorker.ts — Estrazione Post e Commenti LinkedIn
 *
 * Per lead con leadScore >= 75, visita la sezione Activity del profilo
 * e recupera i testi degli ultimi 3 post. I dati vengono salvati in
 * lead_metadata come JSON e usati dal prompt AI per personalizzare il messaggio.
 *
 * Viene chiamato dall'orchestrator dopo lo scoring, prima dell'invio dell'invito.
 * È non bloccante: se fallisce, il bot continua normalmente.
 */

import type { Page } from 'playwright';
import { getDatabase } from '../db';
import { logInfo, logWarn } from '../telemetry/logger';

/** Sleep semplice in ms (non richiede Page). */
function sleep(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.round(minMs + Math.random() * (maxMs - minMs));
    return new Promise(resolve => setTimeout(resolve, delay));
}

/** Struttura di un post estratto. */
export interface ExtractedPost {
    text: string;          // Testo del post (troncato a 500 char)
    publishedAt?: string;  // Es. "3 giorni fa"
    likesApprox?: number;  // Likes approssimativi se visibili
}

const SCORE_THRESHOLD = 75;
const MAX_POSTS = 3;
const POST_TEXT_MAX_LEN = 500;

/**
 * Controlla se il lead ha già i post estratti in metadati.
 */
async function hasPostsExtracted(leadId: number): Promise<boolean> {
    const db = await getDatabase();
    const row = await db.get<{ lead_metadata: string }>(
        `SELECT lead_metadata FROM leads WHERE id = ?`, [leadId]
    );
    if (!row?.lead_metadata) return false;
    try {
        const meta = JSON.parse(row.lead_metadata) as Record<string, unknown>;
        return Array.isArray(meta.recent_posts) && (meta.recent_posts as unknown[]).length > 0;
    } catch {
        return false;
    }
}

/**
 * Salva i post estratti nel campo lead_metadata del lead.
 */
async function savePostsToLead(leadId: number, posts: ExtractedPost[]): Promise<void> {
    const db = await getDatabase();
    const row = await db.get<{ lead_metadata: string }>(
        `SELECT lead_metadata FROM leads WHERE id = ?`, [leadId]
    );

    let meta: Record<string, unknown> = {};
    if (row?.lead_metadata) {
        try { meta = JSON.parse(row.lead_metadata) as Record<string, unknown>; } catch { /* reset */ }
    }

    meta.recent_posts = posts;
    meta.posts_extracted_at = new Date().toISOString();

    await db.run(
        `UPDATE leads SET lead_metadata = ?, updated_at = datetime('now') WHERE id = ?`,
        [JSON.stringify(meta), leadId]
    );
}

/**
 * Estrae gli ultimi post dalla sezione Activity del profilo LinkedIn.
 * Deve essere chiamato con una Page già autenticata e navigata sul profilo.
 */
export async function extractLeadPosts(
    page: Page,
    profileUrl: string
): Promise<ExtractedPost[]> {
    const activityUrl = profileUrl.replace(/\/$/, '') + '/recent-activity/all/';

    try {
        await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await sleep(2000, 3500);

        // Selettori per i post nella sezione attività
        const postSelectors = [
            '[data-urn*="activity"] .feed-shared-update-v2__description',
            '.feed-shared-update-v2__description-wrapper span[dir="ltr"]',
            '.update-components-text span[dir="ltr"]',
        ];

        const posts: ExtractedPost[] = [];

        for (const selector of postSelectors) {
            const elements = await page.$$(selector);
            for (const el of elements.slice(0, MAX_POSTS)) {
                const text = (await el.innerText()).trim();
                if (text.length < 20) continue;
                posts.push({ text: text.substring(0, POST_TEXT_MAX_LEN) });
                if (posts.length >= MAX_POSTS) break;
            }
            if (posts.length >= MAX_POSTS) break;
        }

        return posts;
    } catch (err: unknown) {
        await logWarn('post_extractor.extraction_failed', {
            url: profileUrl,
            error: err instanceof Error ? err.message : String(err),
        });
        return [];
    }
}

/**
 * Worker principale: processa i lead con score >= SCORE_THRESHOLD
 * che non hanno ancora i post estratti.
 *
 * @param page - Pagina Playwright già autenticata
 * @param limit - Quanti lead processare per run (default: 5)
 */
export async function runPostExtractorWorker(page: Page, limit = 5): Promise<void> {
    await logInfo('post_extractor.start', { limit, scoreThreshold: SCORE_THRESHOLD });

    const db = await getDatabase();

    // Trova lead con score alto senza post estratti
    const leads = await db.query<{ id: number; linkedin_url: string; full_name: string; lead_metadata: string }>(
        `SELECT id, linkedin_url, full_name, lead_metadata
         FROM leads
         WHERE lead_score >= ?
           AND linkedin_url IS NOT NULL
           AND status IN ('READY_INVITE', 'INVITED', 'ACCEPTED')
         ORDER BY lead_score DESC
         LIMIT ?`,
        [SCORE_THRESHOLD, limit]
    );

    let extracted = 0;
    let skipped = 0;

    for (const lead of leads) {
        // Skip se già estratti
        if (await hasPostsExtracted(lead.id)) {
            skipped++;
            continue;
        }

        await logInfo('post_extractor.processing', { leadId: lead.id, name: lead.full_name });

        const posts = await extractLeadPosts(page, lead.linkedin_url);

        if (posts.length > 0) {
            await savePostsToLead(lead.id, posts);
            await logInfo('post_extractor.saved', { leadId: lead.id, postsCount: posts.length });
            extracted++;
        } else {
            // Segna comunque come tentato (con array vuoto) per non riprovare subito
            await savePostsToLead(lead.id, []);
        }

        // Pausa umana tra un profilo e l'altro
        await sleep(3000, 6000);
    }

    await logInfo('post_extractor.done', { extracted, skipped, processed: leads.length });
}

/**
 * Recupera i post estratti di un lead per usarli nel prompt AI.
 * Ritorna stringa vuota se non disponibili.
 */
export async function getLeadPostsContext(leadId: number): Promise<string> {
    const db = await getDatabase();
    const row = await db.get<{ lead_metadata: string }>(
        `SELECT lead_metadata FROM leads WHERE id = ?`, [leadId]
    );
    if (!row?.lead_metadata) return '';

    try {
        const meta = JSON.parse(row.lead_metadata) as Record<string, unknown>;
        const posts = meta.recent_posts as ExtractedPost[] | undefined;
        if (!Array.isArray(posts) || posts.length === 0) return '';

        return posts
            .map((p, i) => `Post ${i + 1}: "${p.text}"`)
            .join('\n');
    } catch {
        return '';
    }
}
