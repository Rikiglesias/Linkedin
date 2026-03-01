/**
 * pluginLoader.ts — Caricamento dinamico dei Plugin (security-first)
 *
 * Policy:
 * - directory plugin ammessa solo dentro una allowlist di path
 * - niente symlink
 * - manifest JSON obbligatorio per ogni plugin
 * - integrity hash opzionale ma raccomandato (sha256)
 * - plugin name allowlist opzionale (PLUGIN_ALLOWLIST)
 * - hook dichiarati nel manifest (allowedHooks) opzionali
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { IPlugin, PluginLeadSnapshot, PluginDailyStats, PluginIdleEvent, PluginMessageEvent } from './IPlugin';
import { logInfo, logWarn } from '../telemetry/logger';

type PluginHookName =
    | 'onInit'
    | 'onShutdown'
    | 'onInviteSent'
    | 'onInviteAccepted'
    | 'onMessage'
    | 'onReplyReceived'
    | 'onDailyReport'
    | 'onIdle';

interface PluginManifest {
    name: string;
    version: string;
    entry: string;
    enabled?: boolean;
    integritySha256?: string;
    allowedHooks?: PluginHookName[];
}

const KNOWN_PLUGIN_HOOKS: PluginHookName[] = [
    'onInit',
    'onShutdown',
    'onInviteSent',
    'onInviteAccepted',
    'onMessage',
    'onReplyReceived',
    'onDailyReport',
    'onIdle',
];

function parseCsvEnv(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function normalizeForPathComparison(input: string): string {
    if (process.platform === 'win32') {
        return input.toLowerCase();
    }
    return input;
}

function isPathWithinRoot(root: string, candidate: string): boolean {
    const normalizedRoot = normalizeForPathComparison(path.resolve(root));
    const normalizedCandidate = normalizeForPathComparison(path.resolve(candidate));
    if (normalizedRoot === normalizedCandidate) return true;
    return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function normalizeManifestHooks(raw: unknown): PluginHookName[] | null {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) return null;

    const hooks: PluginHookName[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') return null;
        const normalized = entry.trim() as PluginHookName;
        if (!KNOWN_PLUGIN_HOOKS.includes(normalized)) return null;
        hooks.push(normalized);
    }
    return hooks;
}

function parsePluginManifest(filePath: string): PluginManifest | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        if (typeof parsed.name !== 'string' || parsed.name.trim().length === 0) return null;
        if (typeof parsed.version !== 'string' || parsed.version.trim().length === 0) return null;
        if (typeof parsed.entry !== 'string' || parsed.entry.trim().length === 0) return null;
        if (parsed.enabled !== undefined && typeof parsed.enabled !== 'boolean') return null;
        if (parsed.integritySha256 !== undefined && typeof parsed.integritySha256 !== 'string') return null;

        const allowedHooks = normalizeManifestHooks(parsed.allowedHooks);
        if (allowedHooks === null) return null;

        return {
            name: parsed.name.trim(),
            version: parsed.version.trim(),
            entry: parsed.entry.trim(),
            enabled: parsed.enabled,
            integritySha256: parsed.integritySha256?.trim(),
            allowedHooks,
        };
    } catch {
        return null;
    }
}

// ─── Plugin Registry ──────────────────────────────────────────────────────────

export class PluginRegistry {
    private plugins: IPlugin[] = [];

    private canLoadTypeScriptPlugins(): boolean {
        if (process.env.PLUGIN_ALLOW_TS !== 'true') {
            return false;
        }

        const tsNodeInstance = (process as unknown as { [key: symbol]: unknown })[Symbol.for('ts-node.register.instance')];
        const argv = process.execArgv.join(' ');
        const processArgs = process.argv.join(' ');
        return argv.includes('ts-node/register')
            || argv.includes('tsx')
            || processArgs.includes('ts-node')
            || !!tsNodeInstance
            || !!process.env.TS_NODE_DEV;
    }

    private hasUnsafePermissions(targetPath: string): boolean {
        if (process.platform === 'win32') {
            return false;
        }
        const stats = fs.statSync(targetPath);
        const mode = stats.mode & 0o777;
        return (mode & 0o022) !== 0;
    }

    private verifyIntegrity(filePath: string, expectedSha256: string): boolean {
        const content = fs.readFileSync(filePath);
        const digest = createHash('sha256').update(content).digest('hex');
        return digest === expectedSha256.toLowerCase();
    }

    private getAllowedPluginNames(): Set<string> {
        return new Set(parseCsvEnv(process.env.PLUGIN_ALLOWLIST));
    }

    private getAllowedPluginRoots(): string[] {
        const defaults = [path.resolve(process.cwd(), 'plugins')];
        const configuredRoots = parseCsvEnv(process.env.PLUGIN_DIR_ALLOWLIST).map((rawPath) =>
            path.resolve(process.cwd(), rawPath)
        );
        return configuredRoots.length > 0 ? configuredRoots : defaults;
    }

    private isValidPluginShape(candidate: unknown): candidate is IPlugin {
        if (!candidate || typeof candidate !== 'object') return false;

        const plugin = candidate as Partial<Record<keyof IPlugin, unknown>>;
        if (typeof plugin.name !== 'string' || plugin.name.trim().length === 0) return false;
        if (typeof plugin.version !== 'string' || plugin.version.trim().length === 0) return false;

        for (const hook of KNOWN_PLUGIN_HOOKS) {
            const value = plugin[hook];
            if (value !== undefined && typeof value !== 'function') {
                return false;
            }
        }
        return true;
    }

    private validateHooksAgainstManifest(plugin: IPlugin, manifest: PluginManifest): { ok: boolean; deniedHook?: string } {
        if (!manifest.allowedHooks || manifest.allowedHooks.length === 0) {
            return { ok: true };
        }
        const allowed = new Set(manifest.allowedHooks);
        for (const hook of KNOWN_PLUGIN_HOOKS) {
            const value = plugin[hook];
            if (typeof value === 'function' && !allowed.has(hook)) {
                return { ok: false, deniedHook: hook };
            }
        }
        return { ok: true };
    }

    /** Carica tutti i plugin dalla directory configurata rispettando la policy. */
    async load(): Promise<void> {
        const pluginDir = path.resolve(process.cwd(), process.env.PLUGIN_DIR || 'plugins');
        const allowedRoots = this.getAllowedPluginRoots();
        const allowedNames = this.getAllowedPluginNames();

        if (!allowedRoots.some((root) => isPathWithinRoot(root, pluginDir))) {
            await logWarn('plugin_loader.dir_not_allowed', { dir: pluginDir, allowedRoots });
            return;
        }

        if (!fs.existsSync(pluginDir)) {
            await logInfo('plugin_loader.dir_not_found', { dir: pluginDir });
            return;
        }

        if (this.hasUnsafePermissions(pluginDir)) {
            await logWarn('plugin_loader.dir_unsafe_permissions', { dir: pluginDir });
            return;
        }

        const realPluginDir = fs.realpathSync(pluginDir);
        const allowTsPlugins = this.canLoadTypeScriptPlugins();
        const files = fs.readdirSync(pluginDir)
            .filter((f) => {
                const ext = path.extname(f).toLowerCase();
                if (ext === '.js' || ext === '.cjs') return true;
                if (ext === '.ts') return allowTsPlugins;
                return false;
            })
            .filter((f) => !f.startsWith('.'));

        for (const file of files) {
            const fullPath = path.join(pluginDir, file);
            try {
                const fileStats = fs.lstatSync(fullPath);
                if (fileStats.isSymbolicLink()) {
                    await logWarn('plugin_loader.symlink_blocked', { file });
                    continue;
                }

                const realFilePath = fs.realpathSync(fullPath);
                if (!isPathWithinRoot(realPluginDir, realFilePath)) {
                    await logWarn('plugin_loader.path_escape_blocked', { file, resolved: realFilePath });
                    continue;
                }

                if (this.hasUnsafePermissions(fullPath)) {
                    await logWarn('plugin_loader.file_unsafe_permissions', { file });
                    continue;
                }

                const baseName = path.basename(file, path.extname(file));
                const manifestPath = path.join(pluginDir, `${baseName}.manifest.json`);
                if (!fs.existsSync(manifestPath)) {
                    await logWarn('plugin_loader.manifest_missing', { file, manifestPath });
                    continue;
                }

                const manifest = parsePluginManifest(manifestPath);
                if (!manifest) {
                    await logWarn('plugin_loader.manifest_invalid', { file, manifestPath });
                    continue;
                }
                if (manifest.entry !== file) {
                    await logWarn('plugin_loader.manifest_entry_mismatch', { file, manifestEntry: manifest.entry });
                    continue;
                }
                if (manifest.enabled === false) {
                    await logInfo('plugin_loader.manifest_disabled', { file, plugin: manifest.name });
                    continue;
                }
                if (allowedNames.size > 0 && !allowedNames.has(manifest.name)) {
                    await logWarn('plugin_loader.not_in_allowlist', { file, plugin: manifest.name });
                    continue;
                }
                if (manifest.integritySha256 && !this.verifyIntegrity(fullPath, manifest.integritySha256)) {
                    await logWarn('plugin_loader.integrity_mismatch', { file, plugin: manifest.name });
                    continue;
                }

                const mod = require(realFilePath) as { default?: IPlugin } | IPlugin;
                const plugin = (mod as { default?: IPlugin }).default ?? (mod as IPlugin);
                if (!this.isValidPluginShape(plugin)) {
                    await logWarn('plugin_loader.invalid_plugin_shape', { file });
                    continue;
                }
                if (plugin.name !== manifest.name || plugin.version !== manifest.version) {
                    await logWarn('plugin_loader.manifest_runtime_mismatch', {
                        file,
                        manifestName: manifest.name,
                        pluginName: plugin.name,
                        manifestVersion: manifest.version,
                        pluginVersion: plugin.version,
                    });
                    continue;
                }
                const hookValidation = this.validateHooksAgainstManifest(plugin, manifest);
                if (!hookValidation.ok) {
                    await logWarn('plugin_loader.hook_not_allowed', {
                        file,
                        plugin: plugin.name,
                        hook: hookValidation.deniedHook,
                    });
                    continue;
                }

                this.plugins.push(plugin);
                await logInfo('plugin_loader.loaded', { name: plugin.name, version: plugin.version, file });
            } catch (err: unknown) {
                await logWarn('plugin_loader.load_failed', {
                    file,
                    error: err instanceof Error ? err.message : String(err),
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

    async fireIdle(event: PluginIdleEvent): Promise<void> {
        for (const p of this.plugins) {
            if (p.onIdle) {
                const fn = p.onIdle.bind(p);
                void this.safeCall(p.name, 'onIdle', () => fn(event));
            }
        }
    }

    get count(): number { return this.plugins.length; }

    resetForTests(): void {
        this.plugins = [];
    }

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
