/**
 * browser/stealth.ts
 * ─────────────────────────────────────────────────────────────────
 * Fingerprint selection + anti-bot init script iniettato nelle pagine.
 */

import crypto from 'node:crypto';
import { config } from '../config';
import { randomElement } from '../utils/random';
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
        const fp = randomElement(cloudPool);
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

export function pickFingerprintMode(): boolean {
    return Math.random() < config.mobileProbability;
}

export function pickMobileFingerprint(cloudFingerprints: ReadonlyArray<CloudFingerprint>, accountId: string): BrowserFingerprint {
    const mobileOnly = cloudFingerprints.filter((fp) => fp.isMobile === true);
    if (mobileOnly.length > 0) {
        const fp = randomElement(mobileOnly);
        return normalizeCloudFingerprint(fp, true, accountId);
    }
    return pickBrowserFingerprint([], true, accountId);
}

export function pickDesktopFingerprint(cloudFingerprints: ReadonlyArray<CloudFingerprint>, accountId: string): BrowserFingerprint {
    return pickBrowserFingerprint(cloudFingerprints, false, accountId);
}
