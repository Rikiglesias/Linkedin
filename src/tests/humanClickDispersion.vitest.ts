import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { humanPointInBox } from '../browser/humanClick';

/**
 * Il centro geometrico di un box (`x + width/2`) è lo stesso pixel a ogni passaggio sullo stesso
 * elemento: un umano non centra mai al pixel, quindi è una firma. `clickLocatorHumanLike` lo evitava
 * già; i punti che partivano da un box e chiamavano direttamente `clickCoordinatesHumanLike` no.
 */

const BOX = { x: 100, y: 200, width: 120, height: 36 };

function sorgente(relPath: string): string {
    return readFileSync(join(__dirname, '..', ...relPath.split('/')), 'utf8');
}

describe('humanPointInBox — dispersione del punto di click', () => {
    it('non restituisce il centro geometrico due volte di fila', () => {
        const punti = Array.from({ length: 200 }, () => humanPointInBox(BOX));
        const xDistinti = new Set(punti.map((p) => p.x));
        const yDistinti = new Set(punti.map((p) => p.y));

        // Il difetto da cui nasce l'item: coordinata costante al pixel.
        expect(xDistinti.size).toBeGreaterThan(50);
        expect(yDistinti.size).toBeGreaterThan(50);
    });

    it('resta SEMPRE dentro il box (clamp ±42%)', () => {
        for (let i = 0; i < 2000; i++) {
            const p = humanPointInBox(BOX);
            expect(p.x).toBeGreaterThanOrEqual(BOX.x);
            expect(p.x).toBeLessThanOrEqual(BOX.x + BOX.width);
            expect(p.y).toBeGreaterThanOrEqual(BOX.y);
            expect(p.y).toBeLessThanOrEqual(BOX.y + BOX.height);
        }
    });

    it('resta centrato in media: è dispersione, non deriva', () => {
        const n = 4000;
        const punti = Array.from({ length: n }, () => humanPointInBox(BOX));
        const mediaX = punti.reduce((s, p) => s + p.x, 0) / n;
        const centroX = BOX.x + BOX.width / 2;
        // Tolleranza larga: serve a escludere un bias sistematico, non a misurare la gaussiana.
        expect(Math.abs(mediaX - centroX)).toBeLessThan(BOX.width * 0.05);
    });

    it('su un box degenere non produce NaN né esce dal box', () => {
        const degenere = { x: 10, y: 10, width: 0, height: 0 };
        const p = humanPointInBox(degenere);
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBe(10);
        expect(p.y).toBe(10);
    });
});

