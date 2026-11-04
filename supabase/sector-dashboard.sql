-- Sectors page (index.html#sectors, sectors-page.js).
--   sector_index_history   daily closes of the 20 NSE sector indices and the Nifty 50 (sector-history Edge Function,
--                          pg_cron 'sector-history' weekdays 4:20 PM IST; 2 years back where Yahoo has it)
--   sector_index_groups    which broad stock group (mp_broad_sector) each index stands for
--   sector_dashboard()     everything the page shows, in one call:
--       indices: today / 1W / 1M / 3M / 6M / 1Y returns (live price vs past closes), vs Nifty, above 50/200-day
--                average, distance from the 52-week high, a 3-month sparkline, relative strength and momentum vs the
--                Nifty and the rotation phase (Leading / Weakening / Lagging / Improving) with a 4-week trail
--       groups:  for each broad group of stocks: breadth today, % above 50/200-day averages, near 52-week highs/lows,
--                median P/E, market cap, volume vs average, biggest gainers and losers
--       market:  breadth across all stocks and the Nifty
--   sector_group_stocks()  the stocks of one group, largest first
-- Stocks count only with a trade in the last 10 days and a move within NSE's 20% band (stale or suspended quotes
-- such as a months-old price against a new previous close otherwise show moves like +1900%). Groups come from
-- mp_stock_group() (industry, else a guess from the company name).

create table if not exists public.sector_index_history (symbol text not null, d date not null, close numeric not null, primary key (symbol, d));
alter table public.sector_index_history enable row level security;
revoke all on public.sector_index_history from anon, authenticated;
create table if not exists public.sector_index_groups (symbol text primary key, grp text);
alter table public.sector_index_groups enable row level security;
revoke all on public.sector_index_groups from anon, authenticated;

create or replace function public.sector_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  nifty_px numeric; nifty_ch numeric; out_idx jsonb := '[]'::jsonb; r record;
  c numeric[]; ratio numeric[]; rs numeric[]; n int; px numeric; k int; w int := 63;
  rsv numeric; momv numeric; trail jsonb; phase text; sma50 numeric; sma200 numeric; hi numeric; spark jsonb;
  ret jsonb; hist_n int;
