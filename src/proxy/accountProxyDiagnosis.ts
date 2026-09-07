/**
 * accountProxyDiagnosis.ts — «il proxy di QUESTO account funziona?», con una risposta sola.
 * (C26 del contratto `bot-operativo`, chunk 4.)
 *
 * Prima di questo file la stessa domanda aveva tre risposte diverse: `checkProxyHealth` restituisce un
 * booleano secco (`preflightEnv.ts:100`), `runFullProxyDiagnostic` guarda il pool GLOBALE e non sa nulla
 * degli account (`proxyManager.ts:919`), `getProxyAsync` in fondo restituisce `refreshedChain[0]` senza
 * averlo verificato (`proxyManager.ts:640`). Tre verita' per un fatto solo: chi legge non sa quale credere.
 *
 * Qui i guasti restano DISTINTI, perche' hanno rimedi diversi:
 *  - `tcp: false`   -> il proxy non risponde proprio: rete, host o porta;
 *  - `auth: false`  -> risponde ma rifiuta le credenziali (407): non e' un guasto di rete, e' una password;
 *  - `egress.ok`    -> la richiesta esce davvero e torna un IP (502 o silenzio = non si esce);
 *  - `sticky: false`-> si esce, ma l'IP CAMBIA fra due richieste ravvicinate.
 *
 * Anti-ban — perche' `sticky` e' un guasto di primo livello e non un dettaglio: su LinkedIn la rotazione
 * dell'IP a meta' sessione invalida la sessione, e la forma corretta e' una sticky per account (10-30
 * minuti), che e' gia' la configurazione del progetto. Un pool che ruota mentre il bot lavora produce
 * esattamente il segnale da evitare — una persona sola che si collega da due posti in pochi secondi.
 * Perimetro delle sonde: al massimo DUE richieste, verso l'endpoint di eco IP gia' in uso nel repo
 * (`scripts/webrtcLeakCheck.ts:32`), MAI verso linkedin.com. E' un PRE-flight: non va lanciato mentre
 * una sessione del bot e' viva, perche' consumerebbe la finestra sticky di quell'account.
 */
import http from 'http';
import { URL } from 'url';

/** Endpoint di eco IP gia' adottato dal repo per le verifiche di uscita: non tocca LinkedIn. */
const EGRESS_ECHO_URL = 'http://api.ipify.org?format=json';
const DEFAULT_TIMEOUT_MS = 5000;

export interface DiagnosisProxy {
    server: string;
    username?: string;
    password?: string;
}

export interface EgressProbeResult {
    status: number;
    body: string;
}

export interface AccountProxyDeps {
    /** Il proxy che QUESTO account userebbe davvero (sticky incluso), o null se non ne ha. */
    selectProxy(accountId: string): DiagnosisProxy | null;
    poolSize(accountId: string): { total: number; usable: number };
    timeoutMs?: number;
    /** Iniettabile nei test; il default esce davvero, passando dal proxy. */
    probeEgress?(proxy: DiagnosisProxy, timeoutMs: number): Promise<EgressProbeResult>;
}

/** Perche' la diagnosi si e' fermata. `null` = tutto verde. */
export type DiagnosisReason = 'no-proxy' | 'tcp' | 'auth' | 'egress' | 'timeout' | 'sticky';

export interface AccountProxyDiagnosis {
    accountId: string;
    pool: { total: number; usable: number };
    /** Host e porta del proxy scelto, MAI le credenziali (il risultato finisce in log e JSON). */
    selected: string | null;
    tcp: boolean;
    auth: boolean;
    egress: { ok: boolean; ip?: string };
    /** L'IP di uscita e' lo stesso in due richieste ravvicinate. `null` se non si e' arrivati a misurarlo. */
    sticky: boolean | null;
    reason: DiagnosisReason | null;
}

/** Host:porta senza credenziali: questo valore viene stampato e loggato. */
export function maskProxyTarget(server: string): string {
    try {
        const url = new URL(server);
        return `${url.protocol}//${url.host}`;
    } catch {
        return server.replace(/\/\/[^@/]*@/, '//');
    }
}

class ProbeTimeout extends Error {
    constructor() {
        super('timeout');
        this.name = 'ProbeTimeout';
    }
}

/** Una richiesta HTTP in forma assoluta ATTRAVERSO il proxy: e' cosi' che si misura l'uscita vera. */
function probeEgressViaProxy(proxy: DiagnosisProxy, timeoutMs: number): Promise<EgressProbeResult> {
    return new Promise<EgressProbeResult>((resolve, reject) => {
        let proxyUrl: URL;
        try {
            proxyUrl = new URL(proxy.server);
        } catch {
            reject(new Error(`server proxy non valido: ${maskProxyTarget(proxy.server)}`));
            return;
        }
        const headers: Record<string, string> = { Host: new URL(EGRESS_ECHO_URL).host };
        if (proxy.username !== undefined || proxy.password !== undefined) {
            const raw = `${proxy.username ?? ''}:${proxy.password ?? ''}`;
            headers['Proxy-Authorization'] = `Basic ${Buffer.from(raw).toString('base64')}`;
        }
        const req = http.request(
            {
                host: proxyUrl.hostname,
                port: proxyUrl.port !== '' ? Number(proxyUrl.port) : 80,
                method: 'GET',
                path: EGRESS_ECHO_URL,
                headers,
                timeout: timeoutMs,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
            },
        );
        req.on('timeout', () => {
            req.destroy(new ProbeTimeout());
        });
        req.on('error', (error) => reject(error));
        req.end();
    });
}

