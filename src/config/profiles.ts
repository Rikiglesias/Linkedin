/**
 * config/profiles.ts
 * Profili ambiente con default ragionevoli per dev, staging e production.
 * Il profilo è selezionato via CONFIG_PROFILE env var.
 * I valori .env sovrascrivono sempre i default del profilo.
 */

export type ConfigProfile = 'dev' | 'staging' | 'production';

export interface ProfileDefaults {
    HEADLESS: string;
    HARD_INVITE_CAP: string;
    HARD_MSG_CAP: string;
    SOFT_INVITE_CAP: string;
    SOFT_MSG_CAP: string;
    COMPLIANCE_ENFORCED: string;
    COMPLIANCE_DYNAMIC_WEEKLY_LIMIT_ENABLED: string;
    RISK_STOP_SCORE: string;
    RISK_WARN_SCORE: string;
    GROWTH_MODEL_ENABLED: string;
    DAILY_REPORT_AUTO_ENABLED: string;
    RETENTION_DAYS: string;
    BACKUP_RETENTION_DAYS: string;
    MANDATORY_PREFLIGHT_ENABLED: string;
    WEEKEND_POLICY_ENABLED: string;
    COOLDOWN_ENABLED: string;
    AI_PERSONALIZATION_ENABLED: string;
    SSI_DYNAMIC_LIMITS_ENABLED: string;
    ADAPTIVE_CAPS_ENABLED: string;
    STEALTH_SKIP_SECTIONS: string;
}

const DEV_DEFAULTS: ProfileDefaults = {
    HEADLESS: 'false',
    HARD_INVITE_CAP: '5',
    HARD_MSG_CAP: '3',
    SOFT_INVITE_CAP: '3',
    SOFT_MSG_CAP: '2',
    COMPLIANCE_ENFORCED: 'false',
    COMPLIANCE_DYNAMIC_WEEKLY_LIMIT_ENABLED: 'false',
    RISK_STOP_SCORE: '95',
    RISK_WARN_SCORE: '80',
    GROWTH_MODEL_ENABLED: 'false',
    DAILY_REPORT_AUTO_ENABLED: 'false',
    RETENTION_DAYS: '30',
    BACKUP_RETENTION_DAYS: '3',
    MANDATORY_PREFLIGHT_ENABLED: 'false',
    WEEKEND_POLICY_ENABLED: 'false',
    COOLDOWN_ENABLED: 'false',
    AI_PERSONALIZATION_ENABLED: 'false',
    SSI_DYNAMIC_LIMITS_ENABLED: 'false',
    ADAPTIVE_CAPS_ENABLED: 'false',
    STEALTH_SKIP_SECTIONS: '',
};

const STAGING_DEFAULTS: ProfileDefaults = {
    HEADLESS: 'true',
    HARD_INVITE_CAP: '10',
    HARD_MSG_CAP: '5',
    SOFT_INVITE_CAP: '7',
    SOFT_MSG_CAP: '3',
    COMPLIANCE_ENFORCED: 'true',
    COMPLIANCE_DYNAMIC_WEEKLY_LIMIT_ENABLED: 'true',
    RISK_STOP_SCORE: '80',
    RISK_WARN_SCORE: '55',
    GROWTH_MODEL_ENABLED: 'true',
    DAILY_REPORT_AUTO_ENABLED: 'true',
    RETENTION_DAYS: '60',
    BACKUP_RETENTION_DAYS: '5',
    MANDATORY_PREFLIGHT_ENABLED: 'true',
    WEEKEND_POLICY_ENABLED: 'true',
    COOLDOWN_ENABLED: 'true',
    AI_PERSONALIZATION_ENABLED: 'true',
    SSI_DYNAMIC_LIMITS_ENABLED: 'true',
    ADAPTIVE_CAPS_ENABLED: 'true',
    STEALTH_SKIP_SECTIONS: '',
};

const PRODUCTION_DEFAULTS: ProfileDefaults = {
    HEADLESS: 'true',
    HARD_INVITE_CAP: '20',
    HARD_MSG_CAP: '10',
    SOFT_INVITE_CAP: '15',
    SOFT_MSG_CAP: '8',
    COMPLIANCE_ENFORCED: 'true',
    COMPLIANCE_DYNAMIC_WEEKLY_LIMIT_ENABLED: 'true',
    RISK_STOP_SCORE: '75',
    RISK_WARN_SCORE: '50',
    GROWTH_MODEL_ENABLED: 'true',
    DAILY_REPORT_AUTO_ENABLED: 'true',
    RETENTION_DAYS: '90',
    BACKUP_RETENTION_DAYS: '7',
    MANDATORY_PREFLIGHT_ENABLED: 'true',
    WEEKEND_POLICY_ENABLED: 'true',
    COOLDOWN_ENABLED: 'true',
    AI_PERSONALIZATION_ENABLED: 'true',
    SSI_DYNAMIC_LIMITS_ENABLED: 'true',
    ADAPTIVE_CAPS_ENABLED: 'true',
    STEALTH_SKIP_SECTIONS: '',
};

const PROFILE_MAP: Record<ConfigProfile, ProfileDefaults> = {
    dev: DEV_DEFAULTS,
    staging: STAGING_DEFAULTS,
    production: PRODUCTION_DEFAULTS,
};

/**
 * Rileva il profilo configurato. Fallback: 'production' se NODE_ENV=production, altrimenti 'dev'.
 */
export function resolveConfigProfile(): ConfigProfile {
    const explicit = (process.env.CONFIG_PROFILE ?? '').trim().toLowerCase();
    if (explicit === 'dev' || explicit === 'staging' || explicit === 'production') {
        return explicit;
    }
    return process.env.NODE_ENV === 'production' ? 'production' : 'dev';
}

/**
 * Applica i default del profilo alle variabili env NON ancora impostate.
 * Le variabili esplicitamente impostate nel .env hanno sempre la precedenza.
 * Deve essere chiamata PRIMA di qualsiasi lettura config (parseIntEnv, parseBoolEnv, ecc.).
 */
export function applyProfileDefaults(): ConfigProfile {
    const profile = resolveConfigProfile();
    const defaults = PROFILE_MAP[profile];

    for (const [key, value] of Object.entries(defaults)) {
        if (process.env[key] === undefined || process.env[key] === '') {
            process.env[key] = value;
        }
    }

    return profile;
}
