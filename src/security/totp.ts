/**
 * security/totp.ts
 * Supporto TOTP (Time-based One-Time Password) per 2FA dashboard.
 *
 * Flusso:
 *   1. Admin genera secret con generateTotpSecret() → salva in DASHBOARD_TOTP_SECRET
 *   2. Admin scansiona QR code (otpauth URI) con Google Authenticator/Authy
 *   3. Login dashboard: dopo API key/Basic auth validi, richiede codice TOTP 6 cifre
 *   4. validateTotpCode() verifica il codice con finestra ±1 (30s tolerance)
 *
 * Attivazione: DASHBOARD_TOTP_SECRET nel .env o Docker Secret.
 * Se non configurato, 2FA è disabilitato (retrocompatibile).
 */

import * as OTPAuth from 'otpauth';

const TOTP_ISSUER = 'LinkedInBot';
const TOTP_LABEL = 'Dashboard';
const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = 'SHA1';
const TOTP_WINDOW = 1;

/**
 * Verifica se il TOTP è configurato (secret presente).
 */
export function isTotpEnabled(): boolean {
    const secret = (process.env.DASHBOARD_TOTP_SECRET ?? '').trim();
    return secret.length >= 16;
}

/**
 * Valida un codice TOTP 6 cifre contro il secret configurato.
 * Ritorna true se il codice è valido (±1 finestra di 30s).
 */
export function validateTotpCode(code: string): boolean {
    const secret = (process.env.DASHBOARD_TOTP_SECRET ?? '').trim();
    if (!secret || secret.length < 16) return false;

    const cleanCode = code.replace(/\s/g, '').trim();
    if (!/^\d{6}$/.test(cleanCode)) return false;

    try {
        const totp = new OTPAuth.TOTP({
            issuer: TOTP_ISSUER,
            label: TOTP_LABEL,
            algorithm: TOTP_ALGORITHM,
            digits: TOTP_DIGITS,
            period: TOTP_PERIOD,
            secret: OTPAuth.Secret.fromBase32(secret),
        });

        const delta = totp.validate({ token: cleanCode, window: TOTP_WINDOW });
        return delta !== null;
    } catch {
        return false;
    }
}

/**
 * Genera un nuovo TOTP secret (base32) e l'URI otpauth per QR code.
 * L'admin chiama questo una volta, salva il secret nel .env, scansiona il QR.
 */
export function generateTotpSecret(): { secret: string; uri: string } {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
        issuer: TOTP_ISSUER,
        label: TOTP_LABEL,
        algorithm: TOTP_ALGORITHM,
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD,
        secret,
    });

    return {
        secret: secret.base32,
        uri: totp.toString(),
    };
}
