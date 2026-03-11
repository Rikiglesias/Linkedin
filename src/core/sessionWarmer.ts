/**
 * sessionWarmer.ts
 *
 * Implementa il modulo "Behavioral Engine" della roadmap Fase 3.
 * Il suo scopo è iniettare traffico inerte "umano" subito dopo il routing e
 * prima di operazioni massive come mass-enrichment o auto-connect.
 *
 * Aggiornamento 2026: dati aggregati sui trigger ban per categoria:
 *   - messaggi identici 34% → SemanticChecker copre questo
 *   - timing innaturale 28% → contextual pause + isSpaceOrPunctuation fix
 *   - volume eccessivo 19% → adaptive caps + compliance
 *   - IP condivisi 12% → proxy rotation + sticky proxy
 *   - spike di profile views 7% → warm-up progressivo
 *
 * WARMUP_TWO_SESSIONS_PER_DAY: splitta il budget giornaliero in 2 finestre
 * (es. 9-11 + 14-16) → LinkedIn preferisce pattern a 2 sessioni brevi
 * rispetto a una sessione lunga continua.
 */

import { Page } from 'playwright';
import { simulateHumanReading, humanType, humanDelay } from '../browser';
import { logInfo, logWarn } from '../telemetry/logger';
import { config } from '../config';

/**
 * Determina se la sessione corrente è nella prima o seconda finestra
 * quando WARMUP_TWO_SESSIONS_PER_DAY è attivo.
 * Finestra 1: workingHoursStart → workingHoursStart + metà intervallo
 * Finestra 2: seconda metà dell'intervallo lavorativo
 * Gap tra le due: 2-3 ore per simulare pausa pranzo naturale.
 */
export function getSessionWindow(now: Date = new Date()): 'first' | 'second' | 'gap' {
    if (!config.warmupTwoSessionsPerDay) return 'first';

    const hour = new Intl.DateTimeFormat('en-GB', {
        timeZone: config.timezone,
        hour: '2-digit',
        hour12: false,
    }).format(now);
    const currentHour = parseInt(hour, 10);

    const totalHours = config.workingHoursEnd - config.workingHoursStart;
    const sessionLength = Math.max(1, Math.floor(totalHours / 2) - 1); // -1h per gap minimo, min 1h
    const firstEnd = config.workingHoursStart + sessionLength;
    const gapEnd = firstEnd + 2; // 2h gap (pausa pranzo)
    const secondEnd = Math.min(gapEnd + sessionLength, config.workingHoursEnd);

    if (currentHour >= config.workingHoursStart && currentHour < firstEnd) return 'first';
    if (currentHour >= gapEnd && currentHour < secondEnd) return 'second';
    return 'gap';
}

/**
 * Calcola il fattore di budget per la sessione corrente.
 * Con 2 sessioni/giorno, la mattina riceve 60% e il pomeriggio 40%.
 * Nella gap tra le sessioni, il budget è 0 (pausa).
 * Razionale: la mattina ha tipicamente acceptance rate più alto su LinkedIn.
 */
export function getSessionBudgetFactor(): number {
    if (!config.warmupTwoSessionsPerDay) return 1.0;
    const window = getSessionWindow();
    if (window === 'gap') return 0;
    return window === 'first' ? 0.6 : 0.4;
}

export async function warmupSession(page: Page): Promise<void> {
    const sessionWindow = getSessionWindow();
    await logInfo('session_warmer.start', {
        twoSessionsMode: config.warmupTwoSessionsPerDay,
        sessionWindow,
    });

    // Se siamo nella gap tra le due sessioni, skip warm-up
    if (config.warmupTwoSessionsPerDay && sessionWindow === 'gap') {
        await logInfo('session_warmer.skipped_gap', {
            reason: 'Between session windows (lunch break simulation)',
        });
        return;
    }

    try {
        // 1. Vai alla Home Page
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
        await humanDelay(page, 2000, 5000);

        // 2. Scrolling organico sul feed (leggere articoli passivamente)
        await logInfo('session_warmer.feed_reading');
        const maxScrollAttempts = Math.floor(Math.random() * 3) + 2; // Da 2 a 4 scroll
        for (let i = 0; i < maxScrollAttempts; i++) {
            await simulateHumanReading(page);
            await humanDelay(page, 1500, 4000);
        }

        // 3. Check Notifiche incrociato (Blink passivo)
        if (Math.random() > 0.5) {
            await logInfo('session_warmer.notifications_check');
            const notificationsTab = await page.$('a[href*="/notifications/"]');
            if (notificationsTab) {
                await notificationsTab.hover();
                await humanDelay(page, 1000, 2000);
            }
        }

        // 4. Interazione col motore di ricerca (digita qualcosa, cancella) [Raro: 30%]
        if (Math.random() > 0.7) {
            await logInfo('session_warmer.search_simulation');
            const searchInput = await page.$('input.search-global-typeahead__input');
            if (searchInput) {
                await searchInput.focus();
                const dummySearches = ['software engineer', 'recruiter', 'news tech', 'AI trends'];
                const searchTxt = dummySearches[Math.floor(Math.random() * dummySearches.length)];
                await humanType(page, 'input.search-global-typeahead__input', searchTxt);
                await humanDelay(page, 800, 1500);
                await searchInput.fill('');
                await humanDelay(page, 500, 1000);
                await page.keyboard.press('Escape');
            }
        }

        // 5. Messaging tab check (sessione 2 only — simula "torno a controllare risposte")
        if (sessionWindow === 'second' && Math.random() > 0.6) {
            await logInfo('session_warmer.messaging_check');
            const messagingTab = await page.$('a[href*="/messaging/"]');
            if (messagingTab) {
                await messagingTab.hover();
                await humanDelay(page, 800, 1500);
            }
        }

        // 6. Profile view (raro, 15% — simula curiosità naturale)
        if (Math.random() > 0.85) {
            await logInfo('session_warmer.own_profile_view');
            const myProfileLink = await page.$('a[href*="/in/"] img.presence-entity__image');
            if (myProfileLink) {
                await myProfileLink.hover();
                await humanDelay(page, 500, 1200);
            }
        }
    } catch (e) {
        await logWarn('session_warmer.interrupted', { error: e instanceof Error ? e.message : String(e) });
    } finally {
        await logInfo('session_warmer.done');
        await humanDelay(page, 1000, 2000);
    }
}
