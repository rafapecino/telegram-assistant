-- Peso corporal: un registro por día (si se apunta dos veces el mismo día, vale el último).
create table public.weight_entries (
  id bigint generated always as identity primary key,
  date date not null unique,
  kg numeric(5, 1) not null check (kg > 20 and kg < 400),
  created_at timestamptz not null default now()
);
alter table public.weight_entries enable row level security;
revoke all on public.weight_entries from anon, authenticated;
