import path from 'path';
import { isIP } from 'net';
import fs from 'fs';
import dotenv from 'dotenv';
import { AccountProfileConfig, AiProviderSelection, EventSyncSink, ProxyType } from './types';

const DOCKER_SECRETS_DIR = '/run/secrets';

/**
 * Risolve un segreto con priorità: Docker Secrets → process.env → fallback.
 * Docker Secrets: file in /run/secrets/{key_lowercase} (standard Docker Swarm/Compose).
 * In dev (senza Docker): fallback trasparente su process.env.
 */
export function resolveSecret(key: string, fallback: string = ''): string {
    const envValue = process.env[key];
    if (envValue !== undefined && envValue !== '') return envValue;

    try {
        const safeKey = path.basename(key.toLowerCase());
        if (!safeKey || safeKey === '.' || safeKey === '..') return fallback;
        const secretPath = path.join(DOCKER_SECRETS_DIR, safeKey);
        if (fs.existsSync(secretPath)) {
            const value = fs.readFileSync(secretPath, 'utf8').trim();
            if (value) return value;
        }
    } catch {
        // Docker secrets non disponibili (dev locale, Windows, permessi)
    }

    return fallback;
}

/**
 * Carica la configurazione da due file separati per RESPONSABILITA' (regola 2026-08-01):
 *   1. `.env`                     -> SEGRETI (chiavi API, token, password). Gestito solo dall'utente.
 *   2. `config/bot-settings.conf` -> parametri operativi NON segreti (soglie, cap, timing, flag).
 *
 * L'ordine NON e' arbitrario: dotenv non sovrascrive una variabile gia' presente in `process.env`
 * (`override` default false, dotenv 17 `lib/main.js:380`), quindi il file caricato per PRIMO vince.
 * `.env` va per primo affinche' il file dell'utente abbia sempre l'ultima parola su una chiave
 * definita in entrambi. Entrambi i file sono opzionali: se mancano, valgono i default del codice.
 */
export function loadDotEnv(): void {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    }

    const settingsPath = path.resolve(process.cwd(), 'config', 'bot-settings.conf');
    if (fs.existsSync(settingsPath)) {
        dotenv.config({ path: settingsPath });
    }
}

export function parseIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseFloatEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseBoolEnv(name: string, defaultValue: boolean): boolean {
    const val = process.env[name];
    if (val === undefined || val === '') return defaultValue;
    return val.toLowerCase() === 'true' || val === '1';
}

export function parseStringEnv(name: string, fallback: string = ''): string {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return raw.trim();
}

