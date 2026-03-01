import { Page } from 'playwright';

export interface DeviceProfile {
    fingerprintId: string;
    isMobile: boolean;
    hasTouch: boolean;
}

const pageProfileMap = new WeakMap<Page, DeviceProfile>();

export function registerPageDeviceProfile(page: Page, profile: DeviceProfile): void {
    pageProfileMap.set(page, profile);
}

export function getPageDeviceProfile(page: Page): DeviceProfile {
    return pageProfileMap.get(page) ?? {
        fingerprintId: 'unknown',
        isMobile: false,
        hasTouch: false,
    };
}

export function isMobilePage(page: Page): boolean {
    return getPageDeviceProfile(page).isMobile;
}

