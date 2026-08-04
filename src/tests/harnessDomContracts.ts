/**
 * harnessDomContracts.ts — verifica su BROWSER VERO le assunzioni che il codice fa sul DOM.
 *
 * Perché esiste (audit 2026-08-04): i test unitari mockano i locator Playwright, e un mock è
 * sempre più permissivo del browser reale. Il bug dei messaggi mai inviati è sopravvissuto
 * proprio così — `.inputValue()` su un `div[contenteditable]` viene RIFIUTATO da Playwright,
 * ma nel mock quel metodo restituiva tranquillamente una stringa. Test verdi, zero messaggi.
 *
 * Qui non si mocka niente: si costruisce il DOM come LinkedIn lo espone e si chiede al browser
 * cosa succede davvero. Nessuna richiesta di rete, nessun contatto con LinkedIn.
 *
 * Uso:  npx ts-node src/tests/harnessDomContracts.ts
 * Exit: 0 = tutti i contratti rispettati, 1 = almeno uno rotto (stampa quale).
 */

import { chromium, type Page } from 'playwright';
import { SELECTORS } from '../selectors';

/** DOM della casella messaggi come LinkedIn la espone: un div contenteditable, non un input. */
const MESSAGE_BOX_HTML = `<!doctype html><meta charset="utf-8">
<div class="msg-form__msg-content-container">
  <div class="msg-form__contenteditable" role="textbox" contenteditable="true"
       data-placeholder="Scrivi un messaggio…">TESTO_DIGITATO</div>
</div>`;

type Contract = { name: string; got: unknown; expected: string; ok: boolean };

const joinSelectors = (list: readonly string[]): string => list.join(', ');

/**
 * Il contratto che conta: il codice deve poter RILEGGERE ciò che ha digitato.
 * Se torna stringa vuota, la verifica di `messageWorker` fallisce e il messaggio non parte.
 */
async function contractReadsBackTypedText(page: Page): Promise<Contract[]> {
    const typed = 'Ciao Mario, ho visto il tuo profilo';
    await page.setContent(MESSAGE_BOX_HTML.replace('TESTO_DIGITATO', typed));
    const box = page.locator(joinSelectors(SELECTORS.messageTextbox)).first();

    const viaInnerText = await box.innerText({ timeout: 2000 }).catch(() => '');

    // Controprova esplicita: inputValue è il metodo SBAGLIATO per questo nodo.
    let inputValueRejected = false;
    try {
        await box.inputValue({ timeout: 2000 });
    } catch {
        inputValueRejected = true;
    }

    return [
        {
            name: 'la casella messaggi si rilegge con innerText',
            got: `"${viaInnerText}"`,
            expected: `"${typed}"`,
            ok: viaInnerText.trim() === typed,
        },
        {
            name: 'inputValue viene RIFIUTATO su questo nodo (percio non va usato)',
            got: inputValueRejected ? 'rifiutato' : 'accettato',
            expected: 'rifiutato — se un giorno fosse accettato, questo file va rivisto',
            ok: inputValueRejected,
        },
        {
            name: 'il placeholder NON viene scambiato per testo digitato',
            got: `"${viaInnerText}"`,
            expected: 'senza "Scrivi un messaggio…"',
            ok: !viaInnerText.includes('Scrivi un messaggio'),
        },
    ];
}

/** Casella vuota: la rilettura deve dare vuoto, altrimenti il bot crede di aver scritto. */
async function contractEmptyBoxReadsEmpty(page: Page): Promise<Contract> {
    await page.setContent(MESSAGE_BOX_HTML.replace('TESTO_DIGITATO', ''));
    const box = page.locator(joinSelectors(SELECTORS.messageTextbox)).first();
    const value = await box.innerText({ timeout: 2000 }).catch(() => 'ERRORE');
    return {
        name: 'casella vuota → rilettura vuota',
        got: `"${value}"`,
        expected: '"" (stringa vuota, non un errore)',
        ok: value.trim() === '',
    };
}

async function main(): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const contracts: Contract[] = [];
        contracts.push(...(await contractReadsBackTypedText(page)));
        contracts.push(await contractEmptyBoxReadsEmpty(page));

        console.log('\n=== CONTRATTI DOM — verificati su browser vero, senza mock ===\n');
        let broken = 0;
        for (const c of contracts) {
            if (!c.ok) broken++;
            console.log(`[${c.ok ? 'OK  ' : 'ROTTO'}] ${c.name}`);
            console.log(`       atteso  : ${c.expected}`);
            console.log(`       misurato: ${c.got}\n`);
        }
        console.log(broken === 0 ? 'Tutti i contratti rispettati.' : `${broken} contratti ROTTI.`);
        process.exitCode = broken === 0 ? 0 : 1;
    } finally {
        await browser.close();
    }
}

void main();
