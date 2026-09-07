/**
 * identityInit.ts — `identity-init [--new-session] [--account <id>] [--os <windows|macos|linux>]`
 * (C23 del contratto `bot-operativo`; il contratto completo del comando è C53).
 *
 * Crea UNA volta `<sessionDir>/.fingerprint.json` PRIMA del primo login: da lì in poi `login` e `send-invites`
 * leggono la stessa identità (il launcher la valida a ogni lancio). stdout = solo JSON (`jsonStdout.ts`).
 *  - `--os`: esiste per rendere esplicito e verificabile l'invariante — il valore DEVE essere l'host; qualunque
 *    altro valore = exit 1 senza scritture (font e WebGL del binario sono quelli dell'host);
 *  - `--new-session`: cartella NUOVA accanto a quella configurata (`<sessionDir>-<yyyyMMdd-HHmmss>`) e la riga da
 *    mettere in `config/bot-settings.conf`; senza flag, un profilo che ha già cookie viene RIFIUTATO (mai un device
 *    nuovo sotto un account già visto da LinkedIn);
 *  - idempotente: identità già presente e valida → `created: false`, exit 0;
 *  - `--account <id>` deve esistere in configurazione: sconosciuto = exit 1, 0 scritture (mai il fallback silenzioso
 *    sul primo profilo di `getAccountProfileById`).
 * Sugli engine da pool usa SOLO il pool locale (nessuna rete): su Camoufox (produzione) il pool non entra.
 */
import fs from 'fs';
import { getAccountProfileById, getRuntimeAccountProfiles } from '../../accountManager';
import {
    BrowserIdentityError,
    hostIdentityOs,
    identityFilePath,
    profileHasCookies,
    type IdentityOs,
    type PersistedBrowserIdentity,
} from '../../browser/browserIdentity';
import { ensureLaunchIdentity } from '../../browser/browserIdentityRuntime';
import { getOptionValue } from '../cliParser';
import { writeJsonResult } from '../jsonStdout';

export interface IdentityInitTarget {
    sessionDir: string;
    accountId: string;
    newSession: boolean;
}

/** Iniettabili nel test: la cartella bersaglio e la creazione (che tocca binario e browserforge). */
export interface IdentityInitDeps {
    resolveTarget(args: string[]): IdentityInitTarget;
    createIdentity(sessionDir: string, accountId: string): Promise<PersistedBrowserIdentity>;
    hostOs?: () => IdentityOs;
}

const VALID_OS: ReadonlySet<string> = new Set<IdentityOs>(['windows', 'macos', 'linux']);

function stamp(now = new Date()): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** `--account <id>` sconosciuto: `getAccountProfileById` ricadrebbe sul PRIMO profilo con un solo log → qui è un errore. */
export class IdentityInitTargetError extends Error {
    constructor(
        readonly code: 'IDENTITY_ACCOUNT_UNKNOWN',
        message: string,
    ) {
        super(message);
        this.name = 'IdentityInitTargetError';
    }
}

/** Bersaglio del comando dalla configurazione reale (iniettabile nei test tramite `IdentityInitDeps`). */
export function resolveIdentityInitTarget(args: string[]): IdentityInitTarget {
    const requested = getOptionValue(args, '--account');
    const profile = getAccountProfileById(requested);
    if (requested !== undefined && profile.id !== requested) {
        const known = getRuntimeAccountProfiles().map((p) => p.id);
        throw new IdentityInitTargetError(
            'IDENTITY_ACCOUNT_UNKNOWN',
            `--account ${requested}: profilo sconosciuto (configurati: ${known.length > 0 ? known.join(', ') : 'default'}) — nessuna identità scritta sul profilo sbagliato`,
        );
    }
    const newSession = args.includes('--new-session');
    return {
        sessionDir: newSession ? `${profile.sessionDir}-${stamp()}` : profile.sessionDir,
        accountId: profile.id,
        newSession,
    };
}

const defaultDeps: IdentityInitDeps = {
    resolveTarget: resolveIdentityInitTarget,
    // `accountId` = profilo (validato contro il file a ogni lancio); il seme del pool decide solo QUALE voce del pool
    // alla creazione, una volta per profilo — su Camoufox (produzione) il pool non entra affatto.
    createIdentity: (sessionDir, accountId) =>
        ensureLaunchIdentity({ sessionDir, accountId, poolSeed: accountId, isMobile: false, headless: false, loadCloudFingerprints: async () => [] }),
};

function fail(payload: Record<string, unknown>): void {
    writeJsonResult({ ok: false, ...payload });
    process.exitCode = 1;
}

export async function runIdentityInitCommand(args: string[], deps: IdentityInitDeps = defaultDeps): Promise<void> {
    const hostOs = (deps.hostOs ?? hostIdentityOs)();
    let target: IdentityInitTarget;
    try {
        target = deps.resolveTarget(args);
    } catch (error) {
        fail({
            code: error instanceof IdentityInitTargetError ? error.code : 'IDENTITY_INIT_FAILED',
            error: error instanceof Error ? error.message : String(error),
        });
        return;
    }
    const osFlag = getOptionValue(args, '--os');
    if (osFlag !== undefined && (!VALID_OS.has(osFlag) || osFlag !== hostOs)) {
        fail({
            code: 'IDENTITY_OS_MISMATCH',
            error: `--os ${osFlag} ≠ host ${hostOs}: l'identità dichiara SEMPRE la piattaforma reale (font e WebGL sono quelli dell'host)`,
            sessionDir: target.sessionDir,
        });
        return;
    }
    if (!target.newSession && profileHasCookies(target.sessionDir)) {
        fail({
            code: 'IDENTITY_PROFILE_HAS_COOKIES',
            error: `${target.sessionDir} ha già un cookie jar: nessuna identità nuova sotto un account già visto. Usa --new-session`,
            sessionDir: target.sessionDir,
        });
        return;
    }
    const file = identityFilePath(target.sessionDir);
    const existedBefore = fs.existsSync(file);
    try {
        const identity = await deps.createIdentity(target.sessionDir, target.accountId);
        writeJsonResult({
            ok: true,
            created: !existedBefore,
            file,
            sessionDir: target.sessionDir,
            accountId: identity.accountId,
            engine: identity.engine,
            engineBuild: identity.engineBuild,
            os: identity.os,
            userAgent: identity.userAgent,
            fontsSpacingSeed: identity.fontsSpacingSeed,
            createdAt: identity.createdAt,
            configHint: target.newSession ? `SESSION_DIR=${target.sessionDir}  (in config/bot-settings.conf, poi .\\bot.ps1 login)` : null,
        });
        process.exitCode = 0;
    } catch (error) {
        fail({
            code: error instanceof BrowserIdentityError ? error.code : 'IDENTITY_INIT_FAILED',
            error: error instanceof Error ? error.message : String(error),
            sessionDir: target.sessionDir,
        });
    }
}
