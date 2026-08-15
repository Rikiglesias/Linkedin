/**
 * Seme di identità dell'account, usato per selezionare il fingerprint del browser
 * (`pickDeterministicFingerprint`) e il ritmo di digitazione (`semeAccount01`).
 *
 * ## Il problema che questo modulo risolve
 *
 * Il seme era `options.accountId ?? sessionDir` e i **19** siti di lancio non passavano `accountId`
 * — con UNA eccezione che questa riga taceva: `companyEnrichment.ts:276` lo passava pur riusando il
 * cookie jar dell'account default, cioe' mostrava DUE dispositivi sulla stessa sessione autenticata.
 * Rimossa, insieme al test F3 «un jar, un dispositivo»: oggi i siti che passano `accountId` sono
 * **zero**, ed e' la sentinella a tenerli tali.
 * ⇒ in pratica il seme era `config.sessionDir`, che `config/env.ts` risolve **su `process.cwd()`**.
 * Conseguenza: spostare la repo, o lanciarla da una working directory diversa, cambiava
 * **fingerprint e tempi di battitura a parità di cookie jar** — cioè il segnale «stesso account,
 * dispositivo nuovo», esattamente ciò che l'anti-ban esiste per non produrre.
 *
 * ## Perché NON si sostituisce il seme con l'id dell'account
 *
 * `/antiban-review` (2026-08-15) ha dato **BLOCCO** su quella strada. Il seme entra in
 * `pickDeterministicFingerprint` come hash → **indice nel pool**: cambiarlo sposta l'indice con
 * probabilità ~(N-1)/N, quindi **ogni account già autenticato cambierebbe dispositivo in un colpo
 * solo**. Il difetto non è «il seme è sbagliato», è «il seme è **ricalcolato** da un percorso del
 * filesystem» ⇒ la cura è **fissarlo**, non sostituirlo.
 *
 * ## Le due trappole evitate (non re-inventarle)
 *
 * 1. **La chiave di persistenza non può essere il percorso** (sarebbe circolare: si sposta con la
 *    repo) **né il basename della cartella**: due account con cartelle omonime in rami diversi
 *    finirebbero a condividere il fingerprint, ricreando il correlatore cross-account che
 *    F-6ce4907b aveva eliminato. La chiave è `profiloId`, che viene dalla config
 *    (`getRuntimeAccountProfiles`) ed è stabile e unica.
 * 2. **«Account esistente» non si indovina: lo dice il cookie jar.** Se la directory di sessione
 *    contiene già una sessione autenticata, l'identità del dispositivo è già stata mostrata a
 *    LinkedIn e va congelata com'è; se è vuota, siamo liberi di partire dall'id.
 */

export interface IngressoSemeFingerprint {
    /** Seme già salvato per questo account, se esiste (runtime flag). */
    semePersistito: string | null;
    /** Id del profilo dalla config: stabile, unico, indipendente dal filesystem. */
    profiloId: string;
    /** Directory di sessione risolta, cioè il seme storico di fatto. */
    sessionDir: string;
    /** La directory di sessione contiene già una sessione autenticata? */
    sessioneGiaAutenticata: boolean;
}

/** Un profilo della config, ridotto a cio' che serve per riconoscerlo: id + cartella normalizzata. */
export interface ProfiloConSessione {
    readonly id: string;
    readonly sessionDirNormalizzato: string;
}

/**
 * Da quale identità prende il nome la chiave di persistenza del seme.
 *
 * `null` significa «identità che la config non conosce» (profilo ad-hoc di `createProfile.ts`,
 * diagnostica di `webrtcLeakCheck.ts`): in quel caso il chiamante NON deve persistere nulla, perché
 * l'unica chiave disponibile sarebbe condivisa con un altro account. Anche il caso ambiguo — due
 * profili sulla stessa cartella — è trattato come sconosciuto per la stessa ragione: meglio restare
 * al comportamento odierno che far ereditare a un account il seme di un altro.
 */
export function risolviProfiloId(
    profili: ReadonlyArray<ProfiloConSessione>,
    sessionDirNormalizzato: string,
): string | null {
    const candidati = profili.filter((p) => p.sessionDirNormalizzato === sessionDirNormalizzato);
    if (candidati.length !== 1) return null;
    const id = candidati[0]?.id.trim();
    return id ? id : null;
}

export interface EsitoSemeFingerprint {
    /** Il seme da usare adesso. */
    seme: string;
    /** Il valore da scrivere nel runtime flag, oppure `null` se era già persistito. */
    daPersistere: string | null;
}

/**
 * Puro di proposito: la regola si prova, il wiring (lettura/scrittura del flag, ispezione della
 * cartella) si legge nel chiamante. Stessa lezione di `ramiFallitiDaEsiti`.
 */
export function risolviSemeFingerprint(ingresso: IngressoSemeFingerprint): EsitoSemeFingerprint {
    const persistito = ingresso.semePersistito?.trim();
    if (persistito) {
        // Già congelato: da qui in poi il fingerprint non dipende più da dove gira il processo.
        return { seme: persistito, daPersistere: null };
    }

    if (ingresso.sessioneGiaAutenticata) {
        // Primo passaggio su un account che LinkedIn ha già visto: si congela il seme ODIERNO, cosi'
        // che il dispositivo resti quello di sempre. Cambiarlo qui sarebbe il segnale da evitare.
        return { seme: ingresso.sessionDir, daPersistere: ingresso.sessionDir };
    }

    // Account mai autenticato: nessuna identità da preservare, si parte dall'id stabile.
    return { seme: ingresso.profiloId, daPersistere: ingresso.profiloId };
}
