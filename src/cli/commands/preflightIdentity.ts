/**
 * preflightIdentity.ts — `preflight-identity --offline [--account <id>] [--session-dir <path>]`
 * (C26 del contratto `bot-operativo`, chunk 3).
 *
 * Prima del login, una domanda sola: cio' che la PAGINA vede coincide con l'identita' che il profilo
 * dichiara nel suo `.fingerprint.json`? Due facce diverse sullo stesso profilo sono esattamente il
 * segnale che C23 (identita' persistita) e C24 (una sola identita' per pagina) esistono per evitare;
 * questo comando lo misura PRIMA che LinkedIn lo veda, non dopo.
 *
 * Anti-ban — perche' qui la connessione diretta e' legittima:
 *  - la misura avviene su `about:blank`, una pagina LOCALE: nessuna richiesta esce verso linkedin.com,
 *    quindi nessun IP viene mostrato alla piattaforma (il contratto: «mai su linkedin.com»);
 *  - proprio per questo il lancio passa `bypassProxy: true` e `allowDirectIp: true`, l'uscita ESPLICITA
 *    prevista dal fail-closed di C26/1: senza di essa la diagnostica sarebbe bloccata sul profilo con
 *    cookie, che e' il caso in cui serve di piu'. E' una deroga dichiarata, non un degrado silenzioso;
 *  - l'exit IP e il paese (`--proxy`) NON stanno qui: appartengono alla diagnosi proxy per account,
 *    dove c'e' il percorso di rete vero.
 * stdout = solo JSON (`jsonStdout.ts`).
 */
import { getAccountProfileById, getRuntimeAccountProfiles } from '../../accountManager';
import { readBrowserIdentity, type PersistedBrowserIdentity } from '../../browser/browserIdentity';
import { snapshotPage, type Snapshot } from '../../browser/identitySnapshot';
import { closeBrowser, launchBrowser } from '../../browser/launcher';
import { getOptionValue } from '../cliParser';
import { writeJsonResult } from '../jsonStdout';

/** Pagina LOCALE: `snapshotPage` costruisce da se' canvas e span, non serve una fixture servita in HTTP. */
const PAGINA_LOCALE = 'about:blank';

export interface PreflightIdentityTarget {
    sessionDir: string;
    accountId: string;
}

/** Iniettabili nel test: il bersaglio, la lettura del file identita' e la misura (che apre un browser vero). */
export interface PreflightIdentityDeps {
    resolveTarget(args: string[]): PreflightIdentityTarget;
    readIdentity(sessionDir: string): PersistedBrowserIdentity | null;
    observe(target: PreflightIdentityTarget): Promise<Snapshot>;
}

/** `--account <id>` sconosciuto: `getAccountProfileById` ricadrebbe sul PRIMO profilo — qui e' un errore. */
export class PreflightIdentityTargetError extends Error {
    constructor(
        readonly code: 'IDENTITY_ACCOUNT_UNKNOWN',
        message: string,
    ) {
        super(message);
        this.name = 'PreflightIdentityTargetError';
    }
}

export function resolvePreflightIdentityTarget(args: string[]): PreflightIdentityTarget {
    const requested = getOptionValue(args, '--account');
    const profile = getAccountProfileById(requested);
    if (requested !== undefined && profile.id !== requested) {
        const known = getRuntimeAccountProfiles().map((p) => p.id);
        throw new PreflightIdentityTargetError(
            'IDENTITY_ACCOUNT_UNKNOWN',
            `--account ${requested}: profilo sconosciuto (configurati: ${known.length > 0 ? known.join(', ') : 'default'})`,
        );
    }
    // `--session-dir` serve al caso NEGATIVO da artefatto: una cartella temporanea con un
    // `.fingerprint.json` incoerente, senza toccare il profilo vero e senza env di test nel binario.
    const override = getOptionValue(args, '--session-dir');
    return { sessionDir: override ?? profile.sessionDir, accountId: profile.id };
}

/** Misura dal path di PRODUZIONE (`launchBrowser` valida l'identita' come a ogni lancio), su pagina locale. */
async function observeWithRealBrowser(target: PreflightIdentityTarget): Promise<Snapshot> {
    const session = await launchBrowser({
        sessionDir: target.sessionDir,
        accountId: target.accountId,
        headless: true,
        bypassProxy: true,
        allowDirectIp: true,
        forceDesktop: true,
    });
    try {
        await session.page.goto(PAGINA_LOCALE);
        return await snapshotPage(session.page);
    } finally {
        await closeBrowser(session);
    }
}

