-- ============================================================
-- LinkedIn Bot Enterprise - Supabase PostgreSQL Schema
-- ============================================================
-- Istruzioni: esegui questo script nell'SQL Editor di Supabase
-- (progetto > SQL Editor > New Query > Esegui)
-- ============================================================

-- ============================================================
-- TABELLE DI TELEMETRIA (già esistenti – non alterare se presenti)
-- ============================================================

create table if not exists public.cp_events (
    id bigserial primary key,
    topic text not null,
    payload jsonb not null default '{}',
    idempotency_key text not null unique,
    created_at timestamptz not null default now()
);
create index if not exists idx_cp_events_created_at on public.cp_events(created_at desc);

create table if not exists public.cp_daily_kpis (
    id bigserial primary key,
    local_date date not null,
    metric_name text not null,
    metric_value numeric not null,
    created_at timestamptz not null default now(),
    unique (local_date, metric_name)
);

create table if not exists public.cp_incidents (
    id bigserial primary key,
    incident_type text not null,
    severity text not null,
    details jsonb not null default '{}',
    opened_at timestamptz not null default now()
);

create table if not exists public.cp_worker_runs (
    id bigserial primary key,
    worker_name text not null,
    status text not null,
    details jsonb not null default '{}',
    created_at timestamptz not null default now()
);

-- ============================================================
-- TABELLE OPERATIVE (nuove – core del sistema Enterprise)
-- ============================================================

