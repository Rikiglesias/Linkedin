/**
 * salesnav/bulkSavePageActions.ts — Azioni pagina per bulk save SalesNav.
 * Estratte da bulkSaveOrchestrator.ts (A17: split file >1000 righe).
 *
 * Contiene:
 * - clickSelectAll(): seleziona tutti i lead sulla pagina
 * - openSaveToListDialog(): apre il dialog "Save to list"
 * - verifyToast(): verifica toast conferma salvataggio
 * - chooseTargetList(): seleziona la lista target nel dialog
 * - readSelectedListText(): legge il nome della lista selezionata
 * - visionVerifySelectedList(): verifica visiva lista selezionata
 */

import type { Page } from 'playwright';
import {
    humanDelay,
} from '../browser';
import { config } from '../config';
import {
    hasLocator,
    locatorBoundingBox,
    buildClipAroundLocator,
    smartClick,
    safeVisionClick,
    findVisibleClickTarget,
} from './bulkSaveHelpers';
import { humanMouseMoveToCoords } from '../browser/humanBehavior';
import {
    visionVerify,
    visionWaitFor,
} from './visionNavigator';
import { computerUseSelectList } from './computerUse';
import {
    SALESNAV_SELECT_ALL_SELECTOR as SELECT_ALL_SELECTOR,
    SALESNAV_SAVE_TO_LIST_SELECTOR as SAVE_TO_LIST_SELECTOR,
    SALESNAV_DIALOG_SELECTOR as DIALOG_SELECTOR,
} from './selectors';
import { isListFoundInSession, setListFoundInSession } from './bulkSaveState';
export async function clickSelectAll(page: Page, dryRun: boolean): Promise<void> {
    if (dryRun) return;

    // Scroll in cima — "Select All" è nell'header dei risultati
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await humanDelay(page, 200, 400);

    console.log('[SELECT ALL] URL corrente:', page.url());
    let clicked = false;

    // Strategia 1: Ricerca per testo visibile (solo elementi interattivi: label, button, input)
    const selectAllTexts = ['select all', 'seleziona tutto', 'seleziona tutti'];
    const textBox = await findVisibleClickTarget(page, selectAllTexts);
    if (textBox) {
        console.log(`[SELECT ALL] Strategia 1 OK: testo trovato a (${Math.round(textBox.x)},${Math.round(textBox.y)}) ${Math.round(textBox.width)}x${Math.round(textBox.height)}`);
        await smartClick(page, textBox);
        clicked = true;
    } else {
        console.log('[SELECT ALL] Strategia 1 SKIP: nessun elemento interattivo con testo "select all"');
    }

    // Strategia 2: Playwright locator con selettori espansi (label, checkbox, input)
    if (!clicked) {
        const locator = page.locator(SELECT_ALL_SELECTOR).first();
        const found = await hasLocator(locator);
        const box = found ? await locatorBoundingBox(locator) : null;
        if (box && box.width > 3 && box.height > 3) {
            console.log(`[SELECT ALL] Strategia 2 OK: locator CSS a (${Math.round(box.x)},${Math.round(box.y)}) ${Math.round(box.width)}x${Math.round(box.height)}`);
            await smartClick(page, box);
            clicked = true;
        } else {
            console.log(`[SELECT ALL] Strategia 2 SKIP: locator trovato=${found}, box=${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'null'}`);
        }
    }

    // Strategia 3: Playwright getByRole (gestisce checkbox nascosti nativamente)
    if (!clicked) {
        const checkbox = page.getByRole('checkbox', { name: /select all|seleziona tutt/i }).first();
        const count = await checkbox.count();
        if (count > 0) {
            const box = await locatorBoundingBox(checkbox);
            if (box && box.width > 3) {
                console.log(`[SELECT ALL] Strategia 3 OK: getByRole checkbox a (${Math.round(box.x)},${Math.round(box.y)})`);
                await smartClick(page, box);
            } else {
                console.log('[SELECT ALL] Strategia 3: checkbox hidden, force click');
                await checkbox.check({ force: true });
            }
            clicked = true;
        } else {
            console.log('[SELECT ALL] Strategia 3 SKIP: nessun checkbox trovato via getByRole');
        }
    }

    // Strategia 4: Vision AI — ultimo resort
    if (!clicked) {
        console.log('[SELECT ALL] Strategia 4: invoco Vision AI (GPT-4o)...');
        // M38: Clip area alla toolbar superiore (top 200px) — riduce dimensione screenshot
        // e token AI del ~70%. La checkbox Select All è sempre nella toolbar, non nel body.
        const vp = page.viewportSize() ?? { width: 1280, height: 800 };
        await safeVisionClick(page, 'the checkbox or control to select all leads on this page. Look for a small checkbox at the top of the results list, usually labeled "Select all" or showing a count like "(25)"', {
            retries: 3,
            postClickDelayMs: 850,
            clip: { x: 0, y: 0, width: vp.width, height: Math.min(250, vp.height) },
        });
        clicked = true;
        console.log('[SELECT ALL] Strategia 4 OK: Vision AI click eseguito');
    }

    await humanDelay(page, 350, 700);

    // H06: Verifica QUANTI lead sono stati selezionati dopo clickSelectAll.
    // Virtual scroller potrebbe aver renderizzato solo 20 su 25 → alcuni lead non selezionati.
    try {
        const selectionCountText = await page.evaluate(() => {
            // SalesNav mostra "(25)" o "25 selected" dopo Select All
            const countEl = document.querySelector('[data-test-selection-count], .artdeco-pill__text, .search-results__selected-count');
            if (countEl?.textContent) return countEl.textContent.trim();
            // Fallback: cerca testo "N selected" nella toolbar
            const toolbar = document.querySelector('.search-results__action-bar, [class*="action-bar"]');
            return toolbar?.textContent?.match(/(\d+)\s*(selected|selezionat)/i)?.[1] ?? null;
        });
        if (selectionCountText) {
            const selectedCount = parseInt(selectionCountText.replace(/\D/g, ''), 10);
            if (Number.isFinite(selectedCount) && selectedCount > 0) {
                console.log(`[SELECT ALL] Lead selezionati: ${selectedCount}`);
            }
        }
    } catch (countErr) {
        // A04: count check fallito — non bloccante ma tracciato
        console.warn(`[A04] Select all count check failed: ${countErr instanceof Error ? countErr.message : String(countErr)}`);
    }

    // Verifica: il bottone "Save to list" dovrebbe apparire dopo Select All
    const saveVisible = await page.locator(SAVE_TO_LIST_SELECTOR).first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true, () => false);
    if (!saveVisible) {
        const saveBox = await findVisibleClickTarget(page, ['save to list', "salva nell'elenco"]);
        if (!saveBox) {
            console.log('[SELECT ALL] WARN: "Save to list" non visibile dopo click. Riprovo con force click...');
            const fallback = page.getByRole('checkbox', { name: /select all|seleziona tutt/i }).first();
            if ((await fallback.count()) > 0) {
                await fallback.check({ force: true });
                await humanDelay(page, 400, 700);
            }
        } else {
            console.log('[SELECT ALL] OK: "Save to list" trovato via testo');
        }
    } else {
        console.log('[SELECT ALL] OK: "Save to list" visibile');
    }
}

