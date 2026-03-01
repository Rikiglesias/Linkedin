import { config } from '../config';
import { ScheduleResult, WorkflowSelection } from '../core/scheduler';
import { getRuntimeFlag, setRuntimeFlag } from '../core/repositories';
import { requestOpenAIText } from './openaiClient';

const AI_GUARDIAN_LAST_RUN_AT_KEY = 'ai_guardian.last_run_at';

export type AiGuardianSeverity = 'normal' | 'watch' | 'critical';

export interface AiGuardianDecision {
    source: 'heuristic' | 'ai';
    severity: AiGuardianSeverity;
    summary: string;
    recommendations: string[];
    pauseMinutes: number;
}

export interface AiGuardianResult {
    executed: boolean;
    reason: string;
    decision: AiGuardianDecision | null;
}

interface ParsedAiGuardianPayload {
    severity: AiGuardianSeverity;
    summary: string;
    recommendations: string[];
    pauseMinutes: number;
}

function clampPauseMinutes(value: number): number {
    const parsed = Number.isFinite(value) ? Math.floor(value) : 0;
    if (parsed <= 0) return 0;
    return Math.min(24 * 60, parsed);
}

function heuristics(schedule: ScheduleResult): AiGuardianDecision {
    const criticalList = schedule.listBreakdown.find(
        (list) => list.pendingRatio >= 0.78 || list.blockedRatio >= 0.35
    );

    if (schedule.riskSnapshot.action === 'STOP' || criticalList) {
        return {
            source: 'heuristic',
            severity: 'critical',
            summary: 'Rischio elevato rilevato prima dell’esecuzione.',
            recommendations: [
                'Pausa automatica e controllo manuale account.',
                'Ridurre limiti giornalieri su inviti e messaggi.',
                'Eseguire site-check con --fix prima della ripartenza.',
            ],
            pauseMinutes: config.aiGuardianPauseMinutes,
        };
    }

    if (
        schedule.riskSnapshot.action === 'WARN'
        || schedule.riskSnapshot.action === 'LOW_ACTIVITY'
        || schedule.riskSnapshot.pendingRatio >= config.pendingRatioWarn
        || schedule.riskSnapshot.errorRate >= 0.2
    ) {
        return {
            source: 'heuristic',
            severity: 'watch',
            summary: 'Rischio intermedio: conviene rallentare e monitorare.',
            recommendations: [
                'Ridurre volume inviti nel prossimo ciclo.',
                'Aumentare intervallo loop e verificare mismatch DB/sito.',
            ],
            pauseMinutes: 0,
        };
    }

    return {
        source: 'heuristic',
        severity: 'normal',
        summary: 'Situazione stabile.',
        recommendations: ['Continuare con policy conservative attive.'],
        pauseMinutes: 0,
    };
}

function tryExtractJsonBlock(raw: string): string | null {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }
    return raw.slice(start, end + 1);
}

function parseAiDecision(raw: string): ParsedAiGuardianPayload | null {
    const jsonBlock = tryExtractJsonBlock(raw);
    if (!jsonBlock) return null;

    try {
        const parsed = JSON.parse(jsonBlock) as Record<string, unknown>;
        const severityRaw = typeof parsed.severity === 'string' ? parsed.severity.toLowerCase() : '';
        const severity: AiGuardianSeverity = severityRaw === 'critical' || severityRaw === 'watch' || severityRaw === 'normal'
            ? severityRaw
            : 'watch';
        const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
        const recommendationsRaw = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
        const recommendations = recommendationsRaw
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 5);
        const pauseMinutesRaw = typeof parsed.pauseMinutes === 'number'
            ? parsed.pauseMinutes
            : Number.parseInt(String(parsed.pauseMinutes ?? '0'), 10);

        return {
            severity,
            summary: summary || 'AI guardian non ha fornito un summary dettagliato.',
            recommendations: recommendations.length > 0 ? recommendations : ['Verificare manualmente trend rischio.'],
            pauseMinutes: clampPauseMinutes(pauseMinutesRaw),
        };
    } catch {
        return null;
    }
}

async function shouldRunAiGuardianNow(now: Date): Promise<{ allowed: boolean; reason: string }> {
    const lastRaw = await getRuntimeFlag(AI_GUARDIAN_LAST_RUN_AT_KEY);
    if (!lastRaw) {
        return { allowed: true, reason: 'first_run' };
    }
    const parsed = Date.parse(lastRaw);
    if (!Number.isFinite(parsed)) {
        return { allowed: true, reason: 'invalid_last_run' };
    }
    const elapsedMinutes = (now.getTime() - parsed) / 60_000;
    if (elapsedMinutes >= config.aiGuardianMinIntervalMinutes) {
        return { allowed: true, reason: 'interval_elapsed' };
    }
    return { allowed: false, reason: 'interval_not_elapsed' };
}

export async function evaluateAiGuardian(
    workflow: WorkflowSelection,
    schedule: ScheduleResult
): Promise<AiGuardianResult> {
    const heuristicDecision = heuristics(schedule);
    if (!config.aiGuardianEnabled || !config.openaiApiKey) {
        return {
            executed: true,
            reason: 'heuristic_only',
            decision: heuristicDecision,
        };
    }

    const now = new Date();
    const runCheck = await shouldRunAiGuardianNow(now);
    if (!runCheck.allowed) {
        return {
            executed: false,
            reason: runCheck.reason,
            decision: null,
        };
    }

    const systemPrompt = [
        'Sei un risk controller per automazione LinkedIn.',
        'Valuta il rischio in anticipo e rispondi SOLO JSON valido.',
        'Schema JSON: {"severity":"normal|watch|critical","summary":"...","recommendations":["..."],"pauseMinutes":number}',
        'Usa approccio conservativo, no ottimismo.',
    ].join(' ');
    const userPrompt = JSON.stringify({
        workflow,
        riskSnapshot: schedule.riskSnapshot,
        inviteBudget: schedule.inviteBudget,
        messageBudget: schedule.messageBudget,
        queuedInviteJobs: schedule.queuedInviteJobs,
        queuedCheckJobs: schedule.queuedCheckJobs,
        queuedMessageJobs: schedule.queuedMessageJobs,
        listBreakdown: schedule.listBreakdown,
        fallbackHeuristic: heuristicDecision,
    });

    try {
        const text = await requestOpenAIText({
            system: systemPrompt,
            user: `Valuta questo contesto operativo e decidi: ${userPrompt}`,
            maxOutputTokens: 260,
            temperature: 0.2,
        });
        const parsed = parseAiDecision(text);
        await setRuntimeFlag(AI_GUARDIAN_LAST_RUN_AT_KEY, now.toISOString());

        if (!parsed) {
            return {
                executed: true,
                reason: 'ai_parse_failed_fallback_heuristic',
                decision: heuristicDecision,
            };
        }

        return {
            executed: true,
            reason: runCheck.reason,
            decision: {
                source: 'ai',
                severity: parsed.severity,
                summary: parsed.summary,
                recommendations: parsed.recommendations,
                pauseMinutes: parsed.pauseMinutes,
            },
        };
    } catch {
        return {
            executed: true,
            reason: 'ai_error_fallback_heuristic',
            decision: heuristicDecision,
        };
    }
}