describe('i call-site che partivano dal centro esatto sono stati convertiti', () => {
    it('organicContent non calcola più NESSUN centro a mano', () => {
        const src = sorgente('browser/organicContent.ts');
        // Prima l'asserzione cercava la stringa esatta `const targetX = box.x + box.width / 2` e
        // quindi NON vedeva il terzo punto, che usa `rBox`: verde per il motivo sbagliato, trovato
        // dal critico avversariale. Ora cerca la FORMA del difetto, non una sua istanza letterale.
        expect(src).not.toMatch(/\.width \/ 2/);
        expect(src).not.toMatch(/\.height \/ 2/);
        expect(src).toContain('humanPointInBox(');
    });

    it('il fallback Shadow DOM disperde prima di cliccare', () => {
        const src = sorgente('browser/uiFallback.ts');
        const ramoShadow = src.slice(src.indexOf('export async function clickWithShadowFallback'));
        expect(ramoShadow).toContain('humanPointInBox({');
        expect(ramoShadow).not.toMatch(/clickCoordinatesHumanLike\(page, coords\.x, coords\.y\)/);
    });

    it('RESIDUO DICHIARATO: i click da vision AI restano non dispersi, e non è una svista', () => {
        const src = sorgente('browser/uiFallback.ts');
        // `findObjectCoordinates` restituisce un punto, non un rect: senza larghezza e altezza non si
        // conosce il margine entro cui spostarsi, e disperdere "a occhio" rischia di mancare un target
        // piccolo — che è peggio di un click centrato. Il test blocca il numero: se questi call-site
        // cambiano, la decisione va ripresa invece di scivolare via in silenzio.
        //
        // ⚠️ Il conteggio qui è di `uiFallback` SOLTANTO, ed è per questo che il residuo scritto nel
        // commit `8e56fe7` («2 click vision») era SOTTOSTIMATO: il critico avversariale ha contato i
        // punti veri nel codebase. I due fuori da questo file sono ora coperti dai test qui sotto.
        const puntiVision = src.match(/clickCoordinatesHumanLike\(page, coords\.x, coords\.y\)/g) ?? [];
        expect(puntiVision).toHaveLength(2);
    });

    it('le coordinate FISSE del fallback vision non sono più lo stesso pixel a ogni sessione', () => {
        const src = sorgente('salesnav/visionNavigator.ts');
        // Erano letterali a listino (640,120 / 80,160): identiche su ogni account e ogni sessione,
        // cioè una firma diretta. Ora il punto passa da humanPointInBox su una finestra stretta.
        expect(src).toContain('humanPointInBox({');
        expect(src).not.toMatch(/clickCoordinatesHumanLike\(page, fx, fy\)/);
    });

    it('il fallback a coordinate fisse si SALTA se il viewport non è quello di calibrazione', () => {
        const src = sorgente('salesnav/visionNavigator.ts');
        // Il difetto peggiore non era la firma ma il click CIECO: quelle coordinate valgono per
        // 1280x800, e il layout di SalesNav è responsive — a 1920x1080 quel punto non è il bottone.
        // Il clamp ai bordi non protegge da questo: tiene il click dentro lo schermo, non sul target.
        expect(src).toContain('fallbackViewportCompatibile');
        expect(src).toContain('VISION_FALLBACK_VIEWPORT');
    });

    it('viewport IGNOTO non viene scambiato per viewport buono', () => {
        const src = sorgente('salesnav/visionNavigator.ts');
        // Trovato dalla passata avversariale sul MIO stesso fix: `viewportSize()` torna null quando il
        // context nasce con `viewport: null` (non-headless, launcher.ts:329). Con un `?? {1280x800}`
        // la guardia avrebbe risposto "compatibile" proprio quando le dimensioni sono IGNOTE — cioè
        // avrebbe autorizzato il click cieco nel caso peggiore. Non sapere ≠ sapere che va bene.
        expect(src).not.toMatch(/page\.viewportSize\(\)\s*\?\?\s*VISION_FALLBACK_VIEWPORT/);
        expect(src).toContain('!viewport || !fallbackViewportCompatibile(viewport)');
    });

    it('...ma la guardia non deve uccidere la capability che protegge', () => {
        const src = sorgente('salesnav/visionNavigator.ts');
        // Secondo giro del critico: `headless` è false di DEFAULT e in non-headless il launcher mette
        // apposta `viewport: null`, quindi `viewportSize()` è sempre null in configurazione normale.
        // Una guardia sul solo viewportSize() scatterebbe SEMPRE → fallback H07 = codice morto, cioè
        // capability persa in silenzio (zero-Q). Le dimensioni vere si chiedono al DOM prima di
        // arrendersi. Il test tiene insieme i due errori opposti: non fidarsi dell'ignoto, ma nemmeno
        // dichiararlo ignoto quando è conoscibile.
        // 2026-08-05: `dimensioniFinestra` è stata ESTRATTA in `browser/viewport.ts` (lo stesso
        // difetto vive in 17 punti su 11 file: una copia locale ne sanava uno solo). Qui resta la
        // verifica che questo file USI la misura vera; il `window.innerWidth` non si cerca più nel
        // testo di questo sorgente — starebbe controllando dove abita la funzione invece di cosa fa.
        // Il COMPORTAMENTO (viewport dichiarato → DOM → null) è coperto da `viewportReale.vitest.ts`,
        // che lo esegue invece di leggerlo: un test sulle stringhe non distingue una guardia che non
        // scatta mai da una che scatta sempre (10º principio anti-ban).
        expect(src).toContain("from '../browser/viewport'");
        expect(src).toMatch(/const viewport = await dimensioniFinestra\(page\)/);
    });

    it('il click sul captcha non cade sul pixel esatto restituito dal provider', () => {
        const src = sorgente('workers/challengeHandler.ts');
        // Qui le coordinate NON sono fisse (variano con l'immagine), ma per lo stesso captcha il
        // provider tende a restituire lo stesso punto. Dispersione volutamente minima: un riquadro
        // di captcha è >=40px, e sbagliarlo costa più della firma che si evita.
        expect(src).toContain('humanPointInBox({');
        expect(src).not.toMatch(/Math\.min\(vp\.width - 1, coords\.x\)/);
    });

    it('clickLocatorHumanLike continua a disperdere UNA volta sola', () => {
        const src = sorgente('browser/humanClick.ts');
        // Se anche clickCoordinatesHumanLike disperdesse, il percorso via locator lo farebbe due
        // volte e sfonderebbe il clamp: la dispersione deve stare solo dove il box diventa punto.
        const corpoCoordinate = src.slice(
            src.indexOf('export async function clickCoordinatesHumanLike'),
            src.indexOf('function gaussianStd'),
        );
        expect(corpoCoordinate).not.toContain('humanPointInBox');
        expect(src).toContain('const target = humanPointInBox(box);');
    });
});
