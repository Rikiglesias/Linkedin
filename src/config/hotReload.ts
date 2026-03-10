/**
 * config/hotReload.ts
 * ─────────────────────────────────────────────────────────────────
 * Watches .env file for changes and reloads mutable config fields.
 *
 * Only "safe" fields are reloaded — structural settings (dbPath, sessionDir,
 * accountProfiles) are intentionally excluded because changing them at runtime
 * could corrupt state.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { config } from './index';
import {
    buildLimitsAndRiskDomainConfig,
    buildAiDomainConfig,
    buildCommsAndBusinessDomainConfig,
    buildBehaviorDomainConfig,
} from './domains';
import { AppConfig } from './types';

type ConfigListener = (changedKeys: string[]) => void;
const listeners: ConfigListener[] = [];
let watcher: fs.FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Safe-to-reload domains — excludes db, session, proxy, sync, vision (structural). */
const RELOAD_DOMAINS: Array<() => Partial<AppConfig>> = [
    buildLimitsAndRiskDomainConfig,
    buildAiDomainConfig,
    buildCommsAndBusinessDomainConfig,
    buildBehaviorDomainConfig,
];

/** Keys that must NEVER be hot-reloaded (structural / session-bound). */
const FROZEN_KEYS = new Set<string>([
    'dbPath',
    'databaseUrl',
    'sessionDir',
    'accountProfiles',
    'multiAccountEnabled',
    'allowSqliteInProduction',
    'supabaseUrl',
    'supabaseServiceRoleKey',
    'proxyUrl',
    'proxyUsername',
    'proxyPassword',
    'proxyListPath',
    'eventSyncSink',
    'webhookSyncUrl',
    'webhookSyncSecret',
]);

/**
 * Re-read `.env` and update the live config object in-place.
 * Returns the list of keys that actually changed.
 */
export function reloadConfig(): string[] {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const parsed = dotenv.parse(envContent);
        // Merge into process.env (overwrite existing)
        for (const [key, value] of Object.entries(parsed)) {
            process.env[key] = value;
        }
    }

    const changedKeys: string[] = [];

    const mutableConfig = config as unknown as Record<string, unknown>;
    for (const builder of RELOAD_DOMAINS) {
        const fresh = builder();
        for (const [key, value] of Object.entries(fresh)) {
            if (FROZEN_KEYS.has(key)) continue;
            const current = mutableConfig[key];
            if (current !== value) {
                mutableConfig[key] = value;
                changedKeys.push(key);
            }
        }
    }

    if (changedKeys.length > 0) {
        console.log(`[CONFIG] Hot-reloaded ${changedKeys.length} keys: ${changedKeys.join(', ')}`);
        for (const listener of listeners) {
            try {
                listener(changedKeys);
            } catch (e) {
                console.warn('[CONFIG] Listener error:', e instanceof Error ? e.message : e);
            }
        }
    }

    return changedKeys;
}

/**
 * Register a callback to be notified when config is reloaded.
 * Returns an unsubscribe function.
 */
export function onConfigReload(listener: ConfigListener): () => void {
    listeners.push(listener);
    return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
    };
}

/**
 * Start watching `.env` for changes. Debounces 500ms to avoid rapid reloads.
 */
export function startConfigWatcher(): void {
    if (watcher) return;

    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
        console.log('[CONFIG] No .env file found — hot reload watcher not started');
        return;
    }

    try {
        watcher = fs.watch(envPath, (eventType) => {
            if (eventType !== 'change') return;
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                try {
                    reloadConfig();
                } catch (e) {
                    console.error('[CONFIG] Hot reload failed:', e instanceof Error ? e.message : e);
                }
            }, 500);
        });

        watcher.on('error', (err) => {
            console.warn('[CONFIG] Watcher error:', err.message);
            stopConfigWatcher();
        });

        console.log('[CONFIG] Hot reload watcher started on .env');
    } catch (e) {
        console.warn('[CONFIG] Could not start file watcher:', e instanceof Error ? e.message : e);
    }
}

/**
 * Stop the file watcher.
 */
export function stopConfigWatcher(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    if (watcher) {
        watcher.close();
        watcher = null;
        console.log('[CONFIG] Hot reload watcher stopped');
    }
}
