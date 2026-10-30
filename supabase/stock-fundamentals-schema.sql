-- Cache for the stock-fundamentals edge function (quarterly results read from NSE integrated filings).
-- Only the function (service role) reads and writes it; the browser calls the function.
create table if not exists public.stock_fundamentals_cache (
  symbol text primary key,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.stock_fundamentals_cache enable row level security;
revoke all on public.stock_fundamentals_cache from anon, authenticated;
