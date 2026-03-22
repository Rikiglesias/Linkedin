/**
 * browser/selectorCanary.ts — Verifica selettori CSS pre-sessione.
 * Estratto da humanBehavior.ts (A17: split file >1000 righe).
 */

import { Page } from 'playwright';
import { joinSelectors } from '../selectors';
import { humanDelay } from './humanBehavior';
type CanaryWorkflow = 'all' | 'invite' | 'check' | 'message';

interface SelectorCanaryStepDefinition {
    id: string;
    url: string;
    selectors: string[];
    required: boolean;
    timeoutMs?: number;
}

export interface SelectorCanaryStepResult {
    id: string;
    url: string;
    required: boolean;
    ok: boolean;
    matchedSelector: string | null;
    error: string | null;
}

export interface SelectorCanaryReport {
    workflow: CanaryWorkflow;
    ok: boolean;
    criticalFailed: number;
    optionalFailed: number;
    steps: SelectorCanaryStepResult[];
}

function buildSelectorCanaryPlan(workflow: CanaryWorkflow): SelectorCanaryStepDefinition[] {
    const plan: SelectorCanaryStepDefinition[] = [
        {
            id: 'feed.global_nav',
            url: 'https://www.linkedin.com/feed/',
            selectors: [joinSelectors('globalNav')],
            required: true,
            timeoutMs: 4000,
        },
    ];

    if (workflow === 'all' || workflow === 'invite') {
        plan.push({
            id: 'invite.search_surface',
            url: 'https://www.linkedin.com/search/results/people/?keywords=manager',
            selectors: [joinSelectors('connectButtonPrimary'), 'a[href*="/in/"]'],
            required: false,
            timeoutMs: 3000,
        });
    }

    if (workflow === 'all' || workflow === 'message') {
        plan.push({
            id: 'message.inbox_surface',
            url: 'https://www.linkedin.com/messaging/',
            selectors: [
                '.msg-conversations-container',
                '.msg-overlay-list-bubble',
                '[data-control-name="compose_message"]',
            ],
            required: false,
            timeoutMs: 3000,
        });
    }

    if (workflow === 'all' || workflow === 'check') {
        plan.push({
            id: 'check.network_surface',
            url: 'https://www.linkedin.com/mynetwork/',
            selectors: [
                'a[href*="/mynetwork/invitation-manager/"]',
                joinSelectors('invitePendingIndicators'),
                joinSelectors('globalNav'),
            ],
            required: false,
            timeoutMs: 3000,
        });
    }

    return plan;
}

async function evaluateCanaryStep(page: Page, step: SelectorCanaryStepDefinition): Promise<SelectorCanaryStepResult> {
    try {
        await page.goto(step.url, { waitUntil: 'domcontentloaded' });
        await humanDelay(page, 800, 1600);

        for (const selector of step.selectors) {
            const normalized = selector.trim();
            if (!normalized) continue;
            const playwrightSelector = normalized.startsWith('//') ? `xpath=${normalized}` : normalized;
            try {
                await page.waitForSelector(playwrightSelector, { timeout: step.timeoutMs ?? 3000 });
                return {
                    id: step.id,
                    url: step.url,
                    required: step.required,
                    ok: true,
                    matchedSelector: normalized,
                    error: null,
                };
            } catch {
                // Try next candidate selector.
            }
        }

        return {
            id: step.id,
            url: step.url,
            required: step.required,
            ok: false,
            matchedSelector: null,
            error: 'selector_not_found',
        };
    } catch (error) {
        return {
            id: step.id,
            url: step.url,
            required: step.required,
            ok: false,
            matchedSelector: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function runSelectorCanaryDetailed(
    page: Page,
    workflow: CanaryWorkflow = 'all',
): Promise<SelectorCanaryReport> {
    const plan = buildSelectorCanaryPlan(workflow);
    const steps: SelectorCanaryStepResult[] = [];

    for (const step of plan) {
        steps.push(await evaluateCanaryStep(page, step));
    }

    const criticalFailed = steps.filter((step) => step.required && !step.ok).length;
    const optionalFailed = steps.filter((step) => !step.required && !step.ok).length;
    return {
        workflow,
        ok: criticalFailed === 0,
        criticalFailed,
        optionalFailed,
        steps,
    };
}

export async function runSelectorCanary(page: Page): Promise<boolean> {
    const report = await runSelectorCanaryDetailed(page, 'all');
    return report.ok;
}
