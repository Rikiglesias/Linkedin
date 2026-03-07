/**
 * salesnav/selectors.ts — Shared Sales Navigator selectors
 *
 * Single source of truth for CSS selectors used across SalesNav modules.
 */

export const SALESNAV_NEXT_PAGE_SELECTOR = [
    'button[aria-label="Next"]',
    'button[aria-label*="Avanti"]',
    'button.artdeco-pagination__button--next',
    'button:has-text("Next")',
    'button:has-text("Avanti")',
].join(', ');

export const SALESNAV_SELECT_ALL_SELECTOR = [
    'input[aria-label="Select all current page results"]',
    'input[aria-label="Seleziona tutti i risultati nella pagina corrente"]',
    'button:has-text("Select all")',
    'button:has-text("Seleziona tutto")',
    '.artdeco-checkbox__input[aria-label*="Select all"]',
].join(', ');

export const SALESNAV_SAVE_TO_LIST_SELECTOR = [
    'button:has-text("Save to list")',
    "button:has-text(\"Salva nell'elenco\")",
    'button[title="Save to list"]',
    "button[title=\"Salva nell'elenco\"]",
].join(', ');

export const SALESNAV_DIALOG_SELECTOR = [
    '[role="dialog"]',
    '.artdeco-modal',
    '.artdeco-modal__content',
].join(', ');