export function parseCsvEnv(name: string): string[] {
    const raw = parseStringEnv(name);
    if (!raw) return [];
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

/**
 * SSOT della domanda «questo endpoint AI è in casa?» (F-a3f17c02).
 *
 * La regola viveva in QUATTRO copie divergenti — `ai/openaiClient.ts`, qui, `ai/providerRegistry.ts`
 * (`isLocalUrl`) e `ai/ollamaLifecycle.ts` (`isLoopbackEndpoint`) — e lo stesso URL riceveva verdetti
 * diversi senza che nulla lo segnalasse: `http://[::1]:11434/v1` era locale per il client e remoto per
 * il registry (⇒ i purpose PII-sensitive cadevano su `template`, che lancia), `http://0.0.0.0:11434/v1`
 * era valido per la validazione e bloccato dal client. Vive qui perché `config/` è il livello più
 * basso: `config/validation.ts` non può dipendere da `ai/`, e i test del registry mockano
 * `ai/openaiClient`, il che romperebbe l'import se la SSOT stesse lì.
 *
 * NB: è una ALLOW-list («posso fidarmi, è la mia macchina»). La deny-list SSRF di
 * `security/ssrfGuard.ts` risponde alla domanda OPPOSTA e resta deliberatamente separata:
 * un'unica funzione usata nei due sensi si corrompe al primo cambio di perimetro.
 */
function hostnameAi(baseUrl: string): string {
    try {
        // Le parentesi vanno tolte: `new URL('http://[::1]').hostname` vale '[::1]' (spec WHATWG),
        // quindi il confronto con '::1' era codice morto in tre copie su quattro.
        const host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
        // IPv4-mapped: WHATWG comprime in esadecimale (`::ffff:127.0.0.1` → `::ffff:7f00:1`), quindi
        // il confronto letterale con la forma puntata non poteva matchare. Si riporta all'IPv4.
        const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (mapped) {
            const alto = parseInt(mapped[1], 16);
            const basso = parseInt(mapped[2], 16);
            return `${alto >> 8}.${alto & 0xff}.${basso >> 8}.${basso & 0xff}`;
        }
        return host.replace(/^::ffff:/, '');
    } catch {
        return '';
    }
}

/**
 * Loopback STRETTO: la sola macchina corrente. È il perimetro che decide chi può ricevere
 * `Authorization: Bearer`, quindi NON include `.local` (mDNS = un host qualsiasi della LAN).
 * `127.0.0.0/8` è interamente loopback (RFC 1122); `0.0.0.0` come destinazione di un client viene
 * instradato alla macchina locale dai SO su cui questo bot gira.
 */
export function isLoopbackAiHost(baseUrl: string): boolean {
    const host = hostnameAi(baseUrl);
    if (!host) return false;
    if (host === 'localhost' || host === '::1') return true;
    // 🔴 Il confronto DEVE passare da `isIP`: un prefisso testuale (`/^127\./`) accetterebbe
    // `127.0.0.1.evil.com`, cioè un dominio esterno a cui spediremmo la chiave. È la stessa classe
    // di F-0d84be2f — promuovere una funzione a oracolo di sicurezza senza rivalutarne il perimetro.
    if (isIP(host) !== 4) return false;
    return host === '0.0.0.0' || Number(host.split('.')[0]) === 127;
}

/** Loopback + mDNS: «è in casa», perimetro largo. Sovrainsieme di `isLoopbackAiHost`. */
export function isLocalAiEndpoint(baseUrl: string): boolean {
    return isLoopbackAiHost(baseUrl) || hostnameAi(baseUrl).endsWith('.local');
}

export function isAiRequestConfigured(baseUrl: string, apiKey: string): boolean {
    return isLocalAiEndpoint(baseUrl) || !!apiKey;
}

export function resolvePathValue(rawPath: string): string {
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

export function resolvePathFromEnv(name: string, fallbackRelativePath: string): string {
    const raw = process.env[name];
    if (!raw) {
        return path.resolve(process.cwd(), fallbackRelativePath);
    }
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export function parseEventSyncSinkEnv(name: string, fallback: EventSyncSink): EventSyncSink {
    const raw = parseStringEnv(name, fallback).toUpperCase();
    if (raw === 'SUPABASE' || raw === 'WEBHOOK' || raw === 'NONE' || raw === 'BOTH') {
        return raw;
    }
    return fallback;
}

export function parseAiProviderEnv(name: string, fallback: AiProviderSelection): AiProviderSelection {
    const raw = parseStringEnv(name, fallback).toLowerCase();
    if (raw === 'auto' || raw === 'anthropic' || raw === 'openai' || raw === 'ollama' || raw === 'template') {
        return raw;
    }
    return fallback;
}

export function parseProxyType(rawValue: string | undefined, fallback: ProxyType = 'unknown'): ProxyType {
    const normalized = (rawValue ?? '').trim().toLowerCase();
    if (normalized === 'mobile') return 'mobile';
    if (normalized === 'residential') return 'residential';
    if (normalized === 'unknown' || normalized === '') return fallback;
    return fallback;
}

export function parseAccountProfileFromEnv(slot: 1 | 2): AccountProfileConfig | null {
    const sessionDirRaw = parseStringEnv(`ACCOUNT_${slot}_SESSION_DIR`);
    if (!sessionDirRaw) {
        return null;
    }

    const fallbackId = `account${slot}`;
    const id = parseStringEnv(`ACCOUNT_${slot}_ID`, fallbackId) || fallbackId;
    return {
        id,
        sessionDir: resolvePathValue(sessionDirRaw),
        proxyUrl: parseStringEnv(`ACCOUNT_${slot}_PROXY_URL`),
        proxyUsername: parseStringEnv(`ACCOUNT_${slot}_PROXY_USERNAME`),
        proxyPassword: parseStringEnv(`ACCOUNT_${slot}_PROXY_PASSWORD`),
        proxyType: parseProxyType(process.env[`ACCOUNT_${slot}_PROXY_TYPE`], 'unknown'),
        inviteWeight: Math.max(0.1, parseFloatEnv(`ACCOUNT_${slot}_INVITE_WEIGHT`, 1)),
        messageWeight: Math.max(0.1, parseFloatEnv(`ACCOUNT_${slot}_MESSAGE_WEIGHT`, 1)),
        warmupEnabled: parseBoolEnv(`ACCOUNT_${slot}_WARMUP_ENABLED`, false),
        warmupStartDate: parseStringEnv(`ACCOUNT_${slot}_WARMUP_START_DATE`),
        warmupMaxDays: parseIntEnv(`ACCOUNT_${slot}_WARMUP_MAX_DAYS`, 30),
        warmupMinActions: parseIntEnv(`ACCOUNT_${slot}_WARMUP_MIN_ACTIONS`, 5),
    };
}
