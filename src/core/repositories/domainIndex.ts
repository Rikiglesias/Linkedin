/**
 * A01/A19: Domain-organized index for the repositories barrel.
 *
 * Il barrel repositories.ts ha 233 export — impossibile navigare.
 * Questo file organizza le export per DOMINIO funzionale:
 *
 * - LEADS: CRUD lead, query per stato/lista, scoring, enrichment
 * - STATS: daily stats, weekly stats, aggregazioni, KPI
 * - SYSTEM: runtime flags, outbox, pause, health, sync status
 * - JOBS: job queue, lock, dead letter, retry
 * - CAMPAIGNS: campagne drip, step, enrollment, execution
 * - AI_QUALITY: validation pipeline, samples, quality metrics
 * - FEATURE_STORE: ML feature extraction, dataset versioning
 * - SALESNAV: sync runs, list members, dedup
 * - BLACKLIST: blacklist management
 *
 * I consumer importano dal barrel repositories.ts (invariato) oppure
 * da qui per chiarezza: import { ... } from './repositories/domainIndex'
 */

// ── LEADS (28 query + 19 mutation) ───────────────────────────────────────────
// import { getLeadById } from './repositories/leadReadOps'
// import { addLead } from './repositories/leadWriteOps'

// ── Domain namespace re-exports per navigabilità ─────────────────────────────
export * as statsOps from './stats';
export * as systemOps from './system';
export * as jobsOps from './jobs';
export * as campaignOps from './campaigns';
export * as salesnavOps from './salesnavSync';
export * as blacklistOps from './blacklist';
export * as auditLogOps from './auditLog';
