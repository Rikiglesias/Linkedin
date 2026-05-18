/**
 * auditCore.ts — helper condivisi per audit script
 *
 * Estratto da aiControlPlaneAudit.ts e simili per evitare duplicazione.
 * Import preferito: `import { readText, readJson, isRecord } from './lib/auditCore';`
 */

import { existsSync, readFileSync } from 'fs';

export interface HookCommand {
    command?: unknown;
}

export interface HookEntry {
    hooks?: unknown;
}

export function readText(path: string): string | null {
    if (!existsSync(path)) {
        return null;
    }
    return readFileSync(path, 'utf8');
}

export function readJson<T>(path: string): T | null {
    const text = readText(path);
    if (!text) {
        return null;
    }
    return JSON.parse(text) as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getHookEntries(settings: Record<string, unknown>, eventName: string): HookEntry[] {
    const hooks = isRecord(settings.hooks) ? settings.hooks : {};
    const eventHooks = hooks[eventName];
    if (!Array.isArray(eventHooks)) {
        return [];
    }
    return eventHooks.filter(isRecord) as HookEntry[];
}

export function getNestedCommands(entry: HookEntry): HookCommand[] {
    if (!Array.isArray(entry.hooks)) {
        return [];
    }
    return entry.hooks.filter(isRecord) as HookCommand[];
}

export function findHookCommand(
    settings: Record<string, unknown>,
    eventName: string,
    commandPattern: string,
): boolean {
    return getHookEntries(settings, eventName).some((entry) =>
        getNestedCommands(entry).some(
            (hook) => typeof hook.command === 'string' && hook.command.includes(commandPattern),
        ),
    );
}

export function findHookCommandParts(
    settings: Record<string, unknown>,
    eventName: string,
    commandParts: string[],
): boolean {
    return getHookEntries(settings, eventName).some((entry) =>
        getNestedCommands(entry).some((hook) => {
            const command = hook.command;
            if (typeof command !== 'string') {
                return false;
            }
            return commandParts.every((part) => command.includes(part));
        }),
    );
}

export function missingSnippets(text: string | null, snippets: string[]): string[] {
    if (!text) {
        return snippets;
    }
    return snippets.filter((snippet) => !text.includes(snippet));
}

export function formatMissing(label: string, missing: string[]): string {
    return `${label} mancante o incompleto. Frammenti assenti: ${missing.join(' | ')}`;
}
