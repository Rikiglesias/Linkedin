create table if not exists public.cp_events (
    id bigserial primary key,
    topic text not null,
    payload jsonb not null,
    idempotency_key text not null unique,
    created_at timestamptz not null default now()
);

create table if not exists public.cp_daily_kpis (
    id bigserial primary key,
    local_date date not null,
    metric_name text not null,
    metric_value numeric not null,
    created_at timestamptz not null default now()
);

create table if not exists public.cp_incidents (
    id bigserial primary key,
    incident_type text not null,
    severity text not null,
    details jsonb not null,
    opened_at timestamptz not null default now()
);

create table if not exists public.cp_worker_runs (
    id bigserial primary key,
    worker_name text not null,
    status text not null,
    details jsonb not null,
    created_at timestamptz not null default now()
);

