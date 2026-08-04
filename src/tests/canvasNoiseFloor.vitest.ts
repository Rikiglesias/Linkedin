import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FingerprintPool } from '../fingerprint/noiseGenerator';
import { desktopFingerprintPool } from '../fingerprint/pool';

/**
 * Il rumore del canvas vive dentro una stringa template iniettata nella pagina (`launcher.ts`), quindi
 * non è importabile: si verifica come guardia statica sul sorgente vero, più la prova numerica sul
 * dominio dei seed. Stesso pattern del test sul webhook n8n, che esegue il codice estratto dal JSON.
 *
 * Cosa protegge: ampiezza 0 significa canvas NON perturbato, cioè hash identico fra tutti gli account
 * che girano sulla stessa macchina — che diventano così correlabili fra loro.
 */

const LAUNCHER = readFileSync(join(__dirname, '..', 'browser', 'launcher.ts'), 'utf8');

// Le tre ampiezze, lette dal sorgente invece che riscritte qui: se qualcuno cambia i moltiplicatori,
// il test segue il codice vero e non una copia che invecchia.
const CANALI = [
    { nome: 'noiseR', moltiplicatore: 255 },
    { nome: 'noiseG', moltiplicatore: 230 },
    { nome: 'noiseB', moltiplicatore: 245 },
] as const;

function rigaDelCanale(nome: string): string {
    const riga = LAUNCHER.split('\n').find((l) => l.includes(`const ${nome} =`));
    if (riga === undefined) throw new Error(`riga di ${nome} non trovata in launcher.ts`);
    return riga.trim();
}

/** canvasNoise reali, generati dalla stessa funzione che li produce in esercizio. */
function canvasNoiseCampione(quanti: number): number[] {
    const valori: number[] = [];
    for (let i = 0; i < quanti; i++) {
        const base = desktopFingerprintPool[i % desktopFingerprintPool.length];
        const profilo = FingerprintPool.generateConsistentProfile({ ...base, id: `account-${i}` });
        valori.push(profilo.canvasNoise);
    }
    return valori;
}

describe('canvas noise — pavimento dell ampiezza', () => {
    describe('guardia statica sul sorgente di launcher.ts', () => {
        for (const canale of CANALI) {
            it(`${canale.nome} è protetto da Math.max(1, ...)`, () => {
                const riga = rigaDelCanale(canale.nome);
                expect(riga).toContain('Math.max(1,');
                expect(riga).toContain(`* ${canale.moltiplicatore}`);
            });
        }

        it('nessuna delle tre ampiezze usa il solo Math.floor', () => {
            for (const canale of CANALI) {
                const riga = rigaDelCanale(canale.nome);
                // Il difetto originale era esattamente questa forma, senza pavimento.
                expect(riga).not.toMatch(new RegExp(`=\\s*Math\\.floor\\(canvasNoise \\* ${canale.moltiplicatore}\\)`));
            }
        });
    });

    describe('prova numerica sul dominio dei seed', () => {
        const noise = canvasNoiseCampione(2000);

        it('la formula PRECEDENTE lasciava senza rumore una quota grossa, non una coda', () => {
            const azzerati = noise.filter((n) => Math.floor(n * 255) === 0).length;
            const quota = azzerati / noise.length;
            // Soglia teorica: canvasNoise < 1/255 = 0.00392 su un dominio uniforme [0.000001, 0.009999].
            // Si asserisce che sia una quota SOSTANZIALE, non il valore esatto: il punto è che non era
            // un caso limite. (Misurato ~39%.)
            expect(quota).toBeGreaterThan(0.25);
        });

        it('la formula ATTUALE non lascia mai il canvas senza rumore', () => {
            for (const canale of CANALI) {
                const azzerati = noise.filter((n) => Math.max(1, Math.floor(n * canale.moltiplicatore)) < 1).length;
                expect(azzerati).toBe(0);
            }
        });

        it('il tetto non è stato alzato: l ampiezza resta al massimo 2', () => {
            for (const canale of CANALI) {
                const massimo = Math.max(...noise.map((n) => Math.max(1, Math.floor(n * canale.moltiplicatore))));
                expect(massimo).toBeLessThanOrEqual(2);
            }
        });
    });

    describe('il pavimento non collassa i fingerprint fra loro', () => {
        it('seed diversi restano distinti nel PRNG che decide il pattern dei segni', () => {
            // prngState = Math.abs(canvasNoise * 1e9 | 0) || 1 — è questo a rendere unico il pattern,
            // non l'ampiezza: alzare il pavimento non riduce la varietà degli hash.
            const noise = canvasNoiseCampione(500);
            const statiPrng = new Set(noise.map((n) => Math.abs((n * 1e9) | 0) || 1));
            const noiseDistinti = new Set(noise);
            expect(statiPrng.size).toBe(noiseDistinti.size);
            expect(statiPrng.size).toBeGreaterThan(1);
        });

        it('il rumore resta deterministico per profilo (stesso input, stesso valore)', () => {
            const base = desktopFingerprintPool[0];
            const primo = FingerprintPool.generateConsistentProfile({ ...base, id: 'account-stabile' });
            const secondo = FingerprintPool.generateConsistentProfile({ ...base, id: 'account-stabile' });
            expect(primo.canvasNoise).toBe(secondo.canvasNoise);
        });
    });
});
