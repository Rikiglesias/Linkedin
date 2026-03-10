/**
 * browser/stealth.ts
 * ─────────────────────────────────────────────────────────────────
 * Fingerprint selection + anti-bot init script iniettato nelle pagine.
 */

import crypto from 'node:crypto';
import { config } from '../config';
import { Fingerprint, desktopFingerprintPool, mobileFingerprintPool, pickDeterministicFingerprint } from '../fingerprint/pool';

const FINGERPRINT_VERSION = '1';

export interface CloudFingerprint {
    userAgent: string;
    ja3?: string;
    viewport?: { width: number; height: number };
    timezone?: string;
    locale?: string;
    isMobile?: boolean;
    hasTouch?: boolean;
    deviceScaleFactor?: number;
}

export interface BrowserFingerprint extends Fingerprint {}

function normalizeCloudFingerprint(input: CloudFingerprint, isMobile: boolean, accountId: string): BrowserFingerprint {
    const defaultPool = isMobile ? mobileFingerprintPool : desktopFingerprintPool;
    const base = pickDeterministicFingerprint(defaultPool, accountId);
    const id = crypto.createHash('sha256').update(accountId + FINGERPRINT_VERSION).digest('hex').slice(0, 16);
    return {
        id,
        ja3: input.ja3 ?? config.ja3Fingerprint,
        userAgent: input.userAgent,
        viewport: input.viewport ?? base.viewport,
        timezone: input.timezone ?? config.timezone,
        locale: input.locale ?? 'it-IT',
        isMobile: input.isMobile ?? isMobile,
        hasTouch: input.hasTouch ?? input.isMobile ?? isMobile,
        deviceScaleFactor: input.deviceScaleFactor ?? ((input.isMobile ?? isMobile) ? 2.5 : 1),
    };
}

export function pickBrowserFingerprint(
    cloudFingerprints: ReadonlyArray<CloudFingerprint>,
    isMobile: boolean,
    accountId: string,
): BrowserFingerprint {
    const mobileFiltered = cloudFingerprints.filter((item) => item.isMobile === true);
    const desktopFiltered = cloudFingerprints.filter((item) => item.isMobile !== true);
    const cloudPool = isMobile
        ? mobileFiltered.length > 0
            ? mobileFiltered
            : cloudFingerprints
        : desktopFiltered.length > 0
          ? desktopFiltered
          : cloudFingerprints;

    if (cloudPool.length > 0) {
        // Selezione deterministica anche dal cloud pool: stesso account → stesso fingerprint per ~1 settimana
        const now = new Date();
        const weekNumber = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
        const seed = `${accountId}:cloud:week${weekNumber}`;
        let hash = 0x811c9dc5;
        for (let i = 0; i < seed.length; i++) {
            hash ^= seed.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        const idx = (hash >>> 0) % cloudPool.length;
        const fp = cloudPool[idx] as CloudFingerprint;
        return normalizeCloudFingerprint(fp, isMobile, accountId);
    }

    const localPool = isMobile ? mobileFingerprintPool : desktopFingerprintPool;
    const selected = pickDeterministicFingerprint(localPool, accountId);
    return {
        ...selected,
        timezone: selected.timezone ?? config.timezone,
        locale: selected.locale ?? 'it-IT',
        isMobile: selected.isMobile ?? isMobile,
        hasTouch: selected.hasTouch ?? isMobile,
        deviceScaleFactor: selected.deviceScaleFactor ?? (isMobile ? 2.5 : 1),
    };
}

export function pickFingerprintMode(accountId?: string): boolean {
    if (!accountId || config.mobileProbability <= 0) return false;
    if (config.mobileProbability >= 1) return true;
    // Deterministico per account+settimana: lo stesso account è sempre mobile o desktop per tutta la settimana
    const now = new Date();
    const weekNumber = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
    const seed = `${accountId}:mode:week${weekNumber}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    // Normalizza hash a [0,1) e confronta con la probabilità
    return ((hash >>> 0) / 0xFFFFFFFF) < config.mobileProbability;
}

export function pickMobileFingerprint(cloudFingerprints: ReadonlyArray<CloudFingerprint>, accountId: string): BrowserFingerprint {
    const mobileOnly = cloudFingerprints.filter((fp) => fp.isMobile === true);
    if (mobileOnly.length > 0) {
        // Deterministico: stesso account → stesso fingerprint mobile per ~1 settimana
        return pickBrowserFingerprint(mobileOnly, true, accountId);
    }
    return pickBrowserFingerprint([], true, accountId);
}

export function pickDesktopFingerprint(cloudFingerprints: ReadonlyArray<CloudFingerprint>, accountId: string): BrowserFingerprint {
    return pickBrowserFingerprint(cloudFingerprints, false, accountId);
}
