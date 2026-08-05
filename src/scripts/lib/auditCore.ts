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

/**
 * Cerca un hook il cui comando contiene una sottostringa.
 *
 * NB (2026-08-05): questa funzione era stata rimossa come "export morto" e poi RIPRISTINATA.
 * Il verdetto era sbagliato: non le mancava la vita, le mancava il consumatore corretto —
 * `aiReasoningHardeningAudit.ts` ne teneva una copia locale (`eventHasCommand`) invece di
 * importarla, cioe' esattamente la duplicazione che questa libreria era stata estratta per
 * chiudere. Ora quel file importa da qui. La copia parallela in
 * AI-Control-Plane/06-audit/src/scripts/lib/auditCore.ts la usa gia' (controlPlaneGlobalAudit.ts:180-201),
 * quindi le due copie tornano allineate.
 */
export function findHookCommand(settings: Record<string, unknown>, eventName: string, commandPattern: string): boolean {
    return getHookEntries(settings, eventName).some((entry) =>
        getNestedCommands(entry).some(
            (hook) => typeof hook.command === 'string' && hook.command.includes(commandPattern),
        ),
    );
}

/** Come findHookCommand, ma richiede che TUTTE le parti compaiano nello stesso comando. */
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
