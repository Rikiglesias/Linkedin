import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

function parseIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolEnv(name: string, defaultValue: boolean): boolean {
    const val = process.env[name];
    if (val === undefined || val === '') return defaultValue;
    return val.toLowerCase() === 'true' || val === '1';
}

function parseStringEnv(name: string, fallback: string = ''): string {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return raw.trim();
}

function parseCsvEnv(name: string): string[] {
    const raw = parseStringEnv(name);
    if (!raw) return [];
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function resolvePathValue(rawPath: string): string {
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

export type EventSyncSink = 'SUPABASE' | 'WEBHOOK' | 'NONE';

export interface AccountProfileConfig {
    id: string;
    sessionDir: string;
    proxyUrl: string;
    proxyUsername: string;
    proxyPassword: string;
    warmupEnabled: boolean;
    warmupStartDate?: string;
    warmupMaxDays: number;
    warmupMinActions: number;
}

function parseEventSyncSinkEnv(name: string, fallback: EventSyncSink): EventSyncSink {
    const raw = parseStringEnv(name, fallback).toUpperCase();
    if (raw === 'SUPABASE' || raw === 'WEBHOOK' || raw === 'NONE') {
        return raw;
    }
    return fallback;
}

function resolvePathFromEnv(name: string, fallbackRelativePath: string): string {
    const raw = process.env[name];
    if (!raw) {
        return path.resolve(process.cwd(), fallbackRelativePath);
    }
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function parseAccountProfileFromEnv(slot: 1 | 2): AccountProfileConfig | null {
    const sessionDirRaw = parseStringEnv(`ACCOUNT_${slot}_SESSION_DIR`);
    if (!sessionDirRaw) {
        return null;
    }

    const fallbackId = `account${slot}`;
    const id = parseStringEnv(`ACCOUNT_${slot}_ID`, fallbackId) || fallbackId;
    return {
        id,
        sessionDir: resolvePathValue(sessionDirRaw),
        proxyUrl: parseStringEnv(`ACCOUNT_${slot}_PROXY_URL`),
        proxyUsername: parseStringEnv(`ACCOUNT_${slot}_PROXY_USERNAME`),
        proxyPassword: parseStringEnv(`ACCOUNT_${slot}_PROXY_PASSWORD`),
        warmupEnabled: parseBoolEnv(`ACCOUNT_${slot}_WARMUP_ENABLED`, false),
        warmupStartDate: parseStringEnv(`ACCOUNT_${slot}_WARMUP_START_DATE`),
        warmupMaxDays: parseIntEnv(`ACCOUNT_${slot}_WARMUP_MAX_DAYS`, 30),
        warmupMinActions: parseIntEnv(`ACCOUNT_${slot}_WARMUP_MIN_ACTIONS`, 5),
    };
}

export interface AppConfig {
    timezone: string;
    headless: boolean;
    dashboardAuthEnabled: boolean;
    dashboardApiKey: string;
    dashboardBasicUser: string;
    dashboardBasicPassword: string;
    dashboardTrustedIps: string[];
    workingHoursStart: number;
    workingHoursEnd: number;
    maxConcurrentJobs: number;
    jobStuckMinutes: number;
    retryMaxAttempts: number;
    retryBaseMs: number;
    workflowLoopIntervalMs: number;
    companyEnrichmentEnabled: boolean;
    companyEnrichmentBatch: number;
    companyEnrichmentMaxProfilesPerCompany: number;
    maxConsecutiveJobFailures: number;
    maxSelectorFailuresPerDay: number;
    maxRunErrorsPerDay: number;
    autoPauseMinutesOnFailureBurst: number;
    retentionDays: number;
    profileContextExtractionEnabled: boolean;
    softInviteCap: number;
    hardInviteCap: number;
    weeklyInviteLimit: number;
    softMsgCap: number;
    hardMsgCap: number;
    complianceEnforced: boolean;
    complianceMaxHardInviteCap: number;
    complianceMaxWeeklyInviteLimit: number;
    complianceMaxHardMsgCap: number;
    messageScheduleMinDelayHours: number;
    messageScheduleMaxDelayHours: number;
    riskWarnThreshold: number;
    riskStopThreshold: number;
    pendingRatioWarn: number;
    pendingRatioStop: number;
    adaptiveCapsEnabled: boolean;
    adaptiveCapsPendingWarn: number;
    adaptiveCapsPendingStop: number;
    adaptiveCapsBlockedWarn: number;
    adaptiveCapsMinFactor: number;
    adaptiveCapsWarnFactor: number;
    cooldownEnabled: boolean;
    cooldownWarnScore: number;
    cooldownHighScore: number;
    cooldownPendingThreshold: number;
    cooldownPendingHighThreshold: number;
    cooldownWarnMinutes: number;
    cooldownHighMinutes: number;
    noBurstEnabled: boolean;
    noBurstMinDelaySec: number;
    noBurstMaxDelaySec: number;
    noBurstLongBreakEvery: number;
    noBurstLongBreakMinSec: number;
    noBurstLongBreakMaxSec: number;
    autoSiteCheckEnabled: boolean;
    autoSiteCheckLimit: number;
    autoSiteCheckFix: boolean;
    autoSiteCheckIntervalHours: number;
    siteCheckStaleDays: number;
    postRunStateSyncEnabled: boolean;
    postRunStateSyncLimit: number;
    postRunStateSyncFix: boolean;
    selectorCanaryEnabled: boolean;
    outboxAlertBacklog: number;
    sessionDir: string;
    multiAccountEnabled: boolean;
    accountProfiles: AccountProfileConfig[];
    dbPath: string;
    databaseUrl: string;
    allowSqliteInProduction: boolean;
    eventSyncSink: EventSyncSink;
    supabaseSyncEnabled: boolean;
    supabaseUrl: string;
    supabaseServiceRoleKey: string;
    supabaseSyncBatchSize: number;
    supabaseSyncIntervalMs: number;
    supabaseSyncMaxRetries: number;
    supabaseControlPlaneEnabled: boolean;
    supabaseControlPlaneSyncIntervalMs: number;
    supabaseControlPlaneMaxCampaigns: number;
    webhookSyncEnabled: boolean;
    webhookSyncUrl: string;
    webhookSyncSecret: string;
    webhookSyncBatchSize: number;
    webhookSyncTimeoutMs: number;
    webhookSyncMaxRetries: number;
    openaiApiKey: string;
    openaiBaseUrl: string;
    aiModel: string;
    aiAllowRemoteEndpoint: boolean;
    aiRequestTimeoutMs: number;
    aiPersonalizationEnabled: boolean;
    aiMessageMaxChars: number;
    aiGuardianEnabled: boolean;
    aiGuardianMinIntervalMinutes: number;
    aiGuardianPauseMinutes: number;
    telegramBotToken: string;
    telegramChatId: string;
    discordWebhookUrl: string;
    slackWebhookUrl: string;
    // ── Phase 8 ────────────────────────────────────────────────────────────────
    backupRetentionDays: number;        // giorni di backup da mantenere (default 7)
    processMaxUptimeHours: number;      // ore prima del restart pianificato (default 24)
    hubspotApiKey: string;              // HubSpot Private App Token
    salesforceInstanceUrl: string;      // es. https://mycompany.salesforce.com
    salesforceClientId: string;
    salesforceClientSecret: string;
    hunterApiKey: string;               // Hunter.io API key
    clearbitApiKey: string;             // Clearbit Secret Key
    proxyUrl: string;
    proxyUsername: string;
    proxyPassword: string;
    proxyListPath: string;
    proxyFailureCooldownMinutes: number;
    proxyRotateEveryJobs: number;
    proxyRotateEveryMinutes: number;
    proxyHealthCheckTimeoutMs: number;
    proxyProviderApiEndpoint?: string;
    proxyProviderApiKey?: string;
    fingerprintApiEndpoint: string;

    // Warm-up policy
    warmupEnabled: boolean;
    warmupStartDate?: string;
    warmupMaxDays: number;
    warmupMinActions: number;

    // Hygiene settings (withdraw old pending invites)
    withdrawInvitesEnabled: boolean;
    pendingInviteMaxDays: number;
    inviteWithNote: boolean;
    inviteNoteMode: 'template' | 'ai';
    salesNavSyncEnabled: boolean;
    salesNavSyncListName: string;
    salesNavSyncListUrl: string;
    salesNavSyncMaxPages: number;
    salesNavSyncIntervalHours: number;
    salesNavSyncLimit: number;
    salesNavSyncAccountId: string;
    randomActivityEnabled: boolean;
    randomActivityProbability: number;
    randomActivityMaxActions: number;
    weekendPolicyEnabled: boolean;
}

const configuredAccountProfiles: AccountProfileConfig[] = [parseAccountProfileFromEnv(1), parseAccountProfileFromEnv(2)]
    .filter((profile): profile is AccountProfileConfig => profile !== null);

export const config: AppConfig = {
    timezone: process.env.TIMEZONE ?? 'Europe/Rome',
    headless: parseBoolEnv('HEADLESS', false),
    dashboardAuthEnabled: parseBoolEnv('DASHBOARD_AUTH_ENABLED', true),
    dashboardApiKey: parseStringEnv('DASHBOARD_API_KEY'),
    dashboardBasicUser: parseStringEnv('DASHBOARD_BASIC_USER'),
    dashboardBasicPassword: parseStringEnv('DASHBOARD_BASIC_PASSWORD'),
    dashboardTrustedIps: parseCsvEnv('DASHBOARD_TRUSTED_IPS'),
    workingHoursStart: parseIntEnv('HOUR_START', 9),
    workingHoursEnd: parseIntEnv('HOUR_END', 18),
    maxConcurrentJobs: Math.max(1, parseIntEnv('MAX_CONCURRENT_JOBS', 1)),
    jobStuckMinutes: Math.max(1, parseIntEnv('JOB_STUCK_MINUTES', 30)),
    retryMaxAttempts: Math.max(1, parseIntEnv('RETRY_MAX_ATTEMPTS', 3)),
    retryBaseMs: Math.max(100, parseIntEnv('RETRY_BASE_MS', 1200)),
    workflowLoopIntervalMs: Math.max(10_000, parseIntEnv('WORKFLOW_LOOP_INTERVAL_MS', 900000)),
    companyEnrichmentEnabled: parseBoolEnv('COMPANY_ENRICHMENT_ENABLED', true),
    companyEnrichmentBatch: Math.max(1, parseIntEnv('COMPANY_ENRICHMENT_BATCH', 5)),
    companyEnrichmentMaxProfilesPerCompany: Math.max(1, parseIntEnv('COMPANY_ENRICHMENT_MAX_PROFILES_PER_COMPANY', 3)),
    maxConsecutiveJobFailures: Math.max(1, parseIntEnv('MAX_CONSECUTIVE_JOB_FAILURES', 4)),
    maxSelectorFailuresPerDay: Math.max(1, parseIntEnv('MAX_SELECTOR_FAILURES_PER_DAY', 8)),
    maxRunErrorsPerDay: Math.max(1, parseIntEnv('MAX_RUN_ERRORS_PER_DAY', 20)),
    autoPauseMinutesOnFailureBurst: Math.max(1, parseIntEnv('AUTO_PAUSE_MINUTES_ON_FAILURE_BURST', 180)),
    retentionDays: Math.max(7, parseIntEnv('RETENTION_DAYS', 90)),
    profileContextExtractionEnabled: parseBoolEnv('PROFILE_CONTEXT_EXTRACTION_ENABLED', false),
    softInviteCap: Math.max(1, parseIntEnv('SOFT_INVITE_CAP', 25)),
    hardInviteCap: Math.max(1, parseIntEnv('HARD_INVITE_CAP', 35)),
    weeklyInviteLimit: Math.max(1, parseIntEnv('WEEKLY_INVITE_LIMIT', 120)),
    softMsgCap: Math.max(1, parseIntEnv('SOFT_MSG_CAP', 40)),
    hardMsgCap: Math.max(1, parseIntEnv('HARD_MSG_CAP', 60)),
    complianceEnforced: parseBoolEnv('COMPLIANCE_ENFORCED', true),
    complianceMaxHardInviteCap: Math.max(1, parseIntEnv('COMPLIANCE_MAX_HARD_INVITE_CAP', 20)),
    complianceMaxWeeklyInviteLimit: Math.max(1, parseIntEnv('COMPLIANCE_MAX_WEEKLY_INVITE_LIMIT', 100)),
    complianceMaxHardMsgCap: Math.max(1, parseIntEnv('COMPLIANCE_MAX_HARD_MSG_CAP', 40)),
    messageScheduleMinDelayHours: Math.max(0, parseIntEnv('MESSAGE_SCHEDULE_MIN_DELAY_HOURS', 0)),
    messageScheduleMaxDelayHours: Math.max(0, parseIntEnv('MESSAGE_SCHEDULE_MAX_DELAY_HOURS', 0)),
    riskWarnThreshold: parseIntEnv('RISK_WARN_THRESHOLD', 60),
    riskStopThreshold: parseIntEnv('RISK_STOP_THRESHOLD', 80),
    pendingRatioWarn: parseFloatEnv('PENDING_RATIO_WARN', 0.65),
    pendingRatioStop: parseFloatEnv('PENDING_RATIO_STOP', 0.8),
    adaptiveCapsEnabled: parseBoolEnv('ADAPTIVE_CAPS_ENABLED', true),
    adaptiveCapsPendingWarn: Math.min(1, Math.max(0, parseFloatEnv('ADAPTIVE_CAPS_PENDING_WARN', 0.55))),
    adaptiveCapsPendingStop: Math.min(1, Math.max(0, parseFloatEnv('ADAPTIVE_CAPS_PENDING_STOP', 0.72))),
    adaptiveCapsBlockedWarn: Math.min(1, Math.max(0, parseFloatEnv('ADAPTIVE_CAPS_BLOCKED_WARN', 0.25))),
    adaptiveCapsMinFactor: Math.min(1, Math.max(0.05, parseFloatEnv('ADAPTIVE_CAPS_MIN_FACTOR', 0.25))),
    adaptiveCapsWarnFactor: Math.min(1, Math.max(0.05, parseFloatEnv('ADAPTIVE_CAPS_WARN_FACTOR', 0.85))),
    cooldownEnabled: parseBoolEnv('COOLDOWN_ENABLED', true),
    cooldownWarnScore: Math.max(0, parseIntEnv('COOLDOWN_WARN_SCORE', 68)),
    cooldownHighScore: Math.max(0, parseIntEnv('COOLDOWN_HIGH_SCORE', 75)),
    cooldownPendingThreshold: Math.min(1, Math.max(0, parseFloatEnv('COOLDOWN_PENDING_THRESHOLD', 0.65))),
    cooldownPendingHighThreshold: Math.min(1, Math.max(0, parseFloatEnv('COOLDOWN_PENDING_HIGH_THRESHOLD', 0.75))),
    cooldownWarnMinutes: Math.max(10, parseIntEnv('COOLDOWN_WARN_MINUTES', 2880)),
    cooldownHighMinutes: Math.max(10, parseIntEnv('COOLDOWN_HIGH_MINUTES', 4320)),
    noBurstEnabled: parseBoolEnv('NO_BURST_ENABLED', true),
    noBurstMinDelaySec: Math.max(0, parseIntEnv('NO_BURST_MIN_DELAY_SEC', 8)),
    noBurstMaxDelaySec: Math.max(0, parseIntEnv('NO_BURST_MAX_DELAY_SEC', 25)),
    noBurstLongBreakEvery: Math.max(0, parseIntEnv('NO_BURST_LONG_BREAK_EVERY', 7)),
    noBurstLongBreakMinSec: Math.max(0, parseIntEnv('NO_BURST_LONG_BREAK_MIN_SEC', 120)),
    noBurstLongBreakMaxSec: Math.max(0, parseIntEnv('NO_BURST_LONG_BREAK_MAX_SEC', 360)),
    autoSiteCheckEnabled: parseBoolEnv('AUTO_SITE_CHECK_ENABLED', true),
    autoSiteCheckLimit: Math.max(1, parseIntEnv('AUTO_SITE_CHECK_LIMIT', 20)),
    autoSiteCheckFix: parseBoolEnv('AUTO_SITE_CHECK_FIX', true),
    autoSiteCheckIntervalHours: Math.max(1, parseIntEnv('AUTO_SITE_CHECK_INTERVAL_HOURS', 24)),
    siteCheckStaleDays: Math.max(0, parseIntEnv('SITE_CHECK_STALE_DAYS', 2)),
    postRunStateSyncEnabled: parseBoolEnv('POST_RUN_STATE_SYNC_ENABLED', true),
    postRunStateSyncLimit: Math.max(1, parseIntEnv('POST_RUN_STATE_SYNC_LIMIT', 8)),
    postRunStateSyncFix: parseBoolEnv('POST_RUN_STATE_SYNC_FIX', true),
    selectorCanaryEnabled: parseBoolEnv('SELECTOR_CANARY_ENABLED', true),
    outboxAlertBacklog: Math.max(1, parseIntEnv('OUTBOX_ALERT_BACKLOG', 1000)),
    sessionDir: resolvePathFromEnv('SESSION_DIR', path.join('data', 'session')),
    multiAccountEnabled: parseBoolEnv('MULTI_ACCOUNT_ENABLED', configuredAccountProfiles.length > 1),
    accountProfiles: configuredAccountProfiles,
    dbPath: resolvePathFromEnv('DB_PATH', path.join('data', 'linkedin_bot.sqlite')),
    databaseUrl: parseStringEnv('DATABASE_URL'),
    allowSqliteInProduction: parseBoolEnv('ALLOW_SQLITE_IN_PRODUCTION', false),
    eventSyncSink: parseEventSyncSinkEnv('EVENT_SYNC_SINK', 'SUPABASE'),
    supabaseSyncEnabled: parseBoolEnv('SUPABASE_SYNC_ENABLED', true),
    supabaseUrl: parseStringEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: parseStringEnv('SUPABASE_SERVICE_ROLE_KEY'),
    supabaseSyncBatchSize: Math.max(1, parseIntEnv('SUPABASE_SYNC_BATCH_SIZE', 100)),
    supabaseSyncIntervalMs: Math.max(1000, parseIntEnv('SUPABASE_SYNC_INTERVAL_MS', 15000)),
    supabaseSyncMaxRetries: Math.max(1, parseIntEnv('SUPABASE_SYNC_MAX_RETRIES', 8)),
    supabaseControlPlaneEnabled: parseBoolEnv('SUPABASE_CONTROL_PLANE_ENABLED', false),
    supabaseControlPlaneSyncIntervalMs: Math.max(1000, parseIntEnv('SUPABASE_CONTROL_PLANE_SYNC_INTERVAL_MS', 300000)),
    supabaseControlPlaneMaxCampaigns: Math.max(1, parseIntEnv('SUPABASE_CONTROL_PLANE_MAX_CAMPAIGNS', 500)),
    webhookSyncEnabled: parseBoolEnv('WEBHOOK_SYNC_ENABLED', false),
    webhookSyncUrl: parseStringEnv('WEBHOOK_SYNC_URL'),
    webhookSyncSecret: parseStringEnv('WEBHOOK_SYNC_SECRET'),
    webhookSyncBatchSize: Math.max(1, parseIntEnv('WEBHOOK_SYNC_BATCH_SIZE', 100)),
    webhookSyncTimeoutMs: Math.max(1000, parseIntEnv('WEBHOOK_SYNC_TIMEOUT_MS', 10000)),
    webhookSyncMaxRetries: Math.max(1, parseIntEnv('WEBHOOK_SYNC_MAX_RETRIES', 8)),
    openaiApiKey: parseStringEnv('OPENAI_API_KEY'),
    openaiBaseUrl: parseStringEnv('OPENAI_BASE_URL', 'http://127.0.0.1:11434/v1'),
    aiModel: parseStringEnv('AI_MODEL', 'llama3.1:8b'),
    aiAllowRemoteEndpoint: parseBoolEnv('AI_ALLOW_REMOTE_ENDPOINT', false),
    aiRequestTimeoutMs: Math.max(1000, parseIntEnv('AI_REQUEST_TIMEOUT_MS', 12000)),
    aiPersonalizationEnabled: parseBoolEnv('AI_PERSONALIZATION_ENABLED', false),
    aiMessageMaxChars: Math.max(120, parseIntEnv('AI_MESSAGE_MAX_CHARS', 450)),
    aiGuardianEnabled: parseBoolEnv('AI_GUARDIAN_ENABLED', false),
    aiGuardianMinIntervalMinutes: Math.max(1, parseIntEnv('AI_GUARDIAN_MIN_INTERVAL_MINUTES', 60)),
    aiGuardianPauseMinutes: Math.max(10, parseIntEnv('AI_GUARDIAN_PAUSE_MINUTES', 180)),
    telegramBotToken: parseStringEnv('TELEGRAM_BOT_TOKEN'),
    telegramChatId: parseStringEnv('TELEGRAM_CHAT_ID'),
    discordWebhookUrl: parseStringEnv('DISCORD_WEBHOOK_URL'),
    slackWebhookUrl: parseStringEnv('SLACK_WEBHOOK_URL'),
    // ── Phase 8 ────────────────────────────────────────────────────────────────
    backupRetentionDays: Math.max(1, parseIntEnv('BACKUP_RETENTION_DAYS', 7)),
    processMaxUptimeHours: Math.max(1, parseIntEnv('PROCESS_MAX_UPTIME_HOURS', 24)),
    hubspotApiKey: parseStringEnv('HUBSPOT_API_KEY'),
    salesforceInstanceUrl: parseStringEnv('SALESFORCE_INSTANCE_URL'),
    salesforceClientId: parseStringEnv('SALESFORCE_CLIENT_ID'),
    salesforceClientSecret: parseStringEnv('SALESFORCE_CLIENT_SECRET'),
    hunterApiKey: parseStringEnv('HUNTER_API_KEY'),
    clearbitApiKey: parseStringEnv('CLEARBIT_API_KEY'),
    proxyUrl: parseStringEnv('PROXY_URL'),
    proxyUsername: parseStringEnv('PROXY_USERNAME'),
    proxyPassword: parseStringEnv('PROXY_PASSWORD'),
    proxyListPath: parseStringEnv('PROXY_LIST'),
    proxyFailureCooldownMinutes: Math.max(1, parseIntEnv('PROXY_FAILURE_COOLDOWN_MINUTES', 30)),
    proxyRotateEveryJobs: Math.max(0, parseIntEnv('PROXY_ROTATE_EVERY_JOBS', 0)),
    proxyRotateEveryMinutes: Math.max(0, parseIntEnv('PROXY_ROTATE_EVERY_MINUTES', 0)),
    proxyHealthCheckTimeoutMs: Math.max(1000, parseIntEnv('PROXY_HEALTH_CHECK_TIMEOUT_MS', 5000)),
    proxyProviderApiEndpoint: parseStringEnv('PROXY_PROVIDER_API_ENDPOINT'),
    proxyProviderApiKey: parseStringEnv('PROXY_PROVIDER_API_KEY'),
    fingerprintApiEndpoint: parseStringEnv('FINGERPRINT_API_ENDPOINT'),
    warmupEnabled: parseBoolEnv('WARMUP_ENABLED', false),
    warmupStartDate: parseStringEnv('WARMUP_START_DATE') || undefined,
    warmupMaxDays: Math.max(1, parseIntEnv('WARMUP_MAX_DAYS', 30)),
    warmupMinActions: Math.max(1, parseIntEnv('WARMUP_MIN_ACTIONS', 5)),

    withdrawInvitesEnabled: parseBoolEnv('WITHDRAW_INVITES_ENABLED', true),
    pendingInviteMaxDays: parseIntEnv('PENDING_INVITE_MAX_DAYS', 30),
    inviteWithNote: parseBoolEnv('INVITE_WITH_NOTE', false),
    inviteNoteMode: (parseStringEnv('INVITE_NOTE_MODE', 'template') === 'ai' ? 'ai' : 'template') as 'template' | 'ai',
    salesNavSyncEnabled: parseBoolEnv('SALESNAV_SYNC_ENABLED', false),
    salesNavSyncListName: parseStringEnv('SALESNAV_SYNC_LIST_NAME', 'default'),
    salesNavSyncListUrl: parseStringEnv('SALESNAV_SYNC_LIST_URL'),
    salesNavSyncMaxPages: Math.max(1, parseIntEnv('SALESNAV_SYNC_MAX_PAGES', 3)),
    salesNavSyncIntervalHours: Math.max(1, parseIntEnv('SALESNAV_SYNC_INTERVAL_HOURS', 24)),
    salesNavSyncLimit: Math.max(1, parseIntEnv('SALESNAV_SYNC_LIMIT', 30)),
    salesNavSyncAccountId: parseStringEnv('SALESNAV_SYNC_ACCOUNT_ID'),
    randomActivityEnabled: parseBoolEnv('RANDOM_ACTIVITY_ENABLED', false),
    randomActivityProbability: Math.min(1, Math.max(0, parseFloatEnv('RANDOM_ACTIVITY_PROBABILITY', 0.15))),
    randomActivityMaxActions: Math.max(1, parseIntEnv('RANDOM_ACTIVITY_MAX_ACTIONS', 3)),
    weekendPolicyEnabled: parseBoolEnv('WEEKEND_POLICY_ENABLED', true),
};

// Retrocompatibilità con vecchi moduli ancora presenti nel repository.
export const legacyLimits = {
    dailyInviteLimit: config.hardInviteCap,
    weeklyInviteLimit: config.weeklyInviteLimit,
    dailyMsgLimit: config.hardMsgCap,
};

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

export function getLocalDateString(now: Date = new Date(), timezone: string = config.timezone): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return formatter.format(now);
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
    const map: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    return map[formatted] ?? now.getDay();
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
