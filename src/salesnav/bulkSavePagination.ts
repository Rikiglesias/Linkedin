/**
 * salesnav/bulkSavePagination.ts — Funzioni di paginazione, scroll e UI per bulk save SalesNav.
 * Estratte da bulkSaveOrchestrator.ts (A17: split file >1000 righe).
 *
 * Contiene:
 * - readPaginationInfo(): legge numero pagina corrente/totale dal DOM
 * - hasNextPage(): verifica se il bottone Next è disponibile
 * - clickNextPage(): click sul bottone Next con verifica pagina cambiata
 * - scrollAndReadPage(): scroll umano con raccolta profili dal virtual scroller
 * - prepareResultsPage(): scroll in cima + micro-scroll umano
 * - restoreSearchPagePosition(): ripristina posizione pagina per resume
 * - dismissTransientUi(): chiude dialog/popup transitori
 * - aiCheckPageHealth(): check anomalie AI-powered
 * - runAntiDetectionNoise(): azioni anti-detection tra pagine
 */

import type { Page } from 'playwright';
import { clickLocatorHumanLike, humanDelay, randomMouseMove } from '../browser';
import { config } from '../config';
import { hasLocator, locatorBoundingBox, buildClipAroundLocator, smartClick, safeVisionClick } from './bulkSaveHelpers';
import { humanMouseMoveToCoords } from '../browser/humanBehavior';
import { visionRead } from './visionNavigator';
import { SALESNAV_NEXT_PAGE_SELECTOR as NEXT_PAGE_SELECTOR } from './selectors';
import type { ScrollCollectedProfile } from './bulkSaveTypes';

export interface ScrollResult {
    count: number;
    profiles: ScrollCollectedProfile[];
}

// ─── Paginazione ─────────────────────────────────────────────────────────────

export async function readPaginationInfo(page: Page): Promise<{ current: number; total: number } | null> {
    try {
        const info = await page.evaluate(() => {
            // Strategy 1: Artdeco pagination — look for active page button + last page button
            const paginationContainer =
                document.querySelector('.artdeco-pagination') ??
                document.querySelector('nav[aria-label*="pagination" i]') ??
                document.querySelector('[class*="search-results__pagination"]') ??
                document.querySelector('ol.artdeco-pagination__pages');
            if (paginationContainer) {
                const buttons = Array.from(
                    paginationContainer.querySelectorAll<HTMLButtonElement | HTMLLIElement>(
                        'button[aria-label], li[data-test-pagination-page-btn]',
                    ),
                );
                const activeBtn = paginationContainer.querySelector<HTMLButtonElement>(
                    'button[aria-current="true"], button.active, li.active button, li.selected button',
                );
                const currentFromActive = activeBtn ? parseInt((activeBtn.textContent ?? '').trim(), 10) : NaN;

                // Collect all visible page numbers
                const pageNumbers: number[] = [];
                for (const btn of buttons) {
                    const num = parseInt((btn.textContent ?? '').trim(), 10);
                    if (!isNaN(num) && num > 0) pageNumbers.push(num);
                }
                if (pageNumbers.length > 0) {
                    const maxPage = Math.max(...pageNumbers);
                    const current = !isNaN(currentFromActive) ? currentFromActive : 1;
                    return { current, total: maxPage };
                }
            }

            // Strategy 2: Text pattern "Page X of Y" / "Pagina X di Y" / "X – Y of Z results"
            const bodyText = document.body.innerText || '';
            const pageOfMatch = bodyText.match(/(?:page|pagina)\s+(\d+)\s+(?:of|di)\s+(\d+)/i);
            if (pageOfMatch) {
                return { current: parseInt(pageOfMatch[1], 10), total: parseInt(pageOfMatch[2], 10) };
            }

            // Strategy 3: "X–Y of Z results" → derive page count (25 per page)
            const rangeMatch = bodyText.match(
                /(\d+)\s*[–\-]\s*(\d+)\s+(?:of|di|su)\s+(\d[\d,.]*)\s*(?:results|risultat)/i,
            );
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const totalResults = parseInt(rangeMatch[3].replace(/[,.\s]/g, ''), 10);
                const perPage = 25;
                const current = Math.ceil(start / perPage);
                const total = Math.ceil(totalResults / perPage);
                return { current: current || 1, total: total || 1 };
            }

            return null;
        });
        return info;
    } catch {
        return null;
    }
}

