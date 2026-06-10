-- cloud_001_daily_stat_idempotent — FOLLOW-UP D2 (2026-06-10)
-- Rende cloud.daily_stat recuperabile dall'outbox SENZA doppio conteggio (at-least-once delivery):
-- claim dell'idempotency_key + increment nella STESSA transazione plpgsql.
-- Idempotente: ri-applicabile (create if not exists / or replace). Rollback: vedi .down.sql.
-- ⚠️ APPLY SU SUPABASE SOLO CON CONFERMA UTENTE (prod/DB). Mirror nello schema canonico
-- src/sync/supabase.full.schema.sql (stato finale).

-- 1. Registro eventi applicati: il claim della chiave decide se l'evento è nuovo.
create table if not exists public.cp_applied_events (
    idempotency_key text primary key,
    applied_at timestamptz not null default now()
);
alter table public.cp_applied_events disable row level security;

-- 2. RPC base. Era GIÀ chiamata dal client (supabaseDataClient.incrementCloudDailyStat) ma
--    ASSENTE dallo schema canonico (gap D3: "garantire l'RPC deployata via migration").
--    Whitelist esplicita dei field: niente identifier dinamico non validato.
create or replace function public.increment_daily_stat_cloud(
    p_local_date date,
    p_account_id text,
    p_field text,
    p_amount integer default 1
) returns void language plpgsql as $$
begin
    if p_field not in ('invites_sent','messages_sent','acceptances','replies','challenges_count','selector_failures','run_errors') then
        raise exception 'increment_daily_stat_cloud: campo non ammesso: %', p_field;
    end if;
    execute format(
        'insert into public.daily_stats_cloud (local_date, account_id, %I, updated_at)
         values ($1, $2, $3, now())
         on conflict (local_date, account_id)
         do update set %I = public.daily_stats_cloud.%I + $3, updated_at = now()',
        p_field, p_field, p_field
    ) using p_local_date, p_account_id, p_amount;
end;
$$;

-- 3. RPC idempotente: claim + increment atomici (una sola transazione plpgsql — o entrambi o nessuno).
--    Ritorna true se applicato ora, false se la chiave era già stata applicata (no-op).
create or replace function public.increment_daily_stat_cloud_idem(
    p_idempotency_key text,
    p_local_date date,
    p_account_id text,
    p_field text,
    p_amount integer default 1
) returns boolean language plpgsql as $$
begin
    insert into public.cp_applied_events (idempotency_key)
    values (p_idempotency_key)
    on conflict (idempotency_key) do nothing;
    if not found then
        return false; -- evento già applicato in un drain precedente: no-op (niente doppio conteggio)
    end if;
    perform public.increment_daily_stat_cloud(p_local_date, p_account_id, p_field, p_amount);
    return true;
end;
$$;
