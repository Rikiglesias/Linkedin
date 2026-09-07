/**
 * loginFailurePolicy.ts — perche' il login non e' andato, e cosa farne. Una causa, una reazione.
 * (C27 del contratto `bot-operativo`, blocco A.)
 *
 * Prima di questo file `checkLogin` rispondeva `false` in tre situazioni che non hanno nulla in
 * comune: sessione davvero scaduta, LinkedIn che risponde 429/403, rete o proxy che non rispondono.
 * Chi leggeva quel `false` (`workflowEntryGuards.ts:112`) concludeva sempre «sloggato» e metteva
 * l'account in quarantena chiedendo `bot.ps1 login`. Su un rate-limit quella e' la reazione
 * peggiore: autenticarsi di nuovo mentre la piattaforma sta gia' limitando aggiunge segnali
 * proprio nel momento in cui serve sparire. Ed era anche incoerente — lo stesso 429 letto dal probe
 * del feed, da `checkLogin` o dalla chiamata voyager produceva tre reazioni diverse (pausa
 * `LINKEDIN_PRE_THROTTLED`, quarantena, proxy bruciato).
 *
 * Qui la causa diventa un DATO tipizzato e la politica una funzione pura, cosi' i tre punti di
 * lettura non possono piu' divergere: chi osserva classifica (`checkLoginDetailed`,
 * `probeLinkedInStatus`, il listener voyager del launcher), questa funzione decide, e UN solo
 * handler applica (`risk/loginFailureHandler.ts`).
 *
 * Anti-ban: sul throttling si sceglie la reazione piu' conservativa — pausa lunga (default REALE
 * `autoPauseMinutesOnFailureBurst` = 180, `domains.ts:68`) con backoff `2^n` applicato a valle da
 * `incidentManager.ts:120-126` per i type che contengono `429`, piu' il rilascio dello sticky proxy.
 * Il proxy si rilascia DOPO la pausa, mai a sessione aperta: cambiare IP a meta' sessione la
 * invaliderebbe, ed e' il segnale opposto a quello che si vuole dare.
 */

/** Cosa e' successo davvero al controllo di sessione. */
export type LoginCheckOutcome =
    | { state: 'logged-in' }
    | { state: 'logged-out' }
    /**
     * LinkedIn chiede la verifica in due passaggi: la sessione non e' scaduta, manca un umano.
     * `quarantineApplied` dice se chi ha VISTO la pagina e' riuscito a scrivere la quarantena:
     * `false` significa che la scrittura e' fallita e la reazione va rifatta qui, altrimenti
     * l'account resta libero con una challenge pendente e il ciclo dopo ci rientra dentro.
     */
    | { state: 'two-factor'; quarantineApplied: boolean }
    /** Non lo sappiamo: la richiesta non e' arrivata a destinazione. Non e' una sessione scaduta. */
    | { state: 'unknown'; cause: 'timeout' | 'network' | 'proxy' }
    /** La piattaforma ha risposto, e ha detto di rallentare o ha bloccato. */
    | { state: 'throttled'; status: 429 | 403 };

export interface LoginFailureAction {
    /** Nome del ramo: e' anche il `blockReason` mostrato e il type dell'incident quando ce n'e' uno. */
    reason: 'ok' | 'LOGIN_REQUIRED' | 'LOGIN_2FA_REQUIRED' | 'login_check_unknown' | 'HTTP_429_RATE_LIMIT' | 'HTTP_403_BLOCKED';
    incidentType: string | null;
    /** `null` = nessuna pausa. Il backoff sul 429 lo applica `incidentManager`, non questa funzione. */
    pauseMinutes: number | null;
    quarantine: boolean;
    /** Rilasciare lo sticky proxy dell'account (solo sul throttling, e a sessione gia' chiusa). */
    releaseProxy: boolean;
    /** Frase per l'operatore: dice COSA fare, non solo cosa e' successo. */
    message: string;
}

/** Pausa del ramo IGNOTO: breve per costruzione — non sappiamo se ci sia un problema davvero. */
export const UNKNOWN_PAUSE_MINUTES = 15;
/** Pausa del logout esplicito: l'account resta fermo finche' un umano rifa' il login. */
export const LOGGED_OUT_PAUSE_MINUTES = 60;
/** Pavimento anti-ban del throttling: sotto questa soglia non si scende, qualunque sia la config. */
export const THROTTLED_MIN_PAUSE_MINUTES = 180;

export interface LoginFailurePolicyOptions {
    /** `config.autoPauseMinutesOnFailureBurst` (default reale 180). Mai un letterale al call-site. */
    autoPauseMinutes: number;
}

/**
 * Dalla causa all'azione. Funzione pura: nessun I/O, nessuna scrittura — cosi' i tre punti di
 * osservazione condividono la stessa decisione invece di ricavarsene una a testa.
 */
