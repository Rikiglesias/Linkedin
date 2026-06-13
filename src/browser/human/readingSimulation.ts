/**
 * browser/human/readingSimulation.ts
 * ─────────────────────────────────────────────────────────────────
 * Simulazione lettura/scroll umani: wheelWithMomentum (scroll a tick decrescenti
 * ease-out), simulateTabSwitch (blur/focus/visibilitychange), simulateHumanReading
 * (scroll a 3 fasi orientation/reading/skip), computeProfileDwellTime (dwell ∝ ricchezza
 * profilo). Estratto da humanBehavior.ts (A13, split SRP). TIMING-relevante — momentum,
 * delay per fase, budget dwell e transizioni probabilistiche copiati VERBATIM: un drift
 * = pattern di scroll/lettura rilevabile. NON riscrivere, solo spostare.
 */

import { Page } from 'playwright';
import { isMobilePage } from '../deviceProfile';
import { randomInt } from '../../utils/random';
import { humanSwipe } from './touchGestures';
import { humanDelay } from './humanDelay';

/**
 * AD-04: Simulazione sfocamento tab (cambio scheda utente).
 * Mockerà attivamente la *Page Visibility API* per dimostrare ai tracker
 * che siamo veri umani che hanno cambiato tab.
 */
export async function simulateTabSwitch(page: Page, maxAwayTimeMs: number): Promise<void> {
    if (isMobilePage(page)) {
        // Su mobile il comportamento multi-tab è meno lineare da tracciare, saltiamo.
        return;
    }

    try {
        const jitter = () => Math.round((Math.random() - 0.5) * 20);

        // H18: Usare solo eventi DOM (blur/focus/visibilitychange) SENZA override
        // di document.visibilityState. Il mock via Object.defineProperty è rilevabile
        // perché: 1) lascia tracce su window (__origVisDesc), 2) configurable:true
        // non è il default del browser, 3) CDP può verificare lo stato reale del tab.
        // I listener JavaScript di LinkedIn reagiscono agli EVENTI, non allo stato —
        // quindi dispatching blur/focus/visibilitychange è sufficiente e non rilevabile.
        await page.evaluate((ts) => {
            window.dispatchEvent(new Event('blur', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());
        await page.waitForTimeout(5 + Math.random() * 25);
        await page.evaluate((ts) => {
            document.dispatchEvent(new Event('visibilitychange', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());

        const awayTime = Math.max(3000, Math.min(maxAwayTimeMs, 3000 + Math.random() * maxAwayTimeMs));
        await page.waitForTimeout(awayTime);

        await page.evaluate((ts) => {
            document.dispatchEvent(new Event('visibilitychange', { timeStamp: ts } as EventInit));
            window.dispatchEvent(new Event('focus', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());
        await page.waitForTimeout(5 + Math.random() * 25);
        await page.evaluate((ts) => {
            document.dispatchEvent(new Event('visibilitychange', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());

        await page.waitForTimeout(500 + Math.random() * 800);
    } catch {
        // Best effort
    }
}

/**
 * Scroll con MOMENTUM: decompone un delta totale in una raffica di tick wheel
 * decrescenti (ease-out), come una rotellina/trackpad reale. Un singolo
 * page.mouse.wheel(0, big) sposta la scrollbar in un frame = firma robotica (teletrasporto),
 * il pattern #1 che la behavioral-biometrics cerca sullo scroll.
 */
async function wheelWithMomentum(page: Page, totalDeltaY: number): Promise<void> {
    const ticks = 4 + Math.floor(Math.random() * 5); // 4-8 tick
    let remaining = totalDeltaY;
    for (let i = 0; i < ticks; i++) {
        const isLast = i === ticks - 1;
        // ease-out: i primi tick spostano di più, gli ultimi rallentano (decelerazione naturale)
        const step = isLast ? remaining : Math.round(remaining * (0.35 + Math.random() * 0.25));
        remaining -= step;
        await page.mouse.wheel(0, step);
        if (!isLast) {
            await page.waitForTimeout(12 + Math.floor(Math.random() * 28)); // 12-40ms tra tick
        }
    }
}

/**
 * Scrolling variabile con 3-7 movimenti, velocità diversa e 30% di probabilità
 * di tornare in cima (comportamento dei lettori reali).
 */
export async function simulateHumanReading(page: Page): Promise<void> {
    const mobile = isMobilePage(page);
    const isScrollable = await page.evaluate(() => document.body.scrollHeight > window.innerHeight).catch(() => false);
    if (!isScrollable) return;
    const scrollCount = mobile ? 2 + Math.floor(Math.random() * 4) : 3 + Math.floor(Math.random() * 5);

    // Scroll a 3 fasi (3.2): simula pattern reale di lettura pagina.
    // Fase 1 "orientation": scroll veloce per orientarsi nella pagina
    // Fase 2 "reading": scroll lento per leggere contenuto interessante
    // Fase 3 "skip": scroll veloce per saltare contenuto non rilevante
    // Transizioni probabilistiche: orientation→reading (60%), reading→skip (40%), skip→reading (30%)
    type ScrollPhase = 'orientation' | 'reading' | 'skip';
    let phase: ScrollPhase = 'orientation';

    for (let i = 0; i < scrollCount; i++) {
        let deltaY: number;
        let delayMin: number;
        let delayMax: number;

        if (mobile) {
            deltaY = 220 + Math.random() * 420;
            delayMin = 700;
            delayMax = 2200;
        } else {
            switch (phase) {
                case 'orientation':
                    deltaY = 400 + Math.random() * 200; // 400-600px
                    delayMin = 300;
                    delayMax = 800;
                    break;
                case 'reading':
                    deltaY = 100 + Math.random() * 150; // 100-250px
                    delayMin = 500;
                    delayMax = 2000;
                    break;
                case 'skip':
                    deltaY = 500 + Math.random() * 300; // 500-800px
                    delayMin = 200;
                    delayMax = 500;
                    break;
            }
        }

        await wheelWithMomentum(page, deltaY);
        if (mobile && Math.random() < 0.4) {
            await humanSwipe(page, 'up');
        }
        await humanDelay(page, delayMin, delayMax);

        // Transizione fase (solo desktop — mobile usa pattern uniforme)
        if (!mobile) {
            const roll = Math.random();
            switch (phase) {
                case 'orientation':
                    phase = roll < 0.6 ? 'reading' : 'orientation';
                    break;
                case 'reading':
                    phase = roll < 0.4 ? 'skip' : 'reading';
                    break;
                case 'skip':
                    phase = roll < 0.3 ? 'reading' : 'skip';
                    break;
            }
        }

        // AD-04: 15% di probabilità di cambiare tab temporaneamente mentre legge
        if (Math.random() < 0.15) {
            await simulateTabSwitch(page, 5000 + Math.random() * 15000);
        }
    }
    if (Math.random() < 0.3) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await humanDelay(page, 500, 1400);
    }
}

/**
 * Content-Aware Profile Reading (3.4 fix): funzione UNIFICATA che fa
 * scroll + dwell in un budget di tempo TOTALE proporzionale alla ricchezza
 * del profilo. SOSTITUISCE simulateHumanReading + contextualReadingPause
 * quando siamo su un profilo LinkedIn.
 *
 * Budget totale:
 *   Profilo sparse (solo nome e titolo): 4-8s totali
 *   Profilo medio: 7-14s totali
 *   Profilo ricco (about lungo, molte esperienze): 12-20s totali
 *
 * Include: scroll a fasi, pause di lettura, tab switch occasionale.
 * MAI > 20s per singolo profilo — un umano decide velocemente se connettersi.
 */
export async function computeProfileDwellTime(page: Page): Promise<void> {
    const mobile = isMobilePage(page);
    try {
        const profileRichness = await page.evaluate(() => {
            const aboutText = document.querySelector('[id*="about"]')?.textContent?.trim().length ?? 0;
            const experienceItems = document.querySelectorAll('li.artdeco-list__item, [id*="experience"] li').length;
            const totalText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().length;
            return { aboutText, experienceItems, totalText };
        });

        const aboutScore = Math.min(1, profileRichness.aboutText / 500);
        const expScore = Math.min(1, profileRichness.experienceItems / 5);
        const textScore = Math.min(1, profileRichness.totalText / 3000);
        const richness = aboutScore * 0.35 + expScore * 0.35 + textScore * 0.3;

        // Budget totale: sparse 4-8s, medio 7-14s, ricco 12-20s
        const budgetMs = 4000 + Math.floor(richness * 12_000) + Math.floor(Math.random() * 4000);
        const startMs = Date.now();

        // Fase 1: scroll veloce (orientation) — 30-40% del budget
        const isScrollable = await page
            .evaluate(() => document.body.scrollHeight > window.innerHeight)
            .catch(() => false);
        if (isScrollable) {
            const scrollSteps = mobile ? randomInt(1, 3) : randomInt(2, 4);
            for (let i = 0; i < scrollSteps; i++) {
                if (Date.now() - startMs > budgetMs * 0.7) break; // Non sforare il budget
                const deltaY =
                    richness > 0.5
                        ? 100 + Math.random() * 200 // Profilo ricco: scroll lento per leggere
                        : 300 + Math.random() * 300; // Profilo sparse: scroll veloce
                await wheelWithMomentum(page, deltaY);
                if (mobile && Math.random() < 0.3) await humanSwipe(page, 'up');
                // Pausa tra scroll proporzionale a richness
                const pauseMs = 400 + Math.floor(richness * 1200) + Math.floor(Math.random() * 600);
                await page.waitForTimeout(pauseMs);
            }
        }

        // Fase 2: dwell residuo (lettura + decisione) — tempo restante nel budget
        const elapsed = Date.now() - startMs;
        const remainingMs = Math.max(500, budgetMs - elapsed);
        await page.waitForTimeout(remainingMs);

        // 10% tab switch durante lettura profilo
        if (Math.random() < 0.1) {
            await simulateTabSwitch(page, 2000 + Math.random() * 5000);
        }
    } catch {
        // Fallback: dwell time breve se DOM extraction fallisce
        await page.waitForTimeout(3000 + Math.floor(Math.random() * 5000));
    }
}
