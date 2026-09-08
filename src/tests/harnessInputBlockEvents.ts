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
 *   4. (C29) il gesto di click possiede l'input per TUTTA la sua durata: su N gesti reali il click
 *      arriva sempre al bottone e mai all'overlay, esattamente uno per gesto;
 *   5. (C29) il watchdog resta una rete vera: dopo una pausa senza ripresa (processo morto a meta'
 *      gesto) l'overlay si ripristina da solo entro 1 s.
 *
 * Uso:  npm run harness:input-block   (= npx ts-node src/tests/harnessInputBlockEvents.ts)
 *       C29_GESTI=50 per abbassare N durante lo sviluppo (default 200, quello del criterio).
 * Exit: 0 = tutte le misure attese, 1 = almeno una fuori attesa (stampa quale), 2 = sonda rotta (vedi harnessRuntime).
 */

// Il runtime va importato per PRIMO: isola env/sessionDir/DB prima che `src/config` venga caricato (C28).
import { runHarness } from './harnessRuntime';
import type { Page } from 'playwright';
import {
    ensureInputBlock,
    pauseInputBlock,
    pauseInputBlockForMove,
    resumeInputBlockForMove,
    resumeInputBlock,
    INPUT_BLOCK_HOLD_MAX_MS,
} from '../browser/human/inputBlock';
import { INPUT_BLOCK_OVERLAY_ID } from '../browser/human/overlayIds';
import { clickCoordinatesHumanLike } from '../browser/humanClick';
import { simulateHumanReading } from '../browser/human/readingSimulation';

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>harness</title></head>
<body style="margin:0">
<button id="bersaglio" style="position:fixed;top:40px;left:40px;width:160px;height:36px;z-index:1">Connetti</button>
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
  // Dove ATTERRA il click: sul bottone (gesto riuscito) o sull'overlay del bot (intercettato).
  // Il listener e' registrato PRIMA di quelli dell'overlay: sullo stesso nodo lo stopPropagation
  // dell'overlay non lo salta (solo stopImmediatePropagation lo farebbe), quindi la sonda vede
  // anche i click che l'overlay cancella.
  window.__click = { bersaglio: 0, overlay: 0, altro: 0 };
  document.addEventListener('click', (e) => {
    const el = e.target;
    const id = el && el.id ? el.id : '';
    if (id === 'bersaglio') window.__click.bersaglio++;
    else if (el && el.tagName === 'DIV' && id) window.__click.overlay++;
    else window.__click.altro++;
  }, true);
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

/** Numero di gesti reali misurati. Il criterio C29 ne chiede almeno 200. */
const N_GESTI = Math.max(1, Number(process.env.C29_GESTI ?? 200));

type ContoClick = { bersaglio: number; overlay: number; altro: number };

async function azzeraConteggio(page: Page): Promise<void> {
    await page.evaluate(() => {
        (window as unknown as { __click: ContoClick }).__click = { bersaglio: 0, overlay: 0, altro: 0 };
    });
}

async function leggiConteggio(page: Page): Promise<ContoClick> {
    return page.evaluate(() => (window as unknown as { __click: ContoClick }).__click);
}

async function statoOverlay(page: Page): Promise<{ pointerEvents: string; botClicking: boolean }> {
    return page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return { pointerEvents: 'assente', botClicking: false };
        const rec = el as unknown as Record<string, unknown>;
        return { pointerEvents: el.style.pointerEvents || 'auto', botClicking: rec.__botClicking === true };
    }, INPUT_BLOCK_OVERLAY_ID);
}

/**
 * Controllo positivo della sonda: con l'overlay OPACO un click grezzo DEVE risultare intercettato.
 * Senza questa misura un `intercettati=0` non distingue «il fix funziona» da «la sonda non vede».
 */
async function measureSondaVedeIntercettazione(page: Page, x: number, y: number): Promise<Measure> {
    await resumeInputBlock(page);
    await azzeraConteggio(page);
    await page.mouse.click(x, y);
    await page.waitForTimeout(120);
    const conto = await leggiConteggio(page);
    return {
        name: 'controllo positivo della sonda: click grezzo con overlay OPACO',
        got: conto,
        expected: 'overlay >= 1 e bersaglio === 0 (se no, la sonda non misura nulla)',
        ok: conto.overlay >= 1 && conto.bersaglio === 0,
    };
}

