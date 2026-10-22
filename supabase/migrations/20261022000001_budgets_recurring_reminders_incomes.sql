-- Recordatorios que se repiten: tras enviarse se reprograman en lugar de quedarse como enviados.
alter table public.reminders
  add column repeat text check (repeat in ('daily', 'weekdays', 'weekly', 'monthly')),
  -- Día del mes de un recordatorio mensual: así el del día 31 vuelve al 31 después de pasar por un mes más corto.
  add column repeat_day smallint check (repeat_day between 1 and 31);

-- Ingresos del banco, para el balance. Misma forma y misma clave que los gastos para no duplicarlos.
create table public.incomes (
  id bigint generated always as identity primary key,
  transaction_key text not null unique,
  account_uid text not null,
  booking_date date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null,
  description text not null,
  created_at timestamptz not null default now()
);
create index incomes_booking_date_idx on public.incomes (booking_date);

-- Presupuesto mensual por categoría. La categoría "Total" es el límite de todo el gasto del mes.
create table public.budgets (
  id bigint generated always as identity primary key,
  category text not null unique,
  monthly_limit numeric(12, 2) not null check (monthly_limit > 0),
  created_at timestamptz not null default now()
);

-- Avisos de presupuesto ya enviados: uno por presupuesto, mes y umbral (80 % o 100 %).
create table public.budget_alerts (
  budget_id bigint not null references public.budgets (id) on delete cascade,
  month date not null,
  threshold smallint not null check (threshold in (80, 100)),
  sent_at timestamptz not null default now(),
  primary key (budget_id, month, threshold)
);

-- Igual que el resto de tablas: RLS sin políticas, solo las Edge Functions con la clave secreta pueden usarlas.
alter table public.incomes enable row level security;
alter table public.budgets enable row level security;
alter table public.budget_alerts enable row level security;
