-- cloud_002_rls_enable_pii — goal gdpr-erasure-cloud T5 (2026-06-12)
-- RLS su TUTTE le tabelle del bot esposte via PostgREST (advisor lint 0013 → 0).
--
-- Stato live verificato 2026-06-12 (progetto ukgxmkwubcrbcvvovcto):
--   - 12 tabelle con RLS OFF (lint 0013 ERROR); 8 di queste hanno GIÀ policy
--     *_service_role_all (migration 2026-02 "add_service_role_policies_control_plane_v2")
--     spente dal blocco `disable row level security` dello schema di bootstrap (lint 0007);
--   - 4 senza policy: salesnav_list_members, lead_events, list_daily_stats, session_patterns;
--   - lead_enrichment_data: RLS ON ma senza policy (lint 0008 INFO).
-- Il bot usa SOLO la service_role key (BYPASSRLS, 3 call-site verificati): abilitare RLS
-- NON cambia il comportamento runtime del bot. La dashboard usa la anon key solo su `todos`
-- (tabella NON presente in questo progetto): il revoke è ENUMERATO sulle tabelle del bot,
-- nessun revoke generico sullo schema (regression-safe, zero-Q).
-- Idempotente: enable/revoke/alter ripetibili, policy con drop preventivo.
-- Rollback: cloud_002_rls_enable_pii.down.sql.
-- ⚠️ APPLY SU SUPABASE SOLO CON CONFERMA UTENTE (prod/DB). Mirror dello stato finale in
-- src/sync/supabase.full.schema.sql.

-- 1) Enable RLS sulle 12 tabelle oggi scoperte (lint 0013 → 0).
alter table public.accounts               enable row level security;
alter table public.campaigns              enable row level security;
alter table public.leads                  enable row level security;
alter table public.prompt_variants        enable row level security;
alter table public.jobs_cloud             enable row level security;
alter table public.daily_stats_cloud      enable row level security;
alter table public.proxy_ips              enable row level security;
alter table public.telegram_commands      enable row level security;
alter table public.salesnav_list_members  enable row level security;
alter table public.lead_events            enable row level security;
alter table public.list_daily_stats       enable row level security;
alter table public.session_patterns       enable row level security;

-- 2) Policy service_role esplicite dove mancano (difesa in profondità + lint 0008).
--    service_role bypassa comunque RLS: la policy è documentazione eseguibile dell'intento
--    "solo il bot scrive qui" e protegge da futuri ruoli non-bypass.
drop policy if exists salesnav_list_members_service_role_all on public.salesnav_list_members;
create policy salesnav_list_members_service_role_all on public.salesnav_list_members
    for all to service_role using (true) with check (true);

drop policy if exists lead_events_service_role_all on public.lead_events;
create policy lead_events_service_role_all on public.lead_events
    for all to service_role using (true) with check (true);

drop policy if exists list_daily_stats_service_role_all on public.list_daily_stats;
create policy list_daily_stats_service_role_all on public.list_daily_stats
    for all to service_role using (true) with check (true);

drop policy if exists session_patterns_service_role_all on public.session_patterns;
create policy session_patterns_service_role_all on public.session_patterns
    for all to service_role using (true) with check (true);

drop policy if exists lead_enrichment_data_service_role_all on public.lead_enrichment_data;
create policy lead_enrichment_data_service_role_all on public.lead_enrichment_data
    for all to service_role using (true) with check (true);

-- 3) Difesa in profondità: revoca anon/authenticated ENUMERATA sulle tabelle del bot
--    (lint 0026/0027: spariscono dallo schema GraphQL pubblico e signed-in).
revoke all privileges on table
    public.cp_events,
    public.cp_daily_kpis,
    public.cp_incidents,
    public.cp_worker_runs,
    public.accounts,
    public.campaigns,
    public.leads,
    public.prompt_variants,
    public.jobs_cloud,
    public.daily_stats_cloud,
    public.proxy_ips,
    public.telegram_commands,
    public.salesnav_list_members,
    public.lead_enrichment_data,
    public.lead_events,
    public.list_daily_stats,
    public.session_patterns
from anon, authenticated;

-- 4) search_path pinned sulle funzioni (lint 0011): i corpi referenziano solo oggetti
--    qualificati `public.` → pin non-breaking.
alter function public.set_updated_at() set search_path = public;
alter function public.increment_daily_stat_cloud(date, text, text, integer) set search_path = public;
alter function public.increment_account_counter(text, text, integer) set search_path = public;
