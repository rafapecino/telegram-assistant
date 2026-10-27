-- RLS sin políticas ya impide que anon y authenticated lean o escriban, pero estas tablas conservaban los permisos
-- por defecto de Supabase. Quitarlos deja una segunda barrera: si RLS se desactivara por error, seguirían cerradas.
revoke all on table
  public.birthdays,
  public.budget_alerts,
  public.budgets,
  public.google_authorizations,
  public.google_connections,
  public.habit_checks,
  public.habits,
  public.notes,
  public.shopping_items
from anon, authenticated;

-- Que las tablas nuevas tampoco los reciban: todo el acceso pasa por las funciones con la clave secreta.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Peticiones al panel por ventana de tiempo: límite por usuario y avisos de accesos denegados.
create table public.panel_request_counts (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (bucket, window_start)
);
alter table public.panel_request_counts enable row level security;
revoke all on table public.panel_request_counts from anon, authenticated;

-- En una sola sentencia para que dos peticiones a la vez no lean el mismo contador. Borra de paso las ventanas de
-- hace más de un día, que ya no sirven.
create function public.count_panel_request(bucket_name text, window_seconds integer)
returns integer
language sql
set search_path = ''
as $$
  with expired as (
    delete from public.panel_request_counts where window_start < now() - interval '1 day'
  )
  insert into public.panel_request_counts as counts (bucket, window_start)
  values (bucket_name, to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds))
  on conflict (bucket, window_start) do update set hits = counts.hits + 1
  returning counts.hits;
$$;
revoke all on function public.count_panel_request(text, integer) from public, anon, authenticated;
grant execute on function public.count_panel_request(text, integer) to service_role;
