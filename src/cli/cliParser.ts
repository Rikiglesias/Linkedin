/**
 * cliParser.ts — Utility di parsing degli argomenti CLI
 *
 * Tutte le funzioni pure per leggere, validare e normalizzare i parametri
 * passati da riga di comando. Nessuna dipendenza da DB, browser o config.
 */

import { WorkflowSelection } from '../core/scheduler';

// ─── Lettura argomenti ────────────────────────────────────────────────────────

export function getOptionValue(args: string[], optionName: string): string | undefined {
    const index = args.findIndex((value) => value === optionName);
    if (index === -1 || index + 1 >= args.length) {
        return undefined;
    }
    return args[index + 1];
}

export function hasOption(args: string[], optionName: string): boolean {
    return args.includes(optionName);
}

export function getPositionalArgs(args: string[]): string[] {
    return args.filter((value) => !value.startsWith('--'));
}

export function getWorkflowValue(args: string[]): string | undefined {
    const explicit = getOptionValue(args, '--workflow');
    if (explicit) {
        return explicit;
    }
    const positional = args.find((value) => !value.startsWith('--'));
    return positional;
}

// ─── Parsing valori ───────────────────────────────────────────────────────────

export function parseWorkflow(input: string | undefined): WorkflowSelection {
    if (input === 'invite' || input === 'check' || input === 'message' || input === 'warmup' || input === 'all') {
        return input;
    }
    return 'all';
}

export function parseIntStrict(raw: string, optionName: string): number {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Valore non valido per ${optionName}: ${raw} `);
    }
    return parsed;
}

export function parseNullableCap(raw: string, optionName: string): number | null {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'none' || normalized === 'null' || normalized === 'off' || normalized === '-1') {
        return null;
    }
    const parsed = parseIntStrict(raw, optionName);
    if (parsed < 0) {
        throw new Error(`${optionName} deve essere >= 0 oppure none / null / off.`);
    }
    return parsed;
}

export function parsePauseMinutes(raw: string, optionName: string): number | null {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'none' || normalized === 'null' || normalized === 'off' || normalized === 'indefinite') {
        return null;
    }
    const parsed = parseIntStrict(raw, optionName);
    if (parsed < 1) {
        throw new Error(`${optionName} deve essere >= 1 oppure none / null / off / indefinite.`);
    }
    return parsed;
}

export function parseBoolStrict(raw: string, optionName: string): boolean {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    throw new Error(`Valore non valido per ${optionName}: ${raw} (usa true / false).`);
}
