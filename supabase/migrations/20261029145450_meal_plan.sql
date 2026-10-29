-- Menú de la semana: ideas de platos que propone el asistente y los que eliges. No dice qué comer: tú escoges.
-- `week_start` es el lunes de la semana en Madrid.
create table public.meal_plan (
  id bigint generated always as identity primary key,
  week_start date not null,
  name text not null check (length(name) between 1 and 80),
  description text not null default '' check (length(description) <= 200),
  ingredients text[] not null default '{}' check (cardinality(ingredients) <= 15),
  -- false: solo es una idea propuesta; true: está en tu menú.
  chosen boolean not null default false,
  cooked boolean not null default false,
  created_at timestamptz not null default now()
);
create index meal_plan_week_idx on public.meal_plan (week_start);

-- Ingredientes ya revisados esa semana, guardados en forma comparable (sin mayúsculas ni tildes):
-- `skipped` son los que tienes en casa mientras revisas; `resolved`, los que ya pasaron (o no) a la lista.
create table public.meal_plan_weeks (
  week_start date primary key,
  skipped text[] not null default '{}',
  resolved text[] not null default '{}'
);

-- Como el resto: solo las funciones con la clave secreta pueden leerlas o escribirlas.
alter table public.meal_plan enable row level security;
alter table public.meal_plan_weeks enable row level security;
revoke all on table public.meal_plan, public.meal_plan_weeks from anon, authenticated;
