import { Page } from 'playwright';

export interface DeviceProfile {
    fingerprintId: string;
    isMobile: boolean;
    hasTouch: boolean;
    canvasNoise?: number;
    webglNoise?: number;
    audioNoise?: number;
    /** Per-account timing multiplier from behavioral profile (NEW-4). Default 1.0. */
    profileMultiplier?: number;
}

const pageProfileMap = new WeakMap<Page, DeviceProfile>();

export function registerPageDeviceProfile(page: Page, profile: DeviceProfile): void {
    pageProfileMap.set(page, profile);
}

export function getPageDeviceProfile(page: Page): DeviceProfile {
    return (
        pageProfileMap.get(page) ?? {
            fingerprintId: 'unknown',
            isMobile: false,
            hasTouch: false,
        }
    );
}

export function isMobilePage(page: Page): boolean {
    return getPageDeviceProfile(page).isMobile;
}
