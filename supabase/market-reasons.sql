-- Market reasons: the "why" behind the move, from the news, for India, the US, Europe and Asia.
--   market_reasons    one row per region, written by the market-reasons Edge Function (hourly):
--                     themes  [{k, label, n, heads:[{title,source,url,at}], stocks:[{s,n,c}], avg}]  headlines grouped by
--                             what they are about (AI & chips, elections, rates, tariffs, earnings, oil, China, war ...)
--                             with the moves of the stocks behind that theme;
--                     reasons [{title, detail, sources:[{title,source,url}]}]  a short list written by the AI from those
--                             headlines and numbers only (numbers it can't match to the data are dropped), or null;
--                     movers  [{s,n,c,theme}]  bellwether stocks of the region and their latest session move;
--                     writer  'moonshot:<model>' or 'themes' (no AI text).
--   market_reasons()  public read: {region: row} for market-why.js.
create table if not exists public.market_reasons (
  region text primary key, themes jsonb, reasons jsonb, movers jsonb, writer text, heads_hash text,
  updated_at timestamptz not null default now()
);
alter table public.market_reasons enable row level security;
revoke all on public.market_reasons from anon, authenticated;

create or replace function public.market_reasons() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(region, jsonb_build_object('themes', themes, 'reasons', reasons, 'movers', movers,
           'writer', writer, 'updated_at', updated_at)), '{}'::jsonb)
    from market_reasons where updated_at > now() - interval '2 days';
$$;
revoke all on function public.market_reasons() from public;
grant execute on function public.market_reasons() to anon, authenticated;

-- hourly on weekdays, every 4 hours at weekends (the function skips the AI when the headlines haven't changed)
select cron.unschedule('market-reasons') where exists (select 1 from cron.job where jobname = 'market-reasons');
select cron.schedule('market-reasons', '7 * * * 1-5', $c$
  select net.http_post(url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/market-reasons',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where name = 'crypto_cron')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$c$);
select cron.unschedule('market-reasons-weekend') where exists (select 1 from cron.job where jobname = 'market-reasons-weekend');
select cron.schedule('market-reasons-weekend', '7 */4 * * 0,6', $c$
  select net.http_post(url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/market-reasons',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where name = 'crypto_cron')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$c$);
