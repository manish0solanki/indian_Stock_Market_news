-- Pre-market brief (Home card, premarket.js), built by the premarket-brief Edge Function.
--   premarket_snap    one row per trading day, taken at 3:35 PM IST after the close: Nifty / Bank Nifty high, low, close
--                     and the GIFT Nifty price at that moment. The next morning's GIFT Nifty move is measured from it
--                     ("since our close"), and the day's levels (pivots) come from it.
--   premarket_brief   one row per day: the brief (payload jsonb) built at 7:45 and 8:50 AM IST on weekdays.
--   premarket_brief() public read: the latest brief.
create table if not exists public.premarket_snap (
  d date primary key, data jsonb not null, created_at timestamptz not null default now()
);
create table if not exists public.premarket_brief (
  d date primary key, payload jsonb not null, writer text, built_at timestamptz not null default now()
);
alter table public.premarket_snap enable row level security;
alter table public.premarket_brief enable row level security;
revoke all on public.premarket_snap from anon, authenticated;
revoke all on public.premarket_brief from anon, authenticated;

create or replace function public.premarket_brief() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select payload || jsonb_build_object('d', d, 'writer', writer, 'built_at', built_at)
                     from premarket_brief order by d desc limit 1), '{}'::jsonb)
$$;
revoke all on function public.premarket_brief() from public;
grant execute on function public.premarket_brief() to anon, authenticated;

-- 7:45 and 8:50 AM IST (02:15 / 03:20 UTC) Mon-Fri: build; 3:35 PM IST (10:05 UTC) Mon-Fri: snapshot after the close.
select cron.unschedule(j) from (values ('premarket-brief'), ('premarket-brief-2'), ('premarket-snap')) v(j) where exists (select 1 from cron.job where jobname = j);
select cron.schedule('premarket-brief', '15 2 * * 1-5', $c$
  select net.http_post(url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/premarket-brief',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where name = 'crypto_cron')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$c$);
select cron.schedule('premarket-brief-2', '20 3 * * 1-5', $c$
  select net.http_post(url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/premarket-brief',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where name = 'crypto_cron')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$c$);
select cron.schedule('premarket-snap', '5 10 * * 1-5', $c$
  select net.http_post(url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/premarket-brief?action=snap',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where name = 'crypto_cron')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$c$);
