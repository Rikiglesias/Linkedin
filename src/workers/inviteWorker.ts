import { Page } from 'playwright';
import {
    detectChallenge,
    dismissKnownOverlays,
    humanDelay,
    humanMouseMove,
    humanType,
    simulateHumanReading,
} from '../browser';
import { ensureViewportDwell, computeProfileDwellTime } from '../browser/humanBehavior';
import { navigateToProfileWithContext } from '../browser/navigationContext';
import {
    checkAndIncrementDailyLimit,
    incrementDailyStat,
    incrementListDailyStat,
    recordLeadTimingAttribution,
    updateLeadPromptVariant,
    updateLeadScrapedContext,
} from '../core/repositories';
import { getLeadById } from '../core/repositories/leadsCore';
import { isBlacklisted } from '../core/repositories/blacklist';
import { transitionLead } from '../core/leadStateService';
import { joinSelectors } from '../selectors';
import { InviteJobPayload, LeadRecord } from '../types/domain';
import { WorkerContext } from './context';
import { ChallengeDetectedError, RetryableWorkerError } from './errors';
import { attemptChallengeResolution } from './challengeHandler';
import { isSalesNavigatorUrl } from '../linkedinUrl';
import { config } from '../config';
import { isLoggedIn } from '../browser/auth';
import { buildPersonalizedInviteNote } from '../ai/inviteNotePersonalizer';
import { pauseAutomation } from '../risk/incidentManager';
import { bridgeDailyStat, bridgeLeadStatus } from '../cloud/cloudBridge';
import { recordSent, inferHourBucket } from '../ml/abBandit';
import { WorkerExecutionResult, workerResult } from './result';
import { inferLeadSegment } from '../ml/segments';
import { logInfo, logWarn } from '../telemetry/logger';
import { normalizeNameForComparison, jaroWinklerSimilarity } from '../utils/text';
import { observePageContext, logObservation } from '../browser/observePageContext';
import { aiDecide } from '../ai/aiDecisionEngine';

// Parole attese nel bottone Connect per confidence check pre-click.
// Previene click su bottone sbagliato se LinkedIn cambia il layout.
const CONNECT_BUTTON_KEYWORDS = ['connect', 'collegati', 'connetti'];

function textContainsConnectKeyword(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return CONNECT_BUTTON_KEYWORDS.some((kw) => lower.includes(kw));
}

async function clickConnectOnProfile(page: Page): Promise<boolean> {
    const primaryBtn = page.locator(joinSelectors('connectButtonPrimary')).first();
    if ((await primaryBtn.count()) > 0) {
        // Confidence check: il testo del bottone contiene "Connect"/"Collegati"?
        const btnText = await primaryBtn.innerText().catch(() => '');
        if (!textContainsConnectKeyword(btnText)) {
            console.warn(`[INVITE] Confidence check FAILED: bottone primario dice "${btnText.trim().substring(0, 40)}" — skip`);
            return false;
        }
        await humanMouseMove(page, joinSelectors('connectButtonPrimary'));
        await humanDelay(page, 120, 320);
        await primaryBtn.click();
        return true;
    }

    const moreBtn = page.locator(joinSelectors('moreActionsButton')).first();
    if ((await moreBtn.count()) > 0) {
        await humanMouseMove(page, joinSelectors('moreActionsButton'));
        await humanDelay(page, 120, 300);
        await moreBtn.click();
        await humanDelay(page, 700, 1300);
        const connectInMenu = page.locator(joinSelectors('connectInMoreMenu')).first();
        if ((await connectInMenu.count()) > 0) {
            const menuText = await connectInMenu.innerText().catch(() => '');
            if (!textContainsConnectKeyword(menuText)) {
                console.warn(`[INVITE] Confidence check FAILED: menu item dice "${menuText.trim().substring(0, 40)}" — skip`);
                return false;
            }
            await humanMouseMove(page, joinSelectors('connectInMoreMenu'));
            await humanDelay(page, 120, 300);
            await connectInMenu.click();
            return true;
        }
    }

    return false;
}

