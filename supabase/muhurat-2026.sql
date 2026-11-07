-- Muhurat trading 2026 (Sunday 8 Nov, Diwali, start of Samvat 2083): data for the Home card (muhurat.js).
--   festival_stats       key -> numbers for festival cards; 'muhurat-2026' is built by the muhurat-stats function
--                        (Nifty in past Muhurat sessions and the year after each; Samvat 2082 stocks and sectors).
--   festival_stats(key)  public read.
--   Sunday-only jobs (they check the date, so they do nothing on any other 8 Nov):
--     muhurat-quotes   stock prices every 3 minutes during the session (sector-refresh skips weekends unless forced)
--     muhurat-after    after the close: India "why" reasons (market-reasons, force) and the stats with 2026's move
create table if not exists public.festival_stats (key text primary key, data jsonb not null, updated_at timestamptz not null default now());
alter table public.festival_stats enable row level security;
revoke all on public.festival_stats from anon, authenticated;

create or replace function public.festival_stats(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select data || jsonb_build_object('updated_at', updated_at) from festival_stats where key = p_key), '{}'::jsonb)
$$;
revoke all on function public.festival_stats(text) from public;
grant execute on function public.festival_stats(text) to anon, authenticated;

select cron.unschedule(j) from (values ('muhurat-quotes'), ('muhurat-after')) v(j) where exists (select 1 from cron.job where jobname = j);
-- 08:33-10:15 UTC = 2:03-3:45 PM IST on 8 Nov 2026
select cron.schedule('muhurat-quotes', '*/3 8-10 8 11 *', $c$
  select net.http_post(url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/sector-refresh?force=1',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where name = 'crypto_cron')),
    body := '{}'::jsonb, timeout_milliseconds := 150000)
  where now() between timestamptz '2026-11-08 08:33+00' and timestamptz '2026-11-08 10:16+00';
$c$);
-- 3:42 and 4:15 PM IST: the India reasons after the close, and the Muhurat stats with today's session
select cron.schedule('muhurat-after', '12,45 10 8 11 *', $c$
  select net.http_post(url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/market-reasons?force=1&region=india',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where name = 'crypto_cron')),
    body := '{}'::jsonb, timeout_milliseconds := 150000)
  where now()::date = date '2026-11-08';
  select net.http_post(url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/muhurat-stats',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where name = 'crypto_cron')),
    body := '{}'::jsonb, timeout_milliseconds := 150000)
  where now()::date = date '2026-11-08';
$c$);