export async function hasNextPage(page: Page): Promise<boolean> {
    const nextButton = page.locator(NEXT_PAGE_SELECTOR).first();
    if (!(await hasLocator(nextButton))) {
        return false;
    }
    const ariaDisabled = (await nextButton.getAttribute('aria-disabled').catch(() => null))?.toLowerCase() === 'true';
    const disabled = ariaDisabled || (await nextButton.isDisabled().catch(() => false));
    return !disabled;
}

export async function clickNextPage(page: Page, dryRun: boolean): Promise<boolean> {
    const nextButton = page.locator(NEXT_PAGE_SELECTOR).first();
    if (!(await hasNextPage(page))) {
        return false;
    }

    if (dryRun) {
        return true;
    }

    // Leggi la pagina corrente PRIMA del click per verificare che cambi davvero
    const pageBefore = await readPaginationInfo(page);

    // Scrolla il bottone Next nel viewport — la paginazione è in fondo al container
    await nextButton.scrollIntoViewIfNeeded().catch(() => {});
    await humanDelay(page, 300, 500);

    const clip =
        (await buildClipAroundLocator(page, nextButton, { top: 40, right: 160, bottom: 40, left: 220 })) ?? undefined;

    const box = (await hasLocator(nextButton)) ? await locatorBoundingBox(nextButton) : null;
    if (box) {
        await smartClick(page, box);
    } else {
        await safeVisionClick(page, 'pagination button labeled "Next" or "Avanti"', {
            clip,
            retries: 3,
            postClickDelayMs: 1_000,
        });
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => null);
    await humanDelay(page, 600, 1_200);

    // Verifica che la pagina sia effettivamente cambiata
    const pageAfter = await readPaginationInfo(page);
    if (pageBefore && pageAfter && pageAfter.current <= pageBefore.current) {
        console.warn(
            `[WARN] Click Next non ha cambiato pagina (prima: ${pageBefore.current}, dopo: ${pageAfter.current}). Riprovo con click diretto...`,
        );
        // Fallback: click diretto con force
        await clickLocatorHumanLike(page, nextButton, {
            selectorForDwell: NEXT_PAGE_SELECTOR,
            scrollTimeoutMs: 3_000,
        }).catch(() => {});
        // domcontentloaded (non networkidle — SalesNav ha WebSocket permanente)
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
        await humanDelay(page, 600, 1_200);
    }

    // Attendi che le card lead appaiano nel DOM (lazy rendering post-navigazione).
    // Senza questo, scrollAndReadPage inizia prima che le card siano renderizzate.
    await page
        .waitForSelector('a[href*="/sales/lead/"], a[href*="/sales/people/"]', { timeout: 8_000 })
        .catch(() => null);

    return true;
}

// ─── Preparazione pagina ─────────────────────────────────────────────────────

