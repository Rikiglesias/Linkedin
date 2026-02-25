/**
 * sessionWarmer.ts
 * 
 * Implementa il modulo "Behavioral Engine" della roadmap Fase 3.
 * Il suo scopo è iniettare traffico inerte "umano" subito dopo il routing e 
 * prima di operazioni massive come mass-enrichment o auto-connect.
 */

import { Page } from 'playwright';
import { simulateHumanReading, humanType, humanDelay } from '../browser';


export async function warmupSession(page: Page): Promise<void> {
    console.log(`[WARM-UP] Avvio Session Warming (Behavioral Engine)...`);

    try {
        // 1. Vai alla Home Page
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
        await humanDelay(page, 2000, 5000);

        // 2. Scrolling organico sul feed (leggere articoli passivamente)
        console.log(`[WARM-UP] Simulazione lettura disinteressata del feed...`);
        const maxScrollAttempts = Math.floor(Math.random() * 3) + 2; // Da 2 a 4 scroll
        for (let i = 0; i < maxScrollAttempts; i++) {
            await simulateHumanReading(page);
            await humanDelay(page, 1500, 4000);
        }

        // 3. Check Notifiche incrociato (Blink passivo)
        if (Math.random() > 0.5) {
            console.log(`[WARM-UP] Ispezione sporadica della barra notifiche...`);
            const notificationsTab = await page.$('a[href*="/notifications/"]');
            if (notificationsTab) {
                // Non ci serve per forza cliccare, a volte basta il mouse over lungo o clic passivo
                await notificationsTab.hover();
                await humanDelay(page, 1000, 2000);
            }
        }

        // 4. Interazione col motore di ricerca (digita qualcosa, cancella) [Raro: 30%]
        if (Math.random() > 0.7) {
            console.log(`[WARM-UP] Simulazione interesse ricerca globale disattesa...`);
            const searchInput = await page.$('input.search-global-typeahead__input');
            if (searchInput) {
                await searchInput.focus();
                // Digita un termine dummy che l'utente scriverebbe e poi cancella
                const dummySearches = ['software engineer', 'recruiter', 'news tech', 'AI trends'];
                const searchTxt = dummySearches[Math.floor(Math.random() * dummySearches.length)];
                await humanType(page, 'input.search-global-typeahead__input', searchTxt);
                await humanDelay(page, 800, 1500);
                // Cancella
                await searchInput.fill('');
                await humanDelay(page, 500, 1000);
                await page.keyboard.press('Escape'); // Chiudi il dropdown
            }
        }

    } catch (e) {
        console.log(`[WARM-UP] Warming interrotto, ignoro (non fatale):`, e instanceof Error ? e.message : e);
    } finally {
        console.log(`[WARM-UP] Session Warming completato, token stabilizzato.`);
        await humanDelay(page, 1000, 2000);
    }
}