-- 1. ACCOUNTS – ogni profilo LinkedIn gestito dal bot
--    tier: WARM_UP | ACTIVE | QUARANTINE | BANNED
--    health: GREEN | YELLOW | RED
create table if not exists public.accounts (
    id text primary key,                                  -- corrisponde a config account_id (es. 'acc1')
    email text,
    display_name text,
    session_dir text,
    proxy_url text,
    tier text not null default 'WARM_UP',                 -- WARM_UP | ACTIVE | QUARANTINE | BANNED
    health text not null default 'GREEN',                 -- GREEN | YELLOW | RED
    daily_invite_cap integer not null default 15,
    daily_message_cap integer not null default 20,
    daily_invites_sent integer not null default 0,
    daily_messages_sent integer not null default 0,
    farming_started_at timestamptz,
    farming_ends_at timestamptz,
    last_active_at timestamptz,
    quarantine_reason text,
    quarantine_until timestamptz,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 2. CAMPAIGNS – una campagna raggruppa lead simili con set di istruzioni AI
create table if not exists public.campaigns (
    id bigserial primary key,
    name text not null unique,
    account_id text references public.accounts(id) on delete set null,
    is_active boolean not null default true,
    priority integer not null default 100,
    daily_invite_cap integer,
    daily_message_cap integer,
    -- System prompt e user prompt per la generazione della nota AI
    prompt_system text not null default '',
    prompt_user text not null default '',
    -- Stile: FORMAL | CASUAL | IRONIC
    prompt_style text not null default 'CASUAL',
    -- Statistiche aggregate (aggiornate da trigger o cron)
    total_leads integer not null default 0,
    leads_invited integer not null default 0,
    leads_connected integer not null default 0,
    leads_messaged integer not null default 0,
    leads_replied integer not null default 0,
    acceptance_rate numeric(5,2),
    reply_rate numeric(5,2),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 3. LEADS – il CRM centrale. Replica dei lead locali + dati cloud-only.
--    status: NEW | READY_INVITE | INVITED | CONNECTED | READY_MESSAGE | MESSAGED | REPLIED | DEAD | BLOCKED
create table if not exists public.leads (
    id bigserial primary key,
    local_id integer,                                     -- id dal DB SQLite locale (per reconciliazione)
    campaign_id bigint references public.campaigns(id) on delete set null,
    account_id text references public.accounts(id) on delete set null,
    linkedin_url text not null unique,
    first_name text not null default '',
    last_name text not null default '',
    job_title text not null default '',
    account_name text not null default '',
    website text not null default '',
    list_name text not null default 'default',
    status text not null default 'NEW',
    -- Timestamps chiave del lifecycle
    invited_at timestamptz,
    accepted_at timestamptz,
    messaged_at timestamptz,
    replied_at timestamptz,
    last_site_check_at timestamptz,
    last_error text,
    blocked_reason text,
    about text,
    experience text,
    invite_prompt_variant text,
    invite_note_sent text,
    -- NLP intent dell'ultima risposta in inbox
    last_reply_intent text,                               -- POSITIVE | NEGATIVE | POSTPONED | NEUTRAL
    last_reply_snippet text,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_campaign_id on public.leads(campaign_id);
create index if not exists idx_leads_account_id on public.leads(account_id);
create index if not exists idx_leads_list_name on public.leads(list_name);
create index if not exists idx_leads_invited_at on public.leads(invited_at desc) where invited_at is not null;
create index if not exists idx_leads_accepted_at on public.leads(accepted_at desc) where accepted_at is not null;

-- 4. PROMPT_AB_TEST_VARIANTS – le varianti di prompt da testare
create table if not exists public.prompt_variants (
    id bigserial primary key,
    campaign_id bigint references public.campaigns(id) on delete cascade,
    variant_name text not null,
    prompt_system text not null,
    prompt_user text not null,
    -- Statistiche accumulate
    invites_sent integer not null default 0,
    acceptances integer not null default 0,
    acceptance_rate numeric(5,2),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (campaign_id, variant_name)
);

-- 5. JOBS_CLOUD – coda job distribuita cloud-side (mirror della SQLite locale)
--    type: SCRAPE | INVITE | CHECK_ACCEPTS | MESSAGE | FARM_ACTIVITY
--    status: QUEUED | RUNNING | SUCCESS | FAILED | DEAD_LETTER | BLOCKED
create table if not exists public.jobs_cloud (
    id bigserial primary key,
    local_job_id integer,                                 -- id dal DB SQLite locale
    account_id text references public.accounts(id) on delete cascade,
    lead_id bigint references public.leads(id) on delete set null,
    type text not null,
    status text not null default 'QUEUED',
    priority integer not null default 100,
    payload jsonb not null default '{}',
    idempotency_key text unique,
    attempts integer not null default 0,
    max_attempts integer not null default 3,
    next_run_at timestamptz not null default now(),
    locked_at timestamptz,
    completed_at timestamptz,
    error_message text,
    proof_screenshot_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_jobs_cloud_status_next on public.jobs_cloud(status, next_run_at asc);
create index if not exists idx_jobs_cloud_account_status on public.jobs_cloud(account_id, status);
create index if not exists idx_jobs_cloud_type on public.jobs_cloud(type);

-- 6. DAILY_STATS_CLOUD – statistiche giornaliere aggregate per account
create table if not exists public.daily_stats_cloud (
    id bigserial primary key,
    local_date date not null,
    account_id text references public.accounts(id) on delete cascade,
    invites_sent integer not null default 0,
    messages_sent integer not null default 0,
    acceptances integer not null default 0,
    replies integer not null default 0,
    challenges_count integer not null default 0,
    selector_failures integer not null default 0,
    run_errors integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (local_date, account_id)
);
create index if not exists idx_daily_stats_cloud_date on public.daily_stats_cloud(local_date desc);

-- 7. PROXY_HEALTH – storico della salute dei proxy (Punto 11 del Master Plan)
create table if not exists public.proxy_ips (
    id bigserial primary key,
    proxy_url text not null unique,
    provider text,                                        -- es. 'brightdata', 'iproyal', 'custom'
    ip_address text,
    country_code text,
    asn text,
    is_residential boolean not null default false,
    status text not null default 'ACTIVE',                -- ACTIVE | DEAD | COOLING_DOWN
    failure_count integer not null default 0,
    last_tested_at timestamptz,
    blacklisted_until timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 8. TELEGRAM_COMMANDS – comandi ricevuti via bot Telegram (Punto 4 Master Plan)
create table if not exists public.telegram_commands (
    id bigserial primary key,
    account_id text references public.accounts(id) on delete set null,
    command text not null,                                -- es. 'solve', 'pin', 'restart', 'pause'
    args text,                                            -- es. '742911' (il pin) o '3' (riquadro captcha)
    status text not null default 'PENDING',               -- PENDING | PROCESSED | EXPIRED
    processed_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists idx_telegram_commands_pending on public.telegram_commands(status, created_at asc) where status = 'PENDING';

-- ============================================================
-- FUNZIONI HELPER
-- ============================================================

-- Auto-aggiorna updated_at su ogni UPDATE
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- Applica il trigger a tutte le tabelle con updated_at
do $$
declare
    tbl text;
begin
    foreach tbl in array array['accounts','campaigns','leads','prompt_variants','jobs_cloud','daily_stats_cloud','proxy_ips','telegram_commands']
    loop
        execute format(
            'drop trigger if exists trg_%I_updated_at on public.%I;
             create trigger trg_%I_updated_at
             before update on public.%I
             for each row execute function public.set_updated_at();',
            tbl, tbl, tbl, tbl
        );
    end loop;
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY (RLS) – sicurezza base
-- ============================================================
-- Il service role key bypassa RLS, la anon key no.
-- Per ora disabilitiamo RLS sulle tabelle operative (accesso
-- solo via service role key dal bot, non da browser).
alter table public.accounts disable row level security;
alter table public.campaigns disable row level security;
alter table public.leads disable row level security;
alter table public.prompt_variants disable row level security;
alter table public.jobs_cloud disable row level security;
alter table public.daily_stats_cloud disable row level security;
alter table public.proxy_ips disable row level security;
alter table public.telegram_commands disable row level security;