export async function prepareResultsPage(page: Page): Promise<void> {
    // Scroll veloce in cima — "Select All" è nell'header dei risultati
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    // Micro-scroll occasionale per sembrare umano (10% delle volte — ridotto da 30% per velocità)
    if (Math.random() < 0.1) {
        await humanDelay(page, 100, 300);
        const dy = 60 + Math.random() * 150;
        await page.evaluate((d: number) => window.scrollBy({ top: d, behavior: 'smooth' }), dy);
        await humanDelay(page, 150, 350);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
    await humanDelay(page, 200, 450);
}

export async function restoreSearchPagePosition(page: Page, targetPageNumber: number): Promise<boolean> {
    if (targetPageNumber <= 1) {
        return true;
    }

    console.log(`[RESUME] Ripristino posizione pagina ${targetPageNumber}...`);
    for (let currentPage = 1; currentPage < targetPageNumber; currentPage++) {
        const moved = await clickNextPage(page, false);
        if (!moved) {
            // NON crashare — fallback a pagina 1. Meglio rifare pagine già processate che fermare tutto.
            console.warn(
                `[RESUME] WARN: Next non disponibile alla pagina ${currentPage} (target: ${targetPageNumber}). Riparto da pagina 1.`,
            );
            return false;
        }
    }
    console.log(`[RESUME] Posizione ripristinata a pagina ${targetPageNumber}.`);
    return true;
}

// ─── UI Utilities ────────────────────────────────────────────────────────────

export async function dismissTransientUi(page: Page): Promise<void> {
    // Chiudi eventuali dialog/popup
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(200).catch(() => null);

    // Dismiss "Continua nel browser" / mobile app prompt (se presente)
    const continueBtn = page
        .locator(
            'a:has-text("Continua nel browser"), a:has-text("Continue in browser"), button:has-text("Continua nel browser"), button:has-text("Continue in browser")',
        )
        .first();
    if ((await continueBtn.count().catch(() => 0)) > 0) {
        console.log('[UI] Dismissing mobile app prompt...');
        await clickLocatorHumanLike(page, continueBtn, { scrollTimeoutMs: 3_000 }).catch(() => null);
        await page.waitForTimeout(500).catch(() => null);
    }
}

// ─── AI Health Check ─────────────────────────────────────────────────────────

export async function aiCheckPageHealth(page: Page): Promise<{ safe: boolean; warning: string | null }> {
    // DOM-first: check rapido per testi sospetti senza screenshot AI.
    // Se il DOM è pulito, ritorna safe immediatamente (0 token, 0 latenza).
    try {
        const suspiciousText = await page.evaluate(() => {
            const body = (document.body.innerText || '').toLowerCase();
            const patterns = [
                'unusual activity',
                'attività insolita',
                'restricted',
                'limitato',
                'sospeso',
                'suspended',
                'too fast',
                'troppo veloce',
                'slow down',
                'rallenta',
                'security verification',
                'verifica di sicurezza',
                'something went wrong',
                'qualcosa è andato storto',
                'captcha',
                'robot',
            ];
            for (const p of patterns) {
                if (body.includes(p)) return p;
            }
            return null;
        });

        if (!suspiciousText) {
            return { safe: true, warning: null };
        }

        // Testo sospetto trovato → conferma con Vision AI (potrebbe essere un falso positivo)
        const response = await visionRead(
            page,
            `The page DOM contains the text "${suspiciousText}". Is this a warning/restriction from LinkedIn, or normal content? Answer "OK" if normal, "WARNING: description" if it's a real problem.`,
        );
        if (response.toUpperCase().startsWith('OK')) {
            return { safe: true, warning: null };
        }
        return { safe: false, warning: response };
    } catch {
        return { safe: true, warning: null };
    }
}

// ─── Anti-Detection Noise ────────────────────────────────────────────────────

// Soglie jitterate per anti-detection noise — cambiano ad ogni sessione per evitare pattern fissi.
let _nextHoverAt = 15 + Math.floor(Math.random() * 8);
let _nextAiDelayAt = 8 + Math.floor(Math.random() * 6);

export async function runAntiDetectionNoise(page: Page, totalProcessedPages: number): Promise<void> {
    // Movimento mouse leggero (20% delle volte)
    if (Math.random() < 0.2) {
        await randomMouseMove(page);
    }
    // Micro-pausa occasionale (5% → 1-3s)
    if (Math.random() < 0.05) {
        await humanDelay(page, 1_000, 3_000);
    }
    // Hover su un profilo con jitter
    if (totalProcessedPages > 0 && totalProcessedPages >= _nextHoverAt) {
        _nextHoverAt = totalProcessedPages + 14 + Math.floor(Math.random() * 10);
        const leadLink = page.locator('a[href*="/sales/lead/"], a[href*="/sales/people/"]').first();
        if ((await leadLink.count().catch(() => 0)) > 0) {
            await leadLink.hover().catch(() => null);
            await humanDelay(page, 400, 900);
        }
    }

    // Pausa contestuale con jitter
    if (totalProcessedPages > 0 && totalProcessedPages >= _nextAiDelayAt) {
        _nextAiDelayAt = totalProcessedPages + 7 + Math.floor(Math.random() * 8);
        await humanDelay(page, 2_000, 5_000);
    }
}

// ─── Scroll & Read ───────────────────────────────────────────────────────────

export async function scrollAndReadPage(page: Page, fast: boolean = false): Promise<ScrollResult> {
    const viewport = page.viewportSize() ?? { width: 1400, height: 900 };

    const collectedLeadIds = new Set<string>();
    const collectedProfiles = new Map<string, ScrollCollectedProfile>();

    const collectVisibleLeads = async (): Promise<number> => {
        const profiles = await page.evaluate(() => {
            const results: Array<{
                leadId: string;
                firstName: string;
                lastName: string;
                linkedinUrl: string;
                title?: string;
                company?: string;
                location?: string;
            }> = [];
            const anchors = document.querySelectorAll('a[href*="/sales/lead/"], a[href*="/sales/people/"]');
            for (const a of anchors) {
                const href = a.getAttribute('href') ?? '';
                const id = href.match(/\/(lead|people)\/([^,/?]+)/)?.[2];
                if (!id) continue;
                const card = a.closest('li, article, [data-x--lead-card]') ?? a.parentElement;
                const nameText = a.textContent?.trim() ?? '';
                const parts = nameText.split(/\s+/);
                const firstName = parts[0] ?? '';
                const lastName = parts.slice(1).join(' ') ?? '';
                const subtitleEl = card?.querySelector('[class*="subtitle"], [class*="body-text"]');
                const subtitle = subtitleEl?.textContent?.trim() ?? '';
                const [title, company] = subtitle.includes(' at ')
                    ? subtitle.split(' at ')
                    : subtitle.includes(' @ ')
                      ? subtitle.split(' @ ')
                      : subtitle.includes(' presso ')
                        ? subtitle.split(' presso ')
                        : [subtitle, ''];
                const locationEl = card?.querySelector('[class*="location"], [class*="geo"]');
                const location = locationEl?.textContent?.trim() ?? undefined;
                results.push({
                    leadId: id,
                    firstName,
                    lastName,
                    linkedinUrl: href.startsWith('/') ? `https://www.linkedin.com${href.split('?')[0]}` : href,
                    title: title?.trim() || undefined,
                    company: company?.trim() || undefined,
                    location,
                });
            }
            return results;
        });
        for (const p of profiles) {
            collectedLeadIds.add(p.leadId);
            if (!collectedProfiles.has(p.leadId)) {
                collectedProfiles.set(p.leadId, p);
            }
        }
        return collectedLeadIds.size;
    };

    // Posiziona mouse nell'area risultati
    const mouseX = Math.round(viewport.width * 0.6);
    const mouseY = Math.round(viewport.height * 0.4);
    await humanMouseMoveToCoords(page, mouseX, mouseY);
    await page.waitForTimeout(100 + Math.floor(Math.random() * 150));

    const initialCount = await collectVisibleLeads();

    // Trova container scrollabile
    const scrollContainerInfo = await page.evaluate(() => {
        const allElements = document.querySelectorAll('div, main, section, [role="main"]');
        let bestIndex = -1;
        let bestDiff = 0;
        for (let idx = 0; idx < allElements.length; idx++) {
            const htmlEl = allElements[idx] as HTMLElement;
            const diff = htmlEl.scrollHeight - htmlEl.clientHeight;
            if (diff > 50 && diff > bestDiff) {
                const hasLeads = htmlEl.querySelector('a[href*="/sales/lead/"], a[href*="/sales/people/"]');
                if (hasLeads) {
                    bestIndex = idx;
                    bestDiff = diff;
                }
            }
        }
        if (bestIndex >= 0) {
            const best = allElements[bestIndex] as HTMLElement;
            return {
                found: true,
                index: bestIndex,
                scrollHeight: best.scrollHeight,
                clientHeight: best.clientHeight,
                overflow: bestDiff,
            };
        }
        return { found: false, index: -1, scrollHeight: 0, clientHeight: 0, overflow: 0 };
    });

    console.log(
        `[SCROLL${fast ? ' FAST' : ''}] Container: ${scrollContainerInfo.found ? 'OK' : 'body'}` +
            ` | overflow=${scrollContainerInfo.overflow}px | Lead iniziali: ${initialCount}`,
    );

    const MAX_STEPS = fast ? 40 : 20;
    let noNewLeadsCount = 0;

    const containerIndex = scrollContainerInfo.index;
    const doScroll = async (delta: number): Promise<void> => {
        if (scrollContainerInfo.found) {
            await page.evaluate(
                ({ d, idx }) => {
                    const el = document.querySelectorAll('div, main, section, [role="main"]')[idx] as
                        | HTMLElement
                        | undefined;
                    if (el) el.scrollTop += d;
                },
                { d: delta, idx: containerIndex },
            );
        } else {
            await page.mouse.wheel(0, delta);
        }
    };

    const isAtBottom = async (): Promise<boolean> => {
        if (!scrollContainerInfo.found) {
            return page
                .evaluate(() => window.scrollY + window.innerHeight >= document.body.scrollHeight - 100)
                .catch(() => true);
        }
        return page
            .evaluate((idx: number) => {
                const el = document.querySelectorAll('div, main, section, [role="main"]')[idx] as
                    | HTMLElement
                    | undefined;
                return el ? el.scrollTop + el.clientHeight >= el.scrollHeight - 100 : true;
            }, containerIndex)
            .catch(() => true);
    };

    for (let i = 0; i < MAX_STEPS; i++) {
        const countBefore = await collectVisibleLeads();

        if (fast) {
            const burstCount = 2 + Math.floor(Math.random() * 2);
            for (let b = 0; b < burstCount; b++) {
                const delta = 120 + Math.floor(Math.random() * 60);
                await doScroll(delta);
                const preCount = await page.evaluate(
                    () => document.querySelectorAll('a[href*="/sales/lead/"], a[href*="/sales/people/"]').length,
                );
                // H04: Adaptive scroll timeout — base 2500ms (safer for slow proxies).
                // Adds half of proxy health check timeout as proxy-latency estimate.
                const scrollWaitTimeout = 2_500 + Math.min((config.proxyHealthCheckTimeoutMs ?? 0) / 2, 3_000);
                await page
                    .waitForFunction(
                        (before: number) =>
                            document.querySelectorAll('a[href*="/sales/lead/"], a[href*="/sales/people/"]').length !==
                            before,
                        preCount,
                        { timeout: scrollWaitTimeout },
                    )
                    .catch(() => null);
                await page.waitForTimeout(150 + Math.floor(Math.random() * 100));
                await collectVisibleLeads();
            }
            await page.waitForTimeout(150 + Math.floor(Math.random() * 100));
        } else {
            const roll = Math.random();
            if (roll < 0.25) {
                const burstCount = 2 + Math.floor(Math.random() * 2);
                for (let b = 0; b < burstCount; b++) {
                    const delta = 400 + Math.floor(Math.random() * 250);
                    await doScroll(delta);
                    await page.waitForTimeout(60 + Math.floor(Math.random() * 60));
                }
                await page.waitForTimeout(120 + Math.floor(Math.random() * 150));
            } else if (roll < 0.33) {
                const delta = 200 + Math.floor(Math.random() * 150);
                await doScroll(delta);
                await page.waitForTimeout(600 + Math.floor(Math.random() * 600));
            } else {
                const delta = 300 + Math.floor(Math.random() * 200);
                await doScroll(delta);
                await page.waitForTimeout(140 + Math.floor(Math.random() * 120));
            }
        }

        if (i % 4 === 3) {
            await page
                .waitForFunction(
                    () => !document.querySelector('.artdeco-loader, [class*="skeleton"], [class*="ghost"]'),
                    { timeout: 1_500 },
                )
                .catch(() => {});
        }

        const countAfter = await collectVisibleLeads();

        if (fast && countAfter >= 25) {
            console.log(`[SCROLL] Tutti i ${countAfter} lead raccolti — stop`);
            break;
        }

        if (countAfter > countBefore) {
            if (!fast) {
                await page.waitForTimeout(200 + Math.floor(Math.random() * 300));
            }
            console.log(`[SCROLL] Step ${i + 1}: ${countAfter} lead (+${countAfter - countBefore})`);
            noNewLeadsCount = 0;
        } else {
            noNewLeadsCount++;
            if (fast) {
                const atBottom = await isAtBottom();
                if (atBottom && noNewLeadsCount >= 3) break;
                if (noNewLeadsCount >= 10) break;
            } else {
                if (noNewLeadsCount >= 4) break;
            }
        }

        if (!fast && Math.random() < 0.2) {
            const jitterX = mouseX + Math.floor(Math.random() * 80 - 40);
            const jitterY = mouseY + Math.floor(Math.random() * 50 - 25);
            await humanMouseMoveToCoords(page, jitterX, jitterY);
        }
    }

    if (fast && collectedLeadIds.size < 15 && collectedLeadIds.size > 0) {
        console.warn(
            `[SCROLL] Solo ${collectedLeadIds.size} lead trovati dopo scroll completo — possibile rendering incompleto`,
        );
    }

    const leadCount = collectedLeadIds.size;

    // Torna in cima
    if (scrollContainerInfo.found) {
        await page.evaluate((idx: number) => {
            const el = document.querySelectorAll('div, main, section, [role="main"]')[idx] as HTMLElement | undefined;
            if (el) el.scrollTop = 0;
            window.scrollTo({ top: 0 });
        }, containerIndex);
    } else {
        for (let i = 0; i < 12; i++) {
            await page.mouse.wheel(0, -800);
            await page.waitForTimeout(30);
        }
    }
    await page.waitForTimeout(200 + Math.floor(Math.random() * 200));

    return { count: leadCount, profiles: [...collectedProfiles.values()] };
}
