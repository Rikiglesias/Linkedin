/**
 * pluginLoader.ts — Caricamento dinamico dei Plugin
 *
 * Legge PLUGIN_DIR env (default: ./plugins/) e carica tutti i file .js
 * che esportano `export default: IPlugin`.
 *
 * I plugin vengono inizializzati all'avvio tramite onInit() e i loro
 * hook vengono esposti tramite la classe PluginRegistry.
 *
 * IMPORTANTE: i plugin vengono eseguiti in fire-and-forget (errori non fatali).
 */

import fs from 'fs';
import path from 'path';
import type { IPlugin, PluginLeadSnapshot, PluginDailyStats, PluginMessageEvent } from './IPlugin';
import { logInfo, logWarn } from '../telemetry/logger';

// ─── Plugin Registry ──────────────────────────────────────────────────────────

class PluginRegistry {
    private plugins: IPlugin[] = [];

    private canLoadTypeScriptPlugins(): boolean {
        const argv = process.execArgv.join(' ');
        return argv.includes('ts-node/register')
            || argv.includes('tsx')
            || !!process.env.TS_NODE_DEV;
    }

    /** Carica tutti i plugin dalla directory configurata. */
    async load(): Promise<void> {
        const pluginDir = path.resolve(process.cwd(), process.env.PLUGIN_DIR || 'plugins');

        if (!fs.existsSync(pluginDir)) {
            await logInfo('plugin_loader.dir_not_found', { dir: pluginDir });
            return;
        }

        const allowTsPlugins = this.canLoadTypeScriptPlugins();
        const files = fs.readdirSync(pluginDir)
            .filter((f) => {
                const ext = path.extname(f).toLowerCase();
                if (ext === '.js' || ext === '.cjs' || ext === '.mjs') return true;
                if (ext === '.ts') return allowTsPlugins;
                return false;
            })
            .filter(f => !f.startsWith('.')); // ignora hidden

        for (const file of files) {
            const fullPath = path.join(pluginDir, file);
            try {
                const mod = require(fullPath) as { default?: IPlugin } | IPlugin;
                const plugin = (mod as { default?: IPlugin }).default ?? (mod as IPlugin);

                if (!plugin?.name || !plugin?.version) {
                    await logWarn('plugin_loader.invalid_plugin', { file, reason: 'missing name or version' });
                    continue;
                }

                this.plugins.push(plugin);
                await logInfo('plugin_loader.loaded', { name: plugin.name, version: plugin.version });
            } catch (err: unknown) {
                await logWarn('plugin_loader.load_failed', {
                    file,
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }

        await logInfo('plugin_loader.ready', { count: this.plugins.length });
    }

    /** Chiama onInit() su tutti i plugin. */
    async init(): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onInit) {
                const fn = plugin.onInit.bind(plugin);
                await this.safeCall(plugin.name, 'onInit', () => fn());
            }
        }
    }

    /** Chiama onShutdown() su tutti i plugin. */
    async shutdown(): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onShutdown) {
                const fn = plugin.onShutdown.bind(plugin);
                await this.safeCall(plugin.name, 'onShutdown', () => fn());
            }
        }
    }

    async fireInviteSent(lead: PluginLeadSnapshot, variantId?: string): Promise<void> {
        for (const p of this.plugins) {
            if (p.onInviteSent) {
                const fn = p.onInviteSent.bind(p);
                void this.safeCall(p.name, 'onInviteSent', () => fn(lead, variantId));
            }
        }
    }

    async fireInviteAccepted(lead: PluginLeadSnapshot): Promise<void> {
        for (const p of this.plugins) {
            if (p.onInviteAccepted) {
                const fn = p.onInviteAccepted.bind(p);
                void this.safeCall(p.name, 'onInviteAccepted', () => fn(lead));
            }
        }
    }

    async fireMessage(event: PluginMessageEvent): Promise<void> {
        for (const p of this.plugins) {
            if (p.onMessage) {
                const fn = p.onMessage.bind(p);
                void this.safeCall(p.name, 'onMessage', () => fn(event));
            }
        }
    }

    async fireReplyReceived(lead: PluginLeadSnapshot, message: string, intent?: string): Promise<void> {
        for (const p of this.plugins) {
            if (p.onReplyReceived) {
                const fn = p.onReplyReceived.bind(p);
                void this.safeCall(p.name, 'onReplyReceived', () => fn(lead, message, intent));
            }
        }
    }

    async fireDailyReport(stats: PluginDailyStats): Promise<void> {
        for (const p of this.plugins) {
            if (p.onDailyReport) {
                const fn = p.onDailyReport.bind(p);
                void this.safeCall(p.name, 'onDailyReport', () => fn(stats));
            }
        }
    }

    get count(): number { return this.plugins.length; }

    /** Wrapper con catch per hook non fatali. */
    private async safeCall(pluginName: string, hook: string, fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
        } catch (err: unknown) {
            await logWarn('plugin.hook_failed', {
                plugin: pluginName,
                hook,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const pluginRegistry = new PluginRegistry();

/**
 * Inizializza il plugin system all'avvio. Chiamare da index.ts dopo initDatabase().
 */
export async function initPluginSystem(): Promise<void> {
    await pluginRegistry.load();
    await pluginRegistry.init();
}
