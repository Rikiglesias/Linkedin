import { Page } from 'playwright';
import {
    contextualReadingPause,
    detectChallenge,
    dismissKnownOverlays,
    humanDelay,
    humanMouseMove,
    humanType,
    simulateHumanReading,
} from '../browser';
import {
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
import { buildPersonalizedInviteNote } from '../ai/inviteNotePersonalizer';
import { pauseAutomation } from '../risk/incidentManager';
import { bridgeDailyStat, bridgeLeadStatus } from '../cloud/cloudBridge';
import { recordSent } from '../ml/abBandit';
import { WorkerExecutionResult, workerResult } from './result';
import { inferLeadSegment } from '../ml/segments';
import { enrichLeadAuto } from '../integrations/leadEnricher';
import { getDatabase } from '../db';
import { logError, logInfo } from '../telemetry/logger';

async function clickConnectOnProfile(page: Page): Promise<boolean> {
    const primaryBtn = page.locator(joinSelectors('connectButtonPrimary')).first();
    if ((await primaryBtn.count()) > 0) {
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
            console.error('[INVITE] Errore generazione nota AI, invio senza nota', e);
        }

        // Se la nota è vuota (AI down, errore parsing, template vuoto), NON digitare
        // una stringa vuota — invia senza nota. Una nota vuota su LinkedIn è peggio
        // di nessuna nota: sembra un errore e riduce l'acceptance rate.
        if (!generatedNote.note || generatedNote.note.trim().length === 0) {
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

    if (isSalesNavigatorUrl(lead.linkedin_url)) {
        await transitionLead(lead.id, 'BLOCKED', 'salesnav_url_requires_profile_invite');
        return workerResult(1);
    }

    // ── Enrichment al volo: arricchisci il lead prima di navigare al profilo ──
    // Guard: salta se il lead è già stato arricchito (evita doppio enrichment e spreco API)
    try {
        const db = await getDatabase();
        const alreadyEnriched = await db.get<{ lead_id: number }>(
            `SELECT lead_id FROM lead_enrichment_data WHERE lead_id = ?`,
            [payload.leadId],
        );

        if (!alreadyEnriched) {
            await logInfo('invite.worker.enrichment_start', { leadId: payload.leadId });
            const enrichResult = await enrichLeadAuto(lead);

            // Aggiorna i campi core sulla tabella leads
            await db.run(
                `UPDATE leads SET
                    email = COALESCE(email, ?),
                    phone = COALESCE(phone, ?),
                    company_domain = COALESCE(company_domain, ?),
                    business_email = COALESCE(business_email, ?),
                    business_email_confidence = CASE
                        WHEN business_email IS NOT NULL THEN business_email_confidence
                        WHEN ? IS NOT NULL THEN ?
                        ELSE business_email_confidence
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
                [
                    enrichResult.email, enrichResult.phone, enrichResult.companyDomain,
                    enrichResult.businessEmail,
                    enrichResult.businessEmail, enrichResult.businessEmailConfidence,
                    payload.leadId,
                ],
            );

            // Persisti il risultato completo in lead_enrichment_data
            await db.run(
                `INSERT OR REPLACE INTO lead_enrichment_data
                 (lead_id, company_json, phones_json, socials_json, seniority, department, data_points, confidence, sources_json, domain_source, enriched_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [
                    payload.leadId,
                    enrichResult.companyName || enrichResult.companyDomain || enrichResult.industry
                        ? JSON.stringify({ name: enrichResult.companyName, domain: enrichResult.companyDomain, industry: enrichResult.industry })
                        : null,
                    enrichResult.phone ? JSON.stringify([{ number: enrichResult.phone, type: 'work', source: enrichResult.source }]) : null,
                    enrichResult.deepEnrichment?.socialProfiles?.length
                        ? JSON.stringify(enrichResult.deepEnrichment.socialProfiles)
                        : null,
                    enrichResult.seniority,
                    enrichResult.deepEnrichment?.department ?? null,
                    [enrichResult.email, enrichResult.phone, enrichResult.jobTitle, enrichResult.companyName, enrichResult.location, enrichResult.seniority]
                        .filter(Boolean).length,
                    enrichResult.emailConfidence,
                    JSON.stringify([enrichResult.source]),
                    enrichResult.domainSource ?? null,
                ],
            );
            await logInfo('invite.worker.enrichment_done', { leadId: payload.leadId, emailFound: !!enrichResult.email });
        } else {
            await logInfo('invite.worker.enrichment_skipped', { leadId: payload.leadId, reason: 'already_enriched' });
        }
    } catch (enrichErr) {
        // L'enrichment non deve MAI bloccare l'invio dell'invito
        await logError('invite.worker.enrichment_failed', { leadId: payload.leadId, error: String(enrichErr) });
    }

    // Skip profili già visitati oggi: evita duplicate profile view sullo stesso target
    const normalizedUrl = lead.linkedin_url.replace(/\/+$/, '').toLowerCase();
    if (context.visitedProfilesToday?.has(normalizedUrl)) {
        return workerResult(0);
    }
    context.visitedProfilesToday?.add(normalizedUrl);

    await context.session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
    await simulateHumanReading(context.session.page);
    await contextualReadingPause(context.session.page);

    // Anti-pattern: 20% di probabilità di visitare la pagina attività recente del target
    // prima di tornare al profilo e cliccare Connect. Un umano curioso guarda i post
    // del target prima di decidere se connettersi — rende la visita più organica.
    if (Math.random() < 0.20) {
        const activityUrl = lead.linkedin_url.replace(/\/$/, '') + '/recent-activity/all/';
        await context.session.page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
        await simulateHumanReading(context.session.page);
        // Torna al profilo per procedere con il Connect
        await context.session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
        await humanDelay(context.session.page, 500, 1500);
    }

    if (await detectChallenge(context.session.page)) {
        const resolved = await attemptChallengeResolution(context.session.page);
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

    // Chiudi overlay LinkedIn prima di cercare il bottone Connect
    await dismissKnownOverlays(context.session.page);

    const connectClicked = await clickConnectOnProfile(context.session.page);
    if (!connectClicked) {
        await incrementDailyStat(context.localDate, 'selector_failures');
        await transitionLead(lead.id, 'SKIPPED', 'connect_not_found');
        return workerResult(1);
    }

    await humanDelay(context.session.page, 900, 1800);

    const inviteResult = await handleInviteModal(
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

    await humanDelay(context.session.page, 1200, 2200);
    const proofOfSend = context.dryRun
        ? true
        : await Promise.race([
            detectInviteProof(context.session.page),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), 5000)),
        ]);
    if (!proofOfSend) {
        throw new RetryableWorkerError('Proof-of-send non rilevato', 'NO_PROOF_OF_SEND');
    }

    await transitionLead(lead.id, 'INVITED', context.dryRun ? 'invite_dry_run' : 'invite_sent', {
        dryRun: context.dryRun,
        withNote: inviteResult.sentWithNote,
        withNoteSource: inviteResult.noteSource,
        variant: inviteResult.variant || null,
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

    if (!context.dryRun && inviteResult.variant) {
        const segmentKey = inferLeadSegment(lead.job_title);
        await recordSent(inviteResult.variant, { segmentKey }).catch(() => { });
    }
    await incrementDailyStat(context.localDate, 'invites_sent');
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
