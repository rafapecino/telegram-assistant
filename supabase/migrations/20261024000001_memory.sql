-- Memoria: un único documento con lo que el asistente sabe de Rafa, para hablarle con gracia. Se edita desde el panel.
create table public.memory (
  id smallint primary key default 1 check (id = 1),
  content text not null default '' check (char_length(content) <= 4000),
  updated_at timestamptz not null default now()
);
alter table public.memory enable row level security;
revoke all on public.memory from anon, authenticated;
