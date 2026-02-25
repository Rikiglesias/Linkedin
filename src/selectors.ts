/**
 * Centralized selectors with progressive fallbacks.
 */
export const SELECTORS = {
    globalNav: '.global-nav__me, [data-test-global-nav-me] button',

    connectButtonPrimary: [
        'button.artdeco-button--primary:has-text("Connect")',
        'button.artdeco-button--primary:has-text("Collegati")',
    ].join(', '),

    moreActionsButton: [
        'button[aria-label="More actions"]',
        'button[aria-label="Altre azioni"]',
        'button.artdeco-dropdown__trigger:has-text("More")',
        'button.artdeco-dropdown__trigger:has-text("Altro")',
    ].join(', '),

    connectInMoreMenu: [
        'div.artdeco-dropdown__content-inner li button:has-text("Connect")',
        'div.artdeco-dropdown__content-inner li button:has-text("Collegati")',
    ].join(', '),

    sendWithoutNote: [
        'button[aria-label="Send without a note"]',
        'button[aria-label="Invia senza nota"]',
    ].join(', '),

    sendFallback: [
        'button.artdeco-button--primary:has-text("Send")',
        'button.artdeco-button--primary:has-text("Invia")',
    ].join(', '),

    invitePendingIndicators: [
        'button:has-text("Pending")',
        'button:has-text("In attesa")',
        'button[aria-label*="Pending"]',
    ].join(', '),

    messageButton: [
        'button[aria-label^="Message"]',
        'button[aria-label^="Invia messaggio"]',
        'a.message-anywhere-button',
    ].join(', '),

    distanceBadge: [
        'span.dist-value',
        'span[aria-hidden="true"]:has-text("1st")',
        'span[aria-hidden="true"]:has-text("1°")',
    ].join(', '),

    messageTextbox: [
        'div.msg-form__contenteditable[role="textbox"]',
        'div[contenteditable="true"][role="textbox"]',
    ].join(', '),

    messageSendButton: [
        'button.msg-form__send-button',
        'button:has-text("Send")',
        'button:has-text("Invia")',
    ].join(', '),

    challengeSignals: [
        'input[name="captcha"]',
        'iframe[src*="captcha"]',
        'form[action*="checkpoint"]',
        'h1:has-text("Security verification")',
        'h1:has-text("Verifica")',
    ].join(', '),

    addNoteButton: [
        'button[aria-label="Add a note"]',
        'button[aria-label="Aggiungi una nota"]',
        'button:has-text("Add a note")',
        'button:has-text("Aggiungi una nota")',
    ].join(', '),

    noteTextarea: [
        'div[role="dialog"] textarea',
        'div[role="dialog"] input[type="text"]',
    ].join(', '),

    sendWithNote: [
        'div[role="dialog"] button[aria-label="Send invitation"]',
        'div[role="dialog"] button[aria-label="Invia invito"]',
        'div[role="dialog"] button.artdeco-button--primary:has-text("Send")',
        'div[role="dialog"] button.artdeco-button--primary:has-text("Invia")',
    ].join(', '),
};

