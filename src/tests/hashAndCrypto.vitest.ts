import { describe, it, expect } from 'vitest';
import { hashMessage } from '../validation/messageValidator';
import { generateTotpSecret } from '../security/totp';

describe('hashMessage — collision resistance', () => {
    it('1000 messaggi unici → 1000 hash unici', () => {
        const hashes = new Set<string>();
        for (let i = 0; i < 1000; i++) {
            hashes.add(hashMessage(`unique message number ${i} with random suffix ${Math.random()}`));
        }
        expect(hashes.size).toBe(1000);
    });

    it('hash di messaggi con differenza minima → diversi', () => {
        const h1 = hashMessage('Hello World!');
        const h2 = hashMessage('Hello World.');
        expect(h1).not.toBe(h2);
    });

    it('hash con unicode', () => {
        const h = hashMessage('Ciao 👋 Müller François 张三');
        expect(h).toMatch(/^[a-f0-9]{64}$/);
    });
});

describe('generateTotpSecret — uniqueness', () => {
    it('10 secret consecutivi sono tutti diversi', () => {
        const secrets = new Set<string>();
        for (let i = 0; i < 10; i++) {
            secrets.add(generateTotpSecret().secret);
        }
        expect(secrets.size).toBe(10);
    });

    it('URI contiene issuer', () => {
        const { uri } = generateTotpSecret();
        expect(uri).toContain('issuer=');
    });

    it('secret ha almeno 16 caratteri', () => {
        const { secret } = generateTotpSecret();
        expect(secret.length).toBeGreaterThanOrEqual(16);
    });
});
