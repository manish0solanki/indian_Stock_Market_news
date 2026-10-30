-- Rich quote data for the Home "My Watchlist" widget (home-watchlist.js), for any list of symbols.
-- Public market data only (the user's list itself is read under RLS by the page).
-- spark: the last 22 daily closes from stock_swing_cache (the scanner's ~220 stocks); null for others.
create or replace function public.watchlist_details(p_symbols text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'symbol', q.symbol, 'name', s.company_name, 'industry', s.sector, 'sector', mp_broad_sector(s.sector),
    'price', q.price, 'change', round(q.change::numeric, 2), 'change_percent', round(q.change_percent::numeric, 2),
    'previous_close', q.previous_close, 'open', q.open, 'high', q.high, 'low', q.low,
    'high_52w', q.high_52w, 'low_52w', q.low_52w, 'volume', q.volume, 'avg_volume_3m', q.avg_volume_3m,
    'market_cap_cr', case when q.market_cap > 0 then round(q.market_cap / 1e7) end,
    'pe', case when s.pe > 0 then round(s.pe::numeric, 1) end,
    'dma50', round(q.fifty_day_avg::numeric, 2), 'dma200', round(q.two_hundred_day_avg::numeric, 2),
    'updated_at', q.updated_at,
    'spark', (select jsonb_agg(round((b->>4)::numeric, 2) order by ord)
              from jsonb_array_elements(c.bars) with ordinality as x(b, ord)
              where ord > jsonb_array_length(c.bars) - 22)
  )), '[]'::jsonb)
  from public.stock_quotes q
  left join public.stocks s on s.symbol = q.symbol
  left join public.stock_swing_cache c on c.symbol = q.symbol
  where q.symbol = any(p_symbols[1:50]);
$$;
grant execute on function public.watchlist_details(text[]) to anon, authenticated;
