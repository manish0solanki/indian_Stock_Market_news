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
