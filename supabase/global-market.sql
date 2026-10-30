-- Data for the Global Market page (index.html#global, global-market.js): every global and "world"
-- quote written by the index-refresh function, with the exchange's last trade time and a 5-day trend.
create or replace function public.global_market() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'updated_at', (select max(updated_at) from index_quotes where grp in ('global', 'world')),
    'quotes', coalesce(jsonb_agg(jsonb_build_object(
      'grp', grp, 'symbol', symbol, 'name', display_name, 'price', price, 'previous_close', previous_close,
      'change', round(change::numeric, 4), 'change_percent', round(change_percent::numeric, 2),
      'market_time', market_time, 'spark', spark
    ) order by grp, sort_order), '[]'::jsonb))
  from index_quotes where grp in ('global', 'world') and price is not null;
$$;
grant execute on function public.global_market() to anon, authenticated;

-- Global and world prices every 30 seconds (Yahoo batch quotes; see index-refresh ?fast=1).
-- The per-minute index-refresh job keeps Indian indices, and every 5 minutes adds last trade times.
select cron.schedule('index-refresh-global-30s', '30 seconds', $$select net.http_post(
    url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/index-refresh?fast=1',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where name='crypto_cron')),
    body := '{}'::jsonb, timeout_milliseconds := 25000)$$);
