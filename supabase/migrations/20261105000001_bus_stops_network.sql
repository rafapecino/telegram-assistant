-- Las paradas guardadas pueden ser de la EMT o de un interurbano del CRTM (627, N907…). Las que ya hay son de la EMT.
alter table public.bus_stops
  add column network text not null default 'emt' check (network in ('emt', 'interurbano'));
