import {
    buildAiDomainConfig,
    buildBehaviorDomainConfig,
    buildCommsAndBusinessDomainConfig,
    buildLimitsAndRiskDomainConfig,
    buildProxyDomainConfig,
    buildRuntimeDomainConfig,
    buildSyncDomainConfig,
} from './domains';
import { loadDotEnv, parseAccountProfileFromEnv } from './env';
import { AppConfig, AccountProfileConfig, EventSyncSink, ProxyType } from './types';
import { validateConfigSchema } from './validation';

loadDotEnv();

const configuredAccountProfiles: AccountProfileConfig[] = [parseAccountProfileFromEnv(1), parseAccountProfileFromEnv(2)]
    .filter((profile): profile is AccountProfileConfig => profile !== null);

export const config: AppConfig = {
    ...buildRuntimeDomainConfig(configuredAccountProfiles),
    ...buildLimitsAndRiskDomainConfig(),
    ...buildSyncDomainConfig(),
    ...buildAiDomainConfig(),
    ...buildCommsAndBusinessDomainConfig(),
    ...buildProxyDomainConfig(),
    ...buildBehaviorDomainConfig(),
} as AppConfig;

function isHourInWindow(hour: number, start: number, end: number): boolean {
    if (start === end) return true;
    if (start < end) {
        return hour >= start && hour < end;
    }
    return hour >= start || hour < end;
}

export function getHourInTimezone(now: Date, timezone: string): number {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
    });
    const formatted = formatter.format(now);
    return Number.parseInt(formatted, 10);
}

export function getDayInTimezone(now: Date, timezone: string): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
    });
    const formatted = formatter.format(now);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[formatted] ?? now.getDay();
}

export function isWorkingHour(now: Date = new Date()): boolean {
    if (config.weekendPolicyEnabled) {
        const day = getDayInTimezone(now, config.timezone);
        if (day === 0 || day === 6) {
            return false;
        }
    }
    const hour = getHourInTimezone(now, config.timezone);
    return hour >= config.workingHoursStart && hour < config.workingHoursEnd;
}

export function isGreenModeWindow(now: Date = new Date()): boolean {
    if (!config.greenModeEnabled) {
        return false;
    }
    const hour = getHourInTimezone(now, config.timezone);
    return isHourInWindow(hour, config.greenModeStartHour, config.greenModeEndHour);
}

export function getEffectiveLoopIntervalMs(baseIntervalMs: number, now: Date = new Date()): number {
    if (!isGreenModeWindow(now)) {
        return baseIntervalMs;
    }
    return Math.max(baseIntervalMs, Math.floor(baseIntervalMs * config.greenModeIntervalMultiplier));
}

export function getWorkingHourIntensity(now: Date = new Date()): number {
    if (!isWorkingHour(now)) {
        return 0;
    }

    const day = getDayInTimezone(now, config.timezone);
    const hour = getHourInTimezone(now, config.timezone);

    if (day === 1 && isHourInWindow(hour, config.mondayLowActivityStartHour, config.mondayLowActivityEndHour)) {
        return config.mondayLowActivityFactor;
    }
    if (day === 5 && isHourInWindow(hour, config.fridayLowActivityStartHour, config.fridayLowActivityEndHour)) {
        return config.fridayLowActivityFactor;
    }

    return 1;
}

export function getLocalDateString(now: Date = new Date(), timezone: string = config.timezone): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return formatter.format(now);
}

export function getWeekStartDate(now: Date = new Date(), timezone: string = config.timezone): string {
    const localDate = getLocalDateString(now, timezone);
    const [year, month, day] = localDate.split('-').map((value) => Number.parseInt(value, 10));
    const anchor = new Date(Date.UTC(year, month - 1, day));
    const weekday = anchor.getUTCDay();
    const delta = weekday === 0 ? -6 : 1 - weekday;
    anchor.setUTCDate(anchor.getUTCDate() + delta);
    const anchorYear = anchor.getUTCFullYear();
    const anchorMonth = String(anchor.getUTCMonth() + 1).padStart(2, '0');
    const anchorDay = String(anchor.getUTCDate()).padStart(2, '0');
    return `${anchorYear}-${anchorMonth}-${anchorDay}`;
}

export function validateCriticalConfig(): string[] {
    return validateConfigSchema(config);
}

export type { AppConfig, AccountProfileConfig, EventSyncSink, ProxyType };
