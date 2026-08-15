/**
 * Wiring IMPURO del seme di identità: config, filesystem, runtime flag.
 *
 * La REGOLA sta in `./accountSeed.ts` ed è pura (si prova senza browser e senza DB); qui c'è solo
 * ciò che tocca il mondo. La separazione è deliberata: `launcher.ts` è già oltre le 1000 righe, e
 * il pezzo che decide l'identità di un account non deve stare sepolto dentro il lifecycle di
 * Playwright — chi cerca «da dove viene il fingerprint di questo account» deve trovarlo qui.
 *
 * ⚠️ Perché i parametri sono primitivi e non `LaunchBrowserOptions`: quel tipo vive in
 * `browser/launcher.ts`, che importa questo modulo. Prenderlo come parametro creerebbe un ciclo
 * di import — e `npx madge --circular` deve restare a zero (L1.5).
 */
import fs from 'fs';
import path from 'path';
import { getRuntimeAccountProfiles } from '../accountManager';
import { getRuntimeFlag, setRuntimeFlag } from '../core/repositories';
import { logInfo, logWarn } from '../telemetry/logger';
import { risolviProfiloId, risolviSemeFingerprint } from './accountSeed';

function normalizzaPercorso(percorso: string): string {
    const risolto = path.resolve(percorso);
    // Windows non distingue le maiuscole nei path: due grafie della stessa cartella sono lo STESSO
    // account, e trattarle come diverse spaccherebbe la chiave del seme in due.
    return process.platform === 'win32' ? risolto.toLowerCase() : risolto;
}

function profiloIdDellaSessione(sessionDir: string, accountIdEsplicito?: string): string | null {
    // Un `accountId` passato dal chiamante È già l'identità e ha la precedenza: `companyEnrichment`
    // gira sulla STESSA cartella dell'account default: cercare per cartella li farebbe collidere
    // sulla stessa chiave, e il secondo ad avviarsi erediterebbe il seme del primo.
    const esplicito = accountIdEsplicito?.trim();
    if (esplicito) return esplicito;
    try {
        return risolviProfiloId(
            getRuntimeAccountProfiles().map((profilo) => ({
                id: profilo.id,
                sessionDirNormalizzato: normalizzaPercorso(profilo.sessionDir),
            })),
            normalizzaPercorso(sessionDir),
        );
    } catch {
        return null; // config illeggibile: si resta al comportamento odierno, mai una chiave a caso
    }
}

/**
 * Il cookie jar decide se LinkedIn ha già visto questo dispositivo: cartella con contenuto = sì.
 * Errore di lettura ⇒ `true`, perché congelare il seme ODIERNO è il lato che non cambia dispositivo.
 */
function sessioneGiaAutenticata(sessionDir: string): boolean {
    try {
        return fs.readdirSync(sessionDir).length > 0;
    } catch {
        return true;
    }
}

/**
 * Restituisce il seme da usare per fingerprint e ritmo di battitura, congelandolo al primo avvio.
 * Va chiamata UNA volta per lancio, fuori da qualsiasi ciclo di retry.
 */
export async function congelaSemeFingerprint(sessionDir: string, accountIdEsplicito?: string): Promise<string> {
    // Il seme che il bot userebbe OGGI: è quello da preservare sugli account già autenticati.
    const semeOdierno = accountIdEsplicito ?? sessionDir;
    const profiloId = profiloIdDellaSessione(sessionDir, accountIdEsplicito);
    // Identità che la config non conosce (`createProfile`, `webrtcLeakCheck`): non esiste una chiave
    // stabile su cui congelare senza rischiare di condividerla ⇒ comportamento odierno, invariato.
    if (!profiloId) return semeOdierno;

    const chiave = `fingerprint.seed:${profiloId}`;
    let semePersistito: string | null = null;
    try {
        semePersistito = await getRuntimeFlag(chiave);
    } catch (errore) {
        void logWarn('browser.fingerprint_seed_read_failed', { profiloId, errore: String(errore) });
        return semeOdierno; // fail-safe: su una lettura incerta non si scrive e non si cambia nulla
    }

    const giaAutenticata = sessioneGiaAutenticata(sessionDir);
    const esito = risolviSemeFingerprint({
        semePersistito,
        profiloId,
        // `sessionDir` per la regola è «il seme storico di fatto», che con un accountId esplicito
        // non è la cartella ma quell'id: è il valore che LinkedIn ha già visto.
        sessionDir: semeOdierno,
        sessioneGiaAutenticata: giaAutenticata,
    });

    if (esito.daPersistere !== null) {
        try {
            await setRuntimeFlag(chiave, esito.daPersistere);
            void logInfo('browser.fingerprint_seed_frozen', {
                profiloId,
                // MAI il valore: può essere un percorso assoluto. Basta sapere quale ramo ha deciso —
                // e il ramo è questo, non un confronto col valore (con un accountId esplicito il seme
                // odierno COINCIDE col profiloId, e il confronto direbbe il falso).
                daSessioneEsistente: giaAutenticata,
            });
        } catch (errore) {
            // Il seme in uso resta quello odierno ⇒ nessun cambio di dispositivo; si riproverà al
            // prossimo avvio. Silenziarlo nasconderebbe un flag che non si fissa mai.
            void logWarn('browser.fingerprint_seed_write_failed', { profiloId, errore: String(errore) });
        }
    }
    return esito.seme;
}
