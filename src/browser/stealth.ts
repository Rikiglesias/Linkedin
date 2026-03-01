/**
 * browser/stealth.ts
 * ─────────────────────────────────────────────────────────────────
 * Fingerprint selection + anti-bot init script iniettato nelle pagine.
 */

import { config } from '../config';
import {
    Fingerprint,
    desktopFingerprintPool,
    mobileFingerprintPool,
    pickRandomFingerprint,
} from '../fingerprint/pool';

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

export interface BrowserFingerprint extends Fingerprint { }

function randomElement<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(Math.random() * arr.length)] as T;
}

function normalizeCloudFingerprint(input: CloudFingerprint, isMobile: boolean): BrowserFingerprint {
    const defaultPool = isMobile ? mobileFingerprintPool : desktopFingerprintPool;
    const base = pickRandomFingerprint(defaultPool);
    return {
        id: `cloud_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
        ja3: input.ja3 ?? config.ja3Fingerprint,
        userAgent: input.userAgent,
        viewport: input.viewport ?? base.viewport,
        timezone: input.timezone ?? config.timezone,
        locale: input.locale ?? 'it-IT',
        isMobile: input.isMobile ?? isMobile,
        hasTouch: input.hasTouch ?? (input.isMobile ?? isMobile),
        deviceScaleFactor: input.deviceScaleFactor ?? (input.isMobile ?? isMobile ? 2.5 : 1),
    };
}

export function pickBrowserFingerprint(
    cloudFingerprints: ReadonlyArray<CloudFingerprint>,
    isMobile: boolean
): BrowserFingerprint {
    const mobileFiltered = cloudFingerprints.filter((item) => item.isMobile === true);
    const desktopFiltered = cloudFingerprints.filter((item) => item.isMobile !== true);
    const cloudPool = isMobile
        ? (mobileFiltered.length > 0 ? mobileFiltered : cloudFingerprints)
        : (desktopFiltered.length > 0 ? desktopFiltered : cloudFingerprints);

    if (cloudPool.length > 0) {
        const fp = randomElement(cloudPool);
        return normalizeCloudFingerprint(fp, isMobile);
    }

    const localPool = isMobile ? mobileFingerprintPool : desktopFingerprintPool;
    const selected = pickRandomFingerprint(localPool);
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

export function pickMobileFingerprint(cloudFingerprints: ReadonlyArray<CloudFingerprint>): BrowserFingerprint {
    if (cloudFingerprints.length > 0) {
        const fp = randomElement(cloudFingerprints);
        return normalizeCloudFingerprint(fp, true);
    }
    return pickBrowserFingerprint([], true);
}

export function pickDesktopFingerprint(cloudFingerprints: ReadonlyArray<CloudFingerprint>): BrowserFingerprint {
    return pickBrowserFingerprint(cloudFingerprints, false);
}
