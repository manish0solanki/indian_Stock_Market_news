-- Daily bars for the Stock Analysis "All signals" list (stock-analysis.html): the ~220 stocks the
-- signals scanner keeps in stock_swing_cache (Nifty 50 and other liquid NSE stocks), with names and
-- sectors. The page runs the same verdict rules as the single-stock analysis on each.
-- bars: [[date, open, high, low, close, volume], ...] oldest first, prices rounded to 2 decimals.
create or replace function public.analysis_scan_bars() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('updated_at', max(c.updated_at), 'stocks', coalesce(jsonb_agg(jsonb_build_object(
    'symbol', c.symbol, 'name', coalesce(s.company_name, c.symbol), 'sector', mp_broad_sector(s.sector),
    'mcap_cr', case when q.market_cap > 0 then round(q.market_cap / 1e7) end,
    'bars', (select jsonb_agg(jsonb_build_array(b->>0, round((b->>1)::numeric, 2), round((b->>2)::numeric, 2),
                                                round((b->>3)::numeric, 2), round((b->>4)::numeric, 2), (b->>5)::bigint) order by ord)
             from jsonb_array_elements(c.bars) with ordinality x(b, ord))
  ) order by c.symbol), '[]'::jsonb))
  from stock_swing_cache c
  left join stocks s on s.symbol = c.symbol
  left join stock_quotes q on q.symbol = c.symbol;
$$;
grant execute on function public.analysis_scan_bars() to anon, authenticated;
