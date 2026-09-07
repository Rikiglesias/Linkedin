/**
 * preflightEngineLock.ts — C52 del contratto `bot-operativo`: l'engine è bloccato per la vita del profilo.
 *
 * Il check di `preflight-env` che rispecchia la guardia del launcher (`browserIdentity.ts`, `IDENTITY_ENGINE_MISMATCH`)
 * PRIMA di qualunque lancio, e in più applica la regola del contratto sul profilo AUTENTICATO (cookie jar presente):
 *  - `BROWSER_ENGINE` assente ⇒ default `chromium` ⇒ FAIL con la riga esatta da mettere in configurazione;
 *  - `chromium` ⇒ FAIL (non è un engine per una sessione autenticata: C52/C60), la via è un profilo NUOVO su Camoufox;
 *  - nessun `.fingerprint.json` ⇒ FAIL (LinkedIn ha già visto un dispositivo qui: `identity-init --new-session`).
 * Un lancio Chromium su un profilo Gecko non «ruba» il cookie: crea un profilo vergine con un device DIVERSO sotto lo
 * stesso account — è quello il danno che il check previene. Funzione pura (filesystem a parte): niente `config`.
 */
import {
    IDENTITY_FILE_NAME,
    IDENTITY_FIX_COMMAND,
    profileHasCookies,
    readBrowserIdentity,
    type IdentityEngine,
    type PersistedBrowserIdentity,
} from '../../browser/browserIdentity';

export const RECOMMENDED_ENGINE: IdentityEngine = 'camoufox';

export interface EngineLockInput {
    accountId: string;
    sessionDir: string;
    /** `process.env.BROWSER_ENGINE` così com'è (undefined/vuoto = non impostato). */
    rawBrowserEngine: string | undefined;
    /** L'engine RISOLTO dalla config (default `chromium` quando la chiave manca). */
    configuredEngine: IdentityEngine;
}

export interface EngineLockCheck {
    name: string;
    status: 'OK' | 'FAIL';
    detail: string;
}

const CONF = 'config/bot-settings.conf';

export function checkEngineLockPerProfile(input: EngineLockInput): EngineLockCheck {
    const name = `Browser engine ↔ profilo (${input.accountId})`;
    const fail = (detail: string): EngineLockCheck => ({ name, status: 'FAIL', detail });
    const rawNote = input.rawBrowserEngine?.trim() ? '' : ' [BROWSER_ENGINE non impostato → default chromium]';

    let identity: PersistedBrowserIdentity | null;
    try {
        identity = readBrowserIdentity(input.sessionDir);
    } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
    }
    if (identity && identity.engine !== input.configuredEngine) {
        return fail(
            `identità creata su ${identity.engine}, engine risolto ${input.configuredEngine}${rawNote}: l'engine non cambia sotto un profilo → ` +
                `imposta BROWSER_ENGINE=${identity.engine} in ${CONF} (un engine diverso richiede un profilo NUOVO: ${IDENTITY_FIX_COMMAND})`,
        );
    }
    if (!profileHasCookies(input.sessionDir)) {
        return {
            name,
            status: 'OK',
            detail: identity ? `profilo vergine, identità ${identity.engine} ${identity.engineBuild}` : 'profilo vergine, nessun vincolo',
        };
    }
    if (!identity) {
        return fail(
            `profilo autenticato senza ${IDENTITY_FILE_NAME}: LinkedIn ha già visto un dispositivo qui${rawNote} → ` +
                `${IDENTITY_FIX_COMMAND}, poi BROWSER_ENGINE=${RECOMMENDED_ENGINE} in ${CONF} e login sulla cartella nuova`,
        );
    }
    if (input.configuredEngine === 'chromium') {
        return fail(
            `chromium rifiutato su un profilo autenticato (C52/C60)${rawNote} → profilo NUOVO con ${IDENTITY_FIX_COMMAND}, ` +
                `BROWSER_ENGINE=${RECOMMENDED_ENGINE} in ${CONF}, poi login`,
        );
    }
    return { name, status: 'OK', detail: `${identity.engine} ${identity.engineBuild} (identità e cookie coerenti)` };
}
