-- Events calendar (events.html): results, dividends, bonus/split, buyback and other board meetings
-- from NSE, kept fresh by the events-refresh edge function. Past results get an "outcome": the
-- quarter's numbers from NSE's integrated-filing XBRL (vs previous quarter and the same quarter last
-- year), the share-price reaction, and a positive / negative / mixed verdict with its reasons.
create table if not exists public.market_events (
  id text primary key,                 -- symbol|yyyy-mm-dd|kind
  symbol text not null,
  company text,
  event_date date not null,            -- board meeting date, or ex-date for corporate actions
  kind text not null,                  -- results | dividend | bonus | split | buyback | rights | fundraise | agm | board
  title text not null,
  detail text,
  record_date date,
  amount numeric,                      -- dividend per share (Rs), when stated
  tracked boolean not null default false, -- in the scanner universe (stock_swing_cache)
  pre jsonb,                           -- before the event: last close, typical daily move (tracked stocks)
  outcome jsonb,                       -- past results only, see events-refresh
  outcome_at timestamptz,
  source text not null default 'nse',
  updated_at timestamptz not null default now()
);
create index if not exists market_events_date_idx on public.market_events (event_date);
create index if not exists market_events_symbol_idx on public.market_events (symbol, event_date desc);

alter table public.market_events enable row level security;
revoke all on public.market_events from anon, authenticated;
grant select on public.market_events to anon, authenticated;
drop policy if exists "Public can read market events" on public.market_events;
create policy "Public can read market events" on public.market_events for select using (true);

-- Refresh: hourly (calendar + any newly filed results); results evenings get extra runs.
-- select cron.schedule('events-refresh', '23 * * * *', $$select net.http_post(
--   url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/events-refresh',
--   headers := jsonb_build_object('x-cron-secret', (select value from public.app_secrets where name = 'crypto_cron'), 'Content-Type', 'application/json'),
--   body := '{}'::jsonb, timeout_milliseconds := 140000)$$);