async function detectInviteProof(page: Page): Promise<boolean> {
    const pendingCount = await page.locator(joinSelectors('invitePendingIndicators')).count();
    if (pendingCount > 0) {
        return true;
    }

    const pageText = await page.textContent('body').catch(() => '');
    if (!pageText) {
        return false;
    }
    return /invitation sent|in attesa|pending/i.test(pageText);
}

async function detectWeeklyInviteLimit(page: Page): Promise<boolean> {
    const selectorCount = await page.locator(joinSelectors('inviteWeeklyLimitSignals')).count();
    if (selectorCount > 0) {
        return true;
    }

    const pageText = await page.textContent('body').catch(() => '');
    if (!pageText) {
        return false;
    }
    return /weekly invitation limit|limite settimanale(?: degli)? inviti|hai raggiunto il limite settimanale/i.test(
        pageText,
    );
}

/**
 * Tenta di inviare l'invito con nota personalizzata (se INVITE_WITH_NOTE=true).
 * Flusso:
 *   1. Cerca il bottone "Add a note" nel modale
 *   2. Scrive la nota via humanType
 *   3. Clicca "Send" dal modale
 * Se il bottone "Add a note" non è presente, ricade su sendWithoutNote.
 * Ritorna se l'invio è avvenuto con nota e la source della nota (template/ai).
 */
