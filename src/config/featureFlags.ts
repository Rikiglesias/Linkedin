/**
 * A14: Feature Flags — abilita/disabilita feature a runtime senza deploy.
 *
 * Usa runtime_flags DB (già esistente) per persistenza cross-riavvii.
 * Le feature flags permettono:
 * - Canary deploy (abilita nuova feature su 1 account, poi rollout)
 * - Rollback immediato (disabilita feature senza git revert)
 * - A/B testing (50% account con feature, 50% senza)
 */

import { getRuntimeFlag, setRuntimeFlag } from '../core/repositories';
import { logInfo } from '../telemetry/logger';

export interface FeatureFlag {
    name: string;
    description: string;
    defaultEnabled: boolean;
}

const FEATURE_FLAGS: FeatureFlag[] = [
    { name: 'ai_decision_engine', description: 'R02: AI decide SE invitare/messaggiare', defaultEnabled: false },
    { name: 'observe_page_context', description: 'R01: Osserva pagina prima di agire', defaultEnabled: false },
    { name: 'search_click_result', description: 'R08: Click risultato search invece di goto', defaultEnabled: true },
    { name: 'trust_acceleration', description: 'A11: Budget boost per account maturi', defaultEnabled: true },
    { name: 'decoy_context_aware', description: 'M15/M16: Decoy coerenti col settore', defaultEnabled: true },
    { name: 'follow_up_chat_check', description: 'C06: Verifica chat prima di follow-up', defaultEnabled: true },
    { name: 'identity_check', description: 'C04: Verifica identità h1 vs lead name', defaultEnabled: true },
    { name: 'budget_recalc_mid_session', description: 'H24: Budget ricalcolato ogni 10 job', defaultEnabled: true },
];

/**
 * Verifica se una feature flag è abilitata.
 * Ordine: runtime_flag DB > default dalla definizione.
 */
export async function isFeatureEnabled(flagName: string): Promise<boolean> {
    const dbValue = await getRuntimeFlag(`ff:${flagName}`).catch(() => null);
    if (dbValue === 'true') return true;
    if (dbValue === 'false') return false;
    const definition = FEATURE_FLAGS.find((f) => f.name === flagName);
    return definition?.defaultEnabled ?? false;
}

/**
 * Imposta una feature flag (persistente nel DB).
 */
export async function setFeatureFlag(flagName: string, enabled: boolean): Promise<void> {
    await setRuntimeFlag(`ff:${flagName}`, String(enabled));
    await logInfo('feature_flags.set', { flag: flagName, enabled });
}

/**
 * Lista tutte le feature flags con stato corrente.
 */
export async function listFeatureFlags(): Promise<Array<FeatureFlag & { enabled: boolean; source: 'db' | 'default' }>> {
    const results: Array<FeatureFlag & { enabled: boolean; source: 'db' | 'default' }> = [];
    for (const flag of FEATURE_FLAGS) {
        const dbValue = await getRuntimeFlag(`ff:${flag.name}`).catch(() => null);
        const enabled = dbValue === 'true' ? true : dbValue === 'false' ? false : flag.defaultEnabled;
        results.push({
            ...flag,
            enabled,
            source: dbValue !== null ? 'db' : 'default',
        });
    }
    return results;
}
