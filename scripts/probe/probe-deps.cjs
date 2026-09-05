#!/usr/bin/env node
'use strict';
/**
 * Sonda C20 (goal `bot-operativo`, F1) — dipendenze runtime interrogate DAVVERO.
 *
 * Legge la config REALE del bot (`dist/config`, che carica `.env` come il binario) e chiede a ogni
 * dipendenza se risponde. Stampa SOLO booleani/status/versioni: MAI token, chiavi, URL con credenziali.
 * Non codifica gli attesi: il confronto con la tabella del binding lo fa chi legge.
 *
 * EXPECT (binding C20): `accounts[0].id='default'`, `telegram.ok=true`, `supabase.status=200`,
 * `db.dialect='sqlite'`, `camoufox.present=true` (135.0.1 beta.24), `ollama` uguale alla riga della tabella.
 * Prerequisito: `npm run build` recente (legge `dist/`). Uso: `node scripts/probe/probe-deps.cjs`.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const FETCH_TIMEOUT_MS = 5000;

function loadRuntimeConfig() {
    // `dist/config` stampa `[CONFIG] Profilo attivo` e dotenv i suoi tip: li teniamo fuori dallo stdout della sonda.
    process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET ?? 'true';
    const originalLog = console.log;
    console.log = () => {};
    try {
        const { config } = require(path.join(repoRoot, 'dist', 'config'));
        const { getRuntimeAccountProfiles } = require(path.join(repoRoot, 'dist', 'accountManager'));
        return { config, getRuntimeAccountProfiles };
    } finally {
        console.log = originalLog;
    }
}

/** Errore di rete ridotto al solo codice: il messaggio potrebbe contenere l'URL (e quindi il token). */
function errorCode(err) {
    if (err && err.name === 'AbortError') return 'timeout';
    return (err && (err.cause?.code || err.code || err.name)) || 'error';
}

async function probeHttp(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        const body = await res.json().catch(() => null);
        return { status: res.status, ok: res.ok, body };
    } catch (err) {
        return { status: null, ok: false, error: errorCode(err) };
    } finally {
        clearTimeout(timer);
    }
}

async function probeTelegram(config) {
    const token = config.telegramBotToken;
    if (!token) return { configured: false, ok: false, chatIdPresent: Boolean(config.telegramChatId) };
    const res = await probeHttp(`https://api.telegram.org/bot${token}/getMe`);
    return {
        configured: true,
        status: res.status,
        ok: res.body?.ok === true,
        isBot: res.body?.result?.is_bot === true,
        chatIdPresent: Boolean(config.telegramChatId),
        ...(res.error ? { error: res.error } : {}),
    };
}

async function probeSupabase(config) {
    const url = config.supabaseUrl;
    const key = config.supabaseServiceRoleKey;
    if (!url || !key) return { configured: false, syncEnabled: config.supabaseSyncEnabled, status: null };
    const res = await probeHttp(`${url.replace(/\/$/, '')}/rest/v1/`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    return {
        configured: true,
        syncEnabled: config.supabaseSyncEnabled,
        status: res.status,
        ...(res.error ? { error: res.error } : {}),
    };
}

function probeDb(config) {
    const dialect = config.databaseUrl ? 'postgres' : 'sqlite';
    const sqlitePresent = dialect === 'sqlite' && fs.existsSync(config.dbPath);
    return {
        dialect,
        sqlitePresent,
        sqliteBytes: sqlitePresent ? fs.statSync(config.dbPath).size : null,
        nodeEnv: process.env.NODE_ENV || null,
        allowSqliteInProduction: Boolean(config.allowSqliteInProduction),
    };
}

function probeCamoufox() {
    const base = process.env.LOCALAPPDATA;
    if (!base) return { present: false, reason: 'LOCALAPPDATA non impostata' };
    const versionFile = path.join(base, 'camoufox', 'camoufox', 'Cache', 'version.json');
    if (!fs.existsSync(versionFile)) return { present: false };
    try {
        const { version, release } = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
        return { present: true, version: `${version} ${release}`.trim() };
    } catch (err) {
        return { present: true, version: null, error: errorCode(err) };
    }
}

async function probeOllama(config) {
    const endpoint = config.ollamaEndpoint;
    if (!endpoint) return { configured: false, up: false };
    const res = await probeHttp(`${endpoint.replace(/\/$/, '')}/api/tags`, {}, 3000);
    return {
        configured: true,
        up: res.ok,
        status: res.status,
        models: Array.isArray(res.body?.models) ? res.body.models.length : null,
        ...(res.error ? { error: res.error } : {}),
    };
}

(async () => {
    const { config, getRuntimeAccountProfiles } = loadRuntimeConfig();
    const result = {
        accounts: getRuntimeAccountProfiles().map((account) => ({ id: account.id })),
        telegram: await probeTelegram(config),
        supabase: await probeSupabase(config),
        db: probeDb(config),
        camoufox: probeCamoufox(),
        ollama: await probeOllama(config),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
})().catch((err) => {
    process.stderr.write(`probe-deps: ${errorCode(err)} — ${String(err && err.message).slice(0, 200)}\n`);
    process.exit(2);
});
