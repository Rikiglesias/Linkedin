/**
 * P1 anti-ban / F2 — sentinella sul WIRING del seme di fingerprint.
 *
 * F1 ha reso pura la REGOLA (`risolviSemeFingerprint`), ma una regola non cablata è inerte: fino a
 * F2 il launcher continuava a fare `options.accountId ?? sessionDir`, cioè a **ricalcolare** il seme
 * da un percorso che `env.ts` risolve su `process.cwd()`. Questi test guardano il sorgente di
 * produzione perché il comportamento vero sta dietro una funzione che lancia Playwright: quello che
 * si può provare senza browser è che il seme **passi dalla regola** e che la chiave di persistenza
 * non sia mai un percorso.
 *
 * Il wiring impuro vive in `fingerprint/seedRuntime.ts`, non nel launcher (che è oltre le 900
 * righe): i test seguono quella divisione — `launcher.ts` deve solo CHIAMARLO, al posto giusto.
 *
 * 🔴 Il caso che il design ha rischiato di perdere: `companyEnrichment.ts:276` passa
 * `accountId: 'company-enrichment'` pur usando la stessa `sessionDir` dell'account default. Se la
 * chiave del runtime flag derivasse dalla cartella, i due si scambierebbero il seme ⇒ uno dei due
 * cambierebbe dispositivo. La chiave deve venire dall'IDENTITÀ.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');
const launcher = fs.readFileSync(path.join(SRC, 'browser', 'launcher.ts'), 'utf8');
const seedRuntime = fs.readFileSync(path.join(SRC, 'fingerprint', 'seedRuntime.ts'), 'utf8');

describe('F2 — il seme di fingerprint passa dalla regola, non dal percorso', () => {
    it('il wiring usa la funzione pura `risolviSemeFingerprint`', () => {
        expect(seedRuntime).toMatch(/import\s*\{[^}]*risolviSemeFingerprint[^}]*\}\s*from\s*'\.\/accountSeed'/);
        expect(seedRuntime).toMatch(/risolviSemeFingerprint\(/);
    });

    it('il launcher CHIAMA il wiring invece di contenerlo', () => {
        expect(launcher).toMatch(
            /import\s*\{[^}]*congelaSemeFingerprint[^}]*\}\s*from\s*'\.\.\/fingerprint\/seedRuntime'/,
        );
        // Il launcher non deve tornare a ospitare la logica: è già oltre le 900 righe.
        expect(launcher).not.toMatch(/function\s+congelaSemeFingerprint/);
        expect(launcher).not.toMatch(/setRuntimeFlag\(/);
    });

    it('il seme NON è più ricalcolato come `options.accountId ?? sessionDir`', () => {
        // Sentinella anti-inerzia. Il nome della variabile NON fa parte del divieto: rimetterla
        // chiamandola `acc` sarebbe lo stesso difetto, quindi si vieta la FORMA.
        expect([...launcher.matchAll(/const\s+(\w+)\s*=\s*options\.accountId\s*\?\?\s*sessionDir/g)]).toEqual([]);
        // Nel wiring l'unica occorrenza legittima è il valore da CONGELARE.
        const nelWiring = [...seedRuntime.matchAll(/const\s+(\w+)\s*=\s*accountIdEsplicito\s*\?\?\s*sessionDir/g)];
        expect(nelWiring.map((m) => m[1])).toEqual(['semeOdierno']);
    });

    it('la chiave del runtime flag è costruita sul profiloId, mai su un percorso', () => {
        const chiave = seedRuntime.match(/`fingerprint\.seed:\$\{([^}]+)\}`/);
        expect(chiave, 'chiave `fingerprint.seed:${...}` assente in seedRuntime.ts').not.toBeNull();
        const espressione = chiave?.[1] ?? '';
        expect(espressione).toContain('profiloId');
        expect(espressione).not.toContain('sessionDir');
        expect(espressione).not.toContain('basename');
    });

    it('il seme risolto alimenta ENTRAMBI gli assi: fingerprint e ritmo di battitura', () => {
        // zero-O: due assi della stessa persona simulata non possono avere identità diverse.
        const seme = launcher.match(/impostaSemeAccount\((\w+)\)/);
        expect(seme, 'impostaSemeAccount non trovato').not.toBeNull();
        const nomeSeme = seme?.[1] ?? '';
        // `\s*` ovunque e virgola finale opzionale: un reformat che spezza la chiamata su piu'
        // righe non deve far cadere il test: sarebbe un rosso FALSO su un comportamento corretto,
        // e un test che grida al lupo si disattiva da solo nella testa di chi lo legge.
        const chiamata = (fn: string) =>
            new RegExp(`${fn}\\(\\s*cloudFingerprints\\s*,\\s*${nomeSeme}\\s*,?\\s*\\)`);
        expect(launcher).toMatch(chiamata('pickDesktopFingerprint'));
        expect(launcher).toMatch(chiamata('pickMobileFingerprint'));
    });

    it('la persistenza avviene una sola volta, solo quando la regola lo chiede', () => {
        // `daPersistere !== null` è il contratto della funzione pura: scrivere a ogni avvio
        // sovrascriverebbe il seme congelato con quello del giorno.
        expect(seedRuntime).toMatch(/daPersistere\s*!==\s*null|daPersistere\s*!=\s*null/);
        expect(seedRuntime).toMatch(/setRuntimeFlag\(/);
    });

    it('la risoluzione del seme avviene fuori dal ciclo di retry del proxy', () => {
        const inizioCiclo = launcher.indexOf('for (let attempt = 0; attempt < launchPlan.length; attempt++)');
        const usoWiring = launcher.indexOf('await congelaSemeFingerprint(');
        expect(inizioCiclo).toBeGreaterThan(0);
        expect(usoWiring).toBeGreaterThan(0);
        // Dentro il ciclo si riscriverebbe il flag a ogni tentativo di proxy.
        expect(usoWiring).toBeLessThan(inizioCiclo);
    });

    it('il wiring non importa il tipo del launcher: sarebbe un ciclo di import', () => {
        // `npx madge --circular` deve restare a zero (L1.5). Il contratto e' a parametri primitivi.
        expect(seedRuntime).not.toMatch(/from\s*'\.\.\/browser\//);
        expect(seedRuntime).toMatch(/congelaSemeFingerprint\(\s*sessionDir:\s*string,\s*accountIdEsplicito\?:\s*string/);
    });
});
