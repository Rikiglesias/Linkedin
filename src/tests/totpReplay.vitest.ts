import { describe, test, expect, afterEach } from 'vitest';
import * as OTPAuth from 'otpauth';
import { validateTotpCode } from '../security/totp';

// Ondata-4: TOTP senza anti-replay -> lo stesso codice restava valido ~90s e riutilizzabile.
// Ora ogni codice (timestep) è usabile una sola volta.
const PREV = process.env.DASHBOARD_TOTP_SECRET;
afterEach(() => {
    if (PREV === undefined) delete process.env.DASHBOARD_TOTP_SECRET;
    else process.env.DASHBOARD_TOTP_SECRET = PREV;
});

function makeTotp(secret: OTPAuth.Secret): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
        issuer: 'LinkedInBot',
        label: 'Dashboard',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret,
    });
}

describe('validateTotpCode anti-replay (Ondata-4)', () => {
    test('codice valido accettato una volta, replay rifiutato', () => {
        const secret = new OTPAuth.Secret({ size: 20 });
        process.env.DASHBOARD_TOTP_SECRET = secret.base32;
        const code = makeTotp(secret).generate();

        expect(validateTotpCode(code)).toBe(true); // primo uso
        expect(validateTotpCode(code)).toBe(false); // replay -> rifiutato
    });

    test('codice malformato → false', () => {
        const secret = new OTPAuth.Secret({ size: 20 });
        process.env.DASHBOARD_TOTP_SECRET = secret.base32;
        expect(validateTotpCode('abc')).toBe(false);
        expect(validateTotpCode('12345')).toBe(false);
    });
});
