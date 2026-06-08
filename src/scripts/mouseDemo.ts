/**
 * scripts/mouseDemo.ts
 * ─────────────────────────────────────────────────────────────────
 * DEMO SICURA del comportamento human-like del bot, su PAGINA LOCALE.
 * Mostra i 4 motori reali appena tarati (commit 94fcd96):
 *   - MOUSE: humanMouseMoveToCoords (Bézier + durata ∝ Fitts + jitter log-normale)
 *   - SCROLL: simulateHumanReading (wheelWithMomentum: raffica di tick, niente teletrasporto)
 *   - TYPING: humanType (floor 40/80ms, ~87 WPM, typo+correzioni)
 *   - CLICK: atterraggio gaussiano (via humanMouseMoveToCoords + mouse.click)
 *
 * SICUREZZA: zero LinkedIn, zero proxy, zero input-block. Usa il VERO codice del bot.
 * Avvio:  npm run mouse:demo
 */

process.env.BROWSER_ENGINE = 'chromium';

import { chromium, type Page } from 'playwright';
import {
    initializeMouseState,
    humanMouseMoveToCoords,
    simulateHumanReading,
    humanType,
} from '../browser/humanBehavior';

const VIEWPORT = { width: 1280, height: 800 };

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
    // Contenuto alto e scrollabile (per la demo scroll) + textarea (per la demo typing).
    const filler = Array.from({ length: 24 })
        .map(
            (_, i) =>
                `<p>Riga di contenuto ${i + 1} — un profilo LinkedIn da leggere scrollando in modo naturale, con momentum e pause di lettura variabili.</p>`,
        )
        .join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Behavior demo</title>
<style>
 *{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0}
 .stage{position:relative;height:800px;border-bottom:2px solid #334155}
 .btn{position:absolute;padding:14px 22px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:15px;cursor:pointer;transition:transform .12s ease,background .12s ease}
 .btn.hit{background:#10b981;color:#04241a;border-color:#10b981;transform:scale(1.07)}
 #dot{position:fixed;width:16px;height:16px;border-radius:50%;background:rgba(16,185,129,.95);border:2px solid #fff;box-shadow:0 0 0 5px rgba(16,185,129,.22),0 4px 16px rgba(0,0,0,.35);transform:translate(-50%,-50%);pointer-events:none;z-index:99999;left:-80px;top:-80px;transition:left 18ms linear,top 18ms linear}
 #hud{position:fixed;top:14px;left:14px;font-size:14px;background:#1e293b;border:1px solid #334155;padding:9px 13px;border-radius:9px;z-index:99999}
 #hud b{color:#10b981}
 .content{padding:24px;max-width:760px;margin:0 auto}
 textarea{width:100%;height:120px;margin-top:18px;background:#0b1220;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:12px;font-size:15px}
</style></head><body>
 <div id="hud">Click: <b id="c">0</b> / ${BUTTON_POSITIONS.length} &nbsp;·&nbsp; mouse(Fitts+log-normal) · scroll(momentum) · typing(floor)</div>
 <div id="dot"></div>
 <div class="stage">${buttons}</div>
 <div class="content">
   ${filler}
   <label for="msg">Messaggio (digitazione human-like):</label>
   <textarea id="msg" placeholder="il bot scriverà qui..."></textarea>
 </div>
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
    await humanPause(page, 800, 1400);

    // 1) MOUSE + CLICK: muove curvo (Fitts + log-normale) e clicca con atterraggio gaussiano.
    console.log('[mouseDemo] --- MOUSE + CLICK ---');
    for (let i = 0; i < BUTTON_POSITIONS.length; i++) {
        const box = await page.locator(`#b${i}`).boundingBox();
        if (!box) continue;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await humanMouseMoveToCoords(page, cx, cy);
        await page.mouse.click(cx, cy, { delay: 40 + Math.floor(Math.random() * 70) });
        console.log(`[mouseDemo] click ${i + 1}/${BUTTON_POSITIONS.length} → ${BUTTON_POSITIONS[i].label}`);
        await humanPause(page, 500, 1100);
    }

    // 2) SCROLL: raffica di tick con momentum + pause di lettura (no teletrasporto).
    console.log('[mouseDemo] --- SCROLL (momentum) ---');
    await simulateHumanReading(page);

    // 3) TYPING: digitazione con floor fisico (≥40ms/char), ~87 WPM, typo+correzioni.
    console.log('[mouseDemo] --- TYPING (floor + ~87 WPM) ---');
    const t0 = Date.now();
    const msg = 'Ciao Marco, ho visto il tuo profilo e mi piacerebbe connettermi.';
    await humanType(page, '#msg', msg);
    const secs = (Date.now() - t0) / 1000;
    const wpm = Math.round(msg.length / 5 / (secs / 60));
    console.log(`[mouseDemo] typed ${msg.length} char in ${secs.toFixed(1)}s ≈ ${wpm} WPM (lordo, incl. pause/typo)`);

    console.log('[mouseDemo] Completato. Finestra aperta 5s per osservare.');
    await page.waitForTimeout(5000);
    await browser.close();
}

main().catch((err) => {
    console.error('[mouseDemo] Errore:', err);
    process.exit(1);
});
