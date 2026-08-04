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

/**
 * Esito di uno step, discriminato per CAUSA.
 * - `safe`: selettore trovato.
 * - `unsafe`: pagina arrivata e renderizzata, ma il selettore non c'è → il DOM di LinkedIn è
 *   cambiato. È platform-wide (riguarda ogni account) e giustifica la quarantena.
 * - `unknown`: la pagina non è mai arrivata (rete, proxy, redirect fuori) → del DOM non sappiamo
 *   NULLA. È locale e transitorio: fermare il ciclo sì, incolpare i selettori no.
 *
 * Prima esisteva solo il booleano `ok` e i due fallimenti finivano entrambi in
 * `error: 'selector_not_found'`. Costo reale: il 2026-03-30 un proxy rotto ha prodotto 19 cicli
 * abortiti in ~11 s l'uno (= il timeout, non un cambio di DOM) e una quarantena GLOBALE
 * permanente su tutti gli account, rilasciata a mano due mesi e mezzo dopo.
 */
export type SelectorCanaryStepState = 'safe' | 'unsafe' | 'unknown';

export interface SelectorCanaryStepResult {
    id: string;
    url: string;
    required: boolean;
    /** Retro-compatibile: vero solo per `safe`. I consumer nuovi leggano `state`. */
    ok: boolean;
    state: SelectorCanaryStepState;
    matchedSelector: string | null;
    error: string | null;
}

export interface SelectorCanaryReport {
    workflow: CanaryWorkflow;
    ok: boolean;
    /** Step obbligatori con DOM cambiato su pagina ARRIVATA → quarantena legittima. */
    criticalFailed: number;
    /** Step obbligatori con esito indeterminato → fermare il ciclo, NON quarantinare. */
    criticalUnknown: number;
    optionalFailed: number;
    steps: SelectorCanaryStepResult[];
}

function buildSelectorCanaryPlan(workflow: CanaryWorkflow): SelectorCanaryStepDefinition[] {
    const plan: SelectorCanaryStepDefinition[] = [
        {
            id: 'feed.global_nav',
            url: 'https://www.linkedin.com/feed/',
            selectors: [joinSelectors('globalNav')],
            // DECLASSATO (era `true`, ed era l'unico obbligatorio dell'intero piano): il feed è una
            // pagina che nessun workflow visita, quindi un suo problema non dice niente sulla capacità
            // del bot di lavorare — eppure bastava a fermarlo del tutto. Resta nel piano come segnale
            // di salute generale: rimuoverlo cambierebbe numero e ordine delle pagine aperte, cioè il
            // footprint osservabile da LinkedIn, e non è quello che serve qui.
            required: false,
            // La global-nav del feed è React-rendered e compare a ~4-6s anche su connessione
            // veloce: 4s davano falsi negativi (selettore presente ma non ancora montato). 10s
            // copre il render senza rendere il canary lento (gira max 1×/4h, cache).
            timeoutMs: 10000,
        },
    ];

    // Gli step qui sotto controllano i selettori da cui dipendono davvero le azioni del bot, quindi
    // sono loro gli obbligatori: se cambia il bottone «Collegati», il canary deve accorgersene.
    // Il timeout è allineato a quello del feed (10s) e non lasciato a 6s: queste pagine sono
    // React-rendered allo stesso modo, e promuoverle a obbligatorie tenendo 6s ricreerebbe i falsi
    // negativi già risolti sul feed — con la differenza che ora fermerebbero il bot.
    const TIMEOUT_SUPERFICI_MS = 10000;

    if (workflow === 'all' || workflow === 'invite') {
        plan.push({
            id: 'invite.search_surface',
            url: 'https://www.linkedin.com/search/results/people/?keywords=manager',
            selectors: [joinSelectors('connectButtonPrimary'), 'a[href*="/in/"]'],
            required: true,
            timeoutMs: TIMEOUT_SUPERFICI_MS,
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
            required: true,
            timeoutMs: TIMEOUT_SUPERFICI_MS,
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
            required: true,
            timeoutMs: TIMEOUT_SUPERFICI_MS,
        });
    }

    return plan;
}

/** Lunghezza minima del testo di `body` perché la pagina conti come renderizzata. */
const MIN_TESTO_PAGINA_RESA = 200;

/**
 * La pagina che stiamo guardando è davvero quella chiesta, ed è arrivata?
 *
 * Due segnali INDIPENDENTI dai selettori sotto esame — altrimenti si userebbe la cosa in
 * discussione per giudicare sé stessa:
 *  1. l'URL finale è ancora su linkedin.com e non è finito su login/authwall/checkpoint
 *     (un redirect lì significa «non ho visto la pagina», non «il selettore non c'è più»);
 *  2. il `body` contiene testo in quantità da pagina vera. Una navigazione fallita, una pagina
 *     di errore del proxy o un DOM mai renderizzato lasciano un body vuoto o quasi.
 *
 * Chiamata SOLO quando nessun selettore ha matchato: sul percorso felice non costa nulla, e non
 * aggiunge né navigazioni né attese (nessun cambiamento del footprint verso LinkedIn — la stessa
 * lettura di `body` gira già oggi nel canary, `core/workflowEntryGuards.ts:124`).
 */
