-- Las paradas guardadas pueden ser de la EMT o de un interurbano del CRTM (627, N907…). Las que ya hay son de la EMT.
alter table public.bus_stops
  add column network text not null default 'emt' check (network in ('emt', 'interurbano'));

-- Una parada interurbana puede juntar varios códigos: en Moncloa el 627 sale del intercambiador (06002) y el N907 de
-- la calle Princesa (2419).
alter table public.bus_stops drop constraint bus_stops_stop_id_check;
alter table public.bus_stops
  add constraint bus_stops_stop_id_check check (stop_id ~ '^[0-9]{1,5}(,[0-9]{1,5})*$');
