/**
 * browserIdentityProjection.ts — le tre PROIEZIONI dell'identità persistita (C23) verso chi la consuma.
 *
 * Pure: prendono `PersistedBrowserIdentity` e restituiscono esattamente ciò che il launcher passa a
 * `buildStealthInitScript`/`contextOptions`, al resto del lifecycle (device profile, noise, log) e a `Camoufox()`.
 * Il test C23 le confronta byte a byte fra due lanci con pool cloud diverso: se il pool entrasse qui, si vedrebbe.
 */
import type { BrowserFingerprint } from './stealth';
import type { IdentityOs, PersistedBrowserIdentity } from './browserIdentity';

/** I valori che `buildStealthInitScript` e `contextOptions` devono leggere: dal file, mai dal pool. */
export function stealthInputsFromIdentity(identity: PersistedBrowserIdentity): {
    userAgent: string;
    locale: string;
    languages: string[];
    timezone: string | undefined;
    viewportWidth: number;
    viewportHeight: number;
    hardwareConcurrency: number;
    deviceMemory: number | null;
    colorDepth: number;
} {
    return {
        userAgent: identity.userAgent,
        locale: identity.locale,
        languages: [...identity.languages],
        timezone: identity.timezone,
        viewportWidth: identity.viewport.width,
        viewportHeight: identity.viewport.height,
        hardwareConcurrency: identity.hardwareConcurrency,
        deviceMemory: identity.deviceMemory,
        colorDepth: identity.colorDepth,
    };
}

/** La forma che il resto del launcher (device profile, noise, log) già consuma. */
export function identityToBrowserFingerprint(identity: PersistedBrowserIdentity): BrowserFingerprint {
    return {
        id: identity.fingerprintId,
        userAgent: identity.userAgent,
        viewport: { ...identity.viewport },
        timezone: identity.timezone,
        locale: identity.locale,
        isMobile: identity.isMobile,
        hasTouch: identity.hasTouch,
        deviceScaleFactor: identity.deviceScaleFactor,
        ja3: identity.ja3,
    };
}

/** Ciò che Camoufox riceve dal file: `fingerprint` + `os` + seme font (`setInto` non sovrascrive una chiave presente). */
export function camoufoxIdentityLaunchOptions(identity: PersistedBrowserIdentity): {
    fingerprint: unknown;
    os: IdentityOs;
    config: Record<string, number>;
} {
    return {
        fingerprint: identity.browserforge,
        os: identity.os,
        config: { 'fonts:spacing_seed': identity.fontsSpacingSeed },
    };
}