function estraiIp(body: string): string | undefined {
    try {
        const parsed = JSON.parse(body) as { ip?: unknown };
        return typeof parsed.ip === 'string' ? parsed.ip : undefined;
    } catch {
        return undefined;
    }
}

function esito(base: Omit<AccountProxyDiagnosis, 'egress' | 'sticky' | 'reason'>, reason: DiagnosisReason): AccountProxyDiagnosis {
    return { ...base, egress: { ok: false }, sticky: null, reason };
}

/**
 * Diagnosi completa del proxy di un account. Non scrive nulla: ne' DB, ne' stato del pool, ne' file —
 * una diagnosi che modifica cio' che osserva non e' una diagnosi (e marcare qui un proxy come fallito
 * cambierebbe la scelta del prossimo lancio a partire da una sonda, non da una sessione vera).
 */
export async function diagnoseAccountProxy(accountId: string, deps: AccountProxyDeps): Promise<AccountProxyDiagnosis> {
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const probe = deps.probeEgress ?? probeEgressViaProxy;
    const pool = deps.poolSize(accountId);
    const proxy = deps.selectProxy(accountId);

    const base = { accountId, pool, selected: proxy === null ? null : maskProxyTarget(proxy.server), tcp: false, auth: false };
    // Senza proxy non c'e' nulla da sondare: nessuna richiesta parte (una sonda a vuoto costa e non dice nulla).
    if (proxy === null) return esito(base, 'no-proxy');

    let prima: EgressProbeResult;
    try {
        prima = await probe(proxy, timeoutMs);
    } catch (error) {
        const scaduto = error instanceof ProbeTimeout || (error as { code?: string }).code === 'ETIMEDOUT';
        // Il proxy non ha nemmeno risposto: distinguere «non raggiungibile» da «lento» cambia il rimedio.
        return esito({ ...base, tcp: !scaduto ? false : true }, scaduto ? 'timeout' : 'tcp');
    }

    // Ha risposto: il TCP c'e' per definizione. Il 407 e' il rifiuto delle CREDENZIALI, non un guasto di rete.
    if (prima.status === 407) return esito({ ...base, tcp: true }, 'auth');
    if (prima.status < 200 || prima.status >= 300) return esito({ ...base, tcp: true, auth: true }, 'egress');

    const ip = estraiIp(prima.body);
    if (ip === undefined) return esito({ ...base, tcp: true, auth: true }, 'egress');

    // Seconda sonda ravvicinata: se l'IP cambia, la stickiness e' rotta — su LinkedIn vale piu' di un errore.
    let sticky: boolean | null = null;
    try {
        const seconda = await probe(proxy, timeoutMs);
        const ipSeconda = estraiIp(seconda.body);
        sticky = ipSeconda === undefined ? null : ipSeconda === ip;
    } catch {
        sticky = null;
    }

    return {
        ...base,
        tcp: true,
        auth: true,
        egress: { ok: true, ip },
        sticky,
        reason: sticky === false ? 'sticky' : null,
    };
}

/** Profilo account nella forma minima che serve alla diagnosi (evita di legare questo file al runtime). */
export interface AccountLike {
    id: string;
    proxy?: DiagnosisProxy;
}

/**
 * Le stesse dipendenze per `preflight-env` e `config-validate`: e' questo che rende UNA la diagnosi.
 * Il pool si legge dallo stato reale del manager, importato a richiesta per non trascinare config e DB
 * dentro chi usa solo la funzione pura.
 */
export function accountProxyDepsFromRuntime(account: AccountLike): AccountProxyDeps {
    return {
        selectProxy: () => account.proxy ?? null,
        poolSize: () => {
            try {
                const { getProxyPoolStatus } = require('../proxyManager') as { getProxyPoolStatus: () => { total: number; ready: number } };
                const status = getProxyPoolStatus();
                return { total: status.total, usable: status.ready };
            } catch {
                return { total: 0, usable: 0 };
            }
        },
    };
}

/** Un guasto di credenziali non e' un guasto di rete: `WARN` dove si puo' ancora lavorare, `FAIL` dove no. */
export function proxyCheckStatus(reason: DiagnosisReason | null): 'OK' | 'WARN' | 'FAIL' {
    if (reason === null) return 'OK';
    // Nessun proxy configurato resta un avviso (la connessione diretta e' una scelta, non un guasto);
    // la stickiness rotta e' un avviso forte: si esce, ma la sessione LinkedIn non reggerebbe.
    return reason === 'no-proxy' || reason === 'sticky' ? 'WARN' : 'FAIL';
}

/** Frase leggibile senza credenziali: questo testo finisce nei log e nell'output dei comandi. */
export function describeProxyDiagnosis(d: AccountProxyDiagnosis): string {
    const dove = d.selected ?? 'nessun proxy';
    switch (d.reason) {
        case null:
            return `${dove} — uscita ${d.egress.ip ?? 'verificata'}, IP stabile (pool ${d.pool.usable}/${d.pool.total})`;
        case 'no-proxy':
            return 'Nessun proxy configurato — connessione diretta';
        case 'tcp':
            return `${dove} — NON raggiungibile (rete, host o porta)`;
        case 'timeout':
            return `${dove} — nessuna risposta entro il timeout`;
        case 'auth':
            return `${dove} — raggiungibile ma credenziali RIFIUTATE (407): non e' la rete, e' la password`;
        case 'egress':
            return `${dove} — autenticato ma non si esce (nessun IP di uscita)`;
        case 'sticky':
            return `${dove} — si esce (${d.egress.ip ?? '?'}) ma l'IP CAMBIA fra due richieste: stickiness rotta, la sessione LinkedIn non reggerebbe`;
    }
}
