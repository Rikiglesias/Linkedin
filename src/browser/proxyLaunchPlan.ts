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
    failoverChain: ProxyConfig[];
}): Array<ProxyConfig | undefined> {
    const { explicitProxy, managedProxyEnabled, stickyProxy, failoverChain } = params;
    if (explicitProxy) {
        return [explicitProxy];
    }
    if (!managedProxyEnabled) {
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
                'Verifica i proxy (npm run proxy:doctor) o usa bypassProxy/--allow-direct per una ' +
                'connessione diretta intenzionale.',
        );
    }
    return plan;
}
