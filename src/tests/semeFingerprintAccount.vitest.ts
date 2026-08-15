/**
 * P1 anti-ban / F1 — il seme di fingerprint non deve dipendere da un percorso del disco.
 *
 * Difetto: `launcher.ts:298` fa `options.accountId ?? sessionDir`, e i siti di lancio sono **18**
 * (non 7 come diceva questa riga, e non 19: quel conteggio includeva un commento a
 * `createProfile.ts:59` — trovato da una review indipendente), nessuno dei quali passa oggi
 * `accountId` ⇒ il seme è `config.sessionDir`, che `env.ts:154-160` risolve **su
 * `process.cwd()`**. Quel seme entra in `pickDeterministicFingerprint` (hash FNV-1a → **indice nel
 * pool**) e in `semeAccount01` (typo rate + hold-time dei tasti): spostare la repo o cambiare cwd
 * cambia il **dispositivo** a parità di cookie jar.
 *
 * 🔴 Perché NON si passa semplicemente `account.id`: `/antiban-review` ha dato BLOCCO. Cambiare il
 * seme sposta l'indice con probabilità ~(N-1)/N ⇒ **ogni account cambierebbe dispositivo in un colpo
 * solo**, su sessioni già autenticate — cioè il segnale «stesso account, nuovo dispositivo».
 * Il difetto non è «il seme è sbagliato», è «il seme è RICALCOLATO da un percorso» ⇒ si **fissa**.
 *
 * Il test che conta è `P1.2`: prova un **NON-cambiamento**. Se un giorno qualcuno "semplificherà"
 * questa funzione facendole ritornare `profiloId` sempre, quel test cade — ed è l'unico modo per
 * accorgersene prima che se ne accorga LinkedIn.
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { risolviProfiloId, risolviSemeFingerprint } from '../fingerprint/accountSeed';
import { normalizzaPercorso } from '../fingerprint/seedRuntime';
import { desktopFingerprintPool, pickDeterministicFingerprint } from '../fingerprint/pool';

const SESSION_DIR = 'C:\\Users\\albie\\Desktop\\Programmi\\Linkedin\\data\\session';

describe('risolviSemeFingerprint — fissare il seme, non sostituirlo', () => {
    it('P1.2 (il test che conta): account GIÀ autenticato senza seme persistito → stesso indice di fingerprint di oggi', () => {
        const esito = risolviSemeFingerprint({
            semePersistito: null,
            profiloId: 'default',
            sessionDir: SESSION_DIR,
            sessioneGiaAutenticata: true,
        });

        // Il comportamento ODIERNO: il seme è il sessionDir.
        const fingerprintOggi = pickDeterministicFingerprint(desktopFingerprintPool, SESSION_DIR);
        const fingerprintDopoIlFix = pickDeterministicFingerprint(desktopFingerprintPool, esito.seme);

        expect(fingerprintDopoIlFix).toEqual(fingerprintOggi);
        // e il valore va persistito, altrimenti al prossimo avvio da un'altra cwd cambierebbe.
        expect(esito.daPersistere).toBe(SESSION_DIR);
    });

    it('P1.2-bis: una volta persistito, spostare la repo NON cambia più il fingerprint', () => {
        const dopoLoSpostamento = risolviSemeFingerprint({
            semePersistito: SESSION_DIR,
            profiloId: 'default',
            sessionDir: 'D:\\altrove\\Linkedin\\data\\session', // repo spostata
            sessioneGiaAutenticata: true,
        });
        expect(dopoLoSpostamento.seme).toBe(SESSION_DIR);
        expect(dopoLoSpostamento.daPersistere).toBeNull();
        expect(pickDeterministicFingerprint(desktopFingerprintPool, dopoLoSpostamento.seme)).toEqual(
            pickDeterministicFingerprint(desktopFingerprintPool, SESSION_DIR),
        );
    });

    it('P1.3: account NUOVO (cookie jar assente) → seme = profiloId, mai il percorso', () => {
        const esito = risolviSemeFingerprint({
            semePersistito: null,
            profiloId: 'acc-2',
            sessionDir: 'C:\\qualunque\\data\\session-acc2',
            sessioneGiaAutenticata: false,
        });
        expect(esito.seme).toBe('acc-2');
        expect(esito.daPersistere).toBe('acc-2');
        expect(esito.seme).not.toContain('\\');
        expect(esito.seme).not.toContain('/');
    });

    it('P1.4: il seme persistito VINCE sempre, anche su un account nuovo', () => {
        const esito = risolviSemeFingerprint({
            semePersistito: 'seme-storico',
            profiloId: 'acc-9',
            sessionDir: SESSION_DIR,
            sessioneGiaAutenticata: false,
        });
        expect(esito.seme).toBe('seme-storico');
        expect(esito.daPersistere).toBeNull();
    });

    it('un seme persistito vuoto o di soli spazi non conta come persistito', () => {
        for (const vuoto of ['', '   ']) {
            const esito = risolviSemeFingerprint({
                semePersistito: vuoto,
                profiloId: 'acc-3',
                sessionDir: SESSION_DIR,
                sessioneGiaAutenticata: false,
            });
            expect(esito.seme).toBe('acc-3');
        }
    });

    it('due account diversi non condividono MAI il seme, nemmeno con cartelle omonime', () => {
        // La trappola evitata nel design: il basename come chiave avrebbe fatto collidere questi due.
        const a = risolviSemeFingerprint({
            semePersistito: null,
            profiloId: 'acc-a',
            sessionDir: 'C:\\ramo-1\\session',
            sessioneGiaAutenticata: false,
        });
        const b = risolviSemeFingerprint({
            semePersistito: null,
            profiloId: 'acc-b',
            sessionDir: 'C:\\ramo-2\\session',
            sessioneGiaAutenticata: false,
        });
        expect(a.seme).not.toBe(b.seme);
    });

    it('è puro: stessi input → stesso output', () => {
        const input = {
            semePersistito: null,
            profiloId: 'acc-1',
            sessionDir: SESSION_DIR,
            sessioneGiaAutenticata: true,
        };
        expect(risolviSemeFingerprint(input)).toEqual(risolviSemeFingerprint(input));
    });
});

/**
 * P1.4 — la CHIAVE su cui il seme viene congelato.
 *
 * 🔴 Il caso reale che ha imposto questa funzione: `companyEnrichment.ts:276` lancia con
 * `accountId: 'company-enrichment'` ma **sulla stessa `sessionDir` dell'account default**. Una
 * chiave derivata dalla cartella li farebbe scrivere sullo stesso flag ⇒ il secondo ad avviarsi
 * erediterebbe il seme del primo = cambio di dispositivo su una sessione già autenticata.
 */
