/**
 * browser/proxyLaunchPlan.ts
 * ─────────────────────────────────────────────────────────────────
 * Pianificazione FAIL-CLOSED dei tentativi di launch del browser rispetto al proxy.
 * Logica pura (nessuna dipendenza Playwright) → testabile in isolamento.
 */

import type { ProxyConfig } from '../proxyManager';

export function isSameProxy(a: ProxyConfig | undefined, b: ProxyConfig | undefined): boolean {
    if (!a || !b) return false;
    return (
        a.server === b.server && (a.username ?? '') === (b.username ?? '') && (a.password ?? '') === (b.password ?? '')
    );
}

/**
 * Pianifica i tentativi di launch (ordine proxy) — FAIL-CLOSED sul leak IP (AB-24).
 * Un `undefined` in lista = connessione diretta (nessun proxy). È legittima SOLO quando il proxy
 * gestito NON è richiesto (nessuna config proxy, oppure bypassProxy/--allow-direct intenzionale).
 * Se invece il proxy gestito È richiesto ma non c'è nessun proxy disponibile (chain esaurita/KO),
 * NON si degrada a IP diretto — si lancia un errore, per non esporre l'IP reale dell'utente a
 * LinkedIn (il leak anti-ban peggiore). Coerente con la protezione AB-24 di createProfile.
 */
export function buildProxyLaunchPlan(params: {
    explicitProxy?: ProxyConfig;
    managedProxyEnabled: boolean;
    stickyProxy?: ProxyConfig;
    /** Assente = nessun candidato: il fail-closed diventa piu' severo, mai piu' permissivo. */
    failoverChain?: ProxyConfig[];
    /** C26: obbligatori, non opzionali — un default silenzioso qui e' esattamente il fail-open da evitare. */
    requireProxyForAuth: boolean;
    sessionHasCookies: boolean;
    /** Uscita ESPLICITA per i flussi legittimamente diretti (create-profile su IP fresco, diagnostica). */
    allowDirectIp?: boolean;
}): Array<ProxyConfig | undefined> {
    const { explicitProxy, managedProxyEnabled, stickyProxy, requireProxyForAuth, sessionHasCookies, allowDirectIp } =
        params;
    const failoverChain = params.failoverChain ?? [];
    // C26: una sessione che HA gia' cookie e' una sessione autenticata. Se la policy chiede il proxy
    // per l'autenticazione, la connessione diretta non e' rappresentabile in nessun piano: senza
    // questa riga bastava NON configurare alcun proxy (`managedProxyEnabled=false`) per ottenere
    // `[undefined]` e uscire dall'IP reale con i cookie di LinkedIn addosso — la configurazione che
    // chiede piu' sicurezza era quella che degradava per prima.
    const direttaVietata = requireProxyForAuth && sessionHasCookies && allowDirectIp !== true;
    if (explicitProxy) {
        return [explicitProxy];
    }
    if (!managedProxyEnabled) {
        if (direttaVietata) {
            throw new Error(
                'AB1: connessione diretta rifiutata su sessione autenticata (la sessionDir ha gia\' cookie) ' +
                    'con REQUIRE_PROXY_FOR_AUTH=true — nessun proxy configurato non e\' un permesso a uscire ' +
                    "dall'IP reale. Configura un proxy residenziale/mobile (bot.ps1 proxy-status), oppure usa " +
                    'un flusso con allowDirectIp (create-profile / diagnostica), oppure disattiva ' +
                    'REQUIRE_PROXY_FOR_AUTH se la diretta e\' voluta.',
            );
        }
        // Connessione diretta INTENZIONALE (nessun proxy gestito richiesto).
        return [undefined];
    }
    const plan: Array<ProxyConfig | undefined> = [];
    if (stickyProxy) {
        plan.push(stickyProxy);
    }
    for (const candidate of failoverChain) {
        if (!isSameProxy(candidate, stickyProxy)) {
            plan.push(candidate);
        }
    }
    if (plan.length === 0) {
        throw new Error(
            'AB-24: proxy gestito configurato ma nessun proxy disponibile (failover chain vuota) — ' +
                "avvio annullato per non esporre l'IP diretto a LinkedIn. " +
                'Verifica i proxy (bot.ps1 proxy-status) o usa bypassProxy/--allow-direct per una ' +
                'connessione diretta intenzionale.',
        );
    }
    return plan;
}
