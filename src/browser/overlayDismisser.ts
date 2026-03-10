/**
 * browser/overlayDismisser.ts
 * ─────────────────────────────────────────────────────────────────
 * Chiude automaticamente overlay/popup/modali LinkedIn che interferiscono
 * con le azioni del bot: upsell premium, chat bubbles, cookie consent,
 * toast notifications, "sei ancora qui?", ecc.
 *
 * Chiamare `dismissKnownOverlays(page)` prima di ogni click critico.
 * Tutte le operazioni sono best-effort e non bloccanti.
 */

import { Page } from 'playwright';

// ─── Selectors noti per overlay LinkedIn ─────────────────────────────────────

interface OverlayRule {
    /** ID univoco per logging */
    id: string;
    /** Selector del container (modale, toast, bubble) */
    containerSelector: string;
    /** Selector del bottone di chiusura dentro il container */
    dismissSelector: string;
    /** Se true, prova anche Escape come fallback */
    escFallback?: boolean;
}

const OVERLAY_RULES: readonly OverlayRule[] = [
    // ─── Modali generici LinkedIn (upsell premium, promo, ecc.)
    {
        id: 'artdeco_modal',
        containerSelector: '.artdeco-modal:not([class*="send"]):not([class*="invite"])',
        dismissSelector: '.artdeco-modal__dismiss, button[data-test-modal-close-btn]',
        escFallback: true,
    },
    // ─── Chat overlay bubbles (messaging widget in basso a destra)
    {
        id: 'msg_overlay_bubble',
        containerSelector: '.msg-overlay-list-bubble',
        dismissSelector: '.msg-overlay-bubble-header__control--close-btn, .msg-overlay-list-bubble__control--close',
    },
    // ─── Toast notifications (LinkedIn toasts in alto o in basso)
    {
        id: 'artdeco_toast',
        containerSelector: '#artdeco-toasts-wormhole .artdeco-toast-item',
        dismissSelector: '.artdeco-toast-item__dismiss, button[data-test-artdeco-toast-close-btn]',
    },
    // ─── Cookie consent banner
    {
        id: 'cookie_consent',
        containerSelector: '.artdeco-global-alert--COOKIE_CONSENT, [data-test-id="cookie-consent"]',
        dismissSelector: 'button[action-type="ACCEPT"], button:has-text("Accept"), button:has-text("Accetta")',
    },
    // ─── "Continua nel browser" / mobile app redirect prompt
    {
        id: 'continue_in_browser',
        containerSelector: '[class*="app-aware-link"], [class*="browser-prompt"]',
        dismissSelector: 'a:has-text("Continua nel browser"), a:has-text("Continue in browser"), button:has-text("Continue")',
    },
    // ─── Premium upsell modal
    {
        id: 'premium_upsell',
        containerSelector: '[class*="premium-upsell"], [data-test-id*="premium"]',
        dismissSelector: '.artdeco-modal__dismiss, button[aria-label="Dismiss"], button[aria-label="Chiudi"]',
        escFallback: true,
    },
    // ─── "Are you still there?" / session timeout dialog
    {
        id: 'session_timeout',
        containerSelector: '[role="dialog"][class*="session"], [role="alertdialog"]',
        dismissSelector: 'button:has-text("Yes"), button:has-text("Sì"), button:has-text("Continue"), button:has-text("Continua")',
        escFallback: true,
    },
    // ─── GDPR / privacy policy banner
    {
        id: 'gdpr_banner',
        containerSelector: '.artdeco-global-alert--NOTICE',
        dismissSelector: 'button.artdeco-global-alert__action, button:has-text("Got it"), button:has-text("Ho capito")',
    },
    // ─── Messaging thread expanded overlay (chiudi se aperto e non richiesto)
    {
        id: 'msg_overlay_conversation',
        containerSelector: '.msg-overlay-conversation-bubble--is-active.msg-overlay-conversation-bubble',
        dismissSelector: '.msg-overlay-bubble-header__control--close-btn',
    },
    // ─── Download mobile app prompt (full-screen blocker su SalesNav)
    {
        id: 'download_mobile_app',
        containerSelector: '.download-mobile-app-prompt__overlay',
        dismissSelector: 'button[aria-label="Dismiss"], button[aria-label="Chiudi"], .download-mobile-app-prompt__content button',
        escFallback: true,
    },
] as const;

