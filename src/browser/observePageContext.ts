/**
 * R01: Pattern OBSERVE-DECIDE-ACT per azioni critiche.
 *
 * Prima di ogni azione (invito, messaggio, follow-up, acceptance check),
 * il bot OSSERVA la pagina per raccogliere contesto:
 * - Chi è la persona sulla pagina? (h1 nome, headline, company)
 * - Qual è lo stato della connessione? (1st, 2nd, 3rd, Pending)
 * - C'è un modale aperto? Una challenge? Un errore?
 * - Il profilo esiste ancora? (404, "page doesn't exist")
 *
 * Il contesto raccolto viene passato al worker che DECIDE se procedere.
 * Se il contesto è sospetto (identità mismatch, profilo eliminato, challenge),
 * il worker AGISCE diversamente (skip, review, throw).
 *
 * Questo modulo è il "cervello visivo" del bot — guarda PRIMA di agire.
 */

import { Page } from 'playwright';
import { logInfo, logWarn } from '../telemetry/logger';

export interface PageObservation {
    /** Nome dalla h1 del profilo (null se non trovato) */
    profileName: string | null;
    /** Headline/job title sotto il nome */
    profileHeadline: string | null;
    /** Grado di connessione: '1st', '2nd', '3rd', 'pending', null */
    connectionDegree: string | null;
    /** true se il profilo non esiste (404, "page doesn't exist") */
    isProfileDeleted: boolean;
    /** true se c'è un modale/overlay visibile */
    hasModalOpen: boolean;
    /** true se c'è una challenge/captcha/restriction */
    hasChallenge: boolean;
    /** URL corrente della pagina */
    currentUrl: string;
    /** true se il bottone Connect è visibile */
    hasConnectButton: boolean;
    /** true se il bottone Message è visibile */
    hasMessageButton: boolean;
    /** true se "Pending" è visibile (invito in attesa) */
    hasPendingIndicator: boolean;
}

/**
 * Osserva la pagina corrente e raccoglie contesto strutturato.
 * Timeout: max 5s totali — se la pagina è lenta, ritorna partial observation.
 * Non lancia mai eccezioni — ritorna sempre un PageObservation (anche parziale).
 */
export async function observePageContext(page: Page): Promise<PageObservation> {
    const observation: PageObservation = {
        profileName: null,
        profileHeadline: null,
        connectionDegree: null,
        isProfileDeleted: false,
        hasModalOpen: false,
        hasChallenge: false,
        currentUrl: page.url(),
        hasConnectButton: false,
        hasMessageButton: false,
        hasPendingIndicator: false,
    };

    try {
        // Raccolta parallela per minimizzare latenza (max 3s per step)
        const [nameResult, headlineResult, pageText] = await Promise.allSettled([
            page.locator('h1').first().textContent({ timeout: 3000 }),
            page.locator('.text-body-medium').first().textContent({ timeout: 2000 }),
            page.textContent('body', { timeout: 2000 }),
        ]);

        if (nameResult.status === 'fulfilled' && nameResult.value) {
            observation.profileName = nameResult.value.trim();
        }
        if (headlineResult.status === 'fulfilled' && headlineResult.value) {
            observation.profileHeadline = headlineResult.value.trim();
        }

        const bodyText = (pageText.status === 'fulfilled' ? pageText.value : '') ?? '';
        const bodyLower = bodyText.toLowerCase();

        // Profilo eliminato/404
        observation.isProfileDeleted =
            /this page doesn.t exist|page not found|pagina non trovata|profilo non disponibile/i.test(bodyLower) ||
            observation.currentUrl.includes('/404');

        // Challenge detection
        observation.hasChallenge =
            /unusual activity|restricted|verify your identity|temporarily limited|captcha|checkpoint|attività insolita|account limitato/i.test(bodyLower);

        // Bottoni e indicatori (parallelo)
        const [connectCount, messageCount, pendingCount, modalCount, degreeText] = await Promise.allSettled([
            page.locator('button:has-text("Connect"), button:has-text("Collegati"), button[aria-label*="Connect"]').count(),
            page.locator('button:has-text("Message"), button:has-text("Messaggio"), button[aria-label^="Message"]').count(),
            page.locator('button:has-text("Pending"), button:has-text("In attesa")').count(),
            page.locator('div[role="dialog"], div[role="alertdialog"], .artdeco-modal').count(),
            page.locator('.dist-value, .distance-badge, span:has-text("1st"), span:has-text("2nd"), span:has-text("3rd")').first().textContent({ timeout: 1500 }),
        ]);

        observation.hasConnectButton = connectCount.status === 'fulfilled' && (connectCount.value ?? 0) > 0;
        observation.hasMessageButton = messageCount.status === 'fulfilled' && (messageCount.value ?? 0) > 0;
        observation.hasPendingIndicator = pendingCount.status === 'fulfilled' && (pendingCount.value ?? 0) > 0;
        observation.hasModalOpen = modalCount.status === 'fulfilled' && (modalCount.value ?? 0) > 0;

        if (degreeText.status === 'fulfilled' && degreeText.value) {
            const dt = degreeText.value.trim().toLowerCase();
            if (dt.includes('1st') || dt.includes('1°')) observation.connectionDegree = '1st';
            else if (dt.includes('2nd') || dt.includes('2°')) observation.connectionDegree = '2nd';
            else if (dt.includes('3rd') || dt.includes('3°')) observation.connectionDegree = '3rd';
        }
    } catch (err) {
        await logWarn('observe_page_context.error', {
            url: observation.currentUrl,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    return observation;
}

/**
 * Verifica rapida se la pagina ha problemi bloccanti (profilo eliminato, challenge).
 * Usata come gate prima di qualsiasi azione critica.
 */
export function hasBlockingIssue(obs: PageObservation): { blocked: boolean; reason: string | null } {
    if (obs.isProfileDeleted) {
        return { blocked: true, reason: 'profile_deleted_or_404' };
    }
    if (obs.hasChallenge) {
        return { blocked: true, reason: 'challenge_or_restriction_detected' };
    }
    return { blocked: false, reason: null };
}

/**
 * Log strutturato dell'osservazione per debug e audit.
 */
export async function logObservation(obs: PageObservation, context: { leadId?: number; purpose?: string }): Promise<void> {
    await logInfo('observe_page_context.result', {
        leadId: context.leadId,
        purpose: context.purpose,
        profileName: obs.profileName?.substring(0, 40),
        profileHeadline: obs.profileHeadline?.substring(0, 40),
        connectionDegree: obs.connectionDegree,
        isProfileDeleted: obs.isProfileDeleted,
        hasChallenge: obs.hasChallenge,
        hasConnectButton: obs.hasConnectButton,
        hasMessageButton: obs.hasMessageButton,
        hasPendingIndicator: obs.hasPendingIndicator,
        hasModalOpen: obs.hasModalOpen,
    });
}
