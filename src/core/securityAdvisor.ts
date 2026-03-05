import fs from 'fs';
import path from 'path';
import { config } from '../config';
import {
    countSecurityAuditEventsSince,
    getRuntimeFlag,
    listOpenIncidents,
    listSecretRotationStatus,
    pushOutboxEvent,
    recordSecurityAuditEvent,
    setRuntimeFlag,
} from './repositories';

export type SecurityAdvisorStatus = 'OK' | 'WARN' | 'FAILED' | 'SKIPPED';

export interface SecurityAdvisorCheck {
    key: string;
    status: 'OK' | 'WARN' | 'FAILED' | 'SKIPPED';
    message: string;
    details: Record<string, unknown>;
}

export interface SecurityAdvisorSummary {
    totalChecks: number;
    ok: number;
    warn: number;
    failed: number;
    skipped: number;
}

export interface SecurityAdvisorReport {
    status: SecurityAdvisorStatus;
    reason: string;
    triggeredBy: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    checks: SecurityAdvisorCheck[];
    summary: SecurityAdvisorSummary;
    findings: string[];
    backlog: string[];
    reportPath: string | null;
    errorMessage: string | null;
}

export interface SecurityAdvisorRunOptions {
    triggeredBy?: string;
    reportDir?: string;
    persistRuntimeFlags?: boolean;
}

export interface SecurityAdvisorPosture {
    enabled: boolean;
    intervalDays: number;
    lastRunAt: string | null;
    lastStatus: SecurityAdvisorStatus | null;
    lastReason: string | null;
    lastReportPath: string | null;
    lastFindingsCount: number | null;
    lastBacklogCount: number | null;
    stale: boolean;
    elapsedDaysSinceRun: number | null;
    warning: string | null;
}

export const SECURITY_ADVISOR_LAST_RUN_KEY = 'security_advisor_last_run_at';
export const SECURITY_ADVISOR_LAST_STATUS_KEY = 'security_advisor_last_status';
export const SECURITY_ADVISOR_LAST_REASON_KEY = 'security_advisor_last_reason';
export const SECURITY_ADVISOR_LAST_REPORT_KEY = 'security_advisor_last_report_path';
export const SECURITY_ADVISOR_LAST_FINDINGS_COUNT_KEY = 'security_advisor_last_findings_count';
export const SECURITY_ADVISOR_LAST_BACKLOG_COUNT_KEY = 'security_advisor_last_backlog_count';
export const SECURITY_ADVISOR_LAST_ERROR_KEY = 'security_advisor_last_error';

const SECURITY_ADVISOR_REPORT_DIR = path.resolve(process.cwd(), 'data', 'security-advisor');
const THREAT_MODEL_PATH = path.resolve(process.cwd(), 'THREAT_MODEL.md');
const SECURITY_DOC_PATH = path.resolve(process.cwd(), 'SECURITY.md');

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function renderTimestampToken(date: Date = new Date()): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toIsoOrNull(raw: string | null): string | null {
    if (!raw || !raw.trim()) return null;
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return null;
    return new Date(parsed).toISOString();
}

function toIntOrNull(raw: string | null): number | null {
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function getFileAgeDays(filePath: string, nowMs: number = Date.now()): number | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const stat = fs.statSync(filePath);
    const ageMs = Math.max(0, nowMs - stat.mtimeMs);
    return Number.parseFloat((ageMs / 86_400_000).toFixed(2));
}

function normalizeStatus(raw: string | null): SecurityAdvisorStatus | null {
    if (!raw) return null;
    if (raw === 'OK' || raw === 'WARN' || raw === 'FAILED' || raw === 'SKIPPED') {
        return raw;
    }
    return null;
}

function summarizeChecks(checks: SecurityAdvisorCheck[]): SecurityAdvisorSummary {
    return checks.reduce<SecurityAdvisorSummary>(
        (acc, check) => {
            acc.totalChecks += 1;
            if (check.status === 'OK') acc.ok += 1;
            else if (check.status === 'WARN') acc.warn += 1;
            else if (check.status === 'FAILED') acc.failed += 1;
            else acc.skipped += 1;
            return acc;
        },
        {
            totalChecks: 0,
            ok: 0,
            warn: 0,
            failed: 0,
            skipped: 0,
        },
    );
}

