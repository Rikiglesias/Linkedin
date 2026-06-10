-- Rollback cloud_001_daily_stat_idempotent.
-- NON droppa increment_daily_stat_cloud: è il path PRIMARIO del client (pre-esistente alla
-- migration, indipendente dal recupero outbox).
-- ⚠️ CAVEAT: droppare cp_applied_events perde il registro dei claim → eventuali eventi outbox
-- ancora PENDING già applicati verrebbero ri-contati a un drain successivo. Eseguire il rollback
-- solo con outbox SUPABASE drenata (pendingOutbox = 0) o accettando il rischio dichiarato.

drop function if exists public.increment_daily_stat_cloud_idem(text, date, text, text, integer);
drop table if exists public.cp_applied_events;