begin
  -- Nifty: live price from the index snapshot, else the last close
  select price, change_percent into nifty_px, nifty_ch from index_quotes where symbol = '^NSEI' and grp = 'snapshot' order by updated_at desc limit 1;
  if nifty_px is null then select close into nifty_px from sector_index_history where symbol = '^NSEI' order by d desc limit 1; end if;

  for r in select q.symbol, coalesce(q.display_name, q.name) as name, q.price, q.change_percent, q.updated_at, g.grp, q.sort_order
             from sector_index_quotes q left join sector_index_groups g using (symbol) where q.price > 0 order by q.sort_order nulls last, q.symbol loop
    -- closes before today, oldest first, plus today's live price
    select array_agg(close order by d), count(*) into c, hist_n from (select d, close from sector_index_history where symbol = r.symbol and d < today order by d desc limit 260) x;
    c := coalesce(c, '{}') || r.price; n := array_length(c, 1); px := r.price;
    ret := jsonb_build_object('d1', r.change_percent,
      'w1', case when n > 5 then round((px / c[n - 5] - 1) * 100, 2) end,
      'm1', case when n > 21 then round((px / c[n - 21] - 1) * 100, 2) end,
      'm3', case when n > 63 then round((px / c[n - 63] - 1) * 100, 2) end,
      'm6', case when n > 126 then round((px / c[n - 126] - 1) * 100, 2) end,
      'y1', case when n > 248 then round((px / c[n - 248] - 1) * 100, 2) end);
    sma50 := case when n >= 50 then (select avg(v) from unnest(c[n - 49:n]) v) end;
    sma200 := case when n >= 200 then (select avg(v) from unnest(c[n - 199:n]) v) end;
    hi := case when n >= 120 then (select max(v) from unnest(c[greatest(1, n - 249):n]) v) end;
    spark := case when n >= 20 then to_jsonb(c[greatest(1, n - 63):n]) end;

    -- relative strength vs the Nifty: ratio over its own 63-day average (x), and its 10-day change (y)
    rsv := null; momv := null; trail := null; phase := null;
    select array_agg(i.close / nn.close order by i.d) into ratio
      from (select d, close from sector_index_history where symbol = r.symbol and d < today order by d desc limit 110) i
      join sector_index_history nn on nn.symbol = '^NSEI' and nn.d = i.d;
    if ratio is not null and array_length(ratio, 1) >= w + 30 and nifty_px > 0 then
      ratio := ratio || (px / nifty_px);
      k := array_length(ratio, 1);
      rs := array[]::numeric[];
      for i in w .. k loop rs := rs || (100 * (ratio[i] / (select avg(v) from unnest(ratio[i - w + 1:i]) v) - 1)); end loop;
      -- rs[j] is the strength on day (w - 1 + j); latest is rs[array_length]
      k := array_length(rs, 1);
      rsv := round(rs[k], 2); momv := round(rs[k] - rs[k - 10], 2);
      trail := (select jsonb_agg(jsonb_build_array(round(rs[k - o], 2), round(rs[k - o] - rs[k - o - 10], 2)) order by o desc)
                  from unnest(array[20, 15, 10, 5, 0]) o where k - o - 10 >= 1);
      phase := case when rsv >= 0 and momv >= 0 then 'Leading' when rsv >= 0 then 'Weakening' when momv < 0 then 'Lagging' else 'Improving' end;
    end if;

    out_idx := out_idx || jsonb_build_object('symbol', r.symbol, 'name', r.name, 'group', r.grp, 'price', px, 'ret', ret,
      'vs_nifty_m3', case when n > 63 and (select count(*) from sector_index_history where symbol = '^NSEI' and d < today) > 63 then
                       round(((px / c[n - 63]) / (nifty_px / (select close from sector_index_history where symbol = '^NSEI' and d < today order by d desc offset 62 limit 1)) - 1) * 100, 2) end,
      'above50', case when sma50 is not null then px > sma50 end, 'above200', case when sma200 is not null then px > sma200 end,
      'from_high', case when hi > 0 then round((px / greatest(hi, px) - 1) * 100, 2) end,
      'spark', spark, 'rs', rsv, 'mom', momv, 'trail', trail, 'phase', phase, 'history_days', coalesce(hist_n, 0), 'updated_at', r.updated_at);
  end loop;

  return jsonb_build_object(
    'as_of', now(), 'updated_at', (select max(updated_at) from sector_index_quotes),
    'nifty', jsonb_build_object('price', nifty_px, 'd1', nifty_ch,
       'w1', (select round((nifty_px / close - 1) * 100, 2) from sector_index_history where symbol = '^NSEI' and d < today order by d desc offset 4 limit 1),
       'm1', (select round((nifty_px / close - 1) * 100, 2) from sector_index_history where symbol = '^NSEI' and d < today order by d desc offset 20 limit 1),
       'm3', (select round((nifty_px / close - 1) * 100, 2) from sector_index_history where symbol = '^NSEI' and d < today order by d desc offset 62 limit 1),
       'm6', (select round((nifty_px / close - 1) * 100, 2) from sector_index_history where symbol = '^NSEI' and d < today order by d desc offset 125 limit 1),
       'y1', (select round((nifty_px / close - 1) * 100, 2) from sector_index_history where symbol = '^NSEI' and d < today order by d desc offset 247 limit 1),
       'spark', (select to_jsonb(array_agg(close order by d)) || to_jsonb(nifty_px) from (select d, close from sector_index_history where symbol = '^NSEI' and d < today order by d desc limit 63) z)),
    'indices', out_idx,
    'market', (select jsonb_build_object('stocks', count(*), 'up', count(*) filter (where q.change_percent > 0), 'down', count(*) filter (where q.change_percent < 0),
        'above50', round(100.0 * count(*) filter (where q.price > q.fifty_day_avg) / nullif(count(*) filter (where q.fifty_day_avg > 0), 0), 1),
        'above200', round(100.0 * count(*) filter (where q.price > q.two_hundred_day_avg) / nullif(count(*) filter (where q.two_hundred_day_avg > 0), 0), 1),
        'near_high', count(*) filter (where q.high_52w > 0 and q.price >= 0.97 * q.high_52w), 'near_low', count(*) filter (where q.low_52w > 0 and q.price <= 1.03 * q.low_52w))
      from stock_quotes q where q.price > 0 and q.quote_time > now() - interval '10 days' and abs(coalesce(q.change_percent, 0)) <= 20),
    'groups', (select coalesce(jsonb_agg(x order by x.mcap desc nulls last), '[]'::jsonb) from (
      select b.grp, count(*) as stocks,
             count(*) filter (where b.change_percent > 0) as up, count(*) filter (where b.change_percent < 0) as down,
             round(avg(b.change_percent)::numeric, 2) as avg_chg,
             round((sum(b.change_percent * b.market_cap) filter (where b.market_cap > 0) / nullif(sum(b.market_cap) filter (where b.market_cap > 0 and b.change_percent is not null), 0))::numeric, 2) as wtd_chg,
             round(100.0 * count(*) filter (where b.price > b.fifty_day_avg) / nullif(count(*) filter (where b.fifty_day_avg > 0), 0), 1) as above50,
             round(100.0 * count(*) filter (where b.price > b.two_hundred_day_avg) / nullif(count(*) filter (where b.two_hundred_day_avg > 0), 0), 1) as above200,
             count(*) filter (where b.high_52w > 0 and b.price >= 0.97 * b.high_52w) as near_high,
             count(*) filter (where b.low_52w > 0 and b.price <= 1.03 * b.low_52w) as near_low,
             round((percentile_cont(0.5) within group (order by b.pe) filter (where b.pe > 0 and b.pe < 300))::numeric, 1) as median_pe,
             round(sum(b.market_cap) / 1e7) as mcap,
             round((sum(b.volume) filter (where b.avg_volume_3m > 0) / nullif(sum(b.avg_volume_3m) filter (where b.avg_volume_3m > 0), 0))::numeric, 2) as rel_vol,
             jsonb_agg(jsonb_build_object('s', b.symbol, 'c', round(b.change_percent::numeric, 2)) order by b.change_percent desc) filter (where b.big and b.r_up <= 3) as best,
             jsonb_agg(jsonb_build_object('s', b.symbol, 'c', round(b.change_percent::numeric, 2)) order by b.change_percent) filter (where b.big and b.r_dn <= 3) as worst
        from (select mp_stock_group(s.sector, s.company_name) as grp, s.pe, q.symbol, q.price, q.change_percent, q.market_cap, q.fifty_day_avg, q.two_hundred_day_avg,
                     q.high_52w, q.low_52w, q.volume, q.avg_volume_3m,
                     (q.market_cap > 5e9 and q.change_percent is not null) as big,
                     row_number() over (partition by mp_stock_group(s.sector, s.company_name), (q.market_cap > 5e9 and q.change_percent is not null) order by q.change_percent desc nulls last) as r_up,
                     row_number() over (partition by mp_stock_group(s.sector, s.company_name), (q.market_cap > 5e9 and q.change_percent is not null) order by q.change_percent asc nulls last) as r_dn
                from stocks s join stock_quotes q using (symbol)
               where q.price > 0 and q.quote_time > now() - interval '10 days' and abs(coalesce(q.change_percent, 0)) <= 20) b
       group by b.grp) x));
