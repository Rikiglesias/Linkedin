import { describe, test, expect } from 'vitest';
import { normalizeSqlForPg } from '../db';

describe('SQLite → PostgreSQL SQL normalization', () => {
    test('? placeholder → $N positional params', () => {
        const result = normalizeSqlForPg('SELECT * FROM leads WHERE id = ? AND status = ?');
        expect(result).toBe('SELECT * FROM leads WHERE id = $1 AND status = $2');
    });

    test("DATETIME('now') → CURRENT_TIMESTAMP", () => {
        const result = normalizeSqlForPg("UPDATE t SET updated_at = DATETIME('now') WHERE id = ?");
        expect(result).toContain('CURRENT_TIMESTAMP');
        expect(result).not.toContain("DATETIME('now')");
        expect(result).toContain('$1');
    });

    test("DATE('now') → CURRENT_DATE", () => {
        const result = normalizeSqlForPg("SELECT * FROM t WHERE date = DATE('now')");
        expect(result).toContain('CURRENT_DATE');
    });

    test("DATETIME('now', '-7 days') → CURRENT_TIMESTAMP - INTERVAL", () => {
        const result = normalizeSqlForPg("SELECT * FROM t WHERE created_at > DATETIME('now', '-7 days')");
        expect(result).toContain("CURRENT_TIMESTAMP - INTERVAL '7 days'");
    });

    test("DATETIME('now', '+30 minutes') → CURRENT_TIMESTAMP + INTERVAL", () => {
        const result = normalizeSqlForPg("UPDATE t SET expires_at = DATETIME('now', '+30 minutes')");
        expect(result).toContain("CURRENT_TIMESTAMP + INTERVAL '30 minutes'");
    });

    test("DATE('now', '-90 days') → CURRENT_DATE - INTERVAL", () => {
        const result = normalizeSqlForPg("DELETE FROM t WHERE created_at < DATE('now', '-90 days')");
        expect(result).toContain("CURRENT_DATE - INTERVAL '90 days'");
    });

    test("DATETIME('now', '-' || $N || ' hours') → dynamic interval", () => {
        const result = normalizeSqlForPg("SELECT * FROM t WHERE created_at < DATETIME('now', '-' || ? || ' hours')");
        expect(result).toContain('::interval');
        expect(result).toContain('$1');
    });

    test('INSERT OR IGNORE → INSERT INTO ... ON CONFLICT DO NOTHING', () => {
        const result = normalizeSqlForPg('INSERT OR IGNORE INTO blacklist (url) VALUES (?);');
        expect(result).toContain('INSERT INTO');
        expect(result).toContain('ON CONFLICT DO NOTHING');
        expect(result).not.toContain('INSERT OR IGNORE');
    });

    test('INSERT OR IGNORE con ON CONFLICT esplicito → non aggiunge duplicato', () => {
        const result = normalizeSqlForPg(
            'INSERT OR IGNORE INTO t (id, val) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET val = excluded.val',
        );
        expect(result).toContain('INSERT INTO');
        expect(result).not.toContain('INSERT OR IGNORE');
        const conflicts = (result.match(/ON CONFLICT/gi) ?? []).length;
        expect(conflicts).toBe(1);
    });

    test('strftime timestamp → TO_CHAR', () => {
        const result = normalizeSqlForPg("SELECT strftime('%Y-%m-%dT%H:%M:%f', 'now') AS ts");
        expect(result).toContain('TO_CHAR(CURRENT_TIMESTAMP');
        expect(result).not.toContain('strftime');
    });

    test('query senza pattern SQLite-specific → invariata (a parte ?→$N)', () => {
        const result = normalizeSqlForPg('SELECT id, name FROM leads WHERE status = ? ORDER BY id LIMIT ?');
        expect(result).toBe('SELECT id, name FROM leads WHERE status = $1 ORDER BY id LIMIT $2');
    });

    test('query multipla con mix di pattern', () => {
        const sql = "INSERT OR IGNORE INTO sync_state (key, value, updated_at) VALUES (?, ?, DATETIME('now'));";
        const result = normalizeSqlForPg(sql);
        expect(result).toContain('INSERT INTO');
        expect(result).toContain('CURRENT_TIMESTAMP');
        expect(result).toContain('$1');
        expect(result).toContain('$2');
        expect(result).toContain('ON CONFLICT DO NOTHING');
    });
});
