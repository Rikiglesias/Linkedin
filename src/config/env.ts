import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { AccountProfileConfig, EventSyncSink, ProxyType } from './types';

export function loadDotEnv(): void {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
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

export function isLocalAiEndpoint(baseUrl: string): boolean {
    try {
        const url = new URL(baseUrl);
        const host = url.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
            return true;
        }
        return host.endsWith('.local');
    } catch {
        return false;
    }
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
    if (raw === 'SUPABASE' || raw === 'WEBHOOK' || raw === 'NONE') {
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
