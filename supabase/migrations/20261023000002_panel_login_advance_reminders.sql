-- El panel usa cuentas de Supabase Auth autorizadas expresamente.
create table public.panel_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.panel_users enable row level security;
revoke all on public.panel_users from anon, authenticated;

-- Cada ocurrencia recibe un aviso previo y otro a su hora.
alter table public.reminders
  add column advance_at timestamptz,
  add column advance_notified_at timestamptz;
update public.reminders set advance_at = remind_at - interval '24 hours'
  where sent_at is null and remind_at >= now() + interval '24 hours';
create index reminders_advance_idx on public.reminders (advance_at)
  where sent_at is null and advance_notified_at is null and advance_at is not null;
