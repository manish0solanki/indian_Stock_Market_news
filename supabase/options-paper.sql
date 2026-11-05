-- Options paper trades (admin-only, paper only). The options-signals edge function turns the Stock Signals scanner's
-- BUY / SELL ideas on F&O stocks into defined-risk debit spreads (bull call / bear put), priced from NSE's live option
-- chain at conservative fills (buy at the ask, sell at the bid), and marks / closes them every 15 minutes in market
-- hours. Nothing here is shown to the public: the tables have no policies and the feed checks mp_is_platform_admin().
--
--   option_paper_trades   one row per spread, with the plan at entry, the latest mark and the exit
--   option_signal_log     what each run did with each signal (opened, skipped and why, closed and why)
--   fno_lots              NSE lot sizes per expiry month (nsearchives fo_mktlots.csv), refreshed daily by the function
--   options_paper_feed()  everything the admin page shows
--   pg_cron 'options-signals'  weekdays every 15 minutes, 9:30 AM – 3:30 PM IST

create table if not exists public.option_paper_trades (
  id bigserial primary key,
  symbol text not null,
  signal_side text not null,                 -- BUY or SELL (from stock_signals)
  signal_at timestamptz not null,            -- stock_signals.generated_at: one trade per signal
  signal_setup text, signal_score int,
  strategy text not null,                    -- 'bull_call_spread' | 'bear_put_spread'
  opt_type text not null,                    -- CE | PE
  expiry date not null,
  long_strike numeric not null, short_strike numeric not null,
  lot_size int not null, lots int not null default 1,
  entry_long numeric not null, entry_short numeric not null,   -- per share: long bought at the ask, short sold at the bid
  net_debit numeric not null, width numeric not null,
  max_loss numeric not null, max_profit numeric not null,      -- per lot, in rupees
  breakeven numeric not null,
  spot_entry numeric, stop numeric, target numeric,            -- the underlying's levels from the stock signal
  iv numeric, hv numeric, sector_state text, sector_group text,
  status text not null default 'OPEN',       -- OPEN | CLOSED
  opened_at timestamptz not null default now(),
  mark_long numeric, mark_short numeric, mark_value numeric, mark_spot numeric, marked_at timestamptz,
  exit_long numeric, exit_short numeric, exit_value numeric, exit_spot numeric, exit_reason text, closed_at timestamptz,
  pnl numeric,                               -- per position (lots × lot size), rupees; marked while open
  unique (symbol, signal_at)
);
create index if not exists option_paper_trades_status_idx on public.option_paper_trades (status, opened_at desc);
alter table public.option_paper_trades enable row level security;
revoke all on public.option_paper_trades from anon, authenticated;

create table if not exists public.option_signal_log (
  id bigserial primary key, at timestamptz not null default now(),
  symbol text, action text not null, reason text, detail jsonb
);
create index if not exists option_signal_log_at_idx on public.option_signal_log (at desc);
alter table public.option_signal_log enable row level security;
revoke all on public.option_signal_log from anon, authenticated;

create table if not exists public.fno_lots (symbol text primary key, lot int not null, months jsonb, updated_at timestamptz not null default now());
alter table public.fno_lots add column if not exists months jsonb;   -- {"NOV-26": 1900, ...} from NSE's fo_mktlots.csv
alter table public.fno_lots enable row level security;
revoke all on public.fno_lots from anon, authenticated;

create or replace function public.options_paper_feed() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'as_of', now(),
    'open', (select coalesce(jsonb_agg(to_jsonb(t) order by t.opened_at desc), '[]'::jsonb) from option_paper_trades t where status = 'OPEN'),
    'closed', (select coalesce(jsonb_agg(to_jsonb(t) order by t.closed_at desc), '[]'::jsonb)
                 from (select * from option_paper_trades where status = 'CLOSED' order by closed_at desc limit 200) t),
    'stats', (select jsonb_build_object('closed', count(*), 'wins', count(*) filter (where pnl > 0), 'losses', count(*) filter (where pnl <= 0),
                 'pnl', coalesce(round(sum(pnl)), 0), 'avg_win', round(avg(pnl) filter (where pnl > 0)), 'avg_loss', round(avg(pnl) filter (where pnl <= 0)),
                 'risked', coalesce(round(sum(max_loss * lots)), 0))
                from option_paper_trades where status = 'CLOSED'),
    'open_pnl', (select coalesce(round(sum(pnl)), 0) from option_paper_trades where status = 'OPEN'),
    'last_run', (select max(at) from option_signal_log where action = 'run'),
    'log', (select coalesce(jsonb_agg(to_jsonb(l) order by l.at desc), '[]'::jsonb)
              from (select at, symbol, action, reason, detail from option_signal_log where at > now() - interval '2 days' order by at desc limit 150) l));
end $$;
revoke execute on function public.options_paper_feed() from anon, public;
grant execute on function public.options_paper_feed() to authenticated;

-- Weekdays every 15 minutes, 04:00–09:45 UTC = 9:30 AM – 3:15 PM IST (the function itself also checks market hours).
select cron.schedule('options-signals', '*/15 4-9 * * 1-5', $$select net.http_post('https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/options-signals', '{}'::jsonb, headers => jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from app_secrets where name='crypto_cron')), timeout_milliseconds => 150000)$$);

