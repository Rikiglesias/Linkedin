/**
 * harnessInviteProofAnchored.ts — C13 del contratto `bot-operativo`: la prova di invio è ANCORATA a un contenitore.
 *
 * Perché su browser vero: vitest gira in `environment: 'node'` e i selettori di produzione usano `:has-text` (estensione
 * Playwright), non valutabile senza un browser. Qui non si mocka niente: si costruisce il DOM con le classi che LinkedIn
 * espone, `page.setContent(...)`, zero rete, zero LinkedIn, e si interrogano le FUNZIONI e i SELETTORI di produzione.
 *
 * Cosa prova (i casi del contratto):
 *  1. indicatore Pending DENTRO il contenitore delle azioni del profilo → true;
 *  2. bottone Pending FUORI dal contenitore (sidebar «altri profili») → false (prima: `page.textContent('body')` → true);
 *  3. limite settimanale in un modale di sistema → true;
 *  4. lo stesso testo in un post del feed → false (prima: `div:has-text(...)` sulla pagina intera → true);
 *  5. caso C14: contenitore con Pending → l'helper risponde true PRIMA di ogni click (nessun Connect da premere).
 *
 * Uso:  npx ts-node src/tests/harnessInviteProofAnchored.ts
 * Exit: 0 = tutti i contratti rispettati, 1 = almeno uno rotto (stampa quale).
 */

import { chromium, type Page } from 'playwright';

import { hasInviteSentNotice, hasPendingInviteIndicator, hasWeeklyInviteLimitNotice } from '../browser/inviteStateProbe';
import { joinSelectors } from '../selectors';

type Contract = { name: string; got: unknown; expected: string; ok: boolean };

const HEAD = '<!doctype html><meta charset="utf-8">';

/** Profilo target con l'invito già in attesa: il bottone Pending sta nelle azioni del top card. */
const PROFILE_PENDING_HTML = `${HEAD}
<main>
  <section class="pv-top-card artdeco-card">
    <h1>Mario Rossi</h1>
    <div class="text-body-medium">CEO @ Acme</div>
    <div class="pv-top-card-v2-ctas">
      <button aria-label="Pending" class="artdeco-button artdeco-button--secondary">Pending</button>
      <button aria-label="Message">Message</button>
    </div>
  </section>
  <section class="pv-about-section"><p>About Mario.</p></section>
</main>`;

/** Profilo target ancora da invitare (Connect nelle azioni), con un Pending FUORI dal contenitore (sidebar). */
const PROFILE_CONNECT_WITH_SIDEBAR_PENDING_HTML = `${HEAD}
<main>
  <section class="pv-top-card artdeco-card">
    <h1>Mario Rossi</h1>
    <div class="pv-top-card-v2-ctas">
      <button aria-label="Invite Mario Rossi to connect" class="artdeco-button artdeco-button--primary">Connect</button>
      <button aria-label="Message">Message</button>
    </div>
  </section>
</main>
<aside class="pv-browsemap">
  <ul>
    <li><span>Luigi Verdi</span><button aria-label="Pending">Pending</button></li>
    <li><span>Anna Bianchi</span><button>In attesa</button></li>
  </ul>
</aside>`;

/** Modale di sistema con il limite settimanale. */
const WEEKLY_LIMIT_MODAL_HTML = `${HEAD}
<main><section class="pv-top-card"><h1>Mario Rossi</h1><div class="pv-top-card-v2-ctas"><button>Connect</button></div></section></main>
<div role="dialog" class="artdeco-modal">
  <h2 class="artdeco-modal__header">You’ve reached the weekly invitation limit</h2>
  <div class="artdeco-modal__content"><span>You can send more invitations next week.</span></div>
</div>`;

/** Lo stesso testo, ma in un post del feed: NON è un avviso di sistema. */
const WEEKLY_LIMIT_IN_FEED_HTML = `${HEAD}
<main>
  <div class="feed-shared-update-v2">
    <span class="update-components-text">I hit the weekly invitation limit again, LinkedIn please raise it!</span>
  </div>
  <div class="feed-shared-update-v2"><span>Ho raggiunto il limite settimanale inviti, che fatica.</span></div>
</main>`;

/** Toast «Invitation sent» dopo il click (prova di invio alternativa al bottone Pending). */
const INVITATION_SENT_TOAST_HTML = `${HEAD}
<main><section class="pv-top-card"><h1>Mario Rossi</h1><div class="pv-top-card-v2-ctas"><button>Connect</button></div></section></main>
<div class="artdeco-toast-item"><p class="artdeco-toast-item__message">Invitation sent</p></div>`;

async function contract(page: Page, name: string, html: string, run: (p: Page) => Promise<unknown>, expected: unknown): Promise<Contract> {
    await page.setContent(html);
    const got = await run(page);
    return { name, got, expected: String(expected), ok: got === expected };
}

async function main(): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        const contracts: Contract[] = [];
        contracts.push(
            await contract(page, '1. Pending DENTRO il contenitore delle azioni → prova positiva', PROFILE_PENDING_HTML, hasPendingInviteIndicator, true),
            await contract(
                page,
                '2. Pending FUORI dal contenitore (sidebar) e Connect dentro → nessuna prova',
                PROFILE_CONNECT_WITH_SIDEBAR_PENDING_HTML,
                hasPendingInviteIndicator,
                false,
            ),
            await contract(
                page,
                '2-bis. controprova: il vecchio criterio (pagina intera) avrebbe risposto true',
                PROFILE_CONNECT_WITH_SIDEBAR_PENDING_HTML,
                async (p) => (await p.locator(joinSelectors('invitePendingIndicators')).count()) > 0,
                true,
            ),
            await contract(page, '3. limite settimanale nel modale di sistema → true', WEEKLY_LIMIT_MODAL_HTML, hasWeeklyInviteLimitNotice, true),
            await contract(page, '4. stesso testo in un post del feed → false', WEEKLY_LIMIT_IN_FEED_HTML, hasWeeklyInviteLimitNotice, false),
            await contract(
                page,
                '4-bis. controprova: il vecchio criterio (pagina intera) avrebbe risposto true',
                WEEKLY_LIMIT_IN_FEED_HTML,
                async (p) => (await p.locator(joinSelectors('inviteWeeklyLimitSignals')).count()) > 0,
                true,
            ),
            await contract(page, '5. toast «Invitation sent» → prova positiva', INVITATION_SENT_TOAST_HTML, hasInviteSentNotice, true),
            await contract(
                page,
                '6. caso C14: contenitore con Pending → helper true PRIMA di ogni click (nessun Connect nel contenitore)',
                PROFILE_PENDING_HTML,
                async (p) =>
                    (await hasPendingInviteIndicator(p)) &&
                    (await p.locator(joinSelectors('profileActionsContainer')).locator(joinSelectors('connectButtonPrimary')).count()) === 0,
                true,
            ),
        );

        console.log('\n=== PROVA DI INVIO ANCORATA — browser vero, selettori e funzioni di produzione, zero rete ===\n');
        let broken = 0;
        for (const c of contracts) {
            if (!c.ok) broken++;
            console.log(`[${c.ok ? 'OK  ' : 'ROTTO'}] ${c.name}`);
            console.log(`       atteso  : ${c.expected}`);
            console.log(`       misurato: ${String(c.got)}\n`);
        }
        console.log(broken === 0 ? 'Tutti i contratti rispettati.' : `${broken} contratti ROTTI.`);
        process.exitCode = broken === 0 ? 0 : 1;
    } finally {
        await browser.close();
    }
}

void main();
