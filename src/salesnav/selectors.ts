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
    // Visible label wrapping hidden checkbox (most common SalesNav pattern)
    'label:has-text("Select all")',
    'label:has-text("Seleziona tutto")',
    'label.artdeco-checkbox:has-text("Select all")',
    'label.artdeco-checkbox:has-text("Seleziona tutto")',
    // Checkbox by role
    '[role="checkbox"][aria-label*="Select all"]',
    '[role="checkbox"][aria-label*="Seleziona tutt"]',
    // Artdeco checkbox input (may be visually hidden)
    '.artdeco-checkbox__input[aria-label*="Select all"]',
    '.artdeco-checkbox__input[aria-label*="Seleziona tutt"]',
    // Standard inputs with full aria-label
    'input[aria-label="Select all current page results"]',
    'input[aria-label="Seleziona tutti i risultati nella pagina corrente"]',
    // Button variant
    'button:has-text("Select all")',
    'button:has-text("Seleziona tutto")',
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
    // Dropdown/listbox variant (some SalesNav versions use dropdown instead of modal)
    '[role="listbox"]',
    '.artdeco-dropdown__content',
].join(', ');
