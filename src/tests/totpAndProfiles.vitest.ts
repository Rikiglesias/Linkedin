import { describe, it, expect } from 'vitest';
import { generateTotpSecret } from '../security/totp';

describe('security/totp', () => {
    it('generateTotpSecret ritorna secret e URI', () => {
        const result = generateTotpSecret();
        expect(result.secret).toBeTruthy();
        expect(result.uri).toBeTruthy();
    });

    it('secret è base32 (solo A-Z e 2-7)', () => {
        const result = generateTotpSecret();
        expect(result.secret).toMatch(/^[A-Z2-7]+=*$/);
    });

    it('URI contiene otpauth://', () => {
        const result = generateTotpSecret();
        expect(result.uri).toContain('otpauth://totp/');
    });

    it('genera secret diversi ad ogni chiamata', () => {
        const a = generateTotpSecret();
        const b = generateTotpSecret();
        expect(a.secret).not.toBe(b.secret);
    });
});
