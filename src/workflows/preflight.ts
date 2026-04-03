/**
 * Motore pre-flight interattivo riusabile per tutti i workflow.
 */

import { getRuntimeFlag } from '../core/repositories';
import { askChoice, askConfirmation, askNumber, isInteractiveTTY, readLineFromStdin } from '../cli/stdinHelper';
import { PreflightInput, PreflightResult } from './types';
import { selectAccount } from './preflight/accountSelector';
import { collectDbStats } from './preflight/statsCollector';
import { collectConfigStatus } from './preflight/configInspector';
import { computeSessionRiskLevel } from './preflight/riskAssessor';
import { runAiAdvisor } from './preflight/aiAdvisor';
import { displayAiAdvice, displayConfigStatus, displayDbStats, displayWarnings } from './preflight/presenter';
import { runAntiBanChecklist } from './preflight/antiBanChecklist';

export type PreflightConfig<TAnswers extends object = Record<string, string>> = PreflightInput<TAnswers>;

function toTypedAnswers<TAnswers extends object>(
    pfConfig: PreflightConfig<TAnswers>,
    answers: Record<string, string>,
): TAnswers {
    if (pfConfig.parseAnswers) {
        return pfConfig.parseAnswers({ ...answers });
    }
    return { ...answers } as TAnswers;
}

export { selectAccount } from './preflight/accountSelector';
export { collectDbStats } from './preflight/statsCollector';
export { collectConfigStatus, appendProxyReputationWarning } from './preflight/configInspector';
export { computeSessionRiskLevel } from './preflight/riskAssessor';

