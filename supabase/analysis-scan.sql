-- Daily bars (plus today's live candle) for the Stock Analysis "All signals" list (stock-analysis.html): the ~220 stocks the
-- signals scanner keeps in stock_swing_cache (Nifty 50 and other liquid NSE stocks), with names and
-- sectors. The page runs the same verdict rules as the single-stock analysis on each.
-- bars: [[date, open, high, low, close, volume], ...] oldest first, prices rounded to 2 decimals.
create or replace function public.analysis_scan_bars() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('updated_at', max(c.updated_at), 'live_at', max(q.quote_time), 'stocks', coalesce(jsonb_agg(jsonb_build_object(
    's', c.symbol, 'n', coalesce(s.company_name, c.symbol), 'sec', mp_broad_sector(s.sector),
    'mc', case when q.market_cap > 0 then round(q.market_cap / 1e7) end,
    'd', b.d, 'h', b.h, 'l', b.l, 'c', b.c, 'v', b.v
  ) order by c.symbol), '[]'::jsonb))
  from stock_swing_cache c
  left join stocks s on s.symbol = c.symbol
  left join stock_quotes q on q.symbol = c.symbol
  -- today's candle from the live quote (dated by the last trade, so weekends add nothing), the same way the
  -- single-stock analysis includes today; a cached bar for the same day is updated with the live price.
  cross join lateral (
    select case
      when q.price > 0 and q.quote_time is not null
           and (q.quote_time at time zone 'Asia/Kolkata')::date > (c.bars->-1->>0)::date
        then c.bars || jsonb_build_array(jsonb_build_array(
               to_char((q.quote_time at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
               coalesce(nullif(q.open, 0), q.price), greatest(coalesce(q.high, q.price), q.price),
               least(coalesce(nullif(q.low, 0), q.price), q.price), q.price, coalesce(q.volume, 0)))
      when q.price > 0 and q.quote_time is not null
           and (q.quote_time at time zone 'Asia/Kolkata')::date = (c.bars->-1->>0)::date
        then jsonb_set(c.bars, array[(jsonb_array_length(c.bars) - 1)::text], jsonb_build_array(
               c.bars->-1->>0, (c.bars->-1->>1)::numeric, greatest((c.bars->-1->>2)::numeric, q.price),
               least((c.bars->-1->>3)::numeric, q.price), q.price, greatest((c.bars->-1->>5)::numeric, coalesce(q.volume, 0))))
      else c.bars end as bars
  ) lb
  cross join lateral (
    select string_agg(replace(x.b->>0, '-', ''), ',' order by x.ord) d,
           string_agg(round((x.b->>2)::numeric, 2)::text, ',' order by x.ord) h,
           string_agg(round((x.b->>3)::numeric, 2)::text, ',' order by x.ord) l,
           string_agg(round((x.b->>4)::numeric, 2)::text, ',' order by x.ord) c,
           string_agg(((x.b->>5)::numeric)::bigint::text, ',' order by x.ord) v
    from jsonb_array_elements(lb.bars) with ordinality x(b, ord)
    where x.ord > jsonb_array_length(lb.bars) - 100
  ) b;
$$;
grant execute on function public.analysis_scan_bars() to anon, authenticated;