-- ---------------------------------------------------------------------------------------------------------------
-- Cap, settings and manual controls (exit / take go through the edge function, which needs live NSE prices).
--   option_paper_settings       one row: max open spreads, max total at risk (₹), lots per new trade, auto-open on/off
--   option_paper_trades.source  'auto' (engine) or 'manual' (Take); max_loss / max_profit stay per lot, so the money at
--                               risk on a trade is max_loss × lots
--   options_paper_settings_set(), options_paper_edit(), options_paper_delete(), options_paper_clear()  admin only
create table if not exists public.option_paper_settings (
  id int primary key default 1 check (id = 1),
  max_open int not null default 10 check (max_open between 0 and 200),
  max_risk numeric not null default 150000 check (max_risk >= 0),
  lots int not null default 1 check (lots between 1 and 50),
  auto_open boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.option_paper_settings (id) values (1) on conflict (id) do nothing;
alter table public.option_paper_settings enable row level security;
revoke all on public.option_paper_settings from anon, authenticated;
alter table public.option_paper_trades add column if not exists source text not null default 'auto';

create or replace function public.options_paper_feed() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'as_of', now(),
    'settings', (select to_jsonb(s) from option_paper_settings s where id = 1),
    'open', (select coalesce(jsonb_agg(to_jsonb(t) order by t.opened_at desc), '[]'::jsonb) from option_paper_trades t where status = 'OPEN'),
    'closed', (select coalesce(jsonb_agg(to_jsonb(t) order by t.closed_at desc), '[]'::jsonb)
                 from (select * from option_paper_trades where status = 'CLOSED' order by closed_at desc limit 200) t),
    'stats', (select jsonb_build_object('closed', count(*), 'wins', count(*) filter (where pnl > 0), 'losses', count(*) filter (where pnl <= 0),
                 'pnl', coalesce(round(sum(pnl)), 0), 'avg_win', round(avg(pnl) filter (where pnl > 0)), 'avg_loss', round(avg(pnl) filter (where pnl <= 0)),
                 'risked', coalesce(round(sum(max_loss * lots)), 0))
                from option_paper_trades where status = 'CLOSED'),
    'open_pnl', (select coalesce(round(sum(pnl)), 0) from option_paper_trades where status = 'OPEN'),
    'open_risk', (select coalesce(round(sum(max_loss * lots)), 0) from option_paper_trades where status = 'OPEN'),
    'last_run', (select max(at) from option_signal_log where action = 'run'),
    'log', (select coalesce(jsonb_agg(to_jsonb(l) order by l.at desc), '[]'::jsonb)
              from (select at, symbol, action, reason, detail from option_signal_log where at > now() - interval '2 days' order by at desc limit 150) l));
end $$;

create or replace function public.options_paper_settings_set(p_max_open int, p_max_risk numeric, p_lots int, p_auto boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update option_paper_settings set max_open = p_max_open, max_risk = p_max_risk, lots = p_lots, auto_open = p_auto, updated_at = now() where id = 1;
  insert into option_signal_log (action, reason) values ('note', format('settings: max %s open, max ₹%s at risk, %s lot(s) per trade, auto-open %s',
    p_max_open, to_char(p_max_risk, 'FM99,99,99,999'), p_lots, case when p_auto then 'on' else 'off' end));
  return (select to_jsonb(s) from option_paper_settings s where id = 1);
end $$;

-- Change an open spread's stop / target on the underlying, or its number of lots (P&L is rescaled to the new size).
create or replace function public.options_paper_edit(p_id bigint, p_stop numeric, p_target numeric, p_lots int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t option_paper_trades;
begin
  if not mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into t from option_paper_trades where id = p_id;
  if t.id is null then raise exception 'trade not found'; end if;
  if t.status <> 'OPEN' then raise exception 'only open spreads can be edited'; end if;
  if p_lots is null or p_lots < 1 or p_lots > 50 then raise exception 'lots must be 1–50'; end if;
  if p_stop is not null and p_stop <= 0 or p_target is not null and p_target <= 0 then raise exception 'stop and target must be positive'; end if;
  update option_paper_trades set stop = coalesce(p_stop, stop), target = coalesce(p_target, target), lots = p_lots,
         pnl = case when mark_value is not null then round((mark_value - net_debit) * lot_size * p_lots, 2) else pnl end
   where id = p_id returning * into t;
  insert into option_signal_log (symbol, action, reason) values (t.symbol, 'edited', format('stop %s, target %s, %s lot(s)', t.stop, t.target, t.lots));
  return to_jsonb(t);
end $$;

create or replace function public.options_paper_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  if not mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  delete from option_paper_trades where id = p_id returning symbol into s;
  if s is not null then insert into option_signal_log (symbol, action, reason) values (s, 'deleted', 'removed from the record'); end if;
end $$;

-- p_what: 'closed' = closed spreads only; 'all' = every spread and the activity log.
create or replace function public.options_paper_clear(p_what text) returns int
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if not mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  -- 'where true': requests from the site run with Supabase's safeupdate guard, which refuses a DELETE with no WHERE.
  if p_what = 'closed' then delete from option_paper_trades where status = 'CLOSED'; get diagnostics k = row_count;
  elsif p_what = 'all' then delete from option_paper_trades where true; get diagnostics k = row_count; delete from option_signal_log where true;
  else raise exception 'p_what must be closed or all'; end if;
  insert into option_signal_log (action, reason) values ('note', case when p_what = 'all' then 'cleared everything' else 'cleared closed spreads' end);
  return k;
end $$;

revoke execute on function public.options_paper_settings_set(int, numeric, int, boolean), public.options_paper_edit(bigint, numeric, numeric, int),
  public.options_paper_delete(bigint), public.options_paper_clear(text) from anon, public;
grant execute on function public.options_paper_settings_set(int, numeric, int, boolean), public.options_paper_edit(bigint, numeric, numeric, int),
  public.options_paper_delete(bigint), public.options_paper_clear(text) to authenticated;
