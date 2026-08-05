/**
 * workers/registry.ts
 * ─────────────────────────────────────────────────────────────────
 * Registry centralizzato dei worker processor.
 * Sostituisce lo switch/case nel jobRunner con una lookup Map.
 * Ogni worker implementa l'interfaccia WorkerProcessor.
 */

// Ogni processor qui sotto tipizza il suo payload con il tipo NOMINATO, mai con un literal inline:
// un literal scritto a mano diverge dal tipo canonico senza che niente lo segnali, ed e' il motivo
// per cui i tipi canonici risultavano "export morti" pur avendo i loro consumatori.
// NB: niente conteggi in questo commento — un numero scritto qui invecchia da solo.
import {
    JobType,
    InviteJobPayload,
    AcceptanceJobPayload,
    MessageJobPayload,
    InteractionJobPayload,
    EnrichmentJobPayload,
    PostCreationJobPayload,
} from '../types/domain';
import { WorkerContext } from './context';
import { WorkerExecutionResult, workerResult } from './result';
import { processInviteJob } from './inviteWorker';
import { processAcceptanceJob } from './acceptanceWorker';
import { processMessageJob } from './messageWorker';
import { processHygieneJob, type HygieneJobPayload } from './hygieneWorker';
import { processInteractionJob } from './interactionWorker';
import { processEnrichmentJob } from './enrichmentWorker';
import { createAndPublishPost, type PostCreatorOptions } from './postCreatorWorker';
import { processInboxJob, type InboxJobPayload } from './inboxWorker';

export interface WorkerProcessor {
    process(job: { payload_json: string }, context: WorkerContext): Promise<WorkerExecutionResult>;
}

function parsePayload<T>(job: { payload_json: string }): T {
    return JSON.parse(job.payload_json) as T;
}

const inviteProcessor: WorkerProcessor = {
    async process(job, context) {
        const payload = parsePayload<InviteJobPayload>(job);
        return processInviteJob(payload, context);
    },
};

const acceptanceProcessor: WorkerProcessor = {
    async process(job, context) {
        const payload = parsePayload<AcceptanceJobPayload>(job);
        return processAcceptanceJob(payload, context);
    },
};

const messageProcessor: WorkerProcessor = {
    async process(job, context) {
        // Il literal inline che stava qui OMETTEVA timing? e metadata_json?, che messageWorker legge
        // davvero (`:559-569` decide strategy optimizer|baseline, delaySec, slotHour; `:96-98` il
        // metadata): il tipo mentiva proprio nel punto che governa il timing anti-ban.
        const payload = parsePayload<MessageJobPayload>(job);
        return processMessageJob(payload, context);
    },
};

const hygieneProcessor: WorkerProcessor = {
    async process(job, context) {
        const payload = parsePayload<HygieneJobPayload>(job);
        return processHygieneJob(payload, context);
    },
};

const interactionProcessor: WorkerProcessor = {
    async process(job, context) {
        const payload = parsePayload<InteractionJobPayload>(job);
        return processInteractionJob(payload, context);
    },
};

const enrichmentProcessor: WorkerProcessor = {
    async process(job, context) {
        const payload = parsePayload<EnrichmentJobPayload>(job);
        return processEnrichmentJob(payload, context);
    },
};

const postCreationProcessor: WorkerProcessor = {
    async process(job, context) {
        const payload = parsePayload<PostCreationJobPayload>(job);
        const postResult = await createAndPublishPost(context.session.page, {
            accountId: payload.accountId,
            topic: payload.topic,
            tone: payload.tone as PostCreatorOptions['tone'],
            dryRun: context.dryRun,
        });
        return workerResult(postResult.published ? 1 : 0, postResult.error ? [{ message: postResult.error }] : []);
    },
};

const inboxCheckProcessor: WorkerProcessor = {
    async process(job, context) {
        const payload = parsePayload<InboxJobPayload>(job);
        return processInboxJob(payload, context);
    },
};

// M47: Architettura registry — worker che processano job dalla coda DB.
// Meta-worker (deadLetterWorker, followUpWorker) non sono qui perché non processano job singoli:
// - deadLetterWorker: ricicla/archivia job falliti in batch (chiamato da loopCommand)
// - followUpWorker: query + invio follow-up in batch (chiamato dal jobRunner post-session)
// - inboxWorker: registrato qui (INBOX_CHECK) per supporto coda, ma anche chiamato direttamente
export const workerRegistry: ReadonlyMap<JobType, WorkerProcessor> = new Map<JobType, WorkerProcessor>([
    ['INVITE', inviteProcessor],
    ['ACCEPTANCE_CHECK', acceptanceProcessor],
    ['MESSAGE', messageProcessor],
    ['HYGIENE', hygieneProcessor],
    ['INTERACTION', interactionProcessor],
    ['ENRICHMENT', enrichmentProcessor],
    ['POST_CREATION', postCreationProcessor],
    ['INBOX_CHECK', inboxCheckProcessor],
]);
