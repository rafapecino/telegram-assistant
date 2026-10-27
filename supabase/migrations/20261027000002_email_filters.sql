-- Remitentes que el asistente no enseña al hablar del correo (publicidad, alertas automáticas…). Un dominio
-- vale también para sus subdominios: "aliexpress.com" cubre "deals.aliexpress.com". La lista se rellena en la
-- base de datos y no en el código porque el repositorio es público.
create table public.email_filters (
  sender text primary key check (sender ~ '^[A-Za-z0-9.+_@-]{3,100}$'),
  created_at timestamptz not null default now()
);

alter table public.email_filters enable row level security;
revoke all on public.email_filters from anon, authenticated;
