import { AppConfig } from './types';
import { isAiRequestConfigured } from './env';

interface ConfigValidationRule {
    message: string;
    when: (cfg: AppConfig, nodeEnv: string) => boolean;
}

const CONFIG_VALIDATION_RULES: ConfigValidationRule[] = [
    {
        message: '[CONFIG] SUPABASE_URL mancante ma SUPABASE_SYNC_ENABLED=true',
        when: (cfg) => cfg.supabaseSyncEnabled && !cfg.supabaseUrl,
    },
    {
        message: '[CONFIG] SUPABASE_SERVICE_ROLE_KEY mancante ma SUPABASE_SYNC_ENABLED=true',
        when: (cfg) => cfg.supabaseSyncEnabled && !cfg.supabaseServiceRoleKey,
    },
    {
        message: '[CONFIG] WEBHOOK_SYNC_URL mancante ma WEBHOOK_SYNC_ENABLED=true',
        when: (cfg) => cfg.webhookSyncEnabled && !cfg.webhookSyncUrl,
    },
    {
        message: '[CONFIG] DASHBOARD_AUTH_ENABLED=true ma nessuna credenziale configurata (DASHBOARD_API_KEY o DASHBOARD_BASIC_USER/PASSWORD)',
        when: (cfg) => cfg.dashboardAuthEnabled && !cfg.dashboardApiKey && !(cfg.dashboardBasicUser && cfg.dashboardBasicPassword),
    },
    {
        message: '[CONFIG] AI_PERSONALIZATION_ENABLED=true ma OPENAI_BASE_URL non è locale e OPENAI_API_KEY è mancante',
        when: (cfg) => cfg.aiPersonalizationEnabled && !isAiRequestConfigured(cfg.openaiBaseUrl, cfg.openaiApiKey),
    },
    {
        message: '[CONFIG] AI_SENTIMENT_ENABLED=true ma OPENAI_BASE_URL non è locale e OPENAI_API_KEY è mancante',
        when: (cfg) => cfg.aiSentimentEnabled && !isAiRequestConfigured(cfg.openaiBaseUrl, cfg.openaiApiKey),
    },
    {
        message: '[CONFIG] AI_GUARDIAN_ENABLED=true ma OPENAI_BASE_URL non è locale e OPENAI_API_KEY è mancante',
        when: (cfg) => cfg.aiGuardianEnabled && !isAiRequestConfigured(cfg.openaiBaseUrl, cfg.openaiApiKey),
    },
    {
        message: '[CONFIG] INVITE_NOTE_MODE=ai richiede AI_PERSONALIZATION_ENABLED=true',
        when: (cfg) => cfg.inviteNoteMode === 'ai' && !cfg.aiPersonalizationEnabled,
    },
    {
        message: '[CONFIG] USE_JA3_PROXY=true ma JA3_FINGERPRINT è vuoto',
        when: (cfg) => cfg.useJa3Proxy && !cfg.ja3Fingerprint,
    },
    {
        message: '[CONFIG] SSI_INVITE_MAX deve essere >= SSI_INVITE_MIN',
        when: (cfg) => cfg.ssiInviteMax < cfg.ssiInviteMin,
    },
    {
        message: '[CONFIG] SSI_MESSAGE_MAX deve essere >= SSI_MESSAGE_MIN',
        when: (cfg) => cfg.ssiMessageMax < cfg.ssiMessageMin,
    },
    {
        message: '[CONFIG] INTER_JOB_MAX_DELAY_SEC deve essere >= INTER_JOB_MIN_DELAY_SEC',
        when: (cfg) => cfg.interJobMaxDelaySec < cfg.interJobMinDelaySec,
    },
    {
        message: '[CONFIG] LOW_ACTIVITY_RISK_THRESHOLD deve essere <= RISK_STOP_THRESHOLD',
        when: (cfg) => cfg.lowActivityRiskThreshold > cfg.riskStopThreshold,
    },
    {
        message: '[CONFIG] RISK_WARN_THRESHOLD deve essere <= LOW_ACTIVITY_RISK_THRESHOLD',
        when: (cfg) => cfg.riskWarnThreshold > cfg.lowActivityRiskThreshold,
    },
    {
        message: '[CONFIG] DECOY_MAX_INTERVAL_JOBS deve essere >= DECOY_MIN_INTERVAL_JOBS',
        when: (cfg) => cfg.behaviorDecoyMaxIntervalJobs < cfg.behaviorDecoyMinIntervalJobs,
    },
    {
        message: '[CONFIG] COFFEE_BREAK_MAX_INTERVAL_JOBS deve essere >= COFFEE_BREAK_MIN_INTERVAL_JOBS',
        when: (cfg) => cfg.behaviorCoffeeBreakMaxIntervalJobs < cfg.behaviorCoffeeBreakMinIntervalJobs,
    },
    {
        message: '[CONFIG] COFFEE_BREAK_MAX_SEC deve essere >= COFFEE_BREAK_MIN_SEC',
        when: (cfg) => cfg.behaviorCoffeeBreakMaxSec < cfg.behaviorCoffeeBreakMinSec,
    },
    {
        message: '[CONFIG] MOBILE_PROBABILITY deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.mobileProbability < 0 || cfg.mobileProbability > 1,
    },
    {
        message: '[CONFIG] TIMING_EXPLORATION_PROBABILITY deve essere compreso tra 0 e 0.5',
        when: (cfg) => cfg.timingExplorationProbability < 0 || cfg.timingExplorationProbability > 0.5,
    },
    {
        message: '[CONFIG] GREEN_MODE_INTERVAL_MULTIPLIER deve essere >= 1',
        when: (cfg) => cfg.greenModeIntervalMultiplier < 1,
    },
    {
        message: '[CONFIG] FOLLOW_UP_NOT_INTERESTED_DELAY_DAYS deve essere >= FOLLOW_UP_DELAY_DAYS',
        when: (cfg) => cfg.followUpNotInterestedDelayDays < cfg.followUpDelayDays,
    },
    {
        message: '[CONFIG] INTEGRATION_RETRY_MAX_DELAY_MS deve essere >= RETRY_BASE_MS',
        when: (cfg) => cfg.integrationRetryMaxDelayMs < cfg.retryBaseMs,
    },
    {
        message: '[CONFIG] INTEGRATION_CIRCUIT_FAILURE_THRESHOLD deve essere >= 1',
        when: (cfg) => cfg.integrationCircuitFailureThreshold < 1,
    },
    {
        message: '[CONFIG] INTEGRATION_CIRCUIT_OPEN_MS deve essere >= 1000',
        when: (cfg) => cfg.integrationCircuitOpenMs < 1000,
    },
    {
        message: '[CONFIG] ACCOUNT_HEALTH_CRITICAL_FAILURE_RATE deve essere >= ACCOUNT_HEALTH_WARN_FAILURE_RATE',
        when: (cfg) => cfg.accountHealthCriticalFailureRate < cfg.accountHealthWarnFailureRate,
    },
    {
        message: '[CONFIG] ACCOUNT_HEALTH_WARN_FAILURE_RATE deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.accountHealthWarnFailureRate < 0 || cfg.accountHealthWarnFailureRate > 1,
    },
    {
        message: '[CONFIG] ACCOUNT_HEALTH_CRITICAL_FAILURE_RATE deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.accountHealthCriticalFailureRate < 0 || cfg.accountHealthCriticalFailureRate > 1,
    },
    {
        message: '[CONFIG] AI_QUALITY_SIGNIFICANCE_ALPHA deve essere compreso tra 0.001 e 0.25',
        when: (cfg) => cfg.aiQualitySignificanceAlpha < 0.001 || cfg.aiQualitySignificanceAlpha > 0.25,
    },
    {
        message: '[CONFIG] NODE_ENV=production ma DATABASE_URL non configurata — il bot userà SQLite (non raccomandato in produzione)',
        when: (cfg, nodeEnv) => nodeEnv === 'production' && !cfg.databaseUrl,
    },
    {
        message: '[CONFIG] SESSION_DIR mancante — directory sessione Playwright obbligatoria',
        when: (cfg) => !cfg.sessionDir,
    },
];

export function validateConfigSchema(config: AppConfig, nodeEnv: string = process.env.NODE_ENV ?? ''): string[] {
    const errors: string[] = [];
    for (const rule of CONFIG_VALIDATION_RULES) {
        if (rule.when(config, nodeEnv)) {
            errors.push(rule.message);
        }
    }
    return errors;
}