async function persistSecurityAdvisorFlags(report: SecurityAdvisorReport): Promise<void> {
    await setRuntimeFlag(SECURITY_ADVISOR_LAST_RUN_KEY, report.finishedAt);
    await setRuntimeFlag(SECURITY_ADVISOR_LAST_STATUS_KEY, report.status);
    await setRuntimeFlag(SECURITY_ADVISOR_LAST_REASON_KEY, report.reason);
    await setRuntimeFlag(SECURITY_ADVISOR_LAST_REPORT_KEY, report.reportPath ?? '');
    await setRuntimeFlag(SECURITY_ADVISOR_LAST_FINDINGS_COUNT_KEY, String(report.findings.length));
    await setRuntimeFlag(SECURITY_ADVISOR_LAST_BACKLOG_COUNT_KEY, String(report.backlog.length));
    await setRuntimeFlag(SECURITY_ADVISOR_LAST_ERROR_KEY, report.errorMessage ?? '');
}

function buildBacklogFromChecks(checks: SecurityAdvisorCheck[]): { findings: string[]; backlog: string[] } {
    const findings: string[] = [];
    const backlog: string[] = [];

    for (const check of checks) {
        if (check.status !== 'WARN' && check.status !== 'FAILED') {
            continue;
        }
        findings.push(`${check.key}: ${check.message}`);
        backlog.push(`[${check.status}] ${check.key} -> ${check.message}`);
    }

    return { findings, backlog };
}

export async function getSecurityAdvisorPosture(now: Date = new Date()): Promise<SecurityAdvisorPosture> {
    const [lastRunRaw, lastStatusRaw, lastReasonRaw, lastReportPathRaw, lastFindingsRaw, lastBacklogRaw] =
        await Promise.all([
            getRuntimeFlag(SECURITY_ADVISOR_LAST_RUN_KEY),
            getRuntimeFlag(SECURITY_ADVISOR_LAST_STATUS_KEY),
            getRuntimeFlag(SECURITY_ADVISOR_LAST_REASON_KEY),
            getRuntimeFlag(SECURITY_ADVISOR_LAST_REPORT_KEY),
            getRuntimeFlag(SECURITY_ADVISOR_LAST_FINDINGS_COUNT_KEY),
            getRuntimeFlag(SECURITY_ADVISOR_LAST_BACKLOG_COUNT_KEY),
        ]);

    const lastRunAt = toIsoOrNull(lastRunRaw);
    const lastStatus = normalizeStatus(lastStatusRaw);
    const elapsedDaysSinceRun = lastRunAt
        ? Number.parseFloat(((now.getTime() - Date.parse(lastRunAt)) / 86_400_000).toFixed(2))
        : null;
    const stale = config.securityAdvisorEnabled
        ? !lastRunAt || (elapsedDaysSinceRun ?? Number.POSITIVE_INFINITY) > config.securityAdvisorIntervalDays
        : false;

    const warning = (() => {
        if (!config.securityAdvisorEnabled) return null;
        if (!lastRunAt) return 'security_advisor_never_executed';
        if (stale) return 'security_advisor_stale';
        if (lastStatus === 'FAILED') return 'security_advisor_last_failed';
        if (lastStatus === 'WARN') return 'security_advisor_last_warn';
        return null;
    })();

    return {
        enabled: config.securityAdvisorEnabled,
        intervalDays: config.securityAdvisorIntervalDays,
        lastRunAt,
        lastStatus,
        lastReason: lastReasonRaw && lastReasonRaw.trim() ? lastReasonRaw : null,
        lastReportPath: lastReportPathRaw && lastReportPathRaw.trim() ? lastReportPathRaw : null,
        lastFindingsCount: toIntOrNull(lastFindingsRaw),
        lastBacklogCount: toIntOrNull(lastBacklogRaw),
        stale,
        elapsedDaysSinceRun,
        warning,
    };
}