export function resolveLoginFailureAction(outcome: LoginCheckOutcome, opts: LoginFailurePolicyOptions): LoginFailureAction {
    switch (outcome.state) {
        case 'logged-in':
            return { reason: 'ok', incidentType: null, pauseMinutes: null, quarantine: false, releaseProxy: false, message: 'Sessione attiva' };

        case 'logged-out':
            return {
                reason: 'LOGIN_REQUIRED',
                incidentType: 'LOGIN_REQUIRED',
                pauseMinutes: LOGGED_OUT_PAUSE_MINUTES,
                quarantine: true,
                releaseProxy: false,
                message:
                    'Sessione LinkedIn non autenticata (cookie li_at assente) — eseguire `bot.ps1 login`, poi `bot.ps1 unquarantine`',
            };

        case 'two-factor':
            // La quarantena per-account, l'incident e l'alert li applica gia' chi ha VISTO la pagina di
            // verifica (`checkLoginDetailed`): devono valere anche per chi usa il booleano `checkLogin`
            // e non passa di qui. Ripeterli qui li raddoppierebbe — MA solo se sono davvero riusciti.
            // Quando `quarantineApplied` e' false quella scrittura e' fallita: qui c'e' la seconda
            // rete, altrimenti il bot rientrerebbe nella challenge a ogni ciclo con l'account libero.
            return {
                reason: 'LOGIN_2FA_REQUIRED',
                incidentType: outcome.quarantineApplied ? null : 'LOGIN_2FA_REQUIRED',
                pauseMinutes: null,
                quarantine: !outcome.quarantineApplied,
                releaseProxy: false,
                message: 'LinkedIn richiede la verifica 2FA: completarla nel browser, poi `bot.ps1 unquarantine`',
            };

        case 'unknown':
            // Nessuna quarantena e nessuna pausa lunga: punire l'account per un guasto di rete
            // significa fermarlo per ore per un problema che spesso dura secondi.
            return {
                reason: 'login_check_unknown',
                incidentType: null,
                pauseMinutes: UNKNOWN_PAUSE_MINUTES,
                quarantine: false,
                releaseProxy: outcome.cause === 'proxy',
                message: `Stato della sessione non verificabile (${outcome.cause}): nuova verifica fra ${UNKNOWN_PAUSE_MINUTES} minuti`,
            };

        case 'throttled': {
            const rateLimited = outcome.status === 429;
            const pausa = Math.max(opts.autoPauseMinutes, THROTTLED_MIN_PAUSE_MINUTES);
            return {
                reason: rateLimited ? 'HTTP_429_RATE_LIMIT' : 'HTTP_403_BLOCKED',
                incidentType: rateLimited ? 'HTTP_429_RATE_LIMIT' : 'HTTP_403_BLOCKED',
                // Mai una pausa breve e mai la quarantena: la sessione e' valida, e' la piattaforma
                // che chiede di sparire per un po'. Rifare il login qui peggiorerebbe le cose.
                pauseMinutes: pausa,
                quarantine: false,
                releaseProxy: true,
                message: rateLimited
                    ? `LinkedIn ha risposto 429 (rate limit): pausa di almeno ${pausa} minuti e proxy rilasciato — NON rifare il login`
                    : `LinkedIn ha risposto 403 (accesso bloccato): pausa di almeno ${pausa} minuti e proxy rilasciato — NON rifare il login`,
            };
        }
    }
}

/** Lo status HTTP visto da `checkLogin` diventa una causa, non un booleano. */
export function classifyCheckLoginStatus(status: number, loggedIn = false): LoginCheckOutcome {
    if (status === 429 || status === 403) return { state: 'throttled', status: status as 429 | 403 };
    if (loggedIn) return { state: 'logged-in' };
    return { state: 'logged-out' };
}

/** Stesso trattamento per la chiamata voyager: e' lo stesso 429, quindi e' lo stesso outcome. */
export function classifyVoyagerStatus(status: number): LoginCheckOutcome {
    return classifyCheckLoginStatus(status);
}

/**
 * Un `goto` fallito diventa una causa: la pagina non e' MAI arrivata, quindi sullo stato della
 * sessione non sappiamo nulla. Il proxy si riconosce dal messaggio (`ERR_PROXY_*`, `ERR_TUNNEL_*`)
 * e vince sul timeout: un timeout "connecting to proxy" e' un guasto del proxy.
 */
export function classifyNavigationError(error: unknown): LoginCheckOutcome {
    const msg = error instanceof Error ? error.message : String(error);
    if (/proxy|ERR_TUNNEL/i.test(msg)) return { state: 'unknown', cause: 'proxy' };
    if (/timed?[_ ]?out|ETIMEDOUT/i.test(msg)) return { state: 'unknown', cause: 'timeout' };
    return { state: 'unknown', cause: 'network' };
}

/** Il `reason` testuale del probe del feed (`probeLinkedInStatus`) mappato sulla stessa scala. */
export function classifyProbeReason(reason: string | null): LoginCheckOutcome {
    if (reason === null) return { state: 'logged-in' };
    if (reason.includes('429')) return { state: 'throttled', status: 429 };
    if (reason.includes('403')) return { state: 'throttled', status: 403 };
    if (reason === 'SESSION_EXPIRED') return { state: 'logged-out' };
    // `PROBE_ERROR: …` copre timeout di navigazione, DNS, proxy caduto: stessa scala del `goto` fallito.
    if (reason.startsWith('PROBE_ERROR')) return classifyNavigationError(reason);
    if (reason === 'SLOW_RESPONSE') return { state: 'unknown', cause: 'timeout' };
    return { state: 'unknown', cause: 'network' };
}