export async function openSaveToListDialog(page: Page, dryRun: boolean): Promise<void> {
    if (dryRun) return;

    // Attendi che il bottone "Save to list" appaia (toolbar batch actions)
    await page.locator(SAVE_TO_LIST_SELECTOR).first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => null);

    let clicked = false;
    // Tutti i testi possibili EN + IT (compresi sinonimi e varianti SalesNav)
    const saveTexts = [
        'save to list', "salva nell'elenco", 'salva nella lista',
        'salva in elenco', "aggiungi all'elenco", 'aggiungi alla lista', 'salva',
    ];

    // Strategia 1+2+3 in parallelo: testo visibile + locator CSS + getByRole
    const btnLocator = page.getByRole('button', {
        name: /save to list|salva nell.elenco|salva nella lista|salva in elenco|aggiungi all.elenco|aggiungi alla lista|^salva$/i,
    }).first();
    const [textBox, locatorBox, roleBox] = await Promise.all([
        findVisibleClickTarget(page, saveTexts),
        (async () => {
            const locator = page.locator(SAVE_TO_LIST_SELECTOR).first();
            return (await hasLocator(locator)) ? locatorBoundingBox(locator) : null;
        })(),
        (async () => {
            return (await btnLocator.count()) > 0 ? locatorBoundingBox(btnLocator) : null;
        })(),
    ]);

    if (textBox) {
        console.log(`[SAVE TO LIST] Strategia 1 OK: testo trovato a (${Math.round(textBox.x)},${Math.round(textBox.y)})`);
        await smartClick(page, textBox);
        clicked = true;
    } else if (locatorBox) {
        console.log('[SAVE TO LIST] Strategia 2 OK: locator CSS');
        await smartClick(page, locatorBox);
        clicked = true;
    } else if (roleBox) {
        console.log('[SAVE TO LIST] Strategia 3 OK: getByRole button');
        await smartClick(page, roleBox);
        clicked = true;
    } else if ((await btnLocator.count()) > 0) {
        console.log('[SAVE TO LIST] Strategia 3: button hidden, force click');
        const hiddenBox = await btnLocator.boundingBox().catch(() => null);
        if (hiddenBox) {
            await humanMouseMoveToCoords(page, hiddenBox.x + hiddenBox.width / 2, hiddenBox.y + hiddenBox.height / 2);
        }
        await btnLocator.click({ force: true });
        clicked = true;
    }

    // Strategia 4: Vision AI (chiede in entrambe le lingue)
    if (!clicked) {
        console.log('[SAVE TO LIST] Strategia 4: Vision AI...');
        await safeVisionClick(
            page,
            'button labeled "Save to list" or "Salva nell\'elenco" or "Salva nella lista" or "Aggiungi all\'elenco"',
            { retries: 3, postClickDelayMs: 900 },
        );
    }

    await humanDelay(page, 300, 600);

    // Verifica: il dialog deve aprirsi
    const dialogLocator = page.locator(DIALOG_SELECTOR).first();
    const dialogVisible = await dialogLocator.waitFor({ state: 'visible', timeout: 8_000 }).then(
        () => true,
        () => false,
    );
    if (!dialogVisible) {
        console.log('[SAVE TO LIST] Dialog non aperto via DOM — controllo Vision...');
        const ready = await visionWaitFor(page, 'the save to list dialog is open and list options are visible', 10_000);
        if (!ready) {
            throw new Error('Dialog Save to list non aperto');
        }
    } else {
        console.log('[SAVE TO LIST] OK: dialog aperto');
    }
}

