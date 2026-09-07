/**
 * proxyFailClosedNoInfra.vitest.ts — C26 del contratto `bot-operativo` (blocco A).
 *
 * Il buco che chiude: la guardia AB1 (`launcher.ts:245`) e' una congiunzione di QUATTRO condizioni,
 * fra cui `proxyInfraConfigured`. Con ZERO proxy configurati quella condizione e' falsa, quindi la
 * guardia non scatta, `managedProxyEnabled` diventa false e `buildProxyLaunchPlan` restituisce
 * `[undefined]` = connessione DIRETTA — anche su una sessionDir con cookie di LinkedIn e con
 * `REQUIRE_PROXY_FOR_AUTH=true`. Cioe': proprio la configurazione che chiede «mai senza proxy su
 * sessione autenticata» e' quella che degrada in silenzio quando i proxy mancano del tutto.
 *
 * Regola dopo il fix: con `requireProxyForAuth` e sessione che HA cookie, un piano che contenga una
 * connessione diretta non e' rappresentabile — si lancia, mai si degrada. L'unica uscita e'
 * `allowDirectIp`, esplicito, per i flussi legittimamente diretti (create-profile su IP fresco,
 * diagnostica).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, it, expect } from 'vitest';
import { buildProxyLaunchPlan } from '../browser/proxyLaunchPlan';
import { profileHasCookies } from '../browser/browserIdentity';

const P1 = { server: 'http://p1.example:8080', username: 'u1', password: 'x1' };
const LAUNCHER = fs.readFileSync(path.resolve(__dirname, '..', 'browser', 'launcher.ts'), 'utf8');

const tempDirs: string[] = [];
function sessionDirConCookie(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c26-cookies-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'cookies.sqlite'), 'SQLite format 3\0');
    return dir;
}
afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('C26 — proxy fail-closed anche SENZA infrastruttura proxy', () => {
    it('zero proxy + requireProxyForAuth + sessione con cookie → THROW AB1, mai [undefined]', () => {
        expect(() =>
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: true,
                sessionHasCookies: true,
            }),
        ).toThrow(/AB1/);
    });

    it("il piano non contiene MAI una diretta quando la sessione e' autenticata e il proxy e' richiesto", () => {
        // Anche col proxy gestito attivo e una chain disponibile: nessun `undefined` deve passare.
        const plan = buildProxyLaunchPlan({
            managedProxyEnabled: true,
            failoverChain: [P1],
            requireProxyForAuth: true,
            sessionHasCookies: true,
        });
        expect(plan).not.toContain(undefined);
        expect(plan).toEqual([P1]);
    });

    it("sessione SENZA cookie → la diretta resta legittima (profilo vergine, nessuna identita' esposta)", () => {
        expect(
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: true,
                sessionHasCookies: false,
            }),
        ).toEqual([undefined]);
    });

    it('requireProxyForAuth OFF → comportamento invariato (default del progetto, nessuna regressione)', () => {
        expect(
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: false,
                sessionHasCookies: true,
            }),
        ).toEqual([undefined]);
    });

    it('allowDirectIp esplicito → uscita legittima anche su sessione con cookie', () => {
        expect(
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: true,
                sessionHasCookies: true,
                allowDirectIp: true,
            }),
        ).toEqual([undefined]);
    });

    /**
     * Caso 2 del criterio: «launchBrowser su sessionDir con cookie e nessun proxy → 0 browser aperti».
     * DEVIAZIONE DICHIARATA dal VERIFY letterale (che dice «spy»): uno spy su `launchBrowser`
     * richiederebbe di mockare `playwright` PIU' l'intera `config` — a quel punto il test osserva i
     * mock, non il codice. Qui la stessa proprieta' e' provata in modo piu' stabile e piu' forte:
     * (a) la CATENA REALE profilo→decisione su una sessionDir vera con cookie jar, e
     * (b) l'ORDINE nel sorgente: la decisione precede OGNI apertura di browser, quindi non esiste
     *     cammino che apra un contesto prima di averla presa.
     * `camoufox-js` e' importato dinamicamente a `launcher.ts:450`, cioe' dopo la riga della
     * decisione: se la guardia lancia, quel modulo non viene nemmeno caricato.
     */
    it('catena reale: sessionDir con cookie jar + zero proxy → la decisione lancia AB1', () => {
        const dir = sessionDirConCookie();
        expect(profileHasCookies(dir)).toBe(true);
        expect(() =>
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: true,
                sessionHasCookies: profileHasCookies(dir),
            }),
        ).toThrow(/AB1/);
    });

    it('ordine nel sorgente: la decisione sul proxy precede OGNI apertura di browser', () => {
        const decisione = LAUNCHER.indexOf('buildProxyLaunchPlan({');
        expect(decisione).toBeGreaterThan(-1);

        const aperture = [
            ...LAUNCHER.matchAll(/launchPersistentContext\s*\(/g),
            ...LAUNCHER.matchAll(/\bCamoufox\s*\(/g),
            ...LAUNCHER.matchAll(/await import\('camoufox-js'\)/g),
        ].map((m) => m.index ?? -1);

        expect(aperture.length).toBeGreaterThan(0); // la sonda deve trovare davvero le aperture
        for (const apertura of aperture) {
            expect(apertura).toBeGreaterThan(decisione);
        }
    });

    it('il launcher passa il profilo REALE, non un valore addomesticato', () => {
        // Regressione mirata: `sessionHasCookies: false` letterale, o un booleano dedotto dai proxy,
        // riaprirebbe esattamente il buco che C26 chiude.
        expect(LAUNCHER).toContain('sessionHasCookies: profileHasCookies(sessionDir)');
        expect(LAUNCHER).not.toMatch(/sessionHasCookies:\s*(false|true)\b/);
    });

    it('il messaggio AB1 dice cosa fare, non solo che ha rifiutato', () => {
        try {
            buildProxyLaunchPlan({
                managedProxyEnabled: false,
                requireProxyForAuth: true,
                sessionHasCookies: true,
            });
            throw new Error('atteso throw');
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toContain('AB1');
            expect(msg).toMatch(/proxy/i);
            expect(msg).toMatch(/allowDirectIp|REQUIRE_PROXY_FOR_AUTH/);
        }
    });
});