// ─── Cooldown per evitare spam di dismiss ────────────────────────────────────

const dismissCooldown = new WeakMap<Page, number>();
const COOLDOWN_MS = 800;

// ─── Core ────────────────────────────────────────────────────────────────────

/**
 * Chiude tutti gli overlay/popup LinkedIn noti visibili sulla pagina.
 * Best-effort: non lancia mai errori, non blocca il flusso.
 *
 * @returns Numero di overlay chiusi con successo
 */
export async function dismissKnownOverlays(page: Page): Promise<number> {
    if (page.isClosed()) return 0;

    // Cooldown: non spammare dismiss troppo frequentemente
    const lastDismiss = dismissCooldown.get(page) ?? 0;
    if (Date.now() - lastDismiss < COOLDOWN_MS) return 0;
    dismissCooldown.set(page, Date.now());

    let dismissed = 0;

    for (const rule of OVERLAY_RULES) {
        try {
            const containerCount = await page.locator(rule.containerSelector).count();
            if (containerCount === 0) continue;

            // Cerca il bottone di chiusura dentro il container
            const dismissBtn = page.locator(`${rule.containerSelector} ${rule.dismissSelector}`).first();
            const btnCount = await dismissBtn.count();

            if (btnCount > 0) {
                const isVisible = await dismissBtn.isVisible().catch(() => false);
                if (isVisible) {
                    await dismissBtn.click({ timeout: 1500 }).catch(() => null);
                    dismissed++;
                    // Breve pausa per animazione di chiusura
                    await page.waitForTimeout(150 + Math.random() * 200).catch(() => null);
                    continue;
                }
            }

            // Fallback: prova standalone dismiss selector (non nested)
            const standaloneDismiss = page.locator(rule.dismissSelector).first();
            const standaloneCount = await standaloneDismiss.count();
            if (standaloneCount > 0) {
                const isVisible = await standaloneDismiss.isVisible().catch(() => false);
                if (isVisible) {
                    await standaloneDismiss.click({ timeout: 1500 }).catch(() => null);
                    dismissed++;
                    await page.waitForTimeout(150 + Math.random() * 200).catch(() => null);
                    continue;
                }
            }

            // Escape key fallback
            if (rule.escFallback) {
                await page.keyboard.press('Escape').catch(() => null);
                await page.waitForTimeout(200).catch(() => null);
                // Verifica se l'overlay è scomparso
                const stillThere = await page.locator(rule.containerSelector).count();
                if (stillThere === 0) {
                    dismissed++;
                    continue;
                }
            }

            // Nuclear fallback: rimuovi l'overlay via JS (per full-screen blockers)
            const nuclearCount = await page.locator(rule.containerSelector).count();
            if (nuclearCount > 0) {
                const removed = await page.evaluate((sel: string) => {
                    const el = document.querySelector(sel);
                    if (el) { el.remove(); return true; }
                    return false;
                }, rule.containerSelector).catch(() => false);
                if (removed) {
                    dismissed++;
                    await page.waitForTimeout(100).catch(() => null);
                }
            }
        } catch {
            // Best-effort: ignora errori su singola regola
        }
    }

    return dismissed;
}

/**
 * Versione leggera: controlla solo se ci sono overlay visibili.
 * Utile per decidere se serve una dismissal prima di un'azione.
 */
export async function hasBlockingOverlay(page: Page): Promise<boolean> {
    if (page.isClosed()) return false;

    try {
        // Controlla solo i selettori bloccanti (modali, dialog)
        const blockingSelectors = OVERLAY_RULES
            .filter((r) => r.escFallback) // Solo quelli che richiedono Escape = bloccanti
            .map((r) => r.containerSelector);

        if (blockingSelectors.length === 0) return false;

        const combinedSelector = blockingSelectors.join(', ');
        const count = await page.locator(combinedSelector).count();
        return count > 0;
    } catch {
        return false;
    }
}
