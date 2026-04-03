import { config, getLocalDateString, getWeekStartDate } from '../../config';
import { countWeeklyInvites, getDailyStat } from '../../core/repositories';
import { getRuntimeAccountProfiles } from '../../accountManager';
import { checkSessionFreshness } from '../../browser/sessionCookieMonitor';
import type { PreflightConfigStatus, PreflightWarning } from '../types';

export async function collectConfigStatus(): Promise<PreflightConfigStatus> {
    const localDate = getLocalDateString();
    const invitesSentToday = await getDailyStat(localDate, 'invites_sent');
    const messagesSentToday = await getDailyStat(localDate, 'messages_sent');

    let proxyIpReputation: PreflightConfigStatus['proxyIpReputation'] = null;
    if (config.ipReputationApiKey && config.proxyUrl) {
        try {
            const { checkIpReputation } = await import('../../proxy/ipReputationChecker');
            const result = await checkIpReputation(config.proxyUrl);
            if (result) {
                proxyIpReputation = {
                    ip: result.ip,
                    abuseScore: result.abuseConfidenceScore,
                    isSafe: result.isSafe,
                    isp: result.isp,
                    country: result.countryCode,
                };
            }
        } catch {
            // Best-effort
        }
    }

    const staleAccounts: string[] = [];
    const noLoginAccounts: string[] = [];
    const accounts = getRuntimeAccountProfiles();
    for (const acc of accounts) {
        const freshness = checkSessionFreshness(acc.sessionDir, config.sessionCookieMaxAgeDays);
        if (freshness.lastVerifiedAt === null) {
            noLoginAccounts.push(acc.id);
        } else if (freshness.needsRotation) {
            staleAccounts.push(`${acc.id} (${freshness.sessionAgeDays}d)`);
        }
    }

    const weeklyInvitesSent = await countWeeklyInvites(getWeekStartDate());

    return {
        proxyConfigured: !!config.proxyUrl,
        apolloConfigured: !!config.apolloApiKey,
        hunterConfigured: !!config.hunterApiKey,
        clearbitConfigured: !!config.clearbitApiKey,
        aiConfigured: !!config.openaiApiKey || !!config.ollamaEndpoint,
        supabaseConfigured: !!config.supabaseUrl && !!config.supabaseServiceRoleKey,
        growthModelEnabled: config.growthModelEnabled,
        weeklyStrategyEnabled: config.weeklyStrategyEnabled,
        warmupEnabled: config.warmupEnabled,
        budgetInvites: config.hardInviteCap,
        budgetMessages: config.hardMsgCap,
        invitesSentToday,
        messagesSentToday,
        weeklyInvitesSent,
        weeklyInviteLimit: config.weeklyInviteLimit,
        proxyIpReputation,
        staleAccounts,
        noLoginAccounts,
    };
}

export function appendProxyReputationWarning(warnings: PreflightWarning[], cfgStatus: PreflightConfigStatus): void {
    if (cfgStatus.proxyIpReputation && !cfgStatus.proxyIpReputation.isSafe) {
        warnings.push({
            level: 'critical',
            message: `Proxy IP ${cfgStatus.proxyIpReputation.ip} BLACKLISTED (abuse score: ${cfgStatus.proxyIpReputation.abuseScore}/100, ISP: ${cfgStatus.proxyIpReputation.isp}). Cambiare proxy prima di procedere.`,
        });
    }
    if (cfgStatus.staleAccounts.length > 0) {
        warnings.push({
            level: 'warn',
            message: `Cookie sessione scaduti per: ${cfgStatus.staleAccounts.join(', ')}. Rinnovare il profilo con create-profile.`,
        });
    }
    if (cfgStatus.noLoginAccounts.length > 0) {
        warnings.push({
            level: 'critical',
            message: `Nessun login registrato per: ${cfgStatus.noLoginAccounts.join(', ')}. Esegui "bot login" prima di procedere.`,
        });
    }
}
