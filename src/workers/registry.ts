/**
 * workers/registry.ts
 * ─────────────────────────────────────────────────────────────────
 * Registry centralizzato dei worker processor.
 * Sostituisce lo switch/case nel jobRunner con una lookup Map.
 * Ogni worker implementa l'interfaccia WorkerProcessor.
 */

import { JobType, InviteJobPayload } from '../types/domain';
import { WorkerContext } from './context';
import { WorkerExecutionResult, workerResult } from './result';
import { processInviteJob } from './inviteWorker';
import { processAcceptanceJob } from './acceptanceWorker';
import { processMessageJob } from './messageWorker';
import { processHygieneJob } from './hygieneWorker';
import { processInteractionJob, type InteractionJobPayload } from './interactionWorker';
import { processEnrichmentJob } from './enrichmentWorker';
import { createAndPublishPost, type PostCreatorOptions } from './postCreatorWorker';

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
        const payload = parsePayload<{ leadId: number }>(job);
        return processAcceptanceJob(payload, context);
    },
};

const messageProcessor: WorkerProcessor = {
    async process(job, context) {
        const payload = parsePayload<{ leadId: number; acceptedAtDate: string; campaignStateId?: number }>(job);
        return processMessageJob(payload, context);
    },
};

const hygieneProcessor: WorkerProcessor = {
    async process(job, context) {
        const payload = parsePayload<{ accountId: string }>(job);
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
        const payload = parsePayload<{ leadId: number; campaignStateId?: number }>(job);
        return processEnrichmentJob(payload, context);
    },
};

const postCreationProcessor: WorkerProcessor = {
    async process(job, context) {
        const payload = parsePayload<{ accountId: string; topic?: string; tone?: string }>(job);
        const postResult = await createAndPublishPost(context.session.page, {
            accountId: payload.accountId,
            topic: payload.topic,
            tone: payload.tone as PostCreatorOptions['tone'],
            dryRun: context.dryRun,
        });
        return workerResult(
            postResult.published ? 1 : 0,
            postResult.error ? [{ message: postResult.error }] : [],
        );
    },
};

export const workerRegistry: ReadonlyMap<JobType, WorkerProcessor> = new Map<JobType, WorkerProcessor>([
    ['INVITE', inviteProcessor],
    ['ACCEPTANCE_CHECK', acceptanceProcessor],
    ['MESSAGE', messageProcessor],
    ['HYGIENE', hygieneProcessor],
    ['INTERACTION', interactionProcessor],
    ['ENRICHMENT', enrichmentProcessor],
    ['POST_CREATION', postCreationProcessor],
]);