export async function runPreflight<TAnswers extends object = Record<string, string>>(
    pfConfig: PreflightConfig<TAnswers>,
): Promise<PreflightResult<TAnswers>> {
    const answers: Record<string, string> = { ...pfConfig.cliOverrides };

    const buildResult = (
        overrides: Omit<PreflightResult<TAnswers>, 'answers' | 'rawAnswers'>,
    ): PreflightResult<TAnswers> => ({
        answers: toTypedAnswers(pfConfig, answers),
        rawAnswers: { ...answers },
        ...overrides,
    });

    if (pfConfig.skipPreflight || !isInteractiveTTY()) {
        const dbStats = await collectDbStats(pfConfig.listFilter);
        const configStatus = await collectConfigStatus();
        const warnings = pfConfig.generateWarnings(dbStats, configStatus, answers);
        const riskAssessment = await computeSessionRiskLevel(configStatus);

        for (const q of pfConfig.questions) {
            if (!(q.id in answers) && q.defaultValue !== undefined && q.defaultValue !== null) {
                answers[q.id] = q.defaultValue;
            }
        }

        if (riskAssessment.level === 'STOP') {
            return buildResult({ dbStats, configStatus, warnings, confirmed: false, riskAssessment });
        }

        return buildResult({ dbStats, configStatus, warnings, confirmed: true, riskAssessment });
    }

    console.log('');
    console.log('================================================================');
    console.log(`  PRE-FLIGHT: ${pfConfig.workflowName.toUpperCase()} (6 LIVELLI DI CONTROLLO)`);
    console.log('================================================================');

    const funnelSteps = [
        { cmd: 'sync-search', label: 'Ricerca → Lista SalesNav' },
        { cmd: 'sync-list', label: 'Lista SalesNav → DB' },
        { cmd: 'send-invites', label: 'Invita lead pronti' },
        { cmd: 'send-messages', label: 'Messaggia chi ha accettato' },
    ];
    const currentStep = funnelSteps.findIndex((s) => s.cmd === pfConfig.workflowName);
    if (currentStep >= 0) {
        console.log('');
        console.log(
            '  FUNNEL: ' +
                funnelSteps
                    .map((s, i) => (i === currentStep ? `[${i + 1}. ${s.label}]` : `${i + 1}. ${s.label}`))
                    .join(' → '),
        );
    }

    const selectedAccountId = await selectAccount(pfConfig.cliAccountId);
    if (selectedAccountId) {
        answers['_accountId'] = selectedAccountId;
    }

    const earlyListFilter = pfConfig.cliOverrides?.['listName'] ?? pfConfig.listFilter;
    const dbStats = await collectDbStats(earlyListFilter);
    const configStatus = await collectConfigStatus();

    const checklistPassed = await runAntiBanChecklist(pfConfig.workflowName, dbStats, configStatus);
    if (!checklistPassed) {
        return buildResult({
            dbStats,
            configStatus,
            warnings: [],
            confirmed: false,
            riskAssessment: {
                level: 'STOP',
                score: 100,
                factors: { checklist: 100 },
                recommendation: 'Checklist anti-ban non superata',
            },
            selectedAccountId,
        });
    }

    for (const q of pfConfig.questions) {
        if (q.id in answers) continue;

        if (q.type === 'boolean') {
            const confirmed = await askConfirmation(`  ${q.prompt} [Y/n] `);
            answers[q.id] = confirmed ? 'true' : 'false';
        } else if (q.type === 'number') {
            const num = await askNumber(`  ${q.prompt}`, parseInt(q.defaultValue ?? '0', 10));
            answers[q.id] = String(num);
        } else if (q.type === 'choice' && q.choices) {
            const choice = await askChoice(`  ${q.prompt}`, q.choices, q.defaultValue ?? q.choices[0]);
            answers[q.id] = choice;
        } else {
            const raw = await readLineFromStdin(
                `  ${q.prompt}${q.defaultValue ? ` (default: ${q.defaultValue})` : ''}: `,
            );
            answers[q.id] = raw || q.defaultValue || '';
        }
    }

    const listFilter = answers['list'] ?? answers['listName'] ?? earlyListFilter;
    const warnings = pfConfig.generateWarnings(dbStats, configStatus, answers);
    const riskAssessment = await computeSessionRiskLevel(configStatus);

    console.log('');
    displayDbStats(dbStats, listFilter);
    console.log('');
    displayConfigStatus(configStatus);
    displayWarnings(warnings);

    console.log('');
    const riskIcon = riskAssessment.level === 'GO' ? '[OK]' : riskAssessment.level === 'CAUTION' ? '[!]' : '[!!!]';
    console.log(`  L4: RISK ASSESSMENT — ${riskIcon} ${riskAssessment.level} (score: ${riskAssessment.score}/100)`);
    console.log(`      ${riskAssessment.recommendation}`);
    if (riskAssessment.score > 30) {
        const factorDetails = Object.entries(riskAssessment.factors)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
        if (factorDetails) console.log(`      Fattori: ${factorDetails}`);
    }
    try {
        const historyRaw = await getRuntimeFlag('risk_score_history');
        if (historyRaw) {
            const history: Array<{ date: string; score: number }> = JSON.parse(historyRaw);
            if (history.length >= 2) {
                const prev = history[history.length - 2];
                const delta = riskAssessment.score - prev.score;
                const trendArrow = delta > 5 ? 'IN SALITA [!]' : delta < -5 ? 'in discesa [OK]' : 'stabile';
                console.log(`      Trend: ${trendArrow} (${prev.date}: ${prev.score} → oggi: ${riskAssessment.score})`);
            }
        }
    } catch {
        /* best-effort */
    }

    let aiAdvice = undefined;
    if (configStatus.aiConfigured) {
        console.log('');
        console.log('  L5: AI Advisor in analisi...');
        aiAdvice = await runAiAdvisor(pfConfig.workflowName, dbStats, configStatus, riskAssessment, warnings);
        displayAiAdvice(aiAdvice);

        if (aiAdvice.available && aiAdvice.recommendation === 'ABORT') {
            console.log('');
            const forceOverride = await askConfirmation(
                "  [!!!] L'AI consiglia di NON procedere. Vuoi forzare comunque? [y/N] ",
            );
            if (!forceOverride) {
                return buildResult({
                    dbStats,
                    configStatus,
                    warnings,
                    confirmed: false,
                    riskAssessment,
                    selectedAccountId,
                    aiAdvice,
                });
            }
            console.log('  -> Override utente: si procede nonostante il consiglio AI.');
        }
    }
    console.log('');

    if (riskAssessment.level === 'STOP') {
        console.log('  [!!!] Risk level STOP — sessione NON sicura. Risolvere prima di procedere.');
        return buildResult({
            dbStats,
            configStatus,
            warnings,
            confirmed: false,
            riskAssessment,
            selectedAccountId,
            aiAdvice,
        });
    }

    if (warnings.some((w) => w.level === 'critical')) {
        console.log('  [!!!] Condizioni critiche rilevate. Risolvere prima di procedere.');
        return buildResult({
            dbStats,
            configStatus,
            warnings,
            confirmed: false,
            riskAssessment,
            selectedAccountId,
            aiAdvice,
        });
    }

    const confirmed = await askConfirmation('  Procedo? [Y/n] ');
    process.stdin.pause();

    return buildResult({
        dbStats,
        configStatus,
        warnings,
        confirmed,
        riskAssessment,
        selectedAccountId,
        aiAdvice,
    });
}