/** Verifica il toast LinkedIn post-save: controlla che menzioni la lista target. */
export async function verifyToast(page: Page, targetListName: string): Promise<void> {
    await humanDelay(page, 500, 800);
    const toastText = await page.evaluate(() => {
        const toast = document.querySelector(
            '.artdeco-toast-item, [class*="toast"], [role="alert"], [class*="notification"]',
        );
        return toast ? (toast as HTMLElement).innerText.trim() : '';
    }).catch(() => '');

    if (toastText) {
        const toastLower = toastText.toLowerCase();
        const targetLower = targetListName.toLowerCase();
        if (toastLower.includes('saved') || toastLower.includes('salvat') || toastLower.includes('elenco') || toastLower.includes('list')) {
            // M02: Verificare nome COMPLETO della lista, non solo ≥2 parole.
            // Word overlap poteva confermare lista "Europa Team" con toast "Europa Marketing Team".
            const fullNameMatch = toastLower.includes(targetLower);
            const targetWords = targetLower.split(/[\s,]+/).filter(w => w.length > 2);
            const matchedWords = targetWords.filter(w => toastLower.includes(w));
            if (fullNameMatch || matchedWords.length >= Math.ceil(targetWords.length * 0.8)) {
                console.log(`[CHOOSE LIST] ✓ Toast conferma: "${toastText}"`);
            } else {
                console.error(`[CHOOSE LIST] ⚠️ TOAST MISMATCH: "${toastText}" — target era "${targetListName}"`);
                console.error(`[CHOOSE LIST] ⚠️ Parole matchate: [${matchedWords.join(', ')}] su [${targetWords.join(', ')}]`);
            }
        }
    }
}

