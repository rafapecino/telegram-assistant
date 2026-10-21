-- Tablas del bot. RLS activado y sin políticas: solo las Edge Functions,
-- que usan la clave secreta del proyecto, pueden leer y escribir.

create table public.reminders (
  id bigint generated always as identity primary key,
  text text not null,
  remind_at timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index reminders_pending_idx on public.reminders (remind_at) where sent_at is null;

-- Cada enlace de autorización bancaria lleva un "state" de un solo uso.
create table public.bank_authorizations (
  state text primary key default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table public.bank_sessions (
  session_id text primary key,
  account_uids text[] not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id bigint generated always as identity primary key,
  bank_transaction_id text not null unique,
  account_uid text not null,
  booking_date date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null,
  description text not null,
  category text not null,
  created_at timestamptz not null default now()
);
create index expenses_booking_date_idx on public.expenses (booking_date);

alter table public.reminders enable row level security;
alter table public.bank_authorizations enable row level security;
alter table public.bank_sessions enable row level security;
alter table public.expenses enable row level security;

-- Secretos internos generados dentro de la base de datos, para que nadie tenga que copiarlos a mano.
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'internal_jobs_secret',
  'Autentica las llamadas de pg_cron a la función scheduled-jobs'
);
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'telegram_webhook_secret',
  'Telegram lo envía en cada mensaje para demostrar que la llamada viene de Telegram'
);

-- Las Edge Functions leen esos secretos con esta función; solo la clave secreta puede llamarla.
create function public.get_internal_secret(secret_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name;
$$;

revoke execute on function public.get_internal_secret(text) from public, anon, authenticated;
grant execute on function public.get_internal_secret(text) to service_role;
