/**
 * mcpConfigAudit.ts
 *
 * Verifica la configurazione project-scope `.mcp.json` secondo le regole
 * Claude Code correnti: env var expansion per path machine-specific,
 * transport coerente e default risolvibili localmente.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}

interface McpServerConfig {
    type?: unknown;
    command?: unknown;
    args?: unknown;
    url?: unknown;
    env?: unknown;
    headers?: unknown;
}

interface McpConfig {
    mcpServers?: Record<string, McpServerConfig>;
}

const mcpPath = resolve('.mcp.json');
const supportedTypes = new Set(['stdio', 'http', 'streamable-http', 'sse']);
const machinePathPattern = /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)/;
const expansionPattern = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;

function readJson(path: string): McpConfig | null {
    if (!existsSync(path)) {
        return null;
    }
    return JSON.parse(readFileSync(path, 'utf8')) as McpConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveExpansion(value: string): string {
    return value.replace(expansionPattern, (_match, variableName: string, defaultValue: string | undefined) => {
        const envValue = process.env[variableName];
        if (envValue !== undefined && envValue.length > 0) {
            return envValue;
        }
        return defaultValue ?? '';
    });
}

function hasUnwrappedMachinePath(value: string): boolean {
    if (!machinePathPattern.test(value)) {
        return false;
    }

    const stripped = value.replace(expansionPattern, '');
    return machinePathPattern.test(stripped);
}

function looksLikePath(value: string): boolean {
    return /[\\/]/.test(value) || /\.(exe|cmd|bat|ps1|js|mjs|cjs|ts|py|sh)$/i.test(value);
}

function checkSchema(config: McpConfig | null): CheckResult {
    if (!config?.mcpServers || !isRecord(config.mcpServers)) {
        return {
            name: '.mcp.json schema',
            passed: false,
            detail: 'mcpServers object mancante o non valido.',
        };
    }

    const serverNames = Object.keys(config.mcpServers);
    if (serverNames.length === 0) {
        return {
            name: '.mcp.json schema',
            passed: false,
            detail: 'Nessun MCP server configurato.',
        };
    }

    return {
        name: '.mcp.json schema',
        passed: true,
        detail: `${serverNames.length} MCP server configurati.`,
    };
}

function checkTransportCoherence(config: McpConfig | null): CheckResult {
    const failures: string[] = [];
    const servers = config?.mcpServers ?? {};

    for (const [name, server] of Object.entries(servers)) {
        const type = typeof server.type === 'string' ? server.type : 'stdio';
        if (!supportedTypes.has(type)) {
            failures.push(`${name}: type non supportato '${type}'`);
            continue;
        }

        if (type === 'stdio') {
            if (typeof server.command !== 'string' || server.command.trim().length === 0) {
                failures.push(`${name}: stdio richiede command`);
            }
            if (server.url !== undefined) {
                failures.push(`${name}: stdio non deve usare url`);
            }
            if (server.args !== undefined && !Array.isArray(server.args)) {
                failures.push(`${name}: args deve essere array`);
            }
            continue;
        }

        if (typeof server.url !== 'string' || server.url.trim().length === 0) {
            failures.push(`${name}: ${type} richiede url`);
        }
        if (server.command !== undefined) {
            failures.push(`${name}: ${type} non deve usare command`);
        }
    }

    if (failures.length > 0) {
        return {
            name: 'Transport coerenti',
            passed: false,
            detail: failures.join(' | '),
        };
    }

    return {
        name: 'Transport coerenti',
        passed: true,
        detail: 'Ogni server usa campi coerenti con il transport.',
    };
}

function checkMachinePathExpansion(config: McpConfig | null): CheckResult {
    const failures: string[] = [];
    const servers = config?.mcpServers ?? {};

    for (const [serverName, server] of Object.entries(servers)) {
        const values: Array<[string, unknown]> = [
            ['command', server.command],
            ['url', server.url],
        ];
        if (Array.isArray(server.args)) {
            server.args.forEach((arg, index) => values.push([`args[${index}]`, arg]));
        }
        if (isRecord(server.env)) {
            Object.entries(server.env).forEach(([key, value]) => values.push([`env.${key}`, value]));
        }
        if (isRecord(server.headers)) {
            Object.entries(server.headers).forEach(([key, value]) => values.push([`headers.${key}`, value]));
        }

        for (const [field, rawValue] of values) {
            if (typeof rawValue !== 'string') {
                continue;
            }
            if (hasUnwrappedMachinePath(rawValue)) {
                failures.push(`${serverName}.${field}: path machine-specific senza env var expansion`);
            }
        }
    }

    const required = [
        ['lean-ctx.command', '${LEAN_CTX_PATH:-'],
        ['claude-peers.command', '${BUN_PATH:-'],
        ['claude-peers.args[0]', '${CLAUDE_PEERS_SERVER_PATH:-'],
    ];

    for (const [field, snippet] of required) {
        const [serverName, property] = field.split('.');
        const server = servers[serverName];
        const value = property === 'args[0]' && Array.isArray(server?.args) ? server.args[0] : server?.[property as keyof McpServerConfig];
        if (typeof value !== 'string' || !value.includes(snippet)) {
            failures.push(`${field}: manca ${snippet}`);
        }
    }

    if (failures.length > 0) {
        return {
            name: 'Path machine-specific via env var',
            passed: false,
            detail: failures.join(' | '),
        };
    }

    return {
        name: 'Path machine-specific via env var',
        passed: true,
        detail: 'Path utente-specific coperti da ${VAR:-default}.',
    };
}

function checkResolvedLocalPaths(config: McpConfig | null): CheckResult {
    const failures: string[] = [];
    const servers = config?.mcpServers ?? {};

    for (const [serverName, server] of Object.entries(servers)) {
        if (typeof server.command === 'string') {
            const resolvedCommand = resolveExpansion(server.command);
            if (looksLikePath(resolvedCommand) && !existsSync(resolvedCommand)) {
                failures.push(`${serverName}.command risolve a path inesistente: ${resolvedCommand}`);
            }
        }

        if (Array.isArray(server.args)) {
            server.args.forEach((arg, index) => {
                if (typeof arg !== 'string') {
                    return;
                }
                const resolvedArg = resolveExpansion(arg);
                if (looksLikePath(resolvedArg) && machinePathPattern.test(resolvedArg) && !existsSync(resolvedArg)) {
                    failures.push(`${serverName}.args[${index}] risolve a path inesistente: ${resolvedArg}`);
                }
            });
        }
    }

    if (failures.length > 0) {
        return {
            name: 'Path risolti localmente',
            passed: false,
            detail: failures.join(' | '),
        };
    }

    return {
        name: 'Path risolti localmente',
        passed: true,
        detail: 'Default locali risolvibili oppure comandi da PATH.',
    };
}

function run(): void {
    const config = readJson(mcpPath);
    const checks = [
        checkSchema(config),
        checkTransportCoherence(config),
        checkMachinePathExpansion(config),
        checkResolvedLocalPaths(config),
    ];

    let allPassed = true;
    console.log('\n=== MCP Config Audit ===\n');
    for (const check of checks) {
        const marker = check.passed ? '[OK]' : '[FAIL]';
        console.log(`${marker} ${check.name}`);
        console.log(`     ${check.detail}`);
        if (!check.passed) {
            allPassed = false;
        }
    }

    const passed = checks.filter((check) => check.passed).length;
    console.log(`\n${passed}/${checks.length} check passati.\n`);

    if (!allPassed) {
        process.exit(1);
    }
}

run();