export async function runSecurityAdvisor(options: SecurityAdvisorRunOptions = {}): Promise<SecurityAdvisorReport> {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const triggeredBy = (options.triggeredBy ?? 'manual').trim() || 'manual';
    const reportDir = path.resolve(options.reportDir ?? SECURITY_ADVISOR_REPORT_DIR);
    const persistRuntimeFlags = options.persistRuntimeFlags !== false;

    const finalize = async (payload: {
        status: SecurityAdvisorStatus;
        reason: string;
        checks: SecurityAdvisorCheck[];
        findings: string[];
        backlog: string[];
        errorMessage?: string | null;
    }): Promise<SecurityAdvisorReport> => {
        const finishedAtDate = new Date();
        let status = payload.status;
        let errorMessage = payload.errorMessage ?? null;
        let reportPath: string | null = null;
        const summary = summarizeChecks(payload.checks);

        const finishedAt = finishedAtDate.toISOString();
        const durationMs = finishedAtDate.getTime() - startedAtDate.getTime();

        const reportForFile: SecurityAdvisorReport = {
            status,
            reason: payload.reason,
            triggeredBy,
            startedAt,
            finishedAt,
            durationMs,
            checks: payload.checks,
            summary,
            findings: payload.findings,
            backlog: payload.backlog,
            reportPath,
            errorMessage,
        };

        try {
            ensureDir(reportDir);
            reportPath = path.resolve(reportDir, `security-advisor-${renderTimestampToken(finishedAtDate)}.json`);
            reportForFile.reportPath = reportPath;
            fs.writeFileSync(reportPath, JSON.stringify(reportForFile, null, 2), 'utf8');
        } catch (error) {
            const writeError = error instanceof Error ? error.message : String(error);
            errorMessage = errorMessage
                ? `${errorMessage}; report_write_failed=${writeError}`
                : `report_write_failed=${writeError}`;
            if (status !== 'FAILED') {
                status = 'FAILED';
            }
            reportForFile.status = status;
            reportForFile.errorMessage = errorMessage;
            reportForFile.reportPath = null;
            reportPath = null;
        }

        const report: SecurityAdvisorReport = {
            ...reportForFile,
            status,
            reportPath,
            errorMessage,
        };

        if (persistRuntimeFlags) {
            await persistSecurityAdvisorFlags(report);
        }

        await recordSecurityAuditEvent({
            category: 'security_advisor',
            action: 'run',
            actor: triggeredBy,
            result: report.status,
            metadata: {
                reason: report.reason,
                summary: report.summary,
                findings: report.findings.slice(0, 20),
                backlogCount: report.backlog.length,
                reportPath: report.reportPath,
            },
        });

        await pushOutboxEvent(
            'security.advisor.report',
            {
                status: report.status,
                reason: report.reason,
                summary: report.summary,
                findings: report.findings,
                backlog: report.backlog,
                reportPath: report.reportPath,
                triggeredBy,
                finishedAt: report.finishedAt,
            },
            `security.advisor.report:${report.finishedAt}`,
        );

        return report;
    };

    if (!config.securityAdvisorEnabled) {
        return finalize({
            status: 'SKIPPED',
            reason: 'security_advisor_disabled',
            checks: [],
            findings: [],
            backlog: [],
        });
    }

    try {
        const now = new Date();
        const nowMs = now.getTime();
        const auditSince = new Date(nowMs - config.securityAdvisorAuditLookbackDays * 86_400_000).toISOString();

        const [secretRotationRows, openIncidents, drLastRunRaw, drLastStatus, auditEventsCount] = await Promise.all([
            listSecretRotationStatus(config.securitySecretMaxAgeDays, config.securitySecretWarnDays),
            listOpenIncidents(),
            getRuntimeFlag('dr_restore_test_last_run_at'),
            getRuntimeFlag('dr_restore_test_last_status'),
            countSecurityAuditEventsSince(auditSince),
        ]);

        const checks: SecurityAdvisorCheck[] = [];

        const threatModelAgeDays = getFileAgeDays(THREAT_MODEL_PATH, nowMs);
        if (threatModelAgeDays === null) {
            checks.push({
                key: 'threat_model',
                status: 'FAILED',
                message: 'THREAT_MODEL.md mancante.',
                details: { filePath: THREAT_MODEL_PATH },
            });
        } else if (threatModelAgeDays > config.securityAdvisorDocMaxAgeDays) {
            checks.push({
                key: 'threat_model',
                status: 'WARN',
                message: `THREAT_MODEL.md non aggiornato da ${threatModelAgeDays} giorni.`,
                details: {
                    filePath: THREAT_MODEL_PATH,
                    ageDays: threatModelAgeDays,
                    maxAgeDays: config.securityAdvisorDocMaxAgeDays,
                },
            });
        } else {
            checks.push({
                key: 'threat_model',
                status: 'OK',
                message: 'THREAT_MODEL.md aggiornato entro la finestra prevista.',
                details: {
                    filePath: THREAT_MODEL_PATH,
                    ageDays: threatModelAgeDays,
                    maxAgeDays: config.securityAdvisorDocMaxAgeDays,
                },
            });
        }

        const securityDocAgeDays = getFileAgeDays(SECURITY_DOC_PATH, nowMs);
        if (securityDocAgeDays === null) {
            checks.push({
                key: 'security_doc',
                status: 'FAILED',
                message: 'SECURITY.md mancante.',
                details: { filePath: SECURITY_DOC_PATH },
            });
        } else if (securityDocAgeDays > config.securityAdvisorDocMaxAgeDays) {
            checks.push({
                key: 'security_doc',
                status: 'WARN',
                message: `SECURITY.md non aggiornato da ${securityDocAgeDays} giorni.`,
                details: {
                    filePath: SECURITY_DOC_PATH,
                    ageDays: securityDocAgeDays,
                    maxAgeDays: config.securityAdvisorDocMaxAgeDays,
                },
            });
        } else {
            checks.push({
                key: 'security_doc',
                status: 'OK',
                message: 'SECURITY.md aggiornato entro la finestra prevista.',
                details: {
                    filePath: SECURITY_DOC_PATH,
                    ageDays: securityDocAgeDays,
                    maxAgeDays: config.securityAdvisorDocMaxAgeDays,
                },
            });
        }

        const secretStatusSummary = secretRotationRows.reduce<Record<string, number>>((acc, row) => {
            acc[row.status] = (acc[row.status] ?? 0) + 1;
            return acc;
        }, {});
        const expiredSecrets = secretStatusSummary.EXPIRED ?? 0;
        const warnSecrets = secretStatusSummary.WARN ?? 0;
        if (expiredSecrets > 0) {
            checks.push({
                key: 'secret_rotation',
                status: 'FAILED',
                message: `Trovati ${expiredSecrets} segreti scaduti in inventory.`,
                details: {
                    summary: secretStatusSummary,
                    maxAgeDays: config.securitySecretMaxAgeDays,
                    warnDays: config.securitySecretWarnDays,
                },
            });
        } else if (warnSecrets > 0) {
            checks.push({
                key: 'secret_rotation',
                status: 'WARN',
                message: `Trovati ${warnSecrets} segreti in warning window.`,
                details: {
                    summary: secretStatusSummary,
                    maxAgeDays: config.securitySecretMaxAgeDays,
                    warnDays: config.securitySecretWarnDays,
                },
            });
        } else {
            checks.push({
                key: 'secret_rotation',
                status: 'OK',
                message: 'Inventory segreti in stato sano.',
                details: {
                    summary: secretStatusSummary,
                    maxAgeDays: config.securitySecretMaxAgeDays,
                    warnDays: config.securitySecretWarnDays,
                },
            });
        }

        if (openIncidents.length > 0) {
            checks.push({
                key: 'open_incidents',
                status: 'WARN',
                message: `Presenti ${openIncidents.length} incidenti aperti.`,
                details: {
                    openIncidents: openIncidents.length,
                },
            });
        } else {
            checks.push({
                key: 'open_incidents',
                status: 'OK',
                message: 'Nessun incidente aperto.',
                details: {
                    openIncidents: 0,
                },
            });
        }

        if (!config.disasterRecoveryRestoreTestEnabled) {
            checks.push({
                key: 'dr_restore_drill',
                status: 'SKIPPED',
                message: 'Restore drill disabilitato da configurazione.',
                details: {
                    restoreTestEnabled: false,
                },
            });
        } else {
            const drLastRunAt = toIsoOrNull(drLastRunRaw);
            const drElapsedDays = drLastRunAt
                ? Number.parseFloat(((nowMs - Date.parse(drLastRunAt)) / 86_400_000).toFixed(2))
                : null;
            const drStale =
                !drLastRunAt ||
                (drElapsedDays ?? Number.POSITIVE_INFINITY) > config.disasterRecoveryRestoreTestIntervalDays;
            if ((drLastStatus ?? '') === 'FAILED') {
                checks.push({
                    key: 'dr_restore_drill',
                    status: 'FAILED',
                    message: 'Ultimo restore drill in stato FAILED.',
                    details: {
                        lastRunAt: drLastRunAt,
                        lastStatus: drLastStatus,
                        intervalDays: config.disasterRecoveryRestoreTestIntervalDays,
                    },
                });
            } else if (drStale) {
                checks.push({
                    key: 'dr_restore_drill',
                    status: 'WARN',
                    message: 'Restore drill non eseguito entro intervallo previsto.',
                    details: {
                        lastRunAt: drLastRunAt,
                        lastStatus: drLastStatus,
                        elapsedDays: drElapsedDays,
                        intervalDays: config.disasterRecoveryRestoreTestIntervalDays,
                    },
                });
            } else {
                checks.push({
                    key: 'dr_restore_drill',
                    status: 'OK',
                    message: 'Restore drill in finestra di validita.',
                    details: {
                        lastRunAt: drLastRunAt,
                        lastStatus: drLastStatus,
                        elapsedDays: drElapsedDays,
                        intervalDays: config.disasterRecoveryRestoreTestIntervalDays,
                    },
                });
            }
        }

        if (auditEventsCount < config.securityAdvisorMinAuditEvents) {
            checks.push({
                key: 'security_audit_activity',
                status: 'WARN',
                message: `Audit security sotto soglia nel lookback (${auditEventsCount}/${config.securityAdvisorMinAuditEvents}).`,
                details: {
                    lookbackDays: config.securityAdvisorAuditLookbackDays,
                    minEvents: config.securityAdvisorMinAuditEvents,
                    events: auditEventsCount,
                    since: auditSince,
                },
            });
        } else {
            checks.push({
                key: 'security_audit_activity',
                status: 'OK',
                message: 'Volume audit security nella soglia minima prevista.',
                details: {
                    lookbackDays: config.securityAdvisorAuditLookbackDays,
                    minEvents: config.securityAdvisorMinAuditEvents,
                    events: auditEventsCount,
                    since: auditSince,
                },
            });
        }

        const summary = summarizeChecks(checks);
        const status: SecurityAdvisorStatus = summary.failed > 0 ? 'FAILED' : summary.warn > 0 ? 'WARN' : 'OK';
        const reason =
            status === 'FAILED' ? 'failed_checks_detected' : status === 'WARN' ? 'warnings_detected' : 'all_checks_ok';
        const { findings, backlog } = buildBacklogFromChecks(checks);

        return finalize({
            status,
            reason,
            checks,
            findings,
            backlog,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return finalize({
            status: 'FAILED',
            reason: 'security_advisor_execution_failed',
            checks: [],
            findings: [],
            backlog: [],
            errorMessage: message,
        });
    }
}
