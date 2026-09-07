/**
 * loginFailureHandler.ts — applica la reazione decisa da `resolveLoginFailureAction`.
 * (C27 del contratto `bot-operativo`, blocco A.)
 *
 * La politica (`browser/loginFailurePolicy.ts`) e' pura; qui stanno gli effetti: incident, pausa,
 * quarantena, proxy. E' l'UNICO punto che li applica per un login fallito — canary, job runner,
 * probe del feed e listener voyager del launcher passano tutti di qui, cosi' lo stesso 429 non
 * puo' piu' produrre tre reazioni diverse.
 *
 * Regole:
 * - UN incident per evento. Sul logout lo crea `quarantineAccount` (CRITICAL) e la pausa si scrive
 *   a livello repository, senza un secondo incident WARN; sul throttling lo crea `pauseAutomation`
 *   (WARN, con il backoff 2^n che applica lei stessa ai type che contengono `429`); sull'esito
 *   ignoto nessun incident — un guasto di rete di pochi secondi non merita un alert Telegram.
 * - Il proxy si tocca DOPO la pausa e solo se la politica lo chiede. `releaseStickyProxy` dimentica
 *   l'associazione in memoria per il PROSSIMO lancio: il browser aperto tiene il suo IP fino alla
 *   chiusura (cambiare IP a sessione viva e' proprio il segnale che si vuole evitare). Il cooldown
 *   di `markProxyFailed` resta quello di default sul throttling (soglie invariate rispetto al
 *   listener voyager storico) e quello breve `timeout` (5') sul guasto di proxy.
 */
import path from 'path';
import type { Page } from 'playwright';
import type { ProxyConfig } from '../proxy/types';
import { resolveLoginFailureAction, type LoginCheckOutcome, type LoginFailureAction } from '../browser/loginFailurePolicy';
import { checkLoginDetailed } from '../browser/auth';
import { config } from '../config';
import { pauseAutomation, quarantineAccount } from './incidentManager';
import { setAutomationPause } from '../core/repositories';
import { markProxyFailed, releaseStickyProxy } from '../proxyManager';
import { logWarn } from '../telemetry/logger';

export interface LoginFailureContext {
    /** Account a cui attribuire incident e quarantena. Assente = non attribuibile → flag globale (fail-safe). */
    accountId?: string;
    /** Directory del profilo: e' la chiave dello sticky proxy (`getStickyProxy(sessionDir, …)`). */
    sessionDir?: string;
    /** Proxy in uso nella sessione, per il cooldown. */
    proxy?: ProxyConfig | null;
    /** Chi ha osservato il fallimento: `canary`, `job_runner.session`, `job_runner.probe`, `voyager_response`. */
    source: string;
    details?: Record<string, unknown>;
}

/**
 * Il controllo di sessione PRIMA di un lavoro lungo (sync SalesNav, sync ricerca), con la reazione
 * gia' applicata quando serve.
 *
 * Perche' esiste: il booleano storico `checkLogin` collassa su `false` anche `throttled` (429/403) e
 * `unknown` (rete muta). Chi lo usava trattava quel `false` da «cookie scaduti» e chiamava
 * `awaitManualLogin`, che decide guardando la NAVBAR e il cookie (`isLoggedIn`): sotto un 429 il
 * cookie c'e' ancora, quindi tornava `true` in pochi secondi e il lavoro RIPRENDEVA proprio mentre
 * LinkedIn chiedeva di rallentare — dopo aver anche navigato a `/login`. E' il difetto che C27
 * dichiara chiuso, rimasto su due chiamanti che non passavano dalla politica.
 *
 * Contratto: ritorna l'esito REALE. Su `throttled`/`two-factor`/`unknown` la reazione (incident,
 * pausa, quarantena, proxy) e' gia' stata applicata qui e il chiamante deve solo fermarsi; su
 * `logged-out` non si applica nulla, perche' li' il rimedio e' il login — manuale se c'e' un umano,
 * altrimenti lo decide il chiamante.
 */
export async function valutaSessionePrimaDelLavoro(page: Page, ctx: LoginFailureContext): Promise<LoginCheckOutcome> {
    const esito = await checkLoginDetailed(page, ctx.accountId ? { accountId: ctx.accountId } : {});
    if (esito.state === 'logged-in' || esito.state === 'logged-out') {
        return esito;
    }
    await applyLoginFailureAction(
        resolveLoginFailureAction(esito, { autoPauseMinutes: config.autoPauseMinutesOnFailureBurst }),
        ctx,
    );
    return esito;
}

export async function applyLoginFailureAction(action: LoginFailureAction, ctx: LoginFailureContext): Promise<void> {
    if (action.reason === 'ok') return;

    const details: Record<string, unknown> = {
        ...(ctx.details ?? {}),
        source: ctx.source,
        message: action.message,
        ...(ctx.accountId ? { accountId: ctx.accountId } : {}),
    };

    if (action.quarantine) {
        await quarantineAccount(action.incidentType ?? action.reason, details);
        if (action.pauseMinutes !== null) {
            await setAutomationPause(action.pauseMinutes, action.reason, 'SYSTEM');
        }
    } else if (action.pauseMinutes !== null) {
        if (action.incidentType) {
            await pauseAutomation(action.incidentType, details, action.pauseMinutes);
        } else {
            await setAutomationPause(action.pauseMinutes, action.reason, 'SYSTEM');
            await logWarn('login_check.paused_without_incident', { ...details, pauseMinutes: action.pauseMinutes });
        }
    }

    if (action.releaseProxy) {
        if (ctx.proxy) {
            markProxyFailed(ctx.proxy, action.reason === 'login_check_unknown' ? 'timeout' : undefined);
        }
        if (ctx.sessionDir) {
            // Stessa chiave che usa il launcher: la sessionDir RISOLTA (`launcher.ts` la assolutizza).
            releaseStickyProxy(path.resolve(ctx.sessionDir));
        }
    }
}