describe('risolviProfiloId — la chiave viene dall’identità, mai dalla cartella', () => {
    const PROFILI = [
        { id: 'default', sessionDirNormalizzato: 'c:\\bot\\data\\session' },
        { id: 'acc-2', sessionDirNormalizzato: 'c:\\bot\\data\\session-2' },
    ] as const;

    it('riconosce il profilo dalla cartella normalizzata', () => {
        expect(risolviProfiloId(PROFILI, 'c:\\bot\\data\\session')).toBe('default');
        expect(risolviProfiloId(PROFILI, 'c:\\bot\\data\\session-2')).toBe('acc-2');
    });

    it('cartella che la config non conosce → null (niente persistenza, mai una chiave condivisa)', () => {
        // createProfile.ts e webrtcLeakCheck.ts lanciano con una sessionDir ad-hoc: restano al
        // comportamento odierno invece di scrivere sul flag di un altro account.
        expect(risolviProfiloId(PROFILI, 'c:\\temp\\profilo-nuovo')).toBeNull();
    });

    it('due profili sulla stessa cartella → null: nessuno eredita il seme dell’altro', () => {
        const ambigui = [
            { id: 'a', sessionDirNormalizzato: 'c:\\bot\\data\\session' },
            { id: 'b', sessionDirNormalizzato: 'c:\\bot\\data\\session' },
        ];
        expect(risolviProfiloId(ambigui, 'c:\\bot\\data\\session')).toBeNull();
    });

    it('un id vuoto o di soli spazi non è una chiave valida', () => {
        const rotti = [{ id: '   ', sessionDirNormalizzato: 'c:\\bot\\data\\session' }];
        expect(risolviProfiloId(rotti, 'c:\\bot\\data\\session')).toBeNull();
    });

    it('nessun profilo configurato → null', () => {
        expect(risolviProfiloId([], 'c:\\bot\\data\\session')).toBeNull();
    });
});

/**
 * `normalizzaPercorso` decide se il fix è ATTIVO o INERTE: e' lei a far combaciare la cartella di
 * lancio con quella del profilo. Se sbaglia, `risolviProfiloId` non trova nulla, niente viene
 * persistito e si resta al comportamento odierno **in silenzio** — degrada dal lato sicuro, ma
 * «funziona» e «non fa niente» diventano indistinguibili. Per questo si prova la funzione REALE:
 * il canary che aveva stabilito «fix non inerte su questa macchina» ne usava una copia.
 */
describe('normalizzaPercorso — il confronto che rende il fix attivo invece che inerte', () => {
    it('è idempotente e assoluto', () => {
        const unaVolta = normalizzaPercorso('data/session');
        expect(normalizzaPercorso(unaVolta)).toBe(unaVolta);
        expect(path.isAbsolute(unaVolta)).toBe(true);
    });

    it('la stessa cartella scritta in due modi dà la stessa chiave', () => {
        // Il caso reale: la config ha un path relativo, il launcher lo risolve su process.cwd().
        expect(normalizzaPercorso('data/session')).toBe(normalizzaPercorso(path.resolve('data/session')));
        expect(normalizzaPercorso('data/session')).toBe(normalizzaPercorso('data\\session'));
        expect(normalizzaPercorso('data/./session')).toBe(normalizzaPercorso('data/session'));
    });

    it('su Windows le maiuscole non spaccano la chiave in due', () => {
        const atteso = process.platform === 'win32';
        const uguali = normalizzaPercorso('C:\\Bot\\Data\\Session') === normalizzaPercorso('c:\\bot\\data\\session');
        // Su Windows DEVONO coincidere (stesso account); altrove il filesystem distingue davvero.
        expect(uguali).toBe(atteso);
    });

    it('cartelle diverse restano diverse (mai due account sulla stessa chiave)', () => {
        expect(normalizzaPercorso('data/session')).not.toBe(normalizzaPercorso('data/session-2'));
    });
});
