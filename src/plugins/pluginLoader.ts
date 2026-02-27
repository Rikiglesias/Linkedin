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

    /** Carica tutti i plugin dalla directory configurata. */
    async load(): Promise<void> {
        const pluginDir = path.resolve(process.cwd(), process.env.PLUGIN_DIR || 'plugins');

        if (!fs.existsSync(pluginDir)) {
            await logInfo('plugin_loader.dir_not_found', { dir: pluginDir });
            return;
        }

        const files = fs.readdirSync(pluginDir)
            .filter(f => f.endsWith('.js') || f.endsWith('.ts'))
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
                await this.safeCall(plugin.name, 'onInit', () => plugin.onInit!());
            }
        }
    }

    /** Chiama onShutdown() su tutti i plugin. */
    async shutdown(): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.onShutdown) {
                await this.safeCall(plugin.name, 'onShutdown', () => plugin.onShutdown!());
            }
        }
    }

    async fireInviteSent(lead: PluginLeadSnapshot, variantId?: string): Promise<void> {
        for (const p of this.plugins) {
            if (p.onInviteSent) {
                void this.safeCall(p.name, 'onInviteSent', () => p.onInviteSent!(lead, variantId));
            }
        }
    }

    async fireInviteAccepted(lead: PluginLeadSnapshot): Promise<void> {
        for (const p of this.plugins) {
            if (p.onInviteAccepted) {
                void this.safeCall(p.name, 'onInviteAccepted', () => p.onInviteAccepted!(lead));
            }
        }
    }

    async fireMessage(event: PluginMessageEvent): Promise<void> {
        for (const p of this.plugins) {
            if (p.onMessage) {
                void this.safeCall(p.name, 'onMessage', () => p.onMessage!(event));
            }
        }
    }

    async fireReplyReceived(lead: PluginLeadSnapshot, message: string, intent?: string): Promise<void> {
        for (const p of this.plugins) {
            if (p.onReplyReceived) {
                void this.safeCall(p.name, 'onReplyReceived', () => p.onReplyReceived!(lead, message, intent));
            }
        }
    }

    async fireDailyReport(stats: PluginDailyStats): Promise<void> {
        for (const p of this.plugins) {
            if (p.onDailyReport) {
                void this.safeCall(p.name, 'onDailyReport', () => p.onDailyReport!(stats));
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
