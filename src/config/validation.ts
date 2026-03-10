import { AppConfig } from './types';
import { isAiRequestConfigured } from './env';

interface ConfigValidationRule {
    message: string;
    when: (cfg: AppConfig, nodeEnv: string) => boolean;
    /** 'error' (default) blocks startup; 'warn' only prints a warning. */
    severity?: 'error' | 'warn';
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
        message:
            '[CONFIG] DASHBOARD_AUTH_ENABLED=true ma nessuna credenziale configurata (DASHBOARD_API_KEY o DASHBOARD_BASIC_USER/PASSWORD)',
        when: (cfg) =>
            cfg.dashboardAuthEnabled && !cfg.dashboardApiKey && !(cfg.dashboardBasicUser && cfg.dashboardBasicPassword),
    },
    {
        message: '[CONFIG] DAILY_REPORT_HOUR deve essere compreso tra 0 e 23',
        when: (cfg) => cfg.dailyReportHour < 0 || cfg.dailyReportHour > 23,
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
        message: '[CONFIG] TIMING_MIN_SLOT_SAMPLE deve essere >= 1',
        when: (cfg) => cfg.timingMinSlotSample < 1,
    },
    {
        message: '[CONFIG] TIMING_SCORE_THRESHOLD deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.timingScoreThreshold < 0 || cfg.timingScoreThreshold > 1,
    },
    {
        message: '[CONFIG] TIMING_RECENT_WINDOW_DAYS deve essere >= 1',
        when: (cfg) => cfg.timingRecentWindowDays < 1,
    },
    {
        message: '[CONFIG] TIMING_RECENT_WEIGHT deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.timingRecentWeight < 0 || cfg.timingRecentWeight > 1,
    },
    {
        message: '[CONFIG] TIMING_BAYES_PRIOR_WEIGHT deve essere >= 0',
        when: (cfg) => cfg.timingBayesPriorWeight < 0,
    },
    {
        message: '[CONFIG] TIMING_MAX_DELAY_HOURS deve essere >= 1',
        when: (cfg) => cfg.timingMaxDelayHours < 1,
    },
    {
        message: '[CONFIG] TIMING_AB_LOOKBACK_DAYS deve essere >= 1',
        when: (cfg) => cfg.timingAbLookbackDays < 1,
    },
    {
        message: '[CONFIG] TIMING_AB_SIGNIFICANCE_ALPHA deve essere compreso tra 0.001 e 0.25',
        when: (cfg) => cfg.timingAbSignificanceAlpha < 0.001 || cfg.timingAbSignificanceAlpha > 0.25,
    },
    {
        message: '[CONFIG] DR_RESTORE_TEST_INTERVAL_DAYS deve essere >= 1',
        when: (cfg) => cfg.disasterRecoveryRestoreTestIntervalDays < 1,
    },
    {
        message: '[CONFIG] SECURITY_ADVISOR_INTERVAL_DAYS deve essere >= 1',
        when: (cfg) => cfg.securityAdvisorIntervalDays < 1,
    },
    {
        message: '[CONFIG] SECURITY_ADVISOR_DOC_MAX_AGE_DAYS deve essere >= 1',
        when: (cfg) => cfg.securityAdvisorDocMaxAgeDays < 1,
    },
    {
        message: '[CONFIG] SECURITY_ADVISOR_AUDIT_LOOKBACK_DAYS deve essere >= 1',
        when: (cfg) => cfg.securityAdvisorAuditLookbackDays < 1,
    },
    {
        message: '[CONFIG] SECURITY_ADVISOR_MIN_AUDIT_EVENTS deve essere >= 0',
        when: (cfg) => cfg.securityAdvisorMinAuditEvents < 0,
    },
    {
        message: '[CONFIG] RAMPUP_MODEL_WARMUP_DAYS deve essere >= 7',
        when: (cfg) => cfg.rampUpModelWarmupDays < 7,
    },
    {
        message: '[CONFIG] SELECTOR_LEARNING_MIN_SUCCESS deve essere >= 1',
        when: (cfg) => cfg.selectorLearningMinSuccess < 1,
    },
    {
        message: '[CONFIG] SELECTOR_LEARNING_LIMIT deve essere >= 1',
        when: (cfg) => cfg.selectorLearningLimit < 1,
    },
    {
        message: '[CONFIG] SELECTOR_LEARNING_EVALUATION_WINDOW_DAYS deve essere >= 1',
        when: (cfg) => cfg.selectorLearningEvaluationWindowDays < 1,
    },
    {
        message: '[CONFIG] SELECTOR_LEARNING_FAILURE_DEGRADE_RATIO deve essere >= 0',
        when: (cfg) => cfg.selectorLearningFailureDegradeRatio < 0,
    },
    {
        message: '[CONFIG] SELECTOR_LEARNING_FAILURE_DEGRADE_MIN_DELTA deve essere >= 1',
        when: (cfg) => cfg.selectorLearningFailureDegradeMinDelta < 1,
    },
    {
        message: '[CONFIG] SELECTOR_CACHE_KPI_MIN_BASELINE_FAILURES deve essere >= 0',
        when: (cfg) => cfg.selectorCacheKpiMinBaselineFailures < 0,
    },
    {
        message: '[CONFIG] OBSERVABILITY_SLO_WINDOW_SHORT_DAYS deve essere >= 1',
        when: (cfg) => cfg.observabilitySloWindowShortDays < 1,
    },
    {
        message: '[CONFIG] OBSERVABILITY_SLO_WINDOW_LONG_DAYS deve essere >= OBSERVABILITY_SLO_WINDOW_SHORT_DAYS',
        when: (cfg) => cfg.observabilitySloWindowLongDays < cfg.observabilitySloWindowShortDays,
    },
    {
        message: '[CONFIG] OBSERVABILITY_SLO_ERROR_RATE_WARN deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.observabilitySloErrorRateWarn < 0 || cfg.observabilitySloErrorRateWarn > 1,
    },
    {
        message: '[CONFIG] OBSERVABILITY_SLO_ERROR_RATE_CRITICAL deve essere >= OBSERVABILITY_SLO_ERROR_RATE_WARN',
        when: (cfg) => cfg.observabilitySloErrorRateCritical < cfg.observabilitySloErrorRateWarn,
    },
    {
        message: '[CONFIG] OBSERVABILITY_SLO_CHALLENGE_RATE_WARN deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.observabilitySloChallengeRateWarn < 0 || cfg.observabilitySloChallengeRateWarn > 1,
    },
    {
        message:
            '[CONFIG] OBSERVABILITY_SLO_CHALLENGE_RATE_CRITICAL deve essere >= OBSERVABILITY_SLO_CHALLENGE_RATE_WARN',
        when: (cfg) => cfg.observabilitySloChallengeRateCritical < cfg.observabilitySloChallengeRateWarn,
    },
    {
        message: '[CONFIG] OBSERVABILITY_SLO_SELECTOR_FAILURE_RATE_WARN deve essere compreso tra 0 e 1',
        when: (cfg) =>
            cfg.observabilitySloSelectorFailureRateWarn < 0 || cfg.observabilitySloSelectorFailureRateWarn > 1,
    },
    {
        message:
            '[CONFIG] OBSERVABILITY_SLO_SELECTOR_FAILURE_RATE_CRITICAL deve essere >= OBSERVABILITY_SLO_SELECTOR_FAILURE_RATE_WARN',
        when: (cfg) => cfg.observabilitySloSelectorFailureRateCritical < cfg.observabilitySloSelectorFailureRateWarn,
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
        message: '[CONFIG] FOLLOW_UP_DELAY_STDDEV_DAYS deve essere >= 0',
        when: (cfg) => cfg.followUpDelayStddevDays < 0,
    },
    {
        message: '[CONFIG] FOLLOW_UP_DELAY_ESCALATION_FACTOR deve essere >= 0',
        when: (cfg) => cfg.followUpDelayEscalationFactor < 0,
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
        message: '[CONFIG] COMPLIANCE_HEALTH_PAUSE_THRESHOLD deve essere compreso tra 0 e 100',
        when: (cfg) => cfg.complianceHealthPauseThreshold < 0 || cfg.complianceHealthPauseThreshold > 100,
    },
    {
        message: '[CONFIG] COMPLIANCE_HEALTH_LOOKBACK_DAYS deve essere >= 1',
        when: (cfg) => cfg.complianceHealthLookbackDays < 1,
    },
    {
        message: '[CONFIG] COMPLIANCE_HEALTH_PENDING_WARN_THRESHOLD deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.complianceHealthPendingWarnThreshold < 0 || cfg.complianceHealthPendingWarnThreshold > 1,
    },
    {
        message: '[CONFIG] COMPLIANCE_PENDING_RATIO_ALERT_THRESHOLD deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.compliancePendingRatioAlertThreshold < 0 || cfg.compliancePendingRatioAlertThreshold > 1,
    },
    {
        message: '[CONFIG] COMPLIANCE_PENDING_RATIO_ALERT_MIN_INVITED deve essere >= 1',
        when: (cfg) => cfg.compliancePendingRatioAlertMinInvited < 1,
    },
    {
        message: '[CONFIG] COMPLIANCE_HEALTH_MIN_INVITE_SAMPLE deve essere >= 1',
        when: (cfg) => cfg.complianceHealthMinInviteSample < 1,
    },
    {
        message: '[CONFIG] COMPLIANCE_HEALTH_MIN_MESSAGE_SAMPLE deve essere >= 1',
        when: (cfg) => cfg.complianceHealthMinMessageSample < 1,
    },
    {
        message: '[CONFIG] COMPLIANCE_DYNAMIC_WEEKLY_MAX_INVITES deve essere >= COMPLIANCE_DYNAMIC_WEEKLY_MIN_INVITES',
        when: (cfg) => cfg.complianceDynamicWeeklyMaxInvites < cfg.complianceDynamicWeeklyMinInvites,
    },
    {
        message: '[CONFIG] COMPLIANCE_DYNAMIC_WEEKLY_WARMUP_DAYS deve essere >= 1',
        when: (cfg) => cfg.complianceDynamicWeeklyWarmupDays < 1,
    },
    {
        message: '[CONFIG] AI_QUALITY_SIGNIFICANCE_ALPHA deve essere compreso tra 0.001 e 0.25',
        when: (cfg) => cfg.aiQualitySignificanceAlpha < 0.001 || cfg.aiQualitySignificanceAlpha > 0.25,
    },
    {
        message: '[CONFIG] INBOX_AUTO_REPLY_MIN_CONFIDENCE deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.inboxAutoReplyMinConfidence < 0 || cfg.inboxAutoReplyMinConfidence > 1,
    },
    {
        message: '[CONFIG] INBOX_AUTO_REPLY_MAX_PER_RUN deve essere >= 1',
        when: (cfg) => cfg.inboxAutoReplyMaxPerRun < 1,
    },
    {
        message:
            '[CONFIG] NODE_ENV=production ma DATABASE_URL non configurata — il bot userà SQLite (non raccomandato in produzione)',
        when: (cfg, nodeEnv) => nodeEnv === 'production' && !cfg.databaseUrl,
    },
    {
        message: '[CONFIG] SESSION_DIR mancante — directory sessione Playwright obbligatoria',
        when: (cfg) => !cfg.sessionDir,
    },
    {
        message: '[CONFIG] SOFT_INVITE_CAP deve essere <= HARD_INVITE_CAP',
        when: (cfg) => cfg.softInviteCap > cfg.hardInviteCap,
    },
    {
        message: '[CONFIG] SOFT_MSG_CAP deve essere <= HARD_MSG_CAP',
        when: (cfg) => cfg.softMsgCap > cfg.hardMsgCap,
    },
    {
        message: '[CONFIG] HOUR_START deve essere < HOUR_END',
        when: (cfg) => cfg.workingHoursStart >= cfg.workingHoursEnd,
    },
    {
        message: '[CONFIG] PENDING_INVITE_MAX_DAYS deve essere >= 1',
        when: (cfg) => cfg.pendingInviteMaxDays < 1,
    },
    {
        message: '[CONFIG] TIMEZONE deve essere un fuso orario IANA valido',
        when: (cfg) => {
            try {
                Intl.DateTimeFormat(undefined, { timeZone: cfg.timezone });
                return false;
            } catch {
                return true;
            }
        },
    },

    // ─── Cross-domain validation rules ───────────────────────────────────────
    {
        message:
            '[CONFIG] SALESNAV_SYNC_ENABLED=true ma SALESNAV_LIST_NAME è vuoto — specificare il nome della lista SalesNav',
        when: (cfg) => cfg.salesNavSyncEnabled && !cfg.salesNavSyncListName,
    },
    {
        message:
            '[CONFIG] PROXY_URL configurato ma USE_JA3_PROXY=false — gap stealth: il proxy non simula fingerprint TLS',
        when: (cfg) => !!cfg.proxyUrl && !cfg.useJa3Proxy,
        severity: 'warn',
    },
    {
        message:
            '[CONFIG] NODE_ENV=production ma DASHBOARD_AUTH_ENABLED=false — la dashboard è esposta senza autenticazione',
        when: (_cfg, nodeEnv) => nodeEnv === 'production' && !_cfg.dashboardAuthEnabled,
    },
    {
        message:
            '[CONFIG] GROWTH_MODEL_ENABLED=true ma nessun account ha warmupEnabled — consigliato per fasi di crescita più precise (il growth model usa comunque ageDays dal DB)',
        when: (cfg) =>
            cfg.growthModelEnabled && cfg.accountProfiles.length > 0 && !cfg.accountProfiles.some((a) => a.warmupEnabled),
        severity: 'warn',
    },
    {
        message: '[CONFIG] RANDOM_ACTIVITY_PROBABILITY deve essere compreso tra 0 e 1',
        when: (cfg) => cfg.randomActivityProbability < 0 || cfg.randomActivityProbability > 1,
    },
    {
        message:
            '[CONFIG] NO_BURST_MIN_DELAY_SEC > NO_BURST_MAX_DELAY_SEC — i limiti sono invertiti',
        when: (cfg) => cfg.noBurstMinDelaySec > cfg.noBurstMaxDelaySec,
    },
    {
        message:
            '[CONFIG] HARD_INVITE_CAP > 100 — valore pericolosamente alto, rischio ban LinkedIn',
        when: (cfg) => cfg.hardInviteCap > 100,
    },
];

export interface ConfigValidationResult {
    errors: string[];
    warnings: string[];
}

export function validateConfigSchema(config: AppConfig, nodeEnv: string = process.env.NODE_ENV ?? ''): string[] {
    const { errors } = validateConfigFull(config, nodeEnv);
    return errors;
}

export function validateConfigFull(cfg: AppConfig, nodeEnv: string = process.env.NODE_ENV ?? ''): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const rule of CONFIG_VALIDATION_RULES) {
        if (rule.when(cfg, nodeEnv)) {
            if (rule.severity === 'warn') {
                warnings.push(rule.message);
            } else {
                errors.push(rule.message);
            }
        }
    }
    return { errors, warnings };
}
