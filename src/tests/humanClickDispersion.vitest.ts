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
        const puntiVision = src.match(/clickCoordinatesHumanLike\(page, coords\.x, coords\.y\)/g) ?? [];
        expect(puntiVision).toHaveLength(2);
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
