-- Última consulta a AEMET (a las 8:00 y a las 14:00). El panel y el resumen de la mañana leen de aquí para no
-- gastar el límite de la clave con cada visita.
create table public.weather_alerts (
  id text primary key,
  level text not null check (level in ('amarillo', 'naranja', 'rojo')),
  event text not null,
  zone text not null,
  onset timestamptz not null,
  expires timestamptz not null,
  fetched_at timestamptz not null default now()
);

alter table public.weather_alerts enable row level security;
revoke all on public.weather_alerts from anon, authenticated;
