import { describe, it, expect, afterEach } from 'vitest';
import { parseIntEnv, parseFloatEnv, parseBoolEnv, parseStringEnv, parseCsvEnv, isAiRequestConfigured, isLocalAiEndpoint } from '../config/env';

const orig = { ...process.env };
afterEach(() => { process.env = { ...orig }; });

describe('config/env — comprehensive', () => {
    it('parseIntEnv Infinity → fallback', () => {
        process.env.X = 'Infinity';
        expect(parseIntEnv('X', 42)).toBe(42);
    });

    it('parseFloatEnv Infinity → fallback', () => {
        process.env.X = 'Infinity';
        expect(parseFloatEnv('X', 1.5)).toBe(1.5);
    });

    it('parseBoolEnv TRUE uppercase → true', () => {
        process.env.X = 'TRUE';
        expect(parseBoolEnv('X', false)).toBe(true);
    });

    it('parseBoolEnv 0 → false', () => {
        process.env.X = '0';
        expect(parseBoolEnv('X', true)).toBe(false);
    });

    it('parseBoolEnv random string → false', () => {
        process.env.X = 'maybe';
        expect(parseBoolEnv('X', true)).toBe(false);
    });

    it('parseStringEnv with spaces → trimmed', () => {
        process.env.X = '  hello  ';
        expect(parseStringEnv('X', '')).toBe('hello');
    });

    it('parseCsvEnv with trailing comma', () => {
        process.env.X = 'a,b,c,';
        const result = parseCsvEnv('X');
        expect(result.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    });

    it('isLocalAiEndpoint localhost → true', () => {
        expect(isLocalAiEndpoint('http://localhost:11434')).toBe(true);
    });

    it('isLocalAiEndpoint 127.0.0.1 → true', () => {
        expect(isLocalAiEndpoint('http://127.0.0.1:11434')).toBe(true);
    });

    it('isLocalAiEndpoint remote → false', () => {
        expect(isLocalAiEndpoint('https://api.openai.com')).toBe(false);
    });

    it('isAiRequestConfigured local without key → true', () => {
        expect(isAiRequestConfigured('http://localhost:11434', '')).toBe(true);
    });

    it('isAiRequestConfigured remote without key → false', () => {
        expect(isAiRequestConfigured('https://api.openai.com', '')).toBe(false);
    });
});
