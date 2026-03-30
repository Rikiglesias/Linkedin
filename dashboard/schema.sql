-- Todo Dashboard — Supabase schema
-- Eseguire nel SQL Editor di Supabase

create table if not exists public.todos (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  status         text not null default 'pending'
                   check (status in ('pending', 'in_progress', 'completed')),
  priority       text not null default 'medium'
                   check (priority in ('low', 'medium', 'high')),
  assigned_agent text,
  updated_at     timestamptz not null default now()
);

-- Aggiorna updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger todos_updated_at
  before update on public.todos
  for each row execute function public.set_updated_at();

-- Indici
create index if not exists todos_status_idx    on public.todos (status);
create index if not exists todos_updated_at_idx on public.todos (updated_at desc);

-- RLS: ogni utente vede i propri todo (opzionale — disabilitare per uso single-user)
alter table public.todos enable row level security;

create policy "Allow all" on public.todos
  for all using (true) with check (true);

-- Abilita Realtime (obbligatorio per il dashboard)
alter publication supabase_realtime add table public.todos;
