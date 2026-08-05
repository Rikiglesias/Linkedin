import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digitaTestoUmano } from '../browser/human/humanTyping';
import { fattoreLunghezzaTesto, finestraDwellDellAccount } from '../browser/human/keystrokeTiming';

/**
 * F-b93d5f17 + F-08b7a53c: tre siti scrivevano con `.type(testo, { delay: 25 + random*20 })`.
 * Quel `delay` e' il tempo di PRESSIONE e Playwright lo applica IDENTICO a ogni carattere ⇒ dwell
 * COSTANTE (una firma) e sotto la soglia dei 50 ms (la zona-bot), con flight ~0.
 *
 * 🔴 Perche' questo file esiste, e non bastava la guardia gia' presente: `typingDelegation.vitest.ts`
 * asserisce "nessun keystroke sotto 50ms" ma legge SOLO `browser/uiFallback.ts` e cerca il pattern
 * `delay: Math.floor(Math.random() * N) + 40` — per costruzione non puo' trovare
 * `delay: 25 + Math.floor(...)` ne' guardare `src/salesnav/`. Cercava l'assenza con la firma della
 * presenza: la stessa classe di errore che aveva prodotto un "perimetro chiuso" falso su F-4a6e88d1.
 */

function pageFinta() {
    const attese: number[] = [];
    return {
        attese,
        waitForTimeout: async (ms: number) => {
            attese.push(ms);
        },
    };
}

function scrittoreFinto() {
    const dwell: number[] = [];
    const scritti: string[] = [];
    return {
        dwell,
        scritti,
        scrivi: async (char: string, dwellMs: number) => {
            scritti.push(char);
            dwell.push(dwellMs);
        },
    };
}

describe('digitaTestoUmano — dwell e flight separati su ogni carattere', () => {
    it("ROSSO DI CONTROLLO: com'era prima, UN solo delay costante per tutto il testo, sotto i 50 ms", () => {
        // Riproduce `.type(testo, { delay: 25 + Math.floor(Math.random() * 20) })`.
        const testo = 'Lista Clienti 2026';
        const delayUnico = 25 + Math.floor(Math.random() * 20);
        const dwellPerCarattere = Array.from({ length: testo.length }, () => delayUnico);

        // Tutti identici: un istogramma a una sola barra.
        expect(new Set(dwellPerCarattere).size).toBe(1);
        // ...e dentro la zona-bot che il resto del progetto evita.
        expect(delayUnico).toBeLessThan(50);
    });

    it("scrive OGNI carattere, ognuno con un dwell proprio nella finestra dell'account", async () => {
        const page = pageFinta();
        const scrittore = scrittoreFinto();
        const testo = 'Lista Clienti Milano 2026';

        await digitaTestoUmano(page as never, scrittore.scrivi, testo);

        // Dalla Fase 3 la finestra e' seedata sull'account (F-6ce4907b): due costanti qui
        // passerebbero solo per fortuna su un testo corto, e mentirebbero su un altro account.
        const finestra = finestraDwellDellAccount();
        expect(scrittore.scritti.join('')).toBe(testo);
        expect(scrittore.dwell).toHaveLength(testo.length);
        for (const d of scrittore.dwell) {
            expect(d).toBeGreaterThanOrEqual(Math.floor(finestra.minMs));
            expect(d).toBeLessThanOrEqual(Math.ceil(finestra.maxMs));
        }
        // Un dwell costante sarebbe una firma quanto uno a 0: serve dispersione reale.
        expect(new Set(scrittore.dwell).size).toBeGreaterThan(3);
    });

    it('attende il flight fra un carattere e il successivo, mai ~0', async () => {
        const page = pageFinta();
        const scrittore = scrittoreFinto();

        await digitaTestoUmano(page as never, scrittore.scrivi, 'Acme Corp');

        expect(page.attese).toHaveLength('Acme Corp'.length);
        // 55 ms e' il floor assoluto per i caratteri, 80 per spazi/punteggiatura (TIMING-CORE).
        for (const attesa of page.attese) {
            expect(attesa).toBeGreaterThanOrEqual(55);
        }
    });

    it("applica il fattore-lunghezza: e' la stessa curva di humanType, non una copia divergente", () => {
        expect(fattoreLunghezzaTesto('a'.repeat(10))).toBe(0.85);
        expect(fattoreLunghezzaTesto('a'.repeat(100))).toBe(1.0);
        expect(fattoreLunghezzaTesto('a'.repeat(300))).toBe(1.15);
        expect(fattoreLunghezzaTesto('a'.repeat(500))).toBe(1.3);
    });

    it('testo vuoto: non scrive nulla e non attende nulla (nessuna divisione per zero sulle parole)', async () => {
        const page = pageFinta();
        const scrittore = scrittoreFinto();

        await digitaTestoUmano(page as never, scrittore.scrivi, '');

        expect(scrittore.scritti).toHaveLength(0);
        expect(page.attese).toHaveLength(0);
    });
});

/**
 * Guardia di REGRESSIONE sul sorgente, non sul comportamento: impedisce che un `delay` numerico
 * torni a comparire in una chiamata `.type(...)` nelle aree LinkedIn-touch. E' il check che mancava
 * — quello esistente guardava un solo file e una sola firma.
 */
function fileSorgente(dir: string): string[] {
    const trovati: string[] = [];
    for (const voce of readdirSync(dir)) {
        const completo = join(dir, voce);
        if (statSync(completo).isDirectory()) {
            trovati.push(...fileSorgente(completo));
        } else if (voce.endsWith('.ts')) {
            trovati.push(completo);
        }
    }
    return trovati;
}

describe('nessun dwell numerico hard-coded nelle chiamate .type() delle aree LinkedIn-touch', () => {
    it('src/salesnav, src/browser, src/workers e src/core sono puliti', () => {
        const radici = ['src/salesnav', 'src/browser', 'src/workers', 'src/core'];
        // `.type(qualcosa, { delay: 25 ... })` — cattura il NUMERO, non `humanKeystrokeDwellMs()`.
        const vietato = /\.type\([^)]*delay:\s*\d/;

        const colpevoli: string[] = [];
        for (const radice of radici) {
            for (const file of fileSorgente(radice)) {
                const righe = readFileSync(file, 'utf8').split('\n');
                righe.forEach((riga, i) => {
                    // I commenti CITANO il pattern vietato (questa guardia e' documentata nei
                    // JSDoc): senza questo filtro la guardia resterebbe rossa per sempre e
                    // verrebbe disattivata da qualcuno — un test che non puo' diventare verde
                    // non protegge nulla.
                    const codice = riga.trim();
                    if (codice.startsWith('*') || codice.startsWith('//') || codice.startsWith('/*')) return;
                    if (vietato.test(riga)) colpevoli.push(`${file}:${i + 1} → ${codice}`);
                });
            }
        }

        expect(colpevoli).toEqual([]);
    });
});
