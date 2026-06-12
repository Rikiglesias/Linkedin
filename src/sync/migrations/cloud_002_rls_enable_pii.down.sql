-- Rollback di cloud_002_rls_enable_pii — riporta lo stato pre-migration (2026-06-12).
-- NOTA: ripristina deliberatamente uno stato NON sicuro (RLS off + grant anon):
-- usare solo se la migration rompe un consumer legittimo non previsto.

-- 4) search_path: rimuovi il pin.
alter function public.set_updated_at() reset search_path;
alter function public.increment_daily_stat_cloud(date, text, text, integer) reset search_path;
alter function public.increment_account_counter(text, text, integer) reset search_path;

-- 3) Ripristina i grant di default Supabase per anon/authenticated.
grant all privileges on table
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
to anon, authenticated;

-- 2) Rimuovi le policy introdotte da cloud_002 (le 8 *_service_role_all storiche restano).
drop policy if exists salesnav_list_members_service_role_all on public.salesnav_list_members;
drop policy if exists lead_events_service_role_all on public.lead_events;
drop policy if exists list_daily_stats_service_role_all on public.list_daily_stats;
drop policy if exists session_patterns_service_role_all on public.session_patterns;
drop policy if exists lead_enrichment_data_service_role_all on public.lead_enrichment_data;

-- 1) RLS off sulle 12 tabelle (stato pre-migration; lead_enrichment_data resta ON: lo era già).
alter table public.accounts               disable row level security;
alter table public.campaigns              disable row level security;
alter table public.leads                  disable row level security;
alter table public.prompt_variants        disable row level security;
alter table public.jobs_cloud             disable row level security;
alter table public.daily_stats_cloud      disable row level security;
alter table public.proxy_ips              disable row level security;
alter table public.telegram_commands      disable row level security;
alter table public.salesnav_list_members  disable row level security;
alter table public.lead_events            disable row level security;
alter table public.list_daily_stats       disable row level security;
alter table public.session_patterns       disable row level security;