async function handleInviteModal(
    page: Page,
    lead: LeadRecord,
    dryRun: boolean,
    localDate: string,
    campaignOverrideNote?: string | null,
    noteMode?: 'ai' | 'template' | 'none' | null,
): Promise<{ sentWithNote: boolean; noteSource: 'template' | 'ai' | null; variant?: string | null }> {
    if (dryRun) return { sentWithNote: false, noteSource: null, variant: null };

    // noteMode='none' forza invito senza nota, indipendentemente da config
    const wantsNote = noteMode === 'none' ? false : ((noteMode !== null && noteMode !== undefined) || config.inviteWithNote);

    // Controlla se c'è il bottone "Add a note" (con retry breve se il modale sta caricando)
    let canAddNote = (await page.locator(joinSelectors('addNoteButton')).first().count()) > 0;
    if (wantsNote && !canAddNote) {
        await page.waitForSelector(joinSelectors('addNoteButton'), { timeout: 2000 }).catch(() => null);
        canAddNote = (await page.locator(joinSelectors('addNoteButton')).first().count()) > 0;
    }

    if (wantsNote && canAddNote) {
        await humanMouseMove(page, joinSelectors('addNoteButton'));
        await humanDelay(page, 150, 350);
        await page.locator(joinSelectors('addNoteButton')).first().click();
        await humanDelay(page, 600, 1200);

        // Scrivi la nota nella textarea del modale
        let generatedNote = {
            note: '',
            source: 'template' as 'template' | 'ai' | null,
            variant: null as string | null,
        };
        try {
            if (campaignOverrideNote) {
                generatedNote = { note: campaignOverrideNote, source: 'template', variant: 'campaign_metadata' };
            } else {
                generatedNote = await buildPersonalizedInviteNote(lead);
                if (generatedNote.variant) {
                    await updateLeadPromptVariant(lead.id, generatedNote.variant);
                    lead.invite_prompt_variant = generatedNote.variant;
                }
            }
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            await logInfo('invite.ai_note_fallback', { leadId: lead.id, error: errMsg });
            await incrementDailyStat(localDate, 'run_errors');
        }

        // Se la nota è vuota (AI down, errore parsing, template vuoto), NON digitare
        // una stringa vuota — invia senza nota. Una nota vuota su LinkedIn è peggio
        // di nessuna nota: sembra un errore e riduce l'acceptance rate.
        if (!generatedNote.note || generatedNote.note.trim().length === 0) {
            // M09: Log PERCHÉ la nota è vuota — senza questo, "invio senza nota" è inspiegabile
            await logInfo('invite.empty_note_reason', {
                leadId: lead.id,
                source: generatedNote.source,
                reason: !generatedNote.note ? 'note_null' : 'note_empty_after_trim',
                variant: generatedNote.variant,
            });
            // Chiudi il modale nota e ricadi su invio senza nota
            await page.keyboard.press('Escape').catch(() => null);
            await humanDelay(page, 300, 600);
            const sendWithoutNote = page.locator(joinSelectors('sendWithoutNote')).first();
            if ((await sendWithoutNote.count()) > 0) {
                await humanMouseMove(page, joinSelectors('sendWithoutNote'));
                await humanDelay(page, 120, 300);
                await sendWithoutNote.click();
                return { sentWithNote: false, noteSource: null, variant: null };
            }
            // Se anche sendWithoutNote non c'è, prova sendFallback sotto
        }

        // M39: LinkedIn ha limite 300 char per nota invito. Tronca a 280 (buffer sicurezza)
        // per evitare che LinkedIn rifiuti silenziosamente la nota o tagli a metà parola.
        if (generatedNote.note.length > 280) {
            const truncated = generatedNote.note.substring(0, 277) + '...';
            await logInfo('invite.note_truncated', {
                leadId: lead.id,
                originalLength: generatedNote.note.length,
                truncatedLength: truncated.length,
            });
            generatedNote.note = truncated;
        }

        try {
            await humanType(page, joinSelectors('noteTextarea'), generatedNote.note);
        } catch {
            await incrementDailyStat(localDate, 'selector_failures');
            throw new RetryableWorkerError('Impossibile digitare la nota', 'TYPE_ERROR');
        }

        await humanDelay(page, 400, 800); // Changed from context.session.page to page

        const sendWithNote = page.locator(joinSelectors('sendWithNote')).first();
        if ((await sendWithNote.count()) > 0) {
            await humanMouseMove(page, joinSelectors('sendWithNote'));
            await humanDelay(page, 150, 400); // Changed from context.session.page to page

            await sendWithNote.click();

            return { sentWithNote: true, noteSource: generatedNote.source, variant: generatedNote.variant };
        }

        // Se il bottone Send del modale non è trovato, è un errore bloccante
        await incrementDailyStat(localDate, 'selector_failures');
        throw new RetryableWorkerError('Send con nota non trovato nel modale', 'SEND_WITH_NOTE_NOT_FOUND');
    }

    // Fallback: invia senza nota
    const sendWithoutNote = page.locator(joinSelectors('sendWithoutNote')).first();
    if ((await sendWithoutNote.count()) > 0) {
        await humanMouseMove(page, joinSelectors('sendWithoutNote'));
        await humanDelay(page, 120, 300);
        await sendWithoutNote.click();
        return { sentWithNote: false, noteSource: null, variant: null };
    }

    const fallback = page.locator(joinSelectors('sendFallback')).first();
    if ((await fallback.count()) > 0) {
        await humanMouseMove(page, joinSelectors('sendFallback'));
        await humanDelay(page, 120, 300);
        await fallback.click();
        return { sentWithNote: false, noteSource: null, variant: null };
    }

    await incrementDailyStat(localDate, 'selector_failures');
    throw new RetryableWorkerError('Conferma invito senza nota non trovata', 'SEND_BUTTON_NOT_FOUND');
}

