-- Top signals for the Home page: the best few of stock_signals that can still be traded right now.
-- Tradable (same idea as the Signals page's entry zone): live price between stop and target 1, not more
-- than 0.5R past entry, at least 1.2R left to target 1 from here, market cap >= 1,000 Cr, stop <= 6%.
-- Quality = strategy score + volume, entry-zone, reward-left, market-direction, stop-size and size bonuses,
-- minus a penalty for chasing (RSI > 75 on buys, < 25 on sells). Only picks at or above the cut-off (120) show,
-- so on a weak day Home says there's nothing strong rather than padding the list.
create or replace function public.stock_signals_top(p_limit int default 3, p_min_quality int default 120)
returns jsonb language sql stable security definer set search_path = public as $$
  with nifty as (select coalesce(max(change_percent), 0) as c from index_quotes where symbol = '^NSEI'),
  base as (
    select s.*, coalesce(s.name, st.company_name, s.symbol) as nm, q.price as ltp, q.change_percent as chg,
           q.market_cap as mcap, q.updated_at as quote_at, case when s.side = 'BUY' then 1 else -1 end as dir
      from stock_signals s
      join stock_quotes q on q.symbol = s.symbol
      left join stocks st on st.symbol = s.symbol
     where q.price > 0 and s.risk_per_share > 0
  ),
  m as (
    select b.*, b.dir * (b.ltp - b.entry) / b.risk_per_share as fav,
           b.dir * (b.target1 - b.ltp) / nullif(b.dir * (b.ltp - b.stop), 0) as rr_now
      from base b
  ),
  f as (
    select m.*, (select c from nifty) as nchg from m
     where m.dir * (m.ltp - m.stop) > 0 and m.dir * (m.target1 - m.ltp) > 0
       and m.fav <= 0.5 and m.rr_now >= 1.2 and coalesce(m.mcap, 0) >= 1e10 and coalesce(m.risk_pct, 99) <= 6
  ),
  q as (
    select f.*,
      f.score
      + case when f.vol_ratio >= 2 then 10 when f.vol_ratio >= 1.5 then 5 else 0 end
      + case when abs(f.fav) <= 0.25 then 10 when f.fav < -0.25 then 5 else 0 end
      + case when f.rr_now >= 2 then 10 when f.rr_now >= 1.45 then 5 else 0 end
      + case when f.dir * f.nchg >= 0 then 5 else -5 end
      + case when f.risk_pct <= 3 then 5 else 0 end
      + case when f.mcap >= 2e11 then 5 when f.mcap >= 5e10 then 3 else 0 end
      - case when (f.dir = 1 and f.rsi > 75) or (f.dir = -1 and f.rsi < 25) then 10 else 0 end as quality,
      array_remove(array[
        case when abs(f.fav) <= 0.25 then 'In entry zone' when f.fav < -0.25 then 'Below entry: better price' end,
        case when f.vol_ratio >= 1.5 then 'Volume ' || to_char(f.vol_ratio, 'FM990.0') || '× average' end,
        case when f.rr_now >= 1.45 then to_char(f.rr_now, 'FM990.0') || 'R reward left to target 1' end,
        case when f.dir * f.nchg >= 0 then (case when f.dir = 1 then 'Market is up today' else 'Market is down today' end) end,
        case when f.risk_pct <= 3 then 'Tight stop (' || to_char(f.risk_pct, 'FM990.0') || '%)' end,
        case when f.mcap >= 2e11 then 'Large cap' end
      ], null) as strengths
    from f
  )
  select jsonb_build_object(
    'generated_at', (select max(generated_at) from stock_signals),
    'total', (select count(*) from stock_signals),
    'tradable', (select count(*) from q),
    'min_quality', p_min_quality,
    'picks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'symbol', symbol, 'name', nm, 'tf', tf, 'side', side, 'setup', setup, 'score', score, 'quality', quality,
        'ltp', ltp, 'change_percent', round(chg::numeric, 2), 'entry', entry, 'stop', stop, 'target1', target1, 'target2', target2,
        'risk_pct', round(risk_pct::numeric, 2), 'rr_now', round(rr_now::numeric, 2), 'vol_ratio', round(vol_ratio::numeric, 2),
        'rsi', round(rsi::numeric, 0), 'strengths', strengths, 'reasons', reasons, 'quote_at', quote_at
      ) order by quality desc, score desc)
      from (select * from q where quality >= p_min_quality order by quality desc, score desc limit greatest(1, least(p_limit, 6))) t
    ), '[]'::jsonb)
  )
$$;
grant execute on function public.stock_signals_top(int, int) to anon, authenticated;
