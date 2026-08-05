import { describe, expect, it } from 'vitest';
import { dimensioniFinestra, dimensioniPng } from '../browser/viewport';

/**
 * Copre `browser/viewport.ts`, l'unita' condivisa nata per chiudere la classe
 * «`page.viewportSize() ?? {1280,800}`»: 17 punti in 11 file che, nella configurazione di DEFAULT
 * (headless=false ⇒ `viewport: null`), lavoravano su una finestra inventata.
 *
 * Il caso che conta e' il ROSSO DI CONTROLLO del terzo test: con una finestra reale 1920x1080 il
 * vecchio codice dichiarava 1280x800, e ogni coordinata oltre 1279/799 finiva schiacciata sul bordo.
 */

/** Costruisce l'header PNG minimo (signature + IHDR) per dimensioni note. */
function pngFinto(width: number, height: number): Buffer {
    const buf = Buffer.alloc(24);
    buf.writeUInt32BE(0x89504e47, 0);
    buf.writeUInt32BE(0x0d0a1a0a, 4);
    buf.writeUInt32BE(13, 8); // lunghezza IHDR
    buf.write('IHDR', 12, 'ascii');
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
}

describe('dimensioniPng — l\'immagine e\' la fonte di verita\' di se stessa', () => {
    it('legge width/height dall\'header IHDR', () => {
        expect(dimensioniPng(pngFinto(1920, 1080))).toEqual({ width: 1920, height: 1080 });
        expect(dimensioniPng(pngFinto(3440, 1440))).toEqual({ width: 3440, height: 1440 });
        expect(dimensioniPng(pngFinto(16, 16))).toEqual({ width: 16, height: 16 });
    });

    it('ritorna null su buffer che non sono PNG, invece di inventare dimensioni', () => {
        expect(dimensioniPng(Buffer.alloc(0))).toBeNull();
        expect(dimensioniPng(Buffer.alloc(10))).toBeNull(); // troppo corto
        expect(dimensioniPng(Buffer.from('GIF89a-non-sono-un-png-ma-sono-lungo'))).toBeNull();

        const chunkSbagliato = pngFinto(100, 100);
        chunkSbagliato.write('IDAT', 12, 'ascii');
        expect(dimensioniPng(chunkSbagliato)).toBeNull();
    });

    it('ROSSO DI CONTROLLO: uno screenshot 1920x1080 non deve piu\' misurare 1280x800', () => {
        const screenshot = pngFinto(1920, 1080);

        // Com'era prima: `page.viewportSize() ?? { width: 1280, height: 800 }`, con viewportSize()
        // che in non-headless (il default) restituisce null ⇒ il default vinceva SEMPRE.
        const viewportSizeComeInNonHeadless = (): { width: number; height: number } | null => null;
        const vecchioComportamento = viewportSizeComeInNonHeadless() ?? { width: 1280, height: 800 };
        const nuovoComportamento = dimensioniPng(screenshot);

        expect(vecchioComportamento).toEqual({ width: 1280, height: 800 });
        expect(nuovoComportamento).not.toBeNull();
        if (nuovoComportamento === null) return; // narrowing, senza `!`
        expect(nuovoComportamento).toEqual({ width: 1920, height: 1080 });

        // La conseguenza concreta: con la misura vecchia ogni x oltre 1279 collassava sul bordo.
        const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
        expect(clamp(1500, vecchioComportamento.width)).toBe(1279);
        expect(clamp(1700, vecchioComportamento.width)).toBe(1279); // due punti diversi, stesso pixel
        expect(clamp(1500, nuovoComportamento.width)).toBe(1500);
        expect(clamp(1700, nuovoComportamento.width)).toBe(1700);
    });
});

describe('dimensioniFinestra — misura vera, e null quando non si sa', () => {
    it('usa il viewport dichiarato quando c\'e\' (caso headless)', async () => {
        const page = {
            viewportSize: () => ({ width: 1920, height: 1080 }),
            evaluate: async () => {
                throw new Error('non deve essere chiamata: il viewport dichiarato basta');
            },
        };
        expect(await dimensioniFinestra(page as never)).toEqual({ width: 1920, height: 1080 });
    });

    it('CASO DI DEFAULT (non-headless, viewport null): misura la finestra vera dal DOM', async () => {
        const page = {
            viewportSize: () => null,
            evaluate: async () => ({ width: 2560, height: 1440 }),
        };
        expect(await dimensioniFinestra(page as never)).toEqual({ width: 2560, height: 1440 });
    });

    it('ritorna null se nemmeno il DOM risponde: chi chiama deve poter NON agire', async () => {
        const page = {
            viewportSize: () => null,
            evaluate: async () => {
                throw new Error('Execution context was destroyed');
            },
        };
        expect(await dimensioniFinestra(page as never)).toBeNull();
    });

    it('non accetta misure degeneri (0 px) ne\' dal viewport ne\' dal DOM', async () => {
        const viewportZero = {
            viewportSize: () => ({ width: 0, height: 0 }),
            evaluate: async () => ({ width: 1366, height: 768 }),
        };
        expect(await dimensioniFinestra(viewportZero as never)).toEqual({ width: 1366, height: 768 });

        const domZero = {
            viewportSize: () => null,
            evaluate: async () => ({ width: 0, height: 0 }),
        };
        expect(await dimensioniFinestra(domZero as never)).toBeNull();
    });
});
