-- Nivel de cada aviso de AEMET enviado: el mismo día solo se vuelve a avisar si sube a naranja o rojo.
alter table public.weather_alerts_sent add column level text check (level in ('amarillo', 'naranja', 'rojo'));
