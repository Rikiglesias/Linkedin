import { getRuntimeFlag } from '../../core/repositories';
import type {
    AiAdvisorResult,
    PreflightConfigStatus,
    PreflightDbStats,
    PreflightWarning,
    SessionRiskAssessment,
} from '../types';

export async function runAiAdvisor(
    workflowName: string,
    dbStats: PreflightDbStats,
    cfgStatus: PreflightConfigStatus,
    riskAssessment: SessionRiskAssessment,
    warnings: PreflightWarning[],
): Promise<AiAdvisorResult> {
    if (!cfgStatus.aiConfigured) {
        return { available: false, recommendation: 'PROCEED', reasoning: '', suggestedActions: [] };
    }

    try {
        const { isOpenAIConfigured, requestOpenAIText } = await import('../../ai/openaiClient');
        if (!isOpenAIConfigured()) {
            return { available: false, recommendation: 'PROCEED', reasoning: '', suggestedActions: [] };
        }

        const statusBreakdown = Object.entries(dbStats.byStatus)
            .map(([s, c]) => `${s}: ${c}`)
            .join(', ');
        const listBreakdown = Object.entries(dbStats.byList)
            .slice(0, 10)
            .map(([l, c]) => `"${l}": ${c}`)
            .join(', ');
        const warningsSummary =
            warnings.length > 0 ? warnings.map((w) => `[${w.level}] ${w.message}`).join('\n') : 'Nessun warning';
        const riskFactors = Object.entries(riskAssessment.factors)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');

        const trendSection = dbStats.trend
            ? `\nTREND vs IERI:\n- Inviti ieri: ${dbStats.trend.invitesYesterday}\n- Messaggi ieri: ${dbStats.trend.messagesYesterday}\n- Accettazioni ieri: ${dbStats.trend.acceptancesYesterday}\n- Challenge ieri: ${dbStats.trend.challengesYesterday}\n- Lead nuovi (delta): ${dbStats.trend.leadsDelta ?? 'N/A'}`
            : '';

        let riskTrendSection = '';
        try {
            const historyRaw = await getRuntimeFlag('risk_score_history');
            if (historyRaw) {
                const history: Array<{ date: string; score: number }> = JSON.parse(historyRaw);
                if (history.length >= 2) {
                    riskTrendSection = `\n- Storico risk: ${history
                        .slice(-5)
                        .map((h) => `${h.date}=${h.score}`)
                        .join(', ')}`;
                }
            }
        } catch {
            /* best-effort */
        }

        const prompt = `Sei l'AI advisor di un sistema di automazione LinkedIn. Analizza lo stato del sistema e decidi se il workflow "${workflowName}" deve procedere.

STATO DATABASE (L2):
- Lead totali: ${dbStats.totalLeads}
- Per status: ${statusBreakdown || 'nessuno'}
- Per lista: ${listBreakdown || 'nessuna'}
- Con email: ${dbStats.withEmail}/${dbStats.totalLeads} (${dbStats.totalLeads > 0 ? Math.round((dbStats.withEmail / dbStats.totalLeads) * 100) : 0}%)
- Con job_title: ${dbStats.withJobTitle}/${dbStats.totalLeads}
- Con score: ${dbStats.withScore}/${dbStats.totalLeads}
- Ultimo sync: ${dbStats.lastSyncAt || 'mai'}
${trendSection}

CONFIGURAZIONE (L3):
- Proxy: ${cfgStatus.proxyConfigured ? 'OK' : 'MANCANTE'}${cfgStatus.proxyIpReputation ? ` (abuse score: ${cfgStatus.proxyIpReputation.abuseScore}/100)` : ''}
- Budget inviti: ${cfgStatus.invitesSentToday}/${cfgStatus.budgetInvites} oggi, ${cfgStatus.weeklyInvitesSent}/${cfgStatus.weeklyInviteLimit} settimana
- Budget messaggi: ${cfgStatus.messagesSentToday}/${cfgStatus.budgetMessages} oggi
- API enrichment: Apollo=${cfgStatus.apolloConfigured}, Hunter=${cfgStatus.hunterConfigured}, Clearbit=${cfgStatus.clearbitConfigured}
- Warmup: ${cfgStatus.warmupEnabled ? 'ATTIVO' : 'disabilitato'}
- Cookie scaduti: ${cfgStatus.staleAccounts.length > 0 ? cfgStatus.staleAccounts.join(', ') : 'nessuno'}

RISK ASSESSMENT (L4):
- Score: ${riskAssessment.score}/100 (${riskAssessment.level})
- Fattori attivi: ${riskFactors || 'nessuno'}${riskTrendSection}

WARNING ATTIVI:
${warningsSummary}

PARAMETRI ATTUALI DEL WORKFLOW:
- Budget inviti giornaliero: ${cfgStatus.budgetInvites}
- Budget messaggi giornaliero: ${cfgStatus.budgetMessages}
- Budget inviti settimanale: ${cfgStatus.weeklyInviteLimit}

Rispondi SOLO in formato JSON con questa struttura:
{
  "recommendation": "PROCEED" | "PROCEED_CAUTION" | "ABORT",
  "reasoning": "spiegazione breve (1-2 frasi) in italiano",
  "suggestedActions": ["azione 1", "azione 2"],
  "suggestedParams": {
    "limit": null | number,
    "budgetInvites": null | number,
    "budgetMessages": null | number
  }
}

Regole:
- ABORT solo se ci sono condizioni critiche che rischiano ban (proxy blacklisted, pending ratio >60%, budget esaurito)
- PROCEED_CAUTION se ci sono warning importanti ma non bloccanti
- PROCEED se tutto e' in ordine
- suggestedActions: max 3 suggerimenti concreti e brevi
- suggestedParams: suggerisci valori concreti SOLO se pensi che i parametri attuali siano troppo aggressivi. null = non modificare. Se risk score > 40, riduci il budget. Se pending ratio > 40%, riduci il limit.`;

        const response = await requestOpenAIText({
            system: 'Sei un esperto di automazione LinkedIn e anti-detection. Rispondi solo in JSON valido.',
            user: prompt,
            maxOutputTokens: 300,
            temperature: 0.3,
            responseFormat: 'json_object',
        });

        const parsed = JSON.parse(response) as {
            recommendation?: string;
            reasoning?: string;
            suggestedActions?: string[];
            suggestedParams?: {
                limit?: number | null;
                budgetInvites?: number | null;
                budgetMessages?: number | null;
            };
        };

        const rec = parsed.recommendation?.toUpperCase();
        const recommendation = rec === 'ABORT' ? 'ABORT' : rec === 'PROCEED_CAUTION' ? 'PROCEED_CAUTION' : 'PROCEED';

        let suggestedParams: AiAdvisorResult['suggestedParams'];
        if (parsed.suggestedParams && typeof parsed.suggestedParams === 'object') {
            const sp = parsed.suggestedParams;
            const hasAny =
                typeof sp.limit === 'number' ||
                typeof sp.budgetInvites === 'number' ||
                typeof sp.budgetMessages === 'number';
            if (hasAny) {
                suggestedParams = {
                    limit: typeof sp.limit === 'number' && sp.limit > 0 ? sp.limit : null,
                    budgetInvites:
                        typeof sp.budgetInvites === 'number' && sp.budgetInvites > 0 ? sp.budgetInvites : null,
                    budgetMessages:
                        typeof sp.budgetMessages === 'number' && sp.budgetMessages > 0 ? sp.budgetMessages : null,
                };
            }
        }

        return {
            available: true,
            recommendation,
            reasoning: parsed.reasoning ?? '',
            suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.slice(0, 3) : [],
            suggestedParams,
        };
    } catch {
        return { available: false, recommendation: 'PROCEED', reasoning: '', suggestedActions: [] };
    }
}
