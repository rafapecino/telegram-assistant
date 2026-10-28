-- Productos que se vigilan cada día en Google Shopping (vía SerpApi) para avisar cuando bajan de precio.
create table public.price_watches (
  id bigint generated always as identity primary key,
  query text not null unique check (char_length(query) between 2 and 100),
  -- Avisar cuando el mejor precio baje de esto; sin él, cuando baje un 5 % o más.
  max_price numeric(10, 2) check (max_price > 0),
  best_price numeric(10, 2),
  best_source text,
  best_title text,
  best_link text,
  -- El último precio avisado: no se repite el aviso hasta que baje más.
  notified_price numeric(10, 2),
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.price_watches enable row level security;
revoke all on table public.price_watches from anon, authenticated;
