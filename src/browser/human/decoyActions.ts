/**
 * browser/human/decoyActions.ts
 * ─────────────────────────────────────────────────────────────────
 * Azioni diversive (decoy): performDecoyBurst (raffica 2-4 step shufflati) e
 * performDecoyAction (singola micro-azione organica) navigano in sezioni casuali
 * di LinkedIn per mascherare pattern lineari da bot. Estratto da humanBehavior.ts
 * (A13, split SRP). Le probabilità (search context 0.7, feed-interact 0.2), il pool
 * termini e l'ordine shufflato sono behavioral-pattern anti-ban: copiati VERBATIM.
 */

import { Page } from 'playwright';
import { randomElement, randomInt } from '../../utils/random';
import { ensureVisualCursorOverlay } from './cursorOverlay';
import { ensureInputBlock } from './inputBlock';
import { humanDelay } from './humanDelay';
import { simulateHumanReading } from './readingSimulation';

type DecoyStep = 'feed' | 'network' | 'notifications' | 'search' | 'back';

function shuffle<T>(items: T[]): T[] {
    const clone = items.slice();
    for (let i = clone.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = clone[i];
        clone[i] = clone[j] as T;
        clone[j] = tmp as T;
    }
    return clone;
}

async function runDecoyStep(page: Page, step: DecoyStep, contextTerms?: readonly string[]): Promise<void> {
    if (step === 'feed') {
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2600);
        await simulateHumanReading(page);
        return;
    }
    if (step === 'network') {
        await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2400);
        await simulateHumanReading(page);
        return;
    }
    if (step === 'notifications') {
        await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded' });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2400);
        return;
    }
    if (step === 'search') {
        // M15/M16: Se termini context-aware disponibili, usali (70%); altrimenti generici.
        const useContext = contextTerms && contextTerms.length > 0 && Math.random() < 0.7;
        const term = randomElement(useContext ? contextTerms : DECOY_SEARCH_TERMS);
        await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(term)}`, {
            waitUntil: 'domcontentloaded',
        });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2600);
        await simulateHumanReading(page);
        return;
    }
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await ensureVisualCursorOverlay(page);
    await ensureInputBlock(page);
    await humanDelay(page, 800, 1600);
}

export async function performDecoyBurst(page: Page, contextTerms?: readonly string[]): Promise<void> {
    const baseSteps: DecoyStep[] = ['feed', 'notifications', 'network', 'search', 'back'];
    const steps = shuffle(baseSteps).slice(0, randomInt(2, 4));
    for (const step of steps) {
        await runDecoyStep(page, step, contextTerms).catch(() => null);
    }
}

/**
 * Azioni Diversive Mute (Decoy):
 * naviga in sezioni casuali di LinkedIn prima dei veri task
 * per mascherare pattern lineari da bot.
 */
const DECOY_SEARCH_TERMS: readonly string[] = [
    // Business roles
    'ceo',
    'cto',
    'cfo',
    'coo',
    'cmo',
    'vp sales',
    'vp engineering',
    'head of marketing',
    'head of product',
    'head of operations',
    'director of sales',
    'director of engineering',
    'director of hr',
    'product manager',
    'program manager',
    'account executive',
    'business development',
    'chief of staff',
    'general manager',
    // Industries
    'fintech',
    'saas',
    'edtech',
    'healthtech',
    'biotech',
    'cleantech',
    'proptech',
    'insurtech',
    'agritech',
    'legaltech',
    'martech',
    'e-commerce',
    'cybersecurity',
    'artificial intelligence',
    'blockchain',
    'renewable energy',
    'logistics',
    'telecommunications',
    'media',
    // Skills
    'project management',
    'data analysis',
    'cloud computing',
    'machine learning',
    'digital marketing',
    'ux design',
    'ui design',
    'full stack developer',
    'devops engineer',
    'data scientist',
    'product design',
    'agile methodology',
    'business intelligence',
    'supply chain management',
    'financial analysis',
    'content strategy',
    'software architecture',
    'sales operations',
    'customer success',
    // General professional terms
    'marketing',
    'developer',
    'sales',
    'hr',
    'tech',
    'design',
    'consultant',
    'entrepreneur',
    'startup',
    'venture capital',
    'growth hacking',
    'talent acquisition',
    'brand strategy',
    'operations manager',
    'frontend developer',
    'backend engineer',
    'cloud architect',
    'scrum master',
    'ux researcher',
] as const;

export async function performDecoyAction(page: Page, contextTerms?: readonly string[]): Promise<void> {
    // M15/M16: Se termini context-aware forniti, mescola con generici (coerenza settore)
    const terms =
        contextTerms && contextTerms.length > 0
            ? [...contextTerms, ...Array.from(DECOY_SEARCH_TERMS).slice(0, 15)]
            : DECOY_SEARCH_TERMS;
    const reInjectOverlay = async () => {
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
    };
    const actions = [
        async () => {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
            await reInjectOverlay();
            await simulateHumanReading(page);
            // AD-02: Interviene sul Feed con una probabilità del 20%
            try {
                const { callInteractWithFeed } = await import('../overlayBridge');
                await callInteractWithFeed(page, 0.2);
            } catch {
                // organicContent import/exec fallito — skip decoy interaction
            }
        },
        async () => {
            await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
            await reInjectOverlay();
            await humanDelay(page, 2000, 5000);
            await simulateHumanReading(page);
        },
        async () => {
            const search = randomElement(terms);
            await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${search}`, {
                waitUntil: 'domcontentloaded',
            });
            await reInjectOverlay();
            await humanDelay(page, 1500, 4000);
            await simulateHumanReading(page);
        },
        async () => {
            // AD-10: Ondivagous navigation (history.back)
            const historyState = await page.evaluate(() => window.history.length).catch(() => 0);
            if (historyState > 2) {
                await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
                await reInjectOverlay();
                await humanDelay(page, 1000, 3000);
                await simulateHumanReading(page);
            } else {
                // Fallback action
                await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded' });
                await reInjectOverlay();
                await humanDelay(page, 1200, 2400);
            }
        },
    ];

    try {
        const decoy = randomElement(actions);
        await Promise.race([
            decoy(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Decoy timeout 15s')), 15_000)),
        ]);
    } catch {
        // Ignora silenziosamente — è solo noise decoy
    }
}
