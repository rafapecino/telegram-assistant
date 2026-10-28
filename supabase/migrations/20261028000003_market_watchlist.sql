-- Lo que se sigue en Mercados: acciones e índices (símbolo de Yahoo), criptomonedas (id de CoinGecko) y divisas
-- frente al euro (código ISO). Se edita desde el panel o el chat.
create table public.market_watchlist (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('stock', 'crypto', 'currency')),
  symbol text not null check (symbol ~ '^[A-Za-z0-9.^=-]{1,40}$'),
  label text not null check (char_length(label) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (kind, symbol)
);
alter table public.market_watchlist enable row level security;
revoke all on table public.market_watchlist from anon, authenticated;

insert into public.market_watchlist (kind, symbol, label) values
  ('stock', '^NDX', 'Nasdaq-100'),
  ('stock', 'AAPL', 'Apple'),
  ('stock', 'MSFT', 'Microsoft'),
  ('stock', 'NVDA', 'Nvidia'),
  ('stock', 'AMZN', 'Amazon'),
  ('stock', 'GOOGL', 'Alphabet (Google)'),
  ('stock', 'META', 'Meta'),
  ('stock', 'TSLA', 'Tesla'),
  ('crypto', 'bitcoin', 'Bitcoin'),
  ('crypto', 'ethereum', 'Ethereum'),
  ('crypto', 'solana', 'Solana'),
  ('crypto', 'ripple', 'XRP'),
  ('crypto', 'binancecoin', 'BNB'),
  ('crypto', 'dogecoin', 'Dogecoin'),
  ('currency', 'USD', 'Dólar estadounidense'),
  ('currency', 'GBP', 'Libra esterlina'),
  ('currency', 'CHF', 'Franco suizo');