export async function processInviteJob(
    payload: InviteJobPayload,
    context: WorkerContext,
): Promise<WorkerExecutionResult> {
    const lead = await getLeadById(payload.leadId);
    if (!lead) {
        throw new RetryableWorkerError(`Lead ${payload.leadId} non trovato`, 'LEAD_NOT_FOUND');
    }

    // Check blacklist runtime: il lead potrebbe essere stato aggiunto alla blacklist
    // DOPO la creazione del job nello scheduler (ore/giorni prima).
    if (await isBlacklisted(lead.linkedin_url, lead.company_domain)) {
        return workerResult(0);
    }

    if (lead.status === 'NEW') {
        await transitionLead(lead.id, 'READY_INVITE', 'new_lead_promoted');
        lead.status = 'READY_INVITE';
    }

    const isCampaignDriven = !!payload.campaignStateId;
    if (!isCampaignDriven && lead.status !== 'READY_INVITE') {
        return workerResult(0);
    }

    // Estrai nota campagna e noteMode dal metadata JSON
    let campaignOverrideNote: string | null = null;
    let noteMode: 'ai' | 'template' | 'none' | null = null;
    if (payload.metadata_json) {
        try {
            const meta = JSON.parse(payload.metadata_json);
            if (isCampaignDriven && meta.note) {
                lead.invite_prompt_variant = 'campaign_metadata';
                campaignOverrideNote = meta.note;
            }
            if (meta.noteMode === 'ai' || meta.noteMode === 'template' || meta.noteMode === 'none') {
                noteMode = meta.noteMode;
            }
        } catch {
            // ignore JSON parse error in metadata
        }
    }

    // C10: SalesNav URL → REVIEW_REQUIRED (era BLOCKED = dead-end irrecuperabile).
    // I lead SalesNav HANNO un profilo classico — l'URL /sales/lead/ può essere convertita in /in/.
    // REVIEW_REQUIRED ha transizioni permesse → l'utente o il comando 'salesnav resolve' può fixare.
    if (isSalesNavigatorUrl(lead.linkedin_url)) {
        await transitionLead(lead.id, 'REVIEW_REQUIRED', 'salesnav_url_needs_resolution');
        return workerResult(1);
    }

    // H08: Enrichment RIMOSSO dalla sessione browser.
    // Il pre-enrichment avviene OFFLINE nei workflow (sendInvitesWorkflow, enrich-fast, parallelEnricher).
    // Fare API calls esterne (OSINT 7-fase, 30-60s/lead) con il browser aperto su LinkedIn
    // crea un pattern sospetto: browser idle per 30-60s senza interazione → rilevabile.
    // Se il lead non è ancora arricchito, procedi comunque — l'enrichment verrà fatto offline.

    // Skip profili già visitati oggi: evita duplicate profile view sullo stesso target
    const normalizedUrl = lead.linkedin_url.replace(/\/+$/, '').toLowerCase();
    if (context.visitedProfilesToday?.has(normalizedUrl)) {
        return workerResult(0);
    }
    context.visitedProfilesToday?.add(normalizedUrl);

    // Navigation Context Chain (1.2): catena di navigazione realistica
    // invece di goto diretto al profilo (segnale detection #1).
    // C05: passa sessionActionCount per attivare il decay della navigazione organica
    // (primi inviti: 45% search, dopo: sempre più diretto — simula umano che si stufa di cercare)
    await navigateToProfileWithContext(
        context.session.page,
        lead.linkedin_url,
        { name: `${lead.first_name} ${lead.last_name}`.trim(), job_title: lead.job_title, company: lead.account_name },
        context.accountId,
        context.sessionActionCount ?? 0,
    );
    // Content-Aware Profile Reading (3.4 fix): funzione UNIFICATA scroll + dwell
    // in budget totale proporzionale alla ricchezza del profilo (4-20s).
    // Sostituisce simulateHumanReading + contextualReadingPause per i profili.
    await computeProfileDwellTime(context.session.page);

    // R01+R02: OBSERVE page context + AI DECIDE prima dell'azione critica.
    // Il bot "guarda" la pagina (R01) e l'AI "decide" se procedere (R02).
    // Se AI non configurata → fallback meccanico PROCEED (zero regressione).
    const pageObs = await observePageContext(context.session.page);
    await logObservation(pageObs, { leadId: lead.id, purpose: 'pre_invite' });

    // Gate bloccante: profilo eliminato/404 → skip senza sprecare azioni
    if (pageObs.isProfileDeleted) {
        await logWarn('invite.profile_deleted_observed', { leadId: lead.id, url: pageObs.currentUrl });
        await transitionLead(lead.id, 'REVIEW_REQUIRED', 'profile_deleted_observed');
        return workerResult(1);
    }

    // AI Decision: l'AI decide SE invitare basandosi su contesto pagina + dati lead
    const aiDecision = await aiDecide({
        point: 'pre_invite',
        lead: {
            id: lead.id,
            name: `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || undefined,
            title: lead.job_title ?? undefined,
            company: lead.account_name ?? undefined,
            score: lead.lead_score ?? undefined,
            about: lead.about ?? undefined,
        },
        pageObservation: pageObs,
        session: context.sessionActionCount !== undefined ? {
            invitesSent: context.sessionActionCount,
            messagesSent: 0,
            riskScore: 0,
            pendingRatio: 0,
            duration: 0,
            challengeCount: 0,
        } : undefined,
    });

    if (aiDecision.action === 'SKIP') {
        await logInfo('invite.ai_skip', {
            leadId: lead.id,
            reason: aiDecision.reason.substring(0, 80),
            confidence: aiDecision.confidence,
        });
        return workerResult(0);
    }
    if (aiDecision.action === 'NOTIFY_HUMAN') {
        await logInfo('invite.ai_notify_human', { leadId: lead.id, reason: aiDecision.reason.substring(0, 80) });
        await transitionLead(lead.id, 'REVIEW_REQUIRED', 'ai_notify_human');
        return workerResult(1);
    }
    if (aiDecision.action === 'DEFER') {
        await logInfo('invite.ai_defer', { leadId: lead.id, reason: aiDecision.reason.substring(0, 80) });
        return workerResult(0);
    }
    // PROCEED: se l'AI suggerisce un delay aggiuntivo, applicalo
    if (aiDecision.suggestedDelaySec && aiDecision.suggestedDelaySec > 0) {
        await humanDelay(context.session.page, aiDecision.suggestedDelaySec * 1000, (aiDecision.suggestedDelaySec + 2) * 1000);
    }

    // C04: Identity check — verifica che il profilo aperto corrisponda al lead target.
    // Se l'h1 non corrisponde al nome del lead → REVIEW_REQUIRED (potremmo invitare la persona sbagliata).
    try {
        const h1Element = context.session.page.locator('h1').first();
        const h1Text = await h1Element.textContent({ timeout: 3000 }).catch(() => null);
        if (h1Text) {
            const expectedName = normalizeNameForComparison(`${lead.first_name} ${lead.last_name}`);
            const actualName = normalizeNameForComparison(h1Text);
            if (expectedName && actualName) {
                const similarity = jaroWinklerSimilarity(expectedName, actualName);
                if (similarity < 0.75) {
                    await logWarn('invite.identity_mismatch', {
                        leadId: lead.id,
                        expectedName,
                        actualName,
                        similarity: Number.parseFloat(similarity.toFixed(3)),
                        linkedinUrl: lead.linkedin_url.substring(0, 60),
                    });
                    await transitionLead(lead.id, 'REVIEW_REQUIRED', 'identity_mismatch');
                    return workerResult(1);
                }
            }
        }
        // M07: Reconciliazione dati SalesNav vs profilo reale.
        // Se il job_title o company sulla pagina sono diversi dal DB, aggiorna.
        // Questo mantiene i dati freschi senza enrichment aggiuntivo.
        try {
            const headlineEl = context.session.page.locator('.text-body-medium').first();
            const headlineText = await headlineEl.textContent({ timeout: 2000 }).catch(() => null);
            if (headlineText) {
                const trimmedHeadline = headlineText.trim();
                const dbTitle = (lead.job_title ?? '').trim();
                if (trimmedHeadline && trimmedHeadline !== dbTitle && trimmedHeadline.length > 3) {
                    const { getDatabase } = await import('../db');
                    const db = await getDatabase();
                    await db.run(
                        'UPDATE leads SET job_title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (job_title IS NULL OR job_title != ?)',
                        [trimmedHeadline.substring(0, 255), lead.id, trimmedHeadline.substring(0, 255)],
                    );
                    await logInfo('invite.profile_reconciliation', {
                        leadId: lead.id,
                        field: 'job_title',
                        oldValue: dbTitle.substring(0, 40),
                        newValue: trimmedHeadline.substring(0, 40),
                    });
                }
            }
        } catch {
            // Best-effort reconciliation — non blocca il flusso
        }
    } catch {
        // Identity check non bloccante: se fallisce (es. h1 non trovato), prosegui
    }

    // M10: Probabilità VARIABILE per sessione (10-30%) di visitare la pagina attività recente.
    // Un umano curioso guarda i post del target prima di decidere se connettersi.
    // Decay: più lead visitati nella sessione → meno curiosità (un umano si stanca).
    const activityBaseProb = 0.10 + Math.random() * 0.20; // 10-30% per lead
    const activityDecay = Math.max(0.05, activityBaseProb - (context.sessionActionCount ?? 0) * 0.02);
    if (Math.random() < activityDecay) {
        const activityUrl = lead.linkedin_url.replace(/\/$/, '') + '/recent-activity/all/';
        await context.session.page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
        await simulateHumanReading(context.session.page);
        // Torna al profilo con goBack (più naturale di goto diretto — il browser ha history)
        await context.session.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(async () => {
            // Fallback: se goBack fallisce (es. pagina non in history), usa goto
            await context.session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
        });
        await humanDelay(context.session.page, 500, 1500);
    }

    if (await detectChallenge(context.session.page)) {
        const resolved = await attemptChallengeResolution(context.session.page).catch(() => false);
        if (!resolved) {
            throw new ChallengeDetectedError();
        }
    }

    if (config.profileContextExtractionEnabled) {
        try {
            let extractedAbout: string | null = null;
            let extractedExperience: string | null = null;

            const aboutLocator = context.session.page.locator(joinSelectors('aboutSection')).first();
            if (await aboutLocator.isVisible()) {
                extractedAbout = (await aboutLocator.innerText()).trim();
            }

            const expLocator = context.session.page.locator(joinSelectors('experienceSection')).first();
            if (await expLocator.isVisible()) {
                extractedExperience = (await expLocator.innerText()).trim();
            }

            if (extractedAbout || extractedExperience) {
                await updateLeadScrapedContext(lead.id, extractedAbout || null, extractedExperience || null);
                lead.about = extractedAbout || null;
                lead.experience = extractedExperience || null;

                bridgeLeadStatus(lead.linkedin_url, lead.status, {
                    about: extractedAbout || null,
                    experience: extractedExperience || null,
                });
            }
        } catch (e) {
            // Estrazione opzionale: non bloccare l'invio dell'invito.
            console.warn(`[WARN] Impossibile estrarre contesto AI per lead ${lead.id}:`, e);
        }
    }

    // Atomic daily cap check: incrementa invites_sent solo se sotto il limite.
    // Fatto PRIMA del click per non sprecare azioni su LinkedIn se il cap è raggiunto.
    if (!context.dryRun) {
        const withinCap = await checkAndIncrementDailyLimit(context.localDate, 'invites_sent', config.hardInviteCap);
        if (!withinCap) {
            await logInfo('invite.daily_cap_reached', { leadId: lead.id, cap: config.hardInviteCap });
            return workerResult(0);
        }
    }

    // Compensazione phantom increment: se l'invito fallisce dopo checkAndIncrementDailyLimit,
    // decrementiamo invites_sent per evitare di gonfiare il budget (stessa logica di messageWorker).
    let inviteResult: { sentWithNote: boolean; noteSource: 'template' | 'ai' | null; variant?: string | null };
    try {

    // Pre-click: check weekly invite limit before sending (prevents wasted invites)
    if (!context.dryRun) {
        const preClickLimitReached = await detectWeeklyInviteLimit(context.session.page);
        if (preClickLimitReached) {
            await pauseAutomation(
                'WEEKLY_INVITE_LIMIT_REACHED',
                {
                    leadId: lead.id,
                    linkedinUrl: lead.linkedin_url,
                    accountId: context.accountId,
                    phase: 'pre_click',
                },
                7 * 24 * 60,
            );
            throw new RetryableWorkerError('Limite settimanale inviti raggiunto (pre-click)', 'WEEKLY_LIMIT_REACHED');
        }
    }

    // CC-18: Session validity check prima di azioni critiche.
    // Se il cookie è scaduto mid-session, la pagina redirige al login.
    // Detectare subito evita retry inutili su una pagina di login.
    if (!context.dryRun) {
        const stillLoggedIn = await isLoggedIn(context.session.page);
        if (!stillLoggedIn) {
            throw new RetryableWorkerError(
                'Sessione LinkedIn scaduta durante il flusso invite — aborto per evitare retry su login page',
                'SESSION_EXPIRED',
            );
        }
    }

    // Chiudi overlay LinkedIn prima di cercare il bottone Connect
    await dismissKnownOverlays(context.session.page);

    // Viewport Dwell Time (3.3): assicura che il bottone Connect sia nel viewport
    // da almeno 800-2000ms prima del click — previene segnale click-before-visible.
    await ensureViewportDwell(context.session.page, joinSelectors('connectButtonPrimary'));

    const connectClicked = await clickConnectOnProfile(context.session.page);
    if (!connectClicked) {
        await incrementDailyStat(context.localDate, 'selector_failures');
        await transitionLead(lead.id, 'SKIPPED', 'connect_not_found');
        // Compensazione: invito NON inviato ma invites_sent già incrementato
        if (!context.dryRun) await incrementDailyStat(context.localDate, 'invites_sent', -1).catch(() => {});
        return workerResult(1);
    }

    await humanDelay(context.session.page, 900, 1800);

    // H09: Verifica post-azione BLOCCANTE: dopo click Connect, il modale invito DEVE apparire.
    // Se non appare, il click ha colpito un bottone sbagliato o LinkedIn ha cambiato il layout.
    // Procedere senza modale → handleInviteModal cerca bottoni inesistenti → retry inutile.
    // Il click Connect è già registrato da LinkedIn — non possiamo riprovare.
    const modalAppeared = await context.session.page.locator(
        joinSelectors('addNoteButton') + ', ' + joinSelectors('sendWithoutNote') + ', ' + joinSelectors('sendFallback'),
    ).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (!modalAppeared) {
        await logWarn('invite.post_action_verify_failed', { leadId: lead.id, message: 'Modale invito non apparso dopo click Connect — abort' });
        // Escape per chiudere eventuali overlay residui
        await context.session.page.keyboard.press('Escape').catch(() => {});
        await humanDelay(context.session.page, 500, 1000);
        // Compensazione: decrementa invites_sent (il click Connect non ha prodotto un invito reale)
        if (!context.dryRun) await incrementDailyStat(context.localDate, 'invites_sent', -1).catch(() => {});
        await incrementDailyStat(context.localDate, 'selector_failures');
        throw new RetryableWorkerError('Modale invito non apparso dopo click Connect', 'INVITE_MODAL_NOT_FOUND');
    }

    inviteResult = await handleInviteModal(
        context.session.page,
        lead,
        context.dryRun,
        context.localDate,
        campaignOverrideNote,
        noteMode,
    );

    // Post-click: verify no weekly limit error was triggered by our action
    if (!context.dryRun) {
        const weeklyLimitReached = await detectWeeklyInviteLimit(context.session.page);
        if (weeklyLimitReached) {
            await pauseAutomation(
                'WEEKLY_INVITE_LIMIT_REACHED',
                {
                    leadId: lead.id,
                    linkedinUrl: lead.linkedin_url,
                    accountId: context.accountId,
                    phase: 'post_click',
                },
                7 * 24 * 60,
            );
            throw new RetryableWorkerError('Limite settimanale inviti raggiunto', 'WEEKLY_LIMIT_REACHED');
        }
    }

    // Post-Action Verification (2.2): delay realistico 2-5s prima di verificare
    // che l'invito sia stato effettivamente inviato. Un umano aspetta di vedere
    // il feedback visivo prima di procedere.
    await humanDelay(context.session.page, 2000, 5000);
    const proofOfSend = context.dryRun
        ? true
        : await Promise.race([
            detectInviteProof(context.session.page),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), 5000)),
        ]);
    if (!proofOfSend) {
        // NEW-9: Prima di ritentare, verifica se il lead è già INVITED nel DB.
        // Se sì, l'invito è stato inviato ma il proof-of-send ha fatto timeout (rete lenta).
        // Ritentare causerebbe un invito duplicato.
        const freshLead = await getLeadById(lead.id);
        if (freshLead?.status === 'INVITED') {
            await logInfo('invite.proof_timeout_already_invited', { leadId: lead.id });
            return workerResult(1);
        }
        await logInfo('invite.not_confirmed', {
            leadId: lead.id,
            linkedinUrl: lead.linkedin_url.substring(0, 60),
            message: 'Bottone non diventato Pending/Sent dopo invio',
        });
        throw new RetryableWorkerError('Invito non confermato: proof-of-send non rilevato', 'INVITE_NOT_CONFIRMED');
    }

    } catch (inviteError) {
        // Compensazione: decrementa invites_sent perché l'invito NON è stato inviato
        if (!context.dryRun) await incrementDailyStat(context.localDate, 'invites_sent', -1).catch(() => {});
        throw inviteError;
    }

    const effectiveVariant = inviteResult.variant || (inviteResult.sentWithNote ? null : 'NO_NOTE');
    if (!inviteResult.variant && effectiveVariant) {
        await updateLeadPromptVariant(lead.id, effectiveVariant);
    }
    await transitionLead(lead.id, 'INVITED', context.dryRun ? 'invite_dry_run' : 'invite_sent', {
        dryRun: context.dryRun,
        withNote: inviteResult.sentWithNote,
        withNoteSource: inviteResult.noteSource,
        variant: effectiveVariant,
        timing: payload.timing ?? null,
    });

    if (!context.dryRun) {
        await recordLeadTimingAttribution(lead.id, 'invite', {
            strategy: payload.timing?.strategy === 'optimizer' ? 'optimizer' : 'baseline',
            segment: payload.timing?.segment ?? inferLeadSegment(lead.job_title),
            score: payload.timing?.score ?? 0,
            slotHour: payload.timing?.slotHour ?? null,
            slotDow: payload.timing?.slotDow ?? null,
            delaySec: payload.timing?.delaySec ?? 0,
            model: payload.timing?.model ?? 'timing_optimizer_v2',
        });
    }

    if (!context.dryRun) {
        const abVariant = inviteResult.variant || (inviteResult.sentWithNote ? 'UNKNOWN_NOTE' : 'NO_NOTE');
        const segmentKey = inferLeadSegment(lead.job_title);
        const hourBucket = inferHourBucket(new Date().getHours());
        await recordSent(abVariant, { segmentKey, hourBucket }).catch(() => { });
    }
    // invites_sent already incremented atomically by checkAndIncrementDailyLimit (pre-send)
    await incrementListDailyStat(context.localDate, lead.list_name, 'invites_sent');
    // Cloud sync non-bloccante
    bridgeLeadStatus(lead.linkedin_url, 'INVITED', {
        invited_at: new Date().toISOString(),
        invite_prompt_variant: inviteResult.variant || null,
        invite_note_sent: inviteResult.sentWithNote ? 'yes' : 'no',
    });
    bridgeDailyStat(context.localDate, context.accountId, 'invites_sent');
    return workerResult(1);
}
