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
import { simulateHumanReading, humanType, humanDelay, dismissKnownOverlays } from '../browser';
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

    // Catena probabilistica ordinata (3.1): un umano reale segue sempre
    // lo stesso ordine di navigazione al primo accesso. Feed è SEMPRE primo,
    // poi notifiche, poi messaging. Search e profile view sono rari e mai primi.
    const stepsExecuted: string[] = [];

    try {
        // Step 1: Feed — SEMPRE primo (90% lo visita, 10% skip raro es. clic diretto su notifica)
        if (Math.random() < 0.90) {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
            await dismissKnownOverlays(page);
            await humanDelay(page, 2000, 5000);
            await logInfo('session_warmer.feed_reading');
            const maxScrollAttempts = Math.floor(Math.random() * 3) + 2;
            for (let i = 0; i < maxScrollAttempts; i++) {
                await simulateHumanReading(page);
                await humanDelay(page, 1500, 4000);
            }
            stepsExecuted.push('feed');
        }

        // Step 2: Notifiche — 70% (secondo passo naturale dopo feed)
        if (Math.random() < 0.70) {
            await logInfo('session_warmer.notifications_check');
            await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded' });
            await dismissKnownOverlays(page);
            await humanDelay(page, 1500, 3000);
            await simulateHumanReading(page);
            stepsExecuted.push('notifications');
        }

        // Step 3: Messaging — 40% (solo sessione 2: "torno a controllare risposte")
        if (sessionWindow === 'second' && Math.random() < 0.40) {
            await logInfo('session_warmer.messaging_check');
            await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded' });
            await dismissKnownOverlays(page);
            await humanDelay(page, 1200, 2500);
            stepsExecuted.push('messaging');
        }

        // Step 4: Search — raro (20%), mai primo. Simula curiosità.
        if (stepsExecuted.length > 0 && Math.random() < 0.20) {
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
                stepsExecuted.push('search');
            }
        }

        // Step 5: Profile view — raro (15%), mai primo. Curiosità naturale.
        if (stepsExecuted.length > 0 && Math.random() < 0.15) {
            await logInfo('session_warmer.own_profile_view');
            const myProfileLink = await page.$('a[href*="/in/"] img.presence-entity__image');
            if (myProfileLink) {
                await myProfileLink.hover();
                await humanDelay(page, 500, 1200);
                stepsExecuted.push('profile');
            }
        }
    } catch (e) {
        await logWarn('session_warmer.interrupted', { error: e instanceof Error ? e.message : String(e) });
    } finally {
        await logInfo('session_warmer.done', { stepsExecuted });
        await humanDelay(page, 1000, 2000);
    }
}