const defaultDeps: PreflightIdentityDeps = {
    resolveTarget: resolvePreflightIdentityTarget,
    readIdentity: readBrowserIdentity,
    observe: observeWithRealBrowser,
};

export interface IdentityMismatch {
    field: 'userAgent' | 'timezone' | 'locale' | 'os';
    declared: string;
    observed: string;
}

/** Piattaforma dichiarata dal file identita' vs `navigator.platform` misurato nella pagina. */
const PLATFORM_PER_OS: Record<string, readonly string[]> = {
    windows: ['Win32', 'Win64'],
    macos: ['MacIntel'],
    linux: ['Linux x86_64', 'Linux'],
};

/** Confronto puro (nessun I/O): cosa il profilo DICHIARA contro cosa la pagina MOSTRA. */
export function compareIdentity(identity: PersistedBrowserIdentity, observed: Snapshot): IdentityMismatch[] {
    const mismatches: IdentityMismatch[] = [];
    if (identity.userAgent !== observed.userAgent) {
        mismatches.push({ field: 'userAgent', declared: identity.userAgent, observed: observed.userAgent });
    }
    // La timezone NON e' persistita nel `.fingerprint.json` reale (misurato: le chiavi scritte da
    // `identity-init` non la contengono) ed e' giusto cosi' — Camoufox la deriva da geoip, quindi
    // congelarla nel file la farebbe divergere dal proxy al primo cambio di uscita. Il confronto resta
    // per le identita' che la portano; la coerenza tz-vs-paese di uscita e' della diagnosi proxy.
    if (identity.timezone !== undefined && identity.timezone !== observed.timeZone) {
        mismatches.push({ field: 'timezone', declared: identity.timezone, observed: observed.timeZone });
    }
    const observedLocale = observed.languages[0];
    if (observedLocale !== undefined && identity.locale !== observedLocale) {
        mismatches.push({ field: 'locale', declared: identity.locale, observed: observedLocale });
    }
    const attese = PLATFORM_PER_OS[identity.os];
    if (attese !== undefined && !attese.some((p) => observed.platform.startsWith(p))) {
        mismatches.push({ field: 'os', declared: `${identity.os} (${attese.join('|')})`, observed: observed.platform });
    }
    return mismatches;
}

function fail(payload: Record<string, unknown>): void {
    writeJsonResult({ ok: false, ...payload });
    process.exitCode = 1;
}

export async function runPreflightIdentityCommand(args: string[], deps: PreflightIdentityDeps = defaultDeps): Promise<void> {
    let target: PreflightIdentityTarget;
    try {
        target = deps.resolveTarget(args);
    } catch (error) {
        fail({
            code: error instanceof PreflightIdentityTargetError ? error.code : 'PREFLIGHT_IDENTITY_FAILED',
            error: error instanceof Error ? error.message : String(error),
        });
        return;
    }

    // Senza identita' persistita non ci sono DUE facce da confrontare: si esce prima di aprire un browser.
    const identity = deps.readIdentity(target.sessionDir);
    if (identity === null) {
        fail({
            code: 'IDENTITY_FILE_MISSING',
            error: `${target.sessionDir} non ha .fingerprint.json: esegui prima "bot identity-init" (nessuna misura possibile)`,
            sessionDir: target.sessionDir,
        });
        return;
    }

    let observed: Snapshot;
    try {
        observed = await deps.observe(target);
    } catch (error) {
        fail({
            code: 'PREFLIGHT_IDENTITY_LAUNCH_FAILED',
            error: error instanceof Error ? error.message : String(error),
            sessionDir: target.sessionDir,
        });
        return;
    }

    const mismatches = compareIdentity(identity, observed);
    const coherent = mismatches.length === 0;
    writeJsonResult({
        ok: coherent,
        sessionDir: target.sessionDir,
        accountId: identity.accountId,
        engine: identity.engine,
        engineBuild: identity.engineBuild,
        os: identity.os,
        ua: observed.userAgent,
        tz: observed.timeZone,
        locale: observed.languages[0] ?? identity.locale,
        coherent,
        mismatches,
        page: PAGINA_LOCALE,
    });
    process.exitCode = coherent ? 0 : 1;
}