/** C29: su N gesti reali il click arriva sempre al bersaglio, mai all'overlay, uno per gesto. */
async function measureGestoPossiedeInput(page: Page, x: number, y: number): Promise<Measure[]> {
    await azzeraConteggio(page);
    const inizio = Date.now();
    for (let i = 0; i < N_GESTI; i++) {
        await clickCoordinatesHumanLike(page, x + (Math.random() * 8 - 4), y + (Math.random() * 4 - 2));
    }
    const durataMs = Date.now() - inizio;
    await page.waitForTimeout(150);
    const conto = await leggiConteggio(page);
    return [
        {
            name: `click INTERCETTATI dall overlay su ${N_GESTI} gesti reali (${Math.round(durataMs / 1000)}s)`,
            got: conto.overlay,
            expected: '0 (con il watchdog a 150 ms fissi l overlay tornava opaco a meta gesto)',
            ok: conto.overlay === 0,
        },
        {
            name: 'click arrivati al bersaglio: esattamente uno per gesto',
            got: conto,
            expected: `bersaglio === ${N_GESTI}`,
            ok: conto.bersaglio === N_GESTI,
        },
        {
            // Il segnale piu' forte del difetto: se il watchdog scatta FRA mousedown e mouseup i due
            // eventi hanno target diversi e il browser non sintetizza nessun `click` — il gesto
            // sparisce in silenzio, non viene nemmeno intercettato. Misurato con 150 ms fissi:
            // su 60 gesti, 14 al bersaglio, 14 all'overlay, il resto svanito.
            name: 'gesti che non hanno prodotto NESSUN evento di click',
            got: N_GESTI - (conto.bersaglio + conto.overlay + conto.altro),
            expected: '0 (un gesto che non produce click e un invito che non parte, in silenzio)',
            ok: conto.bersaglio + conto.overlay + conto.altro === N_GESTI,
        },
    ];
}

/**
 * C29: il watchdog NON viene rimosso, resta la rete. Simula il processo che muore fra la pausa e la
 * ripresa (pausa senza resume) e verifica che l'overlay si ripristini da solo entro 1 s.
 */
async function measureWatchdogRipristina(page: Page): Promise<Measure[]> {
    await resumeInputBlock(page);
    await pauseInputBlock(page, INPUT_BLOCK_HOLD_MAX_MS);
    const durante = await statoOverlay(page);
    const inizio = Date.now();
    // Nessuna `resumeInputBlock`: e' il caso «il bot non torna piu'».
    await page.waitForTimeout(INPUT_BLOCK_HOLD_MAX_MS + 150);
    const dopo = await statoOverlay(page);
    const trascorsoMs = Date.now() - inizio;
    return [
        {
            name: 'durante la pausa l overlay e trasparente e marcato',
            got: durante,
            expected: "pointerEvents 'none' e botClicking true",
            ok: durante.pointerEvents === 'none' && durante.botClicking,
        },
        {
            name: `senza ripresa il watchdog ripristina da solo (atteso entro ${INPUT_BLOCK_HOLD_MAX_MS} ms, misurato dopo ${trascorsoMs} ms)`,
            got: dopo,
            expected: "pointerEvents 'auto' e botClicking assente",
            ok: dopo.pointerEvents === 'auto' && !dopo.botClicking,
        },
        {
            name: 'la finestra massima del watchdog resta sotto il secondo',
            got: INPUT_BLOCK_HOLD_MAX_MS,
            expected: '<= 1000 ms',
            ok: INPUT_BLOCK_HOLD_MAX_MS <= 1000,
        },
    ];
}

async function main(): Promise<void> {
    await runHarness('input-block', 'chromium', async (run) => {
        const { page } = run;
        await page.goto(run.serve(PAGE_HTML));
        await ensureInputBlock(page);

        const measures: Measure[] = [];
        measures.push(await measureBotScroll(page));
        measures.push(await measureUserScrollStillBlocked(page));
        // Le firme si leggono col botClicking attivo, cioè nel momento peggiore.
        measures.push(await measureMouseMove(page));

        // C29 — il gesto di click possiede l'input per tutta la sua durata.
        const box = await page.locator('#bersaglio').boundingBox();
        if (!box) {
            measures.push({
                name: 'bersaglio del click presente nella pagina di prova',
                got: null,
                expected: 'boundingBox del bottone #bersaglio',
                ok: false,
            });
        } else {
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            measures.push(await measureSondaVedeIntercettazione(page, cx, cy));
            measures.push(...(await measureGestoPossiedeInput(page, cx, cy)));
            measures.push(...(await measureWatchdogRipristina(page)));
        }

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
        return failed;
    });
}

void main();
