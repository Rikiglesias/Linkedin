/**
 * browser/ssiScraper.ts
 * Scrappa il Social Selling Index (SSI) da LinkedIn Sales Navigator.
 * URL: https://www.linkedin.com/sales/ssi
 *
 * Il punteggio SSI viene usato dallo scheduler per calcolare i cap dinamici
 * di inviti e messaggi giornalieri (config: SSI_DYNAMIC_LIMITS_ENABLED).
 *
 * Task periodico: 1x/settimana nel loop, salva in sync_state[linkedin_ssi_score].
 */

import type { Page } from 'playwright';
import { humanDelay } from './humanBehavior';
import { detectChallenge } from './auth';
import { logInfo, logWarn } from '../telemetry/logger';

const SSI_URL = 'https://www.linkedin.com/sales/ssi';

export interface SsiScrapingResult {
    score: number | null;
    breakdown: {
        establishBrand: number | null;
        findPeople: number | null;
        engageInsights: number | null;
        buildRelationships: number | null;
    };
    scraped: boolean;
    error: string | null;
}

/**
 * Naviga alla pagina SSI e scrappa il punteggio complessivo + i 4 componenti.
 * Ritorna null per lo score se la pagina non è accessibile (es. no Sales Navigator).
 */
export async function scrapeSsiScore(page: Page): Promise<SsiScrapingResult> {
    const result: SsiScrapingResult = {
        score: null,
        breakdown: {
            establishBrand: null,
            findPeople: null,
            engageInsights: null,
            buildRelationships: null,
        },
        scraped: false,
        error: null,
    };

    try {
        await page.goto(SSI_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await humanDelay(page, 2000, 4000);

        if (await detectChallenge(page)) {
            result.error = 'challenge_detected_on_ssi_page';
            return result;
        }

        // Verifica che siamo sulla pagina SSI e non su un redirect
        const currentUrl = page.url();
        if (!currentUrl.includes('/sales/ssi') && !currentUrl.includes('ssi')) {
            result.error = `redirected_away: ${currentUrl}`;
            await logWarn('ssi.scrape.redirect', { url: currentUrl });
            return result;
        }

        // Strategia 1: cercare il punteggio principale nel DOM
        // LinkedIn SSI mostra il punteggio in un elemento con classe o attributo specifico
        const scoreText = await page.evaluate(() => {
            // Prova selettori noti per la pagina SSI
            const selectors = [
                '.ssi-score__score',
                '.dashboard-content .score',
                '[data-test-ssi-score]',
                '.ssi-score',
                '.score-container .score-value',
            ];

            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el?.textContent) {
                    const text = el.textContent.trim();
                    if (text) return text;
                }
            }

            // Fallback: cerca un numero grande (0-100) che potrebbe essere lo score
            const allElements = document.querySelectorAll('h1, h2, h3, .score, [class*="score"], [class*="ssi"]');
            for (const el of allElements) {
                const text = (el.textContent ?? '').trim();
                const match = text.match(/^\d{1,3}$/);
                if (match) {
                    const num = Number.parseInt(match[0], 10);
                    if (num >= 0 && num <= 100) return String(num);
                }
            }

            return null;
        });

        if (scoreText) {
            const parsed = Number.parseInt(scoreText.replace(/[^\d]/g, ''), 10);
            if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
                result.score = parsed;
                result.scraped = true;
            }
        }

        // Strategia 2: cercare i 4 componenti dello score
        const breakdownScores = await page.evaluate(() => {
            const componentSelectors = [
                { key: 'establishBrand', selectors: ['.ssi-score__pillar--brand', '[data-test-pillar="brand"]'] },
                { key: 'findPeople', selectors: ['.ssi-score__pillar--find', '[data-test-pillar="find"]'] },
                { key: 'engageInsights', selectors: ['.ssi-score__pillar--engage', '[data-test-pillar="engage"]'] },
                { key: 'buildRelationships', selectors: ['.ssi-score__pillar--build', '[data-test-pillar="build"]'] },
            ];

            const scores: Record<string, number | null> = {};
            for (const comp of componentSelectors) {
                scores[comp.key] = null;
                for (const sel of comp.selectors) {
                    const el = document.querySelector(sel);
                    if (el?.textContent) {
                        const num = Number.parseFloat(el.textContent.trim());
                        if (Number.isFinite(num) && num >= 0 && num <= 25) {
                            scores[comp.key] = num;
                            break;
                        }
                    }
                }
            }
            return scores;
        });

        if (breakdownScores) {
            result.breakdown.establishBrand = breakdownScores.establishBrand ?? null;
            result.breakdown.findPeople = breakdownScores.findPeople ?? null;
            result.breakdown.engageInsights = breakdownScores.engageInsights ?? null;
            result.breakdown.buildRelationships = breakdownScores.buildRelationships ?? null;

            // Se non abbiamo lo score totale ma abbiamo i componenti, calcoliamolo
            if (result.score === null) {
                const components = [
                    result.breakdown.establishBrand,
                    result.breakdown.findPeople,
                    result.breakdown.engageInsights,
                    result.breakdown.buildRelationships,
                ];
                const validComponents = components.filter((c): c is number => c !== null);
                if (validComponents.length === 4) {
                    result.score = Math.round(validComponents.reduce((a, b) => a + b, 0));
                    result.scraped = true;
                }
            }
        }

        if (!result.scraped) {
            result.error = 'score_not_found_in_dom';
            await logWarn('ssi.scrape.not_found', { url: currentUrl });
        } else {
            await logInfo('ssi.scrape.success', {
                score: result.score,
                ...result.breakdown,
            });
        }
    } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        await logWarn('ssi.scrape.error', { error: result.error });
    }

    return result;
}
