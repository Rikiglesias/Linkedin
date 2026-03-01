/**
 * repositories/system.ts
 * Domain exports: runtime flags/locks, outbox, logs, privacy cleanup, cloud sync.
 */

export {
    pushOutboxEvent,
    getPendingOutboxEvents,
    markOutboxDelivered,
    markOutboxRetry,
    markOutboxPermanentFailure,
    countPendingOutboxEvents,
    getRuntimeLock,
    acquireRuntimeLock,
    heartbeatRuntimeLock,
    releaseRuntimeLock,
    setRuntimeFlag,
    getRuntimeFlag,
    setAutomationPause,
    clearAutomationPause,
    getAutomationPauseState,
    recordRunLog,
    getLastRunLogs,
    cleanupPrivacyData,
    applyCloudAccountUpdates,
    applyCloudLeadUpdates,
} from './legacy';
