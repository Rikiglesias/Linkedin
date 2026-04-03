import { Page } from 'playwright';
import { getAccountProfileById } from '../accountManager';
import { cleanText } from '../utils/text';
import { checkLogin, clickLocatorHumanLike, closeBrowser, humanDelay, launchBrowser } from '../browser';
import { blockUserInput, pauseInputBlock, resumeInputBlock } from '../browser/humanBehavior';
import { enableWindowClickThrough, disableWindowClickThrough } from '../browser/windowInputBlock';
import { normalizeLinkedInUrl } from '../linkedinUrl';
import { navigateToSavedLists, SalesNavSavedList } from './listScraper';

export interface SalesNavActionResult {
    ok: boolean;
    accountId: string;
    message: string;
    listName?: string;
    listUrl?: string | null;
}

const CREATE_LIST_BUTTON_SELECTOR = [
    'button:has-text("Create list")',
    'button:has-text("Crea lista")',
    'a:has-text("Create list")',
    'a:has-text("Crea lista")',
].join(', ');

const LIST_NAME_INPUT_SELECTOR = [
    'input[placeholder*="List name"]',
    'input[placeholder*="Nome lista"]',
    'input[name*="list"]',
    'input[id*="list"]',
].join(', ');

const CREATE_LIST_CONFIRM_SELECTOR = [
    'button:has-text("Create")',
    'button:has-text("Crea")',
    'button.artdeco-button--primary',
].join(', ');

const SAVE_TO_LIST_BUTTON_SELECTOR = [
    'button:has-text("Save in list")',
    'button:has-text("Salva in lista")',
    'button:has-text("Save")',
    'button:has-text("Salva")',
].join(', ');

const ADD_TO_LIST_CONFIRM_SELECTOR = [
    'button:has-text("Save")',
    'button:has-text("Salva")',
    'button:has-text("Done")',
    'button:has-text("Fatto")',
].join(', ');

function normalizeListName(value: string): string {
    return cleanText(value).toLowerCase();
}

function matchSavedListByName(lists: SalesNavSavedList[], listName: string): SalesNavSavedList | null {
    const target = normalizeListName(listName);
    if (!target) return null;

    const exact = lists.find((entry) => normalizeListName(entry.name) === target);
    if (exact) return exact;

    const partial = lists.find((entry) => {
        const name = normalizeListName(entry.name);
        return name.includes(target) || target.includes(name);
    });
    return partial ?? null;
}

async function resolveSavedListUrl(page: import('playwright').Page, listName: string): Promise<string | null> {
    try {
        const lists = await navigateToSavedLists(page);
        const matched = matchSavedListByName(lists, listName);
        return matched?.url ?? null;
    } catch {
        return null;
    }
}

