-- MarketPulse Stock Signals: additive schema only.
-- This file creates stock-only tables. It does not alter or reference crypto tables.
-- Review and run in Supabase SQL Editor after confirming project backup.

create table if not exists public.stock_trade_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  timeframe text not null check (timeframe in ('intraday','swing')),
  direction text not null check (direction in ('BUY','SELL')),
  setup text not null,
  score integer not null check (score between 0 and 100),
  entry_price numeric(18,4) not null check (entry_price > 0),
  stop_loss numeric(18,4) not null check (stop_loss > 0),
  target_1 numeric(18,4) not null check (target_1 > 0),
  target_2 numeric(18,4) not null check (target_2 > 0),
  quantity integer not null check (quantity >= 0),
  risk_budget numeric(18,2) not null check (risk_budget >= 0),
  rr_target_1 numeric(8,3) not null default 1.5,
  rr_target_2 numeric(8,3) not null default 2,
  quote_time timestamptz not null,
  candle_time date not null,
  source text not null,
  indicators jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','EXPIRED','STOP_HIT','TARGET_1_HIT','TARGET_2_HIT','INVALIDATED','CANCELLED')),
  strategy_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(symbol,timeframe,direction,candle_time,strategy_version)
);

create index if not exists stock_trade_signals_user_created_idx
  on public.stock_trade_signals(user_id, created_at desc);
create index if not exists stock_trade_signals_status_idx
  on public.stock_trade_signals(status, timeframe, created_at desc);
create index if not exists stock_trade_signals_symbol_date_idx
  on public.stock_trade_signals(symbol, candle_time desc);

create table if not exists public.stock_signal_events (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.stock_trade_signals(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('PAPER_ENTRY','TARGET_1','TARGET_2','STOP_LOSS','EXPIRED','MANUAL_CLOSED','NOTE')),
  event_time timestamptz not null default now(),
  price numeric(18,4),
  quantity integer check (quantity is null or quantity >= 0),
  gross_pnl numeric(18,2),
  charges numeric(18,2) not null default 0,
  net_pnl numeric(18,2),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists stock_signal_events_signal_time_idx
  on public.stock_signal_events(signal_id, event_time asc);

alter table public.stock_trade_signals enable row level security;
alter table public.stock_signal_events enable row level security;
revoke all on public.stock_trade_signals from anon;
revoke all on public.stock_signal_events from anon;
grant select, insert, update, delete on public.stock_trade_signals to authenticated;
grant select, insert, update, delete on public.stock_signal_events to authenticated;

drop policy if exists "Users manage own stock signals" on public.stock_trade_signals;
create policy "Users manage own stock signals"
on public.stock_trade_signals for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own stock signal events" on public.stock_signal_events;
create policy "Users manage own stock signal events"
on public.stock_signal_events for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Important: upsert conflicts must work under RLS for the same user's own rows.
-- The browser client intentionally does not write to any crypto table.
