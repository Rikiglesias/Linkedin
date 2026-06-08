/**
 * scripts/mouseDemo.ts
 * ─────────────────────────────────────────────────────────────────
 * DEMO SICURA del motore mouse human-like del bot, su PAGINA LOCALE.
 * Mostra il movimento mouse reale (MouseGenerator: Bézier + micro-tremor + Fitts)
 * verso una serie di "workflow" e li clicca in ordine, a velocità umana.
 *
 * SICUREZZA: zero LinkedIn, zero proxy, zero input-block (non chiama blockUserInput).
 * Usa il VERO codice del bot (`humanMouseMoveToCoords`), non una riproduzione.
 *
 * Avvio:  npm run mouse:demo   (oppure: npx ts-node src/scripts/mouseDemo.ts)
 * Engine: chromium headed (page.mouse.move dispatcha eventi reali → il dot li segue).
 */

// Forza chromium PRIMA di importare i moduli del bot (config legge le env al load).
process.env.BROWSER_ENGINE = 'chromium';

import { chromium, type Page } from 'playwright';
import { initializeMouseState, humanMouseMoveToCoords } from '../browser/humanBehavior';

const VIEWPORT = { width: 1280, height: 800 };

// Posizioni sparse: il mouse deve attraversare la pagina (non in linea).
const BUTTON_POSITIONS: ReadonlyArray<{ x: number; y: number; label: string }> = [
    { x: 140, y: 150, label: 'sync-search' },
    { x: 960, y: 200, label: 'send-invites' },
    { x: 430, y: 470, label: 'send-messages' },
    { x: 1080, y: 560, label: 'sync-list' },
    { x: 200, y: 640, label: 'follow-up' },
    { x: 690, y: 320, label: 'enrichment' },
];

function buildHtml(): string {
    const buttons = BUTTON_POSITIONS.map(
        (b, i) =>
            `<button class="btn" id="b${i}" style="left:${b.x}px;top:${b.y}px">${i + 1}. ${b.label}</button>`,
    ).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Mouse human-like demo</title>
<style>
 *{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;height:100vh;overflow:hidden}
 .btn{position:absolute;padding:14px 22px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:15px;cursor:pointer;transition:transform .12s ease,background .12s ease}
 .btn.hit{background:#10b981;color:#04241a;border-color:#10b981;transform:scale(1.07)}
 #dot{position:fixed;width:16px;height:16px;border-radius:50%;background:rgba(16,185,129,.95);border:2px solid #fff;box-shadow:0 0 0 5px rgba(16,185,129,.22),0 4px 16px rgba(0,0,0,.35);transform:translate(-50%,-50%);pointer-events:none;z-index:99999;left:-80px;top:-80px;transition:left 18ms linear,top 18ms linear}
 #hud{position:fixed;top:14px;left:14px;font-size:14px;background:#1e293b;border:1px solid #334155;padding:9px 13px;border-radius:9px}
 #hud b{color:#10b981}
</style></head><body>
 <div id="hud">Click: <b id="c">0</b> / ${BUTTON_POSITIONS.length} &nbsp;·&nbsp; motore reale del bot (Bézier + micro-tremor + Fitts)</div>
 <div id="dot"></div>
 ${buttons}
 <script>
  var dot=document.getElementById('dot');
  addEventListener('mousemove',function(e){dot.style.left=e.clientX+'px';dot.style.top=e.clientY+'px';});
  document.querySelectorAll('.btn').forEach(function(b){
    b.addEventListener('click',function(){
      b.classList.add('hit');
      var c=document.getElementById('c'); c.textContent=String(parseInt(c.textContent,10)+1);
    });
  });
 </script></body></html>`;
}

async function humanPause(page: Page, min: number, max: number): Promise<void> {
    await page.waitForTimeout(min + Math.floor(Math.random() * (max - min)));
}

async function main(): Promise<void> {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.setContent(buildHtml(), { waitUntil: 'domcontentloaded' });

    initializeMouseState(page);
    await humanPause(page, 800, 1400); // l'utente "guarda" la pagina prima di agire

    for (let i = 0; i < BUTTON_POSITIONS.length; i++) {
        const locator = page.locator(`#b${i}`);
        const box = await locator.boundingBox();
        if (!box) {
            console.warn(`[mouseDemo] bottone #b${i} senza boundingBox, salto`);
            continue;
        }
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // MOTORE REALE: traiettoria curva umana + tempi per-punto reali del bot.
        await humanMouseMoveToCoords(page, cx, cy);
        // click reale: il bottone reagisce (prova che il movimento è arrivato a destinazione)
        await page.mouse.click(cx, cy, { delay: 40 + Math.floor(Math.random() * 70) });
        console.log(`[mouseDemo] ${i + 1}/${BUTTON_POSITIONS.length} → ${BUTTON_POSITIONS[i].label}`);

        await humanPause(page, 600, 1300); // pausa umana tra un'azione e l'altra
    }

    console.log('[mouseDemo] Completato. Finestra aperta 5s per osservare.');
    await page.waitForTimeout(5000);
    await browser.close();
}

main().catch((err) => {
    console.error('[mouseDemo] Errore:', err);
    process.exit(1);
});