end $$;
grant execute on function public.sector_dashboard() to anon, authenticated;

-- The stocks of one broad group, largest first.
create or replace function public.sector_group_stocks(p_group text, p_limit int default 60) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.mcap desc nulls last), '[]'::jsonb) from (
    select s.symbol, s.company_name as name, s.sector as industry, q.price, round(q.change_percent::numeric, 2) as chg,
           round(q.market_cap / 1e7) as mcap, s.pe, s.roe,
           case when q.fifty_day_avg > 0 then q.price > q.fifty_day_avg end as above50,
           case when q.two_hundred_day_avg > 0 then q.price > q.two_hundred_day_avg end as above200,
           case when q.high_52w > 0 then round((q.price / greatest(q.high_52w, q.price) - 1) * 100, 1) end as from_high,
           case when q.avg_volume_3m > 0 then round(q.volume::numeric / q.avg_volume_3m, 2) end as rel_vol
      from stocks s join stock_quotes q using (symbol)
     where mp_stock_group(s.sector, s.company_name) = p_group and q.price > 0 and q.quote_time > now() - interval '10 days' and abs(coalesce(q.change_percent, 0)) <= 20
     order by q.market_cap desc nulls last limit greatest(1, least(p_limit, 200))) x
$$;
grant execute on function public.sector_group_stocks(text, int) to anon, authenticated;
