-- Funciones que no dependen del banco: lista de la compra, notas, cumpleaños, hábitos y Google Calendar.

create table public.shopping_items (
  id bigint generated always as identity primary key,
  text text not null check (length(text) between 1 and 100),
  created_at timestamptz not null default now()
);

-- Datos sueltos para recordar ("la talla de Marta es la 38"), sin fecha.
create table public.notes (
  id bigint generated always as identity primary key,
  text text not null check (length(text) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table public.birthdays (
  id bigint generated always as identity primary key,
  name text not null unique,
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  -- Año de nacimiento, si se sabe: sirve para decir cuántos cumple.
  year smallint check (year between 1900 and 2100),
  created_at timestamptz not null default now()
);

create table public.habits (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Una respuesta por hábito y día: si se contesta dos veces, vale la última.
create table public.habit_checks (
  habit_id bigint not null references public.habits (id) on delete cascade,
  date date not null,
  done boolean not null,
  answered_at timestamptz not null default now(),
  primary key (habit_id, date)
);

-- Cada enlace de autorización de Google lleva un "state" de un solo uso, como el del banco.
create table public.google_authorizations (
  state text primary key default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

-- Token de larga duración para leer y crear eventos. Solo hay una conexión: al reconectar se sustituye.
create table public.google_connections (
  id bigint generated always as identity primary key,
  refresh_token text not null,
  created_at timestamptz not null default now()
);

-- Como el resto de tablas: RLS sin políticas, solo las Edge Functions con la clave secreta pueden usarlas.
alter table public.shopping_items enable row level security;
alter table public.notes enable row level security;
alter table public.birthdays enable row level security;
alter table public.habits enable row level security;
alter table public.habit_checks enable row level security;
alter table public.google_authorizations enable row level security;
alter table public.google_connections enable row level security;
