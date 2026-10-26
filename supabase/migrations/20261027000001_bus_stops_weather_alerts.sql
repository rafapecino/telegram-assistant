-- Paradas de la EMT guardadas con un nombre ("la de casa es la 1234").
create table public.bus_stops (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(name) between 1 and 50),
  stop_id text not null check (stop_id ~ '^[0-9]{1,5}$'),
  created_at timestamptz not null default now()
);

-- Avisos de AEMET ya enviados por Telegram, para no repetirlos cada hora. El id es el identificador del aviso CAP.
create table public.weather_alerts_sent (
  id text primary key,
  sent_at timestamptz not null default now()
);

alter table public.bus_stops enable row level security;
alter table public.weather_alerts_sent enable row level security;
revoke all on public.bus_stops from anon, authenticated;
revoke all on public.weather_alerts_sent from anon, authenticated;
