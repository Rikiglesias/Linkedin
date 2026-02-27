/**
 * Centralized selectors with explicit priority arrays.
 *
 * Each key returns an array of selectors, ordered from most-specific (primary)
 * to least-specific (text-based XPath fallback). The browser wrapper
 * `clickWithFallback`/`waitForSelectorWithFallback` will iterate the array in
 * order, logging a WARNING when it degrades to a fallback tier.
 *
 * Convention:
 *   [0] = Primary CSS selector (aria-label, data-test, artdeco class)
 *   [1] = Secondary CSS selector (text variant / i18n Italian)
 *   [2] = Tertiary / XPath text-based (last resort)
 */
export const SELECTORS = {

    globalNav: [
        '.global-nav__me',
        '[data-test-global-nav-me] button',
        'button[aria-label*="Me"]',
    ],

    connectButtonPrimary: [
        'button.artdeco-button--primary:has-text("Connect")',
        'button.artdeco-button--primary:has-text("Collegati")',
        'button[aria-label*="Connect"]',
        'button[aria-label*="Collegati"]',
    ],

    moreActionsButton: [
        'button[aria-label="More actions"]',
        'button[aria-label="Altre azioni"]',
        'button.artdeco-dropdown__trigger:has-text("More")',
        'button.artdeco-dropdown__trigger:has-text("Altro")',
        // XPath fallback – last resort
        '//button[contains(@aria-label,"More") or contains(@aria-label,"Altre")]',
    ],

    connectInMoreMenu: [
        'div.artdeco-dropdown__content-inner li button:has-text("Connect")',
        'div.artdeco-dropdown__content-inner li button:has-text("Collegati")',
        '.artdeco-dropdown__content button:has-text("Connect")',
        '//div[contains(@class,"dropdown")]//button[contains(.,"Connect") or contains(.,"Collegati")]',
    ],

    sendWithoutNote: [
        'button[aria-label="Send without a note"]',
        'button[aria-label="Invia senza nota"]',
        'button:has-text("Send without a note")',
        'button:has-text("Invia senza nota")',
        '//button[contains(.,"Send without") or contains(.,"Invia senza")]',
    ],

    sendFallback: [
        'button.artdeco-button--primary:has-text("Send")',
        'button.artdeco-button--primary:has-text("Invia")',
        '//button[contains(@class,"primary") and (contains(.,"Send") or contains(.,"Invia"))]',
    ],

    invitePendingIndicators: [
        'button:has-text("Pending")',
        'button:has-text("In attesa")',
        'button[aria-label*="Pending"]',
        '//button[contains(.,"Pending") or contains(.,"In attesa")]',
    ],

    messageButton: [
        'button[aria-label^="Message"]',
        'button[aria-label^="Invia messaggio"]',
        'a.message-anywhere-button',
        'button:has-text("Message")',
        '//button[starts-with(@aria-label,"Message") or starts-with(@aria-label,"Invia messaggio")]',
    ],

    distanceBadge: [
        'span.dist-value',
        'span[aria-hidden="true"]:has-text("1st")',
        'span[aria-hidden="true"]:has-text("1°")',
        '//span[@aria-hidden="true" and (contains(.,"1st") or contains(.,"1°"))]',
    ],

    messageTextbox: [
        'div.msg-form__contenteditable[role="textbox"]',
        'div[contenteditable="true"][role="textbox"]',
        '.msg-form__msg-content-container div[contenteditable]',
    ],

    messageSendButton: [
        'button.msg-form__send-button',
        'button:has-text("Send"):not([aria-label*="Connection"])',
        'button:has-text("Invia"):not([aria-label*="Connessione"])',
        '//button[contains(@class,"send-button")]',
    ],

    challengeSignals: [
        'input[name="captcha"]',
        'iframe[src*="captcha"]',
        'form[action*="checkpoint"]',
        'h1:has-text("Security verification")',
        'h1:has-text("Verifica")',
        'div:has-text("temporarily blocked")',
        'div:has-text("temporaneamente bloccato")',
    ],

    addNoteButton: [
        'button[aria-label="Add a note"]',
        'button[aria-label="Aggiungi una nota"]',
        'button:has-text("Add a note")',
        'button:has-text("Aggiungi una nota")',
        '//button[contains(.,"Add a note") or contains(.,"Aggiungi una nota")]',
    ],

    noteTextarea: [
        'div[role="dialog"] textarea',
        'div[role="dialog"] div[contenteditable="true"]',
        'div[role="dialog"] input[type="text"]',
    ],

    sendWithNote: [
        'div[role="dialog"] button[aria-label="Send invitation"]',
        'div[role="dialog"] button[aria-label="Invia invito"]',
        'div[role="dialog"] button.artdeco-button--primary:has-text("Send")',
        'div[role="dialog"] button.artdeco-button--primary:has-text("Invia")',
        '//div[@role="dialog"]//button[contains(@class,"primary") and (contains(.,"Send") or contains(.,"Invia"))]',
    ],

    inviteWeeklyLimitSignals: [
        'div:has-text("weekly invitation limit")',
        'span:has-text("weekly invitation limit")',
        'div:has-text("limite settimanale")',
        'span:has-text("limite settimanale")',
    ],

    aboutSection: [
        'section:has(#about) .display-flex',
        'div#about ~ div .display-flex',
        '.pv-shared-text-with-see-more',
        '#about',
    ],

    experienceSection: [
        'section:has(#experience) ul.pvs-list',
        'div#experience ~ div ul.pvs-list',
        '#experience ~ div ul',
    ],

    showMoreButton: [
        'button:has-text("Show more")',
        'button:has-text("Mostra altro")',
        'button.scaffold-finite-scroll__load-button',
        '//button[contains(.,"Show more") or contains(.,"Mostra altro")]',
    ],
} as const;

/**
 * Helper: concatenate all selectors for a key into a single comma-separated
 * CSS selector string (XPath entries are excluded).
 * Useful for places that use `page.locator()` directly with any-match.
 */
export function joinSelectors(key: keyof typeof SELECTORS): string {
    return SELECTORS[key]
        .filter((s) => !s.startsWith('//'))
        .join(', ');
}
