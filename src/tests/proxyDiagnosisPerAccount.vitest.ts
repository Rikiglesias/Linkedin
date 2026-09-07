/**
 * proxyDiagnosisPerAccount.vitest.ts — C26 chunk 4 del contratto `bot-operativo` (blocco A).
 *
 * Oggi la stessa domanda («il proxy di questo account funziona?») ha TRE risposte diverse nel codice:
 * `preflight-env` chiama `checkProxyHealth` e ottiene un booleano secco (`preflightEnv.ts:100`),
 * `config-validate` chiama `runFullProxyDiagnostic` che e' GLOBALE e non sa nulla degli account
 * (`proxyManager.ts:919`), e `getProxyAsync` prova la catena e in fondo restituisce comunque
 * `refreshedChain[0]` senza averlo verificato (`proxyManager.ts:640`). Tre verita' per un solo fatto.
 *
 * Qui si verifica l'unica funzione che le sostituisce, e soprattutto che i suoi campi siano DISTINTI:
 * un proxy raggiungibile ma con credenziali rifiutate (407) non e' «un proxy che funziona a meta'» —
 * e' un proxy da cui NON si esce, e va detto con quella parola. Il booleano secco di oggi non lo puo'
 * dire, ed e' per questo che un guasto di autenticazione somiglia a un guasto di rete.
 *
 * I quattro guasti sono provati contro un proxy HTTP LOCALE vero (nessun mock del trasporto): 407,
 * 502, silenzio (timeout) e IP di uscita che cambia fra due richieste — l'ultimo e' il segnale che la
 * stickiness si e' rotta, che su LinkedIn vale piu' di un errore: la rotazione a meta' sessione
 * invalida la sessione stessa (fonti 2026 convergenti: torchproxies, Apify, businessage).
 */
import fsSync from 'fs';
import http from 'http';
import pathSync from 'path';
import type { AddressInfo } from 'net';
import { afterEach, describe, it, expect } from 'vitest';
import { diagnoseAccountProxy, type AccountProxyDeps } from '../proxy/accountProxyDiagnosis';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const servers: http.Server[] = [];

/** Proxy HTTP locale: riceve richieste in forma assoluta, come un proxy vero. */
async function proxyLocale(handler: Handler): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
    while (servers.length > 0) {
        const server = servers.pop();
        if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

function deps(proxyServer: string | null, over: Partial<AccountProxyDeps> = {}): AccountProxyDeps {
    return {
        selectProxy: () => (proxyServer === null ? null : { server: proxyServer, username: 'u', password: 'p' }),
        poolSize: () => (proxyServer === null ? { total: 0, usable: 0 } : { total: 3, usable: 2 }),
        timeoutMs: 400,
        ...over,
    };
}

describe('C26/4 — diagnosi proxy per account, campi distinti', () => {
    it('407 sul proxy: raggiungibile e autenticazione RIFIUTATA, quindi nessuna uscita', async () => {
        const server = await proxyLocale((_req, res) => {
            res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="proxy"' });
            res.end();
        });
        const d = await diagnoseAccountProxy('default', deps(server));
        expect(d.tcp).toBe(true);
        expect(d.auth).toBe(false);
        expect(d.egress.ok).toBe(false);
        expect(d.reason).toBe('auth');
    });

    it('502 dal proxy: autenticazione passata ma uscita rotta — auth e egress non si confondono', async () => {
        const server = await proxyLocale((_req, res) => {
            res.writeHead(502);
            res.end();
        });
        const d = await diagnoseAccountProxy('default', deps(server));
        expect(d.tcp).toBe(true);
        expect(d.auth).toBe(true);
        expect(d.egress.ok).toBe(false);
        expect(d.reason).toBe('egress');
    });

    it('proxy che non risponde: timeout, mai attesa infinita', async () => {
        const server = await proxyLocale(() => {
            /* silenzio deliberato: la richiesta resta appesa */
        });
        const inizio = Date.now();
        const d = await diagnoseAccountProxy('default', deps(server));
        expect(d.egress.ok).toBe(false);
        expect(d.reason).toBe('timeout');
        expect(Date.now() - inizio).toBeLessThan(4000);
    });

    it('IP di uscita che CAMBIA fra due richieste: stickiness rotta, segnalata come tale', async () => {
        let chiamate = 0;
        const server = await proxyLocale((_req, res) => {
            chiamate += 1;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ip: chiamate === 1 ? '203.0.113.10' : '203.0.113.99' }));
        });
        const d = await diagnoseAccountProxy('default', deps(server));
        expect(d.egress.ok).toBe(true);
        expect(d.egress.ip).toBe('203.0.113.10');
        expect(d.sticky).toBe(false);
        expect(d.reason).toBe('sticky');
    });

    it('proxy sano e IP stabile: tutti i campi verdi, nessun reason', async () => {
        const server = await proxyLocale((_req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ip: '203.0.113.10' }));
        });
        const d = await diagnoseAccountProxy('default', deps(server));
        expect(d).toMatchObject({ tcp: true, auth: true, sticky: true, reason: null });
        expect(d.egress).toMatchObject({ ok: true, ip: '203.0.113.10' });
        expect(d.pool).toEqual({ total: 3, usable: 2 });
        expect(d.selected).not.toBeNull();
    });

    it('nessun proxy per l account: pool a zero e diagnosi esplicita, senza sonde di rete', async () => {
        let sondato = false;
        const d = await diagnoseAccountProxy('default', {
            ...deps(null),
            probeEgress: async () => {
                sondato = true;
                return { status: 200, body: '{}' };
            },
        });
        expect(d.selected).toBeNull();
        expect(d.reason).toBe('no-proxy');
        expect(d.egress.ok).toBe(false);
        expect(sondato, 'senza proxy non c e nulla da sondare').toBe(false);
    });

    it('UNA funzione, DUE consumatori: preflight-env e config-validate non ricalcolano per conto loro', () => {
        const leggi = (...p: string[]): string => fsSync.readFileSync(pathSync.resolve(__dirname, '..', ...p), 'utf8');
        const preflight = leggi('cli', 'commands', 'preflightEnv.ts');
        const admin = leggi('cli', 'commands', 'adminCommands.ts');
        expect(preflight).toContain('diagnoseAccountProxy');
        expect(admin).toContain('diagnoseAccountProxy');
        // Il vecchio booleano secco non deve tornare: era lui a far somigliare un guasto di
        // credenziali a un guasto di rete (`preflightEnv.ts:100`, prima di C26/4).
        expect(preflight).not.toContain('checkProxyHealth');
    });

    it('il risultato non porta credenziali: niente password ne user:pass nell URL', async () => {
        const server = await proxyLocale((_req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ip: '203.0.113.10' }));
        });
        const d = await diagnoseAccountProxy('default', deps(server));
        const serializzato = JSON.stringify(d);
        expect(serializzato).not.toContain('password');
        expect(serializzato).not.toMatch(/:\/\/[^@"]*:[^@"]*@/);
    });
});
