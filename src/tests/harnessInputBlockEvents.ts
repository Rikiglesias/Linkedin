/**
 * harnessInputBlockEvents.ts — baseline che MISURA gli eventi reali (Fase 1 del piano audit-codebase).
 *
 * Perché esiste: l'overlay di `inputBlock` blocca gli eventi utente registrando handler
 * `passive:false` in capture sul document. Gli eventi del BOT (CDP) sono indistinguibili
 * da quelli dell'utente per quegli handler, quindi rischiano di essere cancellati insieme.
 * Nessun test unitario può accorgersene: serve un browser vero e un evento vero.
 *
 * Misura, su una pagina locale (nessuna richiesta a LinkedIn):
 *   1. scroll del bot via `page.mouse.wheel` con overlay attivo → la pagina scrolla davvero?
 *   2. mousemove del bot con overlay attivo → la pagina lo riceve?
 *   3. firme lasciate nel DOM dall'overlay (attributi `data-*`, testo leggibile)
 *
 * Uso:  npx ts-node src/tests/harnessInputBlockEvents.ts
 * Exit: 0 = tutte le misure attese, 1 = almeno una misura fuori attesa (stampa quale).
 */

import { chromium, type Page } from 'playwright';
import { ensureInputBlock, pauseInputBlockForMove, resumeInputBlockForMove } from '../browser/human/inputBlock';
import { simulateHumanReading } from '../browser/human/readingSimulation';

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>harness</title></head>
<body style="margin:0">
<div style="height:5000px;background:linear-gradient(#fff,#333)"></div>
<script>
  window.__events = { wheel: 0, mousemove: 0 };
  // Massimo scrollY raggiunto: simulateHumanReading ha un ramo (30%) che torna in cima,
  // quindi lo scrollY FINALE è una misura instabile. Qui interessa "la pagina si e' mossa".
  window.__maxScrollY = 0;
  document.addEventListener('scroll', () => {
    if (window.scrollY > window.__maxScrollY) window.__maxScrollY = window.scrollY;
  }, true);
  document.addEventListener('wheel', () => { window.__events.wheel++; }, true);
  document.addEventListener('mousemove', () => { window.__events.mousemove++; }, true);
</script>
</body></html>`;

type Measure = { name: string; got: unknown; expected: string; ok: boolean };

/** Lo scroll del BOT passa da simulateHumanReading → wheelWithMomentum: deve muovere la pagina. */
async function measureBotScroll(page: Page): Promise<Measure> {
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        (window as unknown as { __maxScrollY: number }).__maxScrollY = 0;
    });
    await page.mouse.move(400, 300);
    await simulateHumanReading(page);
    const maxScrollY = await page.evaluate(() =>
        Math.round((window as unknown as { __maxScrollY: number }).__maxScrollY),
    );
    return {
        name: 'scroll del BOT (simulateHumanReading) con overlay attivo',
        got: maxScrollY,
        expected: '> 0 (la pagina deve scrollare davvero — misura il MAX raggiunto, non il finale)',
        ok: maxScrollY > 0,
    };
}

/**
 * Lo scroll dell'UTENTE fisico (wheel grezzo, nessun flag) deve restare bloccato:
 * è la ragione d'essere dell'overlay. Controprova che il fix non ha aperto un buco.
 */
async function measureUserScrollStillBlocked(page: Page): Promise<Measure> {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(400);
    const scrollY = await page.evaluate(() => Math.round(window.scrollY));
    return {
        name: 'scroll dell UTENTE fisico resta bloccato (non-regressione)',
        got: scrollY,
        expected: '0 (l overlay deve continuare a bloccare l utente)',
        ok: scrollY === 0,
    };
}

async function measureMouseMove(page: Page): Promise<Measure> {
    await page.evaluate(() => {
        (window as unknown as { __events: { mousemove: number } }).__events.mousemove = 0;
    });
    await pauseInputBlockForMove(page);
    await page.mouse.move(100, 100);
    await page.mouse.move(500, 400);
    await resumeInputBlockForMove(page);
    await page.waitForTimeout(200);
    const seen = await page.evaluate(
        () => (window as unknown as { __events: { mousemove: number } }).__events.mousemove,
    );
    return {
        name: 'mousemove del bot durante pauseInputBlockForMove',
        got: seen,
        expected: '> 0 (LinkedIn deve vedere il movimento del bot)',
        ok: seen > 0,
    };
}

async function measureDomSignatures(page: Page): Promise<Measure[]> {
    // Le firme vanno lette QUANDO sono attive: `resumeInputBlockForMove` cancella l'attributo,
    // quindi misurarle dopo il movimento darebbe un falso "pulito" (errore della prima versione).
    await pauseInputBlockForMove(page);
    const signatures = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        const dataBot = (html.match(/data-bot[\w-]*/g) ?? []) as string[];
        // Testo leggibile iniettato dagli overlay del bot (non presente nella pagina originale)
        const readable = [...document.querySelectorAll('body > div, html > div')]
            .map((el) => (el.textContent ?? '').trim())
            .filter((t) => t.length > 0);
        return { dataBot, readable };
    });
    return [
        {
            name: 'attributi data-bot* nel DOM',
            got: signatures.dataBot,
            expected: '[] (nessun attributo che identifichi il bot)',
            ok: signatures.dataBot.length === 0,
        },
        {
            name: 'testo leggibile iniettato dagli overlay',
            got: signatures.readable,
            expected: '[] (nessun testo del bot nel DOM della pagina)',
            ok: signatures.readable.length === 0,
        },
    ];
}

async function main(): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await page.setContent(PAGE_HTML);
        await ensureInputBlock(page);

        const measures: Measure[] = [];
        measures.push(await measureBotScroll(page));
        measures.push(await measureUserScrollStillBlocked(page));
        // Le firme si leggono col botClicking attivo, cioè nel momento peggiore.
        measures.push(await measureMouseMove(page));
        measures.push(...(await measureDomSignatures(page)));

        console.log('\n=== HARNESS inputBlock — eventi reali con overlay attivo ===\n');
        let failed = 0;
        for (const m of measures) {
            const flag = m.ok ? 'OK  ' : 'FAIL';
            if (!m.ok) failed++;
            console.log(`[${flag}] ${m.name}`);
            console.log(`       atteso : ${m.expected}`);
            console.log(`       misurato: ${JSON.stringify(m.got)}\n`);
        }
        console.log(failed === 0 ? 'Tutte le misure nell atteso.' : `${failed} misure fuori atteso.`);
        process.exitCode = failed === 0 ? 0 : 1;
    } finally {
        await browser.close();
    }
}

void main();
