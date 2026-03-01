/**
 * repositories/jobs.ts
 * Domain exports: queueing, retries, dead letter, stuck job recovery.
 */

export {
    enqueueJob,
    lockNextQueuedJob,
    markJobSucceeded,
    markJobRetryOrDeadLetter,
    createJobAttempt,
    getJobStatusCounts,
    parseJobPayload,
    recoverStuckJobs,
    getFailedJobs,
    markJobAsDeadLetter,
    recycleJob,
} from './legacy';

export type { JobWithPayload } from './legacy';
