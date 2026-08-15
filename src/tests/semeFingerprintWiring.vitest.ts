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
 * 🔴 Il caso che il design ha rischiato di perdere: se la chiave del runtime flag derivasse dalla
 * cartella, due account con la stessa `sessionDir` si scambierebbero il seme ⇒ uno dei due
 * cambierebbe dispositivo. La chiave deve venire dall'IDENTITÀ.
 *
 * ⚠️ Questa premessa era scritta su `companyEnrichment.ts:276`, che passava
 * `accountId: 'company-enrichment'` **riusando il jar dell'account default**: proteggerne la chiave
 * significava tenere in piedi DUE dispositivi sulla stessa sessione autenticata. Il caso e' stato
 * risolto alla radice (l'`accountId` non si passa piu' li') e la regola generale vive ora nel
 * gruppo F3 in fondo a questo file. La regola sopra resta valida per due jar DIVERSI.
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

/**
 * F3 — un cookie jar, un dispositivo.
 *
 * F2 ha protetto la CHIAVE di persistenza («due account non si scambiano il seme») e nel farlo ha
 * dato per corretto che `companyEnrichment` avesse un'identita' propria pur riusando la `sessionDir`
 * dell'account default. La domanda che nessuno aveva fatto e' quella zero: se il jar e' lo stesso ed
 * e' AUTENTICATO (`companyEnrichment.ts:278` fa `checkLogin`), LinkedIn vede la stessa sessione
 * presentarsi con DUE fingerprint — un segnale di cambio-dispositivo, cioe' esattamente cio' che il
 * lavoro sul seme esisteva per eliminare.
 *
 * La regola generale, non l'istanza: passare un `accountId` a `launchBrowser` significa dichiarare
 * un'identita' diversa; un'identita' diversa deve avere il PROPRIO cookie jar. Chi passa l'uno senza
 * l'altro sta creando un secondo dispositivo su una sessione altrui.
 */
describe('F3 — chi dichiara una identita\' propria deve avere il proprio cookie jar', () => {
    const FILE_PRODUZIONE = (() => {
        const risultati: Array<{ file: string; testo: string }> = [];
        const visita = (dir: string): void => {
            for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
                const completo = path.join(dir, voce.name);
                if (voce.isDirectory()) {
                    if (voce.name === 'tests' || voce.name === 'node_modules') continue;
                    visita(completo);
                } else if (voce.name.endsWith('.ts') && !voce.name.endsWith('.d.ts')) {
                    risultati.push({ file: path.relative(SRC, completo), testo: fs.readFileSync(completo, 'utf8') });
                }
            }
        };
        visita(SRC);
        return risultati;
    })();

    /**
     * Estrae gli oggetti letterali passati a `launchBrowser(` contando le graffe.
     * NON una regex: `\{[^}]*\}` si ferma alla PRIMA graffa chiusa, quindi
     * `launchBrowser({ proxy: { url }, accountId: X })` verrebbe troncato a `{ proxy: { url }`
     * e l'`accountId` sfuggirebbe alla guardia. Un oggetto annidato non deve poterla aggirare.
     */
    const argomentiDiLaunchBrowser = (testo: string): string[] => {
        const trovati: string[] = [];
        const marcatore = /launchBrowser\(\s*\{/g;
        let m: RegExpExecArray | null;
        while ((m = marcatore.exec(testo)) !== null) {
            let profondita = 1;
            let i = m.index + m[0].length;
            for (; i < testo.length && profondita > 0; i++) {
                if (testo[i] === '{') profondita++;
                else if (testo[i] === '}') profondita--;
            }
            trovati.push(testo.slice(m.index, i));
        }
        return trovati;
    };

    it('l\'estrattore vede dentro gli oggetti annidati (altrimenti la guardia sotto è aggirabile)', () => {
        const finto = 'launchBrowser({ proxy: { url: "x" }, accountId: ACC })';
        const [estratto] = argomentiDiLaunchBrowser(finto);
        expect(estratto).toContain('accountId');
    });

    /**
     * Il jar e' PROPRIO se `sessionDir` e' passato (anche in forma abbreviata `sessionDir,`, che
     * `webrtcLeakCheck.ts:135` usa gia': cercare solo `sessionDir:` bocciava il codice CORRETTO)
     * e NON e' il jar condiviso dell'account default. `sessionDir: config.sessionDir` insieme a un
     * `accountId` e' il bug appena corretto scritto in modo esplicito: due identita', un solo jar.
     */
    const haJarProprio = (chiamata: string): boolean => {
        if (/\bsessionDir\s*:\s*config\.sessionDir\b/.test(chiamata)) return false;
        return /\bsessionDir\s*[:,}]/.test(chiamata);
    };

    it('riconosce il jar proprio anche in forma abbreviata, e NON lo riconosce se e\' quello condiviso', () => {
        expect(haJarProprio('launchBrowser({ sessionDir, headless })')).toBe(true);
        expect(haJarProprio('launchBrowser({ sessionDir: dir, accountId: X })')).toBe(true);
        expect(haJarProprio('launchBrowser({ sessionDir: config.sessionDir, accountId: X })')).toBe(false);
        expect(haJarProprio('launchBrowser({ forceDesktop: true })')).toBe(false);
    });

    it('nessun call-site dichiara una identita\' propria senza avere un cookie jar proprio', () => {
        const colpevoli: string[] = [];
        for (const { file, testo } of FILE_PRODUZIONE) {
            for (const chiamata of argomentiDiLaunchBrowser(testo)) {
                if (/\baccountId\s*[:,}]/.test(chiamata) && !haJarProprio(chiamata)) {
                    colpevoli.push(`${file}: ${chiamata.replace(/\s+/g, ' ').slice(0, 90)}`);
                }
            }
        }
        expect(colpevoli).toEqual([]);
    });
});