/**
 * Primo segnale: siamo finiti sulla pagina che avevamo chiesto?
 *
 * Non dipende dal rendering, quindi si può guardare SUBITO dopo la navigazione senza rischiare
 * falsi «non so» su pagine React lente. Serve anche a non sprecare tempo: senza questo controllo
 * un redirect all'authwall fa consumare tutti i timeout dei selettori (fino a 30 s per superficie,
 * e il guard ritenta l'intero canary) prima di arrivare a una conclusione che era già nota — cioè
 * minuti di browser fermo su LinkedIn a vuoto, che è esattamente ciò che non vogliamo far vedere.
 */
function inspectUrlArrival(page: Page): { arrived: boolean; reason: string } {
    const currentUrl = typeof page.url === 'function' ? page.url() : '';
    if (!/^https?:\/\/([a-z0-9-]+\.)*linkedin\.com(\/|$)/i.test(currentUrl)) {
        return { arrived: false, reason: `off_domain:${currentUrl || 'about:blank'}` };
    }
    if (/\/(login|authwall|checkpoint|challenge|uas)(\/|\?|$)/i.test(currentUrl)) {
        return { arrived: false, reason: 'auth_wall' };
    }
    return { arrived: true, reason: 'url_ok' };
}

/** Secondo segnale, da guardare solo DOPO i selettori: la pagina ha renderizzato qualcosa? */
async function inspectPageArrival(page: Page): Promise<{ arrived: boolean; reason: string }> {
    const perUrl = inspectUrlArrival(page);
    if (!perUrl.arrived) return perUrl;

    const text = (await page.textContent('body').catch(() => '')) ?? '';
    if (text.trim().length < MIN_TESTO_PAGINA_RESA) {
        return { arrived: false, reason: 'empty_dom' };
    }
    return { arrived: true, reason: 'rendered' };
}

async function evaluateCanaryStep(page: Page, step: SelectorCanaryStepDefinition): Promise<SelectorCanaryStepResult> {
    const base = { id: step.id, url: step.url, required: step.required };
    try {
        await page.goto(step.url, { waitUntil: 'domcontentloaded' });
        await humanDelay(page, 800, 1600);

        // Se non siamo nemmeno sulla pagina chiesta (redirect all'authwall, dominio diverso) non
        // c'è nessun selettore da cercare: cercarlo comunque vorrebbe dire tenere il browser
        // fermo su LinkedIn per decine di secondi per poi concludere ciò che si sapeva già.
        const arrivoPerUrl = inspectUrlArrival(page);
        if (!arrivoPerUrl.arrived) {
            return {
                ...base,
                ok: false,
                state: 'unknown',
                matchedSelector: null,
                error: `page_not_reached:${arrivoPerUrl.reason}`,
            };
        }

        for (const selector of step.selectors) {
            const normalized = selector.trim();
            if (!normalized) continue;
            const playwrightSelector = normalized.startsWith('//') ? `xpath=${normalized}` : normalized;
            try {
                await page.waitForSelector(playwrightSelector, { timeout: step.timeoutMs ?? 3000 });
                return { ...base, ok: true, state: 'safe', matchedSelector: normalized, error: null };
            } catch {
                // Try next candidate selector.
            }
        }

        // Nessun selettore trovato. Il verdetto dipende da un fatto che finora nessuno chiedeva:
        // la pagina è arrivata? Se sì il DOM è cambiato davvero; se no non abbiamo visto niente.
        const arrival = await inspectPageArrival(page);
        if (!arrival.arrived) {
            return {
                ...base,
                ok: false,
                state: 'unknown',
                matchedSelector: null,
                error: `page_not_reached:${arrival.reason}`,
            };
        }

        return { ...base, ok: false, state: 'unsafe', matchedSelector: null, error: 'selector_not_found' };
    } catch (error) {
        // `goto` fallito (DNS, proxy, timeout di navigazione): la pagina non è mai stata caricata,
        // quindi sui selettori non c'è nessuna informazione da estrarre. Mai `unsafe` da qui.
        return {
            ...base,
            ok: false,
            state: 'unknown',
            matchedSelector: null,
            error: `navigation_failed:${error instanceof Error ? error.message : String(error)}`,
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

    // `criticalFailed` conta SOLO il drift accertato: è il numero su cui a valle si decide la
    // quarantena, e deve restare pulito da tutto ciò che è «non lo so».
    const criticalFailed = steps.filter((step) => step.required && step.state === 'unsafe').length;
    const criticalUnknown = steps.filter((step) => step.required && step.state === 'unknown').length;
    const optionalFailed = steps.filter((step) => !step.required && !step.ok).length;
    return {
        workflow,
        // Il ciclo si ferma in entrambi i casi (senza pagina non si lavora); a cambiare è la
        // CONSEGUENZA, che il caller sceglie leggendo i due contatori separati.
        ok: criticalFailed === 0 && criticalUnknown === 0,
        criticalFailed,
        criticalUnknown,
        optionalFailed,
        steps,
    };
}

export async function runSelectorCanary(page: Page): Promise<boolean> {
    const report = await runSelectorCanaryDetailed(page, 'all');
    return report.ok;
}
