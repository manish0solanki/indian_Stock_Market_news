-- Expiry-day reversal (₹10 options): platform admin only, paper only (until SEBI RA registration).
-- The expiry-reversal Edge Function watches the index whose options expire today (Nifty weekly on Tuesdays, Bank
-- Nifty on its monthly expiry, Sensex on Thursdays) from 12:00 to 2:00 PM IST. When the index has sold off (or rallied)
-- at least 0.6% from the day's high (low), made that low (high) within the last hour, has won back 20% of the move
-- and closed three 5-minute bars in a row in the new direction, it buys the out-of-the-money call (put) priced
-- ₹4–12 that is closest to the index, sized to the budget (₹1,000). One trade a day, across all three.
-- Exits: 3x the entry premium (target), half the premium or the index back through the day's low / high (stop),
-- or 3:00 PM. Nifty / Bank Nifty use NSE's live option chain (buy at the ask, sell at the bid); BSE blocks automated
-- requests, so Sensex signals carry a Black-Scholes estimate and are marked "estimate" (signal only, no paper fill).
--   expiry_trades     the day's trade (or signal), its plan, live mark and exit
--   expiry_watch      what each index looks like now (for the desk), one row per index
--   expiry_settings   auto paper trade on/off, budget, premium range
--   expiry_desk()     everything the desk shows (admin only)
create table if not exists public.expiry_trades (
  id bigserial primary key,
  day date not null unique,                  -- one trade a day
  idx text not null,                         -- NIFTY | BANKNIFTY | SENSEX
  side text not null,                        -- CE (after a selloff turns up) | PE (after a rally turns down)
  expiry date not null,
  strike numeric not null,
  lot_size int not null, lots int not null, qty int not null,
  entry numeric not null, stop numeric not null, target numeric not null,
  spot_entry numeric, pivot numeric, day_high numeric, day_low numeric, move_pct numeric,
  estimate boolean not null default false,   -- premium from a model (Sensex), not a live quote
  status text not null default 'OPEN',       -- OPEN | CLOSED | SIGNAL (shown, not paper traded)
  reasons jsonb,
  mark numeric, mark_spot numeric, marked_at timestamptz,
  exit numeric, exit_spot numeric, exit_reason text, closed_at timestamptz,
  pnl numeric,                               -- rupees for the whole position (marked while open)
  created_at timestamptz not null default now()
);
alter table public.expiry_trades enable row level security;
revoke all on public.expiry_trades from anon, authenticated;

create table if not exists public.expiry_watch (
  idx text primary key, day date, data jsonb, updated_at timestamptz not null default now()
);
alter table public.expiry_watch enable row level security;
revoke all on public.expiry_watch from anon, authenticated;

create table if not exists public.expiry_settings (
  id int primary key default 1 check (id = 1),
  auto_paper boolean not null default true,
  budget numeric not null default 1000,
  min_prem numeric not null default 4,
  max_prem numeric not null default 12,
  updated_at timestamptz not null default now()
);
insert into public.expiry_settings (id) values (1) on conflict do nothing;
alter table public.expiry_settings enable row level security;
revoke all on public.expiry_settings from anon, authenticated;

create or replace function public.expiry_desk()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(mp_is_platform_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'now', now(),
    'settings', (select to_jsonb(s) from expiry_settings s where id = 1),
    'today', (select to_jsonb(t) from expiry_trades t where day = (now() at time zone 'Asia/Kolkata')::date),
    'watch', coalesce((select jsonb_agg(to_jsonb(w) order by w.idx) from expiry_watch w where w.day = (now() at time zone 'Asia/Kolkata')::date), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(to_jsonb(t) order by t.day desc) from (select * from expiry_trades order by day desc limit 60) t), '[]'::jsonb),
    'stats', (select jsonb_build_object(
        'n', count(*) filter (where status = 'CLOSED'),
        'wins', count(*) filter (where status = 'CLOSED' and pnl > 0),
        'pnl', coalesce(sum(pnl) filter (where status = 'CLOSED'), 0),
        'best', max(pnl) filter (where status = 'CLOSED'), 'worst', min(pnl) filter (where status = 'CLOSED'),
        'signals', count(*)) from expiry_trades where not estimate));
end $$;
revoke all on function public.expiry_desk() from public, anon;
grant execute on function public.expiry_desk() to authenticated;

create or replace function public.expiry_settings_save(p_auto boolean, p_budget numeric, p_min numeric, p_max numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(mp_is_platform_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  update expiry_settings set auto_paper = coalesce(p_auto, auto_paper),
    budget = greatest(100, least(coalesce(p_budget, budget), 100000)),
    min_prem = greatest(0.5, least(coalesce(p_min, min_prem), 50)),
    max_prem = greatest(1, least(coalesce(p_max, max_prem), 100)), updated_at = now() where id = 1;
  return (select to_jsonb(s) from expiry_settings s where id = 1);
end $$;
revoke all on function public.expiry_settings_save(boolean, numeric, numeric, numeric) from public, anon;
grant execute on function public.expiry_settings_save(boolean, numeric, numeric, numeric) to authenticated;

-- Allow the new alert kind for the admin's bell.
alter table public.user_alerts drop constraint if exists user_alerts_kind_check;
alter table public.user_alerts add constraint user_alerts_kind_check check (kind in ('price', 'move', 'results', 'dividend', 'signal', 'paper', 'option'));

-- Applied 18 Nov 2026 (migration expiry_reversal); cron scheduled:
-- select cron.schedule('expiry-reversal', '* 6-9 * * 1-5', <http_post to expiry-reversal> where not public.mp_is_market_holiday());
--   every minute 11:30 AM – 3:29 PM IST on trading days; the function itself does nothing unless an index expires today.