export async function createSalesNavList(
    listName: string,
    accountId?: string,
    externalPage?: Page,
): Promise<SalesNavActionResult> {
    const account = getAccountProfileById(accountId);
    const normalizedListName = cleanText(listName);
    if (!normalizedListName) {
        return { ok: false, accountId: account.id, message: 'Nome lista non valido' };
    }

    const ownSession = externalPage
        ? null
        : await launchBrowser({
              headless: false,
              sessionDir: account.sessionDir,
              proxy: account.proxy,
              forceDesktop: true,
          });
    const page = externalPage ?? ownSession?.page;
    if (!page) return { ok: false, accountId: account.id, message: 'Nessuna pagina disponibile' };
    try {
        const loggedIn = await checkLogin(page);
        if (!loggedIn) {
            return { ok: false, accountId: account.id, message: 'Sessione non autenticata' };
        }
        enableWindowClickThrough(page.context());
        await blockUserInput(page);

        await page.goto('https://www.linkedin.com/sales/lists/people/', {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        await blockUserInput(page);
        await humanDelay(page, 1400, 2600);

        const createButton = page.locator(CREATE_LIST_BUTTON_SELECTOR).first();
        if ((await createButton.count()) === 0) {
            return { ok: false, accountId: account.id, message: 'Bottone Create list non trovato' };
        }
        await clickLocatorHumanLike(page, createButton, { selectorForDwell: CREATE_LIST_BUTTON_SELECTOR });
        await humanDelay(page, 800, 1600);

        const nameInput = page.locator(LIST_NAME_INPUT_SELECTOR).first();
        if ((await nameInput.count()) === 0) {
            return { ok: false, accountId: account.id, message: 'Input nome lista non trovato' };
        }
        await pauseInputBlock(page);
        try {
            await nameInput.fill(normalizedListName);
        } finally {
            await resumeInputBlock(page);
        }
        await humanDelay(page, 450, 900);

        const confirmButton = page.locator(CREATE_LIST_CONFIRM_SELECTOR).first();
        if ((await confirmButton.count()) === 0) {
            return { ok: false, accountId: account.id, message: 'Bottone conferma creazione non trovato' };
        }
        await clickLocatorHumanLike(page, confirmButton, { selectorForDwell: CREATE_LIST_CONFIRM_SELECTOR });
        await humanDelay(page, 1400, 2600);
        const resolvedListUrl = await resolveSavedListUrl(page, normalizedListName);

        return {
            ok: true,
            accountId: account.id,
            listName: normalizedListName,
            listUrl: resolvedListUrl,
            message: `Lista creata (best-effort): ${normalizedListName}`,
        };
    } finally {
        if (ownSession) {
            disableWindowClickThrough(ownSession.browser);
            await closeBrowser(ownSession);
        }
    }
}

export async function addLeadToSalesNavList(
    leadLinkedinUrl: string,
    listName: string,
    accountId?: string,
    externalPage?: Page,
): Promise<SalesNavActionResult> {
    const account = getAccountProfileById(accountId);
    const normalizedListName = cleanText(listName);
    const normalizedLeadUrl = normalizeLinkedInUrl(leadLinkedinUrl);
    if (!normalizedListName) {
        return { ok: false, accountId: account.id, message: 'Nome lista non valido' };
    }
    if (!normalizedLeadUrl) {
        return { ok: false, accountId: account.id, message: 'URL lead non valido' };
    }

    const ownSession = externalPage
        ? null
        : await launchBrowser({
              headless: false,
              sessionDir: account.sessionDir,
              proxy: account.proxy,
              forceDesktop: true,
          });
    const page = externalPage ?? ownSession?.page;
    if (!page) return { ok: false, accountId: account.id, message: 'Nessuna pagina disponibile' };
    try {
        const loggedIn = await checkLogin(page);
        if (!loggedIn) {
            return { ok: false, accountId: account.id, message: 'Sessione non autenticata' };
        }
        enableWindowClickThrough(page.context());
        await blockUserInput(page);

        await page.goto(normalizedLeadUrl, { waitUntil: 'domcontentloaded' });
        await blockUserInput(page);
        await humanDelay(page, 1400, 2600);

        const saveButton = page.locator(SAVE_TO_LIST_BUTTON_SELECTOR).first();
        if ((await saveButton.count()) === 0) {
            return { ok: false, accountId: account.id, message: 'Bottone Save in list non trovato' };
        }
        await clickLocatorHumanLike(page, saveButton, { selectorForDwell: SAVE_TO_LIST_BUTTON_SELECTOR });
        await humanDelay(page, 900, 1800);

        const listOption = page.locator(`text="${normalizedListName}"`).first();
        if ((await listOption.count()) === 0) {
            return {
                ok: false,
                accountId: account.id,
                message: `Lista non trovata nel popup: ${normalizedListName}`,
            };
        }
        await clickLocatorHumanLike(page, listOption, {
            selectorForDwell: `text="${normalizedListName}"`,
        });
        await humanDelay(page, 400, 900);

        const confirmButton = page.locator(ADD_TO_LIST_CONFIRM_SELECTOR).first();
        if ((await confirmButton.count()) > 0) {
            await clickLocatorHumanLike(page, confirmButton, { selectorForDwell: ADD_TO_LIST_CONFIRM_SELECTOR });
        }
        await humanDelay(page, 900, 1800);
        const resolvedListUrl = await resolveSavedListUrl(page, normalizedListName);
        return {
            ok: true,
            accountId: account.id,
            listName: normalizedListName,
            listUrl: resolvedListUrl,
            message: `Lead aggiunto (best-effort) a lista: ${normalizedListName}`,
        };
    } finally {
        if (ownSession) {
            disableWindowClickThrough(ownSession.browser);
            await closeBrowser(ownSession);
        }
    }
}
