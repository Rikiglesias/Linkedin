/**
 * workers/postCreatorWorker.ts
 * ─────────────────────────────────────────────────────────────────
 * Worker per la creazione e pubblicazione di post LinkedIn.
 * Genera contenuto via AI, naviga alla UI di composizione,
 * scrive il post e lo pubblica. Traccia tutto nel DB.
 */

import { Page } from 'playwright';
import { getDatabase } from '../db';
import { humanDelay, humanType } from '../browser/humanBehavior';
import { detectChallenge } from '../browser/auth';
import { generatePostContent, PostContentRequest } from '../ai/postContentGenerator';
import { logInfo, logError } from '../telemetry/logger';

export type PostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED';

export interface PostCreatorOptions {
    accountId?: string;
    dryRun?: boolean;
    topic?: string;
    industry?: string;
    tone?: PostContentRequest['tone'];
    customContent?: string;
}

export interface PostCreatorResult {
    postId: number | null;
    status: PostStatus;
    content: string;
    topic: string;
    source: 'ai' | 'template' | 'custom';
    published: boolean;
    error: string | null;
}

async function insertPostRecord(
    accountId: string,
    content: string,
    topic: string,
    source: string,
    model: string | null,
    status: PostStatus,
): Promise<number> {
    const db = await getDatabase();
    const result = await db.run(
        `INSERT INTO published_posts (account_id, content, topic, source, model, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [accountId, content, topic, source, model, status],
    );
    return result.lastID ?? 0;
}

async function updatePostStatus(
    postId: number,
    status: PostStatus,
    extra?: { publishedAt?: string; linkedinPostUrl?: string; error?: string; publishingStartedAt?: string },
): Promise<void> {
    const db = await getDatabase();
    const parts = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const params: unknown[] = [status];

    if (extra?.publishedAt) {
        parts.push('published_at = ?');
        params.push(extra.publishedAt);
    }
    if (extra?.linkedinPostUrl) {
        parts.push('linkedin_post_url = ?');
        params.push(extra.linkedinPostUrl);
    }
    if (extra?.publishingStartedAt) {
        parts.push("metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.publishing_started_at', ?)");
        params.push(extra.publishingStartedAt);
    }
    if (extra?.error) {
        parts.push("metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.last_error', ?)");
        params.push(extra.error);
    }
    params.push(postId);

    await db.run(`UPDATE published_posts SET ${parts.join(', ')} WHERE id = ?`, params);
}

const POST_COMPOSER_SELECTORS = [
    '.share-box-feed-entry__trigger',
    'button[data-control-name="share.post_feed"]',
    '.share-box__open',
    'button.artdeco-button--muted[aria-label*="post"]',
    'button[aria-label*="Avvia un post"]',
    'button[aria-label*="Start a post"]',
];

const POST_TEXTAREA_SELECTORS = [
    '.ql-editor[data-placeholder]',
    '.ql-editor',
    '[role="textbox"][contenteditable="true"]',
    '.editor-content [contenteditable="true"]',
];

const POST_SUBMIT_SELECTORS = [
    'button.share-actions__primary-action',
    'button[data-control-name="share.post"]',
    'button.share-box-feed-entry__bottom-bar-action--post',
    'button:has-text("Pubblica")',
    'button:has-text("Post")',
];

async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
    for (const selector of selectors) {
        try {
            const el = page.locator(selector).first();
            if ((await el.count()) > 0 && (await el.isVisible())) {
                await el.click();
                return true;
            }
        } catch {
            continue;
        }
    }
    return false;
}

async function typeInComposer(page: Page, content: string): Promise<boolean> {
    for (const selector of POST_TEXTAREA_SELECTORS) {
        try {
            const el = page.locator(selector).first();
            if ((await el.count()) > 0 && (await el.isVisible())) {
                await el.click();
                await humanDelay(page, 300, 600);
                await humanType(page, selector, content);
                return true;
            }
        } catch {
            continue;
        }
    }
    return false;
}

/**
 * Genera e pubblica un post LinkedIn.
 * Flow: genera contenuto → apri composer → scrivi → pubblica.
 */
export async function createAndPublishPost(page: Page, options: PostCreatorOptions = {}): Promise<PostCreatorResult> {
    const accountId = options.accountId || 'default';

    try {
        let content: string;
        let topic: string;
        let source: 'ai' | 'template' | 'custom';
        let model: string | null = null;

        if (options.customContent) {
            content = options.customContent;
            topic = options.topic || 'custom';
            source = 'custom';
        } else {
            const generated = await generatePostContent({
                topic: options.topic,
                industry: options.industry,
                tone: options.tone,
            });
            content = generated.content;
            topic = generated.topic;
            source = generated.source;
            model = generated.model;
        }

        const postId = await insertPostRecord(accountId, content, topic, source, model, 'DRAFT');
        await logInfo('post_creator.draft_created', { postId, topic, source, contentLength: content.length });

        if (options.dryRun) {
            await updatePostStatus(postId, 'DRAFT');
            return { postId, status: 'DRAFT', content, topic, source, published: false, error: null };
        }

        await updatePostStatus(postId, 'PUBLISHING', { publishingStartedAt: new Date().toISOString() });

        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
        await humanDelay(page, 2000, 4000);

        if (await detectChallenge(page)) {
            await updatePostStatus(postId, 'FAILED', { error: 'challenge_detected' });
            return { postId, status: 'FAILED', content, topic, source, published: false, error: 'challenge_detected' };
        }

        const composerOpened = await clickFirstVisible(page, POST_COMPOSER_SELECTORS);
        if (!composerOpened) {
            await updatePostStatus(postId, 'FAILED', { error: 'composer_not_found' });
            return { postId, status: 'FAILED', content, topic, source, published: false, error: 'composer_not_found' };
        }

        await humanDelay(page, 1500, 3000);

        const typed = await typeInComposer(page, content);
        if (!typed) {
            await updatePostStatus(postId, 'FAILED', { error: 'textarea_not_found' });
            return { postId, status: 'FAILED', content, topic, source, published: false, error: 'textarea_not_found' };
        }

        await humanDelay(page, 1000, 2000);

        const submitted = await clickFirstVisible(page, POST_SUBMIT_SELECTORS);
        if (!submitted) {
            await updatePostStatus(postId, 'FAILED', { error: 'submit_button_not_found' });
            return {
                postId,
                status: 'FAILED',
                content,
                topic,
                source,
                published: false,
                error: 'submit_button_not_found',
            };
        }

        await humanDelay(page, 3000, 5000);

        // Challenge check post-submit: LinkedIn può mostrare un challenge dopo la pubblicazione
        if (await detectChallenge(page)) {
            await updatePostStatus(postId, 'FAILED', { error: 'challenge_detected_post_submit' });
            return {
                postId,
                status: 'FAILED',
                content,
                topic,
                source,
                published: false,
                error: 'challenge_detected_post_submit',
            };
        }

        await updatePostStatus(postId, 'PUBLISHED', {
            publishedAt: new Date().toISOString(),
        });

        await logInfo('post_creator.published', { postId, topic, source, contentLength: content.length });

        return { postId, status: 'PUBLISHED', content, topic, source, published: true, error: null };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await logError('post_creator.fatal', { accountId, error: msg });
        return { postId: null, status: 'FAILED', content: '', topic: '', source: 'ai', published: false, error: msg };
    }
}

/**
 * Conta i post pubblicati oggi per un account (rate limiting).
 */
export async function countTodayPosts(accountId: string): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM published_posts
         WHERE account_id = ? AND status = 'PUBLISHED'
         AND date(published_at) = date('now')`,
        [accountId],
    );
    return row?.count ?? 0;
}
