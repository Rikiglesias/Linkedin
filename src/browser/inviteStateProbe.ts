/**
 * browser/inviteStateProbe.ts — stato dell'invito letto da un CONTENITORE, mai dal body (C13/C14, goal `bot-operativo`).
 *
 * Prima `inviteWorker` decideva «invito inviato?» e «limite settimanale?» leggendo il testo dell'INTERO body e con
 * selettori valutati sulla pagina intera: un bottone «Pending» nella sidebar «altri profili» o un post del feed che
 * cita il «weekly invitation limit» bastavano a produrre una prova falsa (o un falso limite → pausa di 7 giorni).
 * Qui ogni lettura è ancorata a un contenitore risolto con i SELETTORI di produzione (`selectors.ts`):
 *  - `profileActionsContainer` = le azioni del profilo TARGET (Connect / Pending / Message): è l'unico posto in cui
 *    un «Pending» riguarda davvero questo lead;
 *  - `systemNoticeContainer` = modale, dialog, toast, alert di LinkedIn: è l'unico posto in cui il limite settimanale
 *    o «Invitation sent» sono avvisi di sistema e non testo di un utente.
 * Nessun contenitore risolto → false (fail-closed: nessuna prova, nessun limite). Un errore Playwright (pagina chiusa,
 * frame staccato, navigazione in corso) NON è silenzioso: log `invite_probe.dom_error` con il passo fallito, poi lo
 * stesso valore neutro — il chiamante decide come prima, ma l'evento resta visibile (regola anti-ban 9, L5-LI.4).
 * Solo letture DOM: zero click, zero navigazione, zero attese. Provato su browser vero in
 * `tests/harnessInviteProofAnchored.ts`.
 */
import type { Locator, Page } from 'playwright';

import { joinSelectors } from '../selectors';
import { logWarn } from '../telemetry/logger';

/** Estensione Playwright (`:text-matches`), valutata SOLO sui bottoni del contenitore delle azioni. */
const PENDING_BUTTON_TEXT = 'button:text-matches("pending|in attesa", "i")';
const INVITE_SENT_TEXT = /invitation sent|invito inviato/i;
const WEEKLY_LIMIT_TEXT = /weekly invitation limit|limite settimanale(?: degli)? inviti|hai raggiunto il limite settimanale/i;

type ContainerKey = 'profileActionsContainer' | 'systemNoticeContainer';

/**
 * Gestore degli errori DOM: logga (fire-and-forget, senza aggiungere attese alla sonda) e ritorna il valore neutro.
 * `step` dice QUALE lettura è fallita, così un errore ricorrente si diagnostica dal log e non dal silenzio.
 */
function onDomError<T>(step: string, neutral: T): (error: unknown) => T {
    return (error) => {
        const message = error instanceof Error ? error.message : String(error);
        logWarn('invite_probe.dom_error', { step, error: message }).catch(() => undefined);
        return neutral;
    };
}

async function resolveContainers(page: Page, key: ContainerKey): Promise<Locator[]> {
    const all = page.locator(joinSelectors(key));
    const total = await all.count().catch(onDomError(`resolve:${key}`, 0));
    return Array.from({ length: total }, (_, index) => all.nth(index));
}

async function countIn(container: Locator, selector: string): Promise<number> {
    return container.locator(selector).count().catch(onDomError(`count:${selector}`, 0));
}

/** Il profilo TARGET ha già un invito in attesa (bottone Pending / In attesa nelle sue azioni). */
export async function hasPendingInviteIndicator(page: Page): Promise<boolean> {
    for (const container of await resolveContainers(page, 'profileActionsContainer')) {
        if ((await countIn(container, joinSelectors('invitePendingIndicators'))) > 0) return true;
        if ((await countIn(container, PENDING_BUTTON_TEXT)) > 0) return true;
    }
    return false;
}

async function systemNoticeMatches(page: Page, selectorKey: 'inviteWeeklyLimitSignals' | null, pattern: RegExp): Promise<boolean> {
    for (const container of await resolveContainers(page, 'systemNoticeContainer')) {
        if (selectorKey && (await countIn(container, joinSelectors(selectorKey))) > 0) return true;
        const text = await container.innerText().catch(onDomError('innerText:systemNoticeContainer', ''));
        if (pattern.test(text)) return true;
    }
    return false;
}

/** LinkedIn mostra un avviso di sistema di limite settimanale (modale/toast/alert), non un testo qualunque. */
export async function hasWeeklyInviteLimitNotice(page: Page): Promise<boolean> {
    return systemNoticeMatches(page, 'inviteWeeklyLimitSignals', WEEKLY_LIMIT_TEXT);
}

/** Toast/alert «Invitation sent» dopo il click: prova di invio alternativa al bottone Pending. */
export async function hasInviteSentNotice(page: Page): Promise<boolean> {
    return systemNoticeMatches(page, null, INVITE_SENT_TEXT);
}

/** Prova di invio ancorata: Pending nelle azioni del profilo OPPURE avviso di sistema «Invitation sent». */
export async function detectInviteProofAnchored(page: Page): Promise<boolean> {
    return (await hasPendingInviteIndicator(page)) || (await hasInviteSentNotice(page));
}