export async function chooseTargetList(page: Page, targetListName: string, dryRun: boolean): Promise<void> {
    const dialogLocator = page.locator(DIALOG_SELECTOR).first();

    if (dryRun) {
        const clip =
            (await buildClipAroundLocator(page, dialogLocator, { top: 20, right: 20, bottom: 20, left: 20 })) ??
            undefined;
        const visible = await visionVerify(
            page,
            `the dialog contains an option labeled "${targetListName}"`,
            clip ? { clip } : undefined,
        );
        if (!visible) {
            throw new Error(`Dry run: lista target "${targetListName}" non trovata nella dialog`);
        }
        return;
    }

    const dialogContainerSelector = DIALOG_SELECTOR.split(', ')[0];
    console.log(`[CHOOSE LIST] Cerco "${targetListName}" nel dialog...${isListFoundInSession() ? ' (fast path: lista già usata)' : ''}`);

    // ── Fast path: se la lista è già stata usata in questa sessione, prova click diretto ──
    // Un umano esperto che fa bulk save ripetitivo NON riscrive il nome ogni volta.
    // La lista è in cima al dialog (recente) → click diretto.
    // Se la lista ha già la checkbox selezionata (aria-checked/aria-selected), basta confermare.
    if (isListFoundInSession()) {
        // Check se la lista è GIÀ selezionata (checkbox checked) → nessun click necessario
        const alreadySelected = await page.evaluate(({ container, name }: { container: string; name: string }) => {
            const root = document.querySelector(container) ?? document;
            const items = root.querySelectorAll('[aria-selected="true"], [aria-checked="true"], input:checked');
            for (const item of items) {
                const text = (item.closest('li, label, [role="option"]') ?? item).textContent?.toLowerCase().replace(/\s+/g, ' ').trim() ?? '';
                if (text.includes(name.toLowerCase())) return true;
            }
            return false;
        }, { container: dialogContainerSelector, name: targetListName }).catch(() => false);

        if (alreadySelected) {
            console.log('[CHOOSE LIST] Fast path: lista già selezionata — confermo');
            const confirmBox = await findVisibleClickTarget(
                page,
                ['save', 'salva', 'done', 'fatto', 'confirm', 'conferma'],
                dialogContainerSelector,
            );
            if (confirmBox) {
                await smartClick(page, confirmBox);
                await dialogLocator.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => null);
                await verifyToast(page, targetListName);
                return;
            }
        }

        const directBox = await findVisibleClickTarget(page, [targetListName], dialogContainerSelector, true, true);
        if (directBox) {
            console.log(`[CHOOSE LIST] Fast path OK: click diretto a (${Math.round(directBox.x)},${Math.round(directBox.y)})`);
            await smartClick(page, directBox);
            await humanDelay(page, 300, 600);

            // Verifica e chiudi dialog
            const fastDialogClosed = await dialogLocator.waitFor({ state: 'hidden', timeout: 6_000 }).then(
                () => true,
                () => false,
            );
            if (fastDialogClosed) {
                await verifyToast(page, targetListName);
                return;
            }
            // Dialog ancora aperta → prova conferma
            const confirmBox = await findVisibleClickTarget(
                page,
                ['save', 'salva', 'done', 'fatto', 'confirm', 'conferma'],
                dialogContainerSelector,
            );
            if (confirmBox) {
                await smartClick(page, confirmBox);
                await dialogLocator.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => null);
                await verifyToast(page, targetListName);
                return;
            }
            // Fast path non ha chiuso il dialog → fall through alle strategie normali
            console.log('[CHOOSE LIST] Fast path: dialog non chiusa, fallback a strategie standard...');
        }
    }

    // ── Strategia 0 (PRIMARIA): GPT-5.4 Computer Use ──
    // Il modello vede lo screenshot del dialog e decide autonomamente dove cliccare.
    if (config.openaiApiKey) {
        console.log('[CHOOSE LIST] Strategia 0: GPT-5.4 Computer Use...');
        const cuResult = await computerUseSelectList(page, targetListName);
        if (cuResult.success) {
            console.log(`[CHOOSE LIST] ✓ Computer Use OK: ${cuResult.turns} turns, ${cuResult.totalActions} azioni`);
            if (cuResult.lastResponseText) {
                console.log(`[CHOOSE LIST] Modello: "${cuResult.lastResponseText.substring(0, 120)}"`);
            }
            // Verifica post-CU: il dialog si è chiuso? (la lista è stata selezionata e confermata)
            const cuDialogClosed = await dialogLocator.waitFor({ state: 'hidden', timeout: 4_000 }).then(
                () => true,
                () => false,
            );
            if (cuDialogClosed) {
                console.log('[CHOOSE LIST] ✓ Dialog chiusa — Computer Use ha completato tutto');
                // Toast verification
                await verifyToast(page, targetListName);
                return;
            }
            // Dialog ancora aperta — il modello potrebbe aver selezionato ma non confermato
            // Proviamo a confermare con click su Save/Salva
            const confirmBox = await findVisibleClickTarget(
                page,
                ['save', 'salva', 'done', 'fatto', 'confirm', 'conferma'],
                dialogContainerSelector,
            );
            if (confirmBox) {
                await smartClick(page, confirmBox);
                await dialogLocator.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => null);
                console.log('[CHOOSE LIST] ✓ Computer Use + confirm button');
                await verifyToast(page, targetListName);
                return;
            }
        } else {
            console.warn(`[CHOOSE LIST] Computer Use fallito: ${cuResult.error ?? 'sconosciuto'} — fallback a DOM strategies`);
        }
    }

    // ── Helper: legge il testo dell'elemento evidenziato/selezionato nel dialog ──
    async function readSelectedListText(): Promise<string> {
        return page.evaluate((containerSel: string) => {
            const root = document.querySelector(containerSel) ?? document;
            // Look for highlighted/selected/active list items
            const selectors = [
                '[aria-selected="true"]',
                '[aria-checked="true"]',
                '.artdeco-entity-lockup--active',
                '.active',
                '.selected',
                '[class*="highlight"]',
                '[class*="selected"]',
                'li[class*="active"]',
            ];
            for (const sel of selectors) {
                const el = root.querySelector(sel);
                if (el) {
                    return (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
                }
            }
            return '';
        }, dialogContainerSelector).catch(() => '');
    }

    // ── Helper: verifica con Vision AI che la lista clickata sia quella giusta ──
    async function visionVerifySelectedList(): Promise<boolean> {
        const clip =
            (await buildClipAroundLocator(page, dialogLocator, { top: 20, right: 20, bottom: 20, left: 20 })) ??
            undefined;
        const prompt = `Look at this dialog. Is the list "${targetListName}" currently selected or highlighted? Answer only YES or NO.`;
        const result = await visionVerify(page, prompt, clip ? { clip } : undefined);
        return result;
    }

    // ── Attempt loop: up to 2 attempts ──
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
            console.warn(`[CHOOSE LIST] Tentativo ${attempt}/${MAX_ATTEMPTS}...`);
        }

        let clicked = false;

        // Strategia 1 (PRIORITARIA): digita il nome COMPLETO nel campo ricerca per filtrare
        const searchInput = dialogLocator.locator('input[type="text"], input[type="search"], input[placeholder*="Search"], input[placeholder*="Cerca"]').first();
        if ((await searchInput.count()) > 0) {
            console.log('[CHOOSE LIST] Strategia 1: filtro via campo ricerca (STRICT match)...');
            // Mouse move umano sull'input prima di digitare
            const inputBox = await searchInput.boundingBox().catch(() => null);
            if (inputBox) {
                await humanMouseMoveToCoords(page, inputBox.x + inputBox.width / 2 + (Math.random() * 6 - 3), inputBox.y + inputBox.height / 2 + (Math.random() * 4 - 2));
            }
            await searchInput.click();
            await humanDelay(page, 150, 300);
            await searchInput.fill('');
            await humanDelay(page, 100, 200);
            await searchInput.type(targetListName, { delay: 25 + Math.floor(Math.random() * 20) });
            await humanDelay(page, 800, 1_200);

            // Strict match: exact or starts-with only
            let box = await findVisibleClickTarget(page, [targetListName], dialogContainerSelector, true, true);
            if (box) {
                console.log(`[CHOOSE LIST] Strategia 1 STRICT OK a (${Math.round(box.x)},${Math.round(box.y)})`);
                await smartClick(page, box);
                clicked = true;
            } else {
                // Fallback: partial name search but still strict match
                console.log('[CHOOSE LIST] Strategia 1: strict fallita, provo ricerca parziale...');
                // Mouse move umano sull'input per il retry parziale
                const retryBox = await searchInput.boundingBox().catch(() => null);
                if (retryBox) {
                    await humanMouseMoveToCoords(page, retryBox.x + retryBox.width / 2 + (Math.random() * 6 - 3), retryBox.y + retryBox.height / 2 + (Math.random() * 4 - 2));
                }
                await searchInput.click();
                await humanDelay(page, 100, 200);
                await searchInput.fill('');
                await humanDelay(page, 100, 200);
                const partialName = targetListName.substring(0, Math.min(25, targetListName.length));
                await searchInput.type(partialName, { delay: 30 + Math.floor(Math.random() * 20) });
                await humanDelay(page, 800, 1_200);
                box = await findVisibleClickTarget(page, [targetListName], dialogContainerSelector, true, true);
                if (box) {
                    console.log(`[CHOOSE LIST] Strategia 1b STRICT OK a (${Math.round(box.x)},${Math.round(box.y)})`);
                    await smartClick(page, box);
                    clicked = true;
                }
            }
        }

        // Strategia 2: Cerca con strict match diretto (senza campo ricerca)
        if (!clicked) {
            const box = await findVisibleClickTarget(page, [targetListName], dialogContainerSelector, true, true);
            if (box) {
                console.log(`[CHOOSE LIST] Strategia 2 STRICT OK a (${Math.round(box.x)},${Math.round(box.y)})`);
                await smartClick(page, box);
                clicked = true;
            }
        }

        // Strategia 3: Scrolla dentro il dialog con strict match
        if (!clicked) {
            await page.evaluate((selector: string) => {
                const dialog = document.querySelector(selector);
                if (!dialog) return;
                const scrollable = dialog.querySelector('.artdeco-modal__content, [style*="overflow"], [class*="scroll"]') ?? dialog;
                (scrollable as HTMLElement).scrollTop = 0;
            }, dialogContainerSelector);
            await humanDelay(page, 150, 300);

            for (let scroll = 0; scroll < 15 && !clicked; scroll++) {
                const box = await findVisibleClickTarget(page, [targetListName], dialogContainerSelector, true, true);
                if (box) {
                    console.log(`[CHOOSE LIST] Strategia 3 STRICT OK (scroll ${scroll}) a (${Math.round(box.x)},${Math.round(box.y)})`);
                    await smartClick(page, box);
                    clicked = true;
                    break;
                }
                await page.evaluate((selector: string) => {
                    const dialog = document.querySelector(selector);
                    if (!dialog) return;
                    const scrollable = dialog.querySelector('.artdeco-modal__content, [style*="overflow"], [class*="scroll"]') ?? dialog;
                    (scrollable as HTMLElement).scrollTop += 250;
                }, dialogContainerSelector);
                await humanDelay(page, 150, 250);
            }
        }

        // Strategia 4: Vision AI — click mirato con nome esatto
        if (!clicked) {
            console.log('[CHOOSE LIST] Strategia 4: Vision AI click...');
            const clip =
                (await buildClipAroundLocator(page, dialogLocator, { top: 20, right: 20, bottom: 20, left: 20 })) ??
                undefined;
            await safeVisionClick(
                page,
                `click EXACTLY on the list named "${targetListName}" inside the save dialog. Do NOT click any other list.`,
                {
                    clip,
                    locator: (await hasLocator(dialogLocator)) ? dialogLocator : undefined,
                    retries: 2,
                    postClickDelayMs: 1_100,
                },
            );
        }

        await humanDelay(page, 300, 600);

        // ── POST-CLICK VERIFICATION ──
        // Step 1: Read DOM to see what was selected
        const selectedText = await readSelectedListText();
        if (selectedText) {
            const selLower = selectedText.toLowerCase().replace(/\s+/g, ' ').trim();
            const tgtLower = targetListName.toLowerCase().replace(/\s+/g, ' ').trim();
            if (selLower.includes(tgtLower) || tgtLower.includes(selLower.substring(0, 20))) {
                console.log(`[CHOOSE LIST] ✓ Verifica DOM OK: selezionato "${selectedText}"`);
            } else {
                console.error(`[CHOOSE LIST] ✗ Verifica DOM FALLITA: selezionato "${selectedText}" ma target era "${targetListName}"`);
                if (attempt < MAX_ATTEMPTS) {
                    console.warn('[CHOOSE LIST] ABORT — chiudo dialog e riprovo...');
                    await page.keyboard.press('Escape');
                    await humanDelay(page, 500, 800);
                    // Re-open the dialog
                    const saveBtn = page.locator(SAVE_TO_LIST_SELECTOR).first();
                    if (await hasLocator(saveBtn)) {
                        const box = await locatorBoundingBox(saveBtn);
                        if (box) await smartClick(page, box);
                        await dialogLocator.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => { });
                        await humanDelay(page, 300, 500);
                    }
                    continue; // Retry
                }
            }
        }

        // Step 2: Vision AI verification (only if DOM check was inconclusive)
        if (!selectedText) {
            const visionOk = await visionVerifySelectedList();
            if (!visionOk) {
                console.error(`[CHOOSE LIST] ✗ Vision AI: lista "${targetListName}" NON sembra selezionata`);
                if (attempt < MAX_ATTEMPTS) {
                    console.warn('[CHOOSE LIST] ABORT — chiudo dialog e riprovo...');
                    await page.keyboard.press('Escape');
                    await humanDelay(page, 500, 800);
                    const saveBtn = page.locator(SAVE_TO_LIST_SELECTOR).first();
                    if (await hasLocator(saveBtn)) {
                        const box = await locatorBoundingBox(saveBtn);
                        if (box) await smartClick(page, box);
                        await dialogLocator.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => { });
                        await humanDelay(page, 300, 500);
                    }
                    continue; // Retry
                }
                console.error('[CHOOSE LIST] ⚠️ ATTENZIONE: proseguo ma la lista potrebbe essere SBAGLIATA');
            } else {
                console.log(`[CHOOSE LIST] ✓ Vision AI conferma lista "${targetListName}" selezionata`);
            }
        }

        // ── CONFIRM: chiudi il dialog ──
        const dialogClosed = await dialogLocator.waitFor({ state: 'hidden', timeout: 6_000 }).then(
            () => true,
            () => false,
        );
        if (!dialogClosed) {
            const confirmBox = await findVisibleClickTarget(
                page,
                ['save', 'salva', 'done', 'fatto', 'confirm', 'conferma'],
                dialogContainerSelector,
            );
            if (confirmBox) {
                await smartClick(page, confirmBox);
                await dialogLocator.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => null);
            } else {
                await page.keyboard.press('Escape');
                await humanDelay(page, 300, 500);
                const stillOpen = await dialogLocator.isVisible().catch(() => false);
                if (stillOpen) {
                    const ready = await visionWaitFor(
                        page,
                        'the save to list dialog is closed and the search results page is visible again',
                        8_000,
                    );
                    if (!ready) {
                        throw new Error(`Dialog Save to list non chiusa dopo la selezione di "${targetListName}"`);
                    }
                }
            }
        }

        // ── TOAST VERIFICATION ──
        await verifyToast(page, targetListName);

        // Segna la lista come usata — dalla prossima pagina usa fast path (click diretto)
        setListFoundInSession(true);

        // Success — exit the attempt loop
        break;
    }
}




