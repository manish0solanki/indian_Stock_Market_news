-- Market calendar: NSE trading holidays and special sessions, so the site and its jobs know when the market is shut.
--   market_holidays        (d, name, source)  'nse' rows come from NSE's holiday list via the market-holidays Edge
--                          Function (weekly cron); 'manual' rows are added by hand. Weekends are not stored.
--   market_special_sessions (d, starts, ends, name)  e.g. the Diwali Muhurat session, added by hand from NSE's circular.
--   mp_is_market_holiday(d)  weekday exchange holiday (default: today in IST). Market-hours cron jobs skip these days.
--   market_calendar()        public: holidays and special sessions from 30 days back to the end of next year, for pages.
create table if not exists public.market_holidays (d date primary key, name text);
alter table public.market_holidays add column if not exists source text not null default 'manual';
alter table public.market_holidays enable row level security;
revoke all on public.market_holidays from anon, authenticated;

create table if not exists public.market_special_sessions (
  d date primary key, starts time not null, ends time not null, name text not null
);
alter table public.market_special_sessions enable row level security;
revoke all on public.market_special_sessions from anon, authenticated;
insert into public.market_special_sessions (d, starts, ends, name)
values ('2026-11-08', '14:05', '15:40', 'Muhurat trading') on conflict (d) do nothing;

create or replace function public.mp_is_market_holiday(p_d date default (now() at time zone 'Asia/Kolkata')::date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from market_holidays where d = p_d)
$$;
revoke all on function public.mp_is_market_holiday(date) from public, anon, authenticated;

create or replace function public.market_calendar()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'name', name) order by d) from market_holidays
                 where d between (now() at time zone 'Asia/Kolkata')::date - 30 and make_date(extract(year from now())::int + 1, 12, 31)), '[]'::jsonb),
    'special', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'from', to_char(starts, 'HH24:MI'), 'to', to_char(ends, 'HH24:MI'), 'name', name) order by d)
                 from market_special_sessions where d >= (now() at time zone 'Asia/Kolkata')::date - 30), '[]'::jsonb))
$$;
revoke all on function public.market_calendar() from public;
grant execute on function public.market_calendar() to anon, authenticated;

-- Weekly refresh from NSE (Mondays 01:37 UTC), and market-hours jobs skip holidays:
-- select cron.schedule('market-holidays', '37 1 * * 1', $$select net.http_post(
--   url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/market-holidays',
--   headers := jsonb_build_object('x-cron-secret', (select value from public.app_secrets where name = 'crypto_cron'), 'Content-Type', 'application/json'),
--   body := '{}'::jsonb, timeout_milliseconds := 60000)$$);
-- Jobs given "where not public.mp_is_market_holiday()" (see the cron.alter_job calls applied with this file):
--   blog-market-posts, blog-market-backup, blog-fiidii, blog-fiidii-retry, blog-fiidii-backup, live-insights,
--   options-signals, sector-history, stock-signals-refresh. premarket-brief* and premarket-snap already check market_holidays.
