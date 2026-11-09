-- Today's best trades (Signals page, admin only): the active scanner signals ranked for "which 3 should I take today".
--   signal_best_trades(tf, include_sell, limit)  candidates, best first. Same tradable filters and quality score as
--   stock_signals_top() (price still between stop and target 1, at most 0.5R past entry, at least 1.2R left to
--   target 1, market cap >= Rs 1,000 Cr, stop <= 6%), plus what the signal scorecard records for each signal
--   (signal_log.ctx): a BUY whose stock news is negative (or a SELL with positive news) is left out, and a trade
--   against the Nifty's trend loses 10 points (the clearest early pattern in the scorecard). The browser then keeps
--   one pick per sector group and sizes each trade from the amount entered.
--   Platform admin only (mp_is_platform_admin()); paper / personal use until SEBI RA registration.
create or replace function public.signal_best_trades(p_tf text default 'swing', p_include_sell boolean default false, p_limit int default 12)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not coalesce(mp_is_platform_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  with nifty as (select coalesce(max(change_percent), 0) as c from index_quotes where symbol = '^NSEI'),
  base as (
    select l.*, coalesce(l.name, st.company_name, l.symbol) as nm, q.price as ltp, q.change_percent as chg,
           q.market_cap as mcap, case when l.side = 'BUY' then 1 else -1 end as dir, coalesce(l.ctx, '{}'::jsonb) as x
      from signal_log l
      join stock_quotes q on q.symbol = l.symbol
      left join stocks st on st.symbol = l.symbol
     where l.status = 'active' and l.tf = p_tf and (p_include_sell or l.side = 'BUY')
       and q.price > 0 and l.risk_per_share > 0),
  m as (
    select b.*, b.dir * (b.ltp - b.entry) / b.risk_per_share as fav,
           b.dir * (b.target1 - b.ltp) / nullif(b.dir * (b.ltp - b.stop), 0) as rr_now,
           (b.x->>'news_score')::numeric * b.dir as news_al,
           case when b.x->>'nifty_trend' is null then 0 when (b.x->>'nifty_trend' = 'up') = (b.dir = 1) then 1 else -1 end as trend_al
      from base b),
  f as (
    select m.*, (select c from nifty) as nchg from m
     where m.dir * (m.ltp - m.stop) > 0 and m.dir * (m.target1 - m.ltp) > 0
       and m.fav <= 0.5 and m.rr_now >= 1.2 and coalesce(m.mcap, 0) >= 1e10 and coalesce(m.risk_pct, 99) <= 6
       and coalesce(m.news_al, 0) > -15),
  q as (
    select f.*,
      f.score
      + case when f.vol_ratio >= 2 then 10 when f.vol_ratio >= 1.5 then 5 else 0 end
      + case when abs(f.fav) <= 0.25 then 10 when f.fav < -0.25 then 5 else 0 end
      + case when f.rr_now >= 2 then 10 when f.rr_now >= 1.45 then 5 else 0 end
      + case when f.dir * f.nchg >= 0 then 5 else -5 end
      + case when f.risk_pct <= 3 then 5 else 0 end
      + case when f.mcap >= 2e11 then 5 when f.mcap >= 5e10 then 3 else 0 end
      - case when (f.dir = 1 and f.rsi > 75) or (f.dir = -1 and f.rsi < 25) then 10 else 0 end
      + case when f.trend_al = 1 then 0 when f.trend_al = -1 then -10 else 0 end
      + case when f.news_al >= 15 then 5 else 0 end as quality,
      array_remove(array[
        case when abs(f.fav) <= 0.25 then 'In entry zone' when f.fav < -0.25 then 'Below entry: better price' end,
        case when f.vol_ratio >= 1.5 then 'Volume ' || to_char(f.vol_ratio, 'FM990.0') || '× average' end,
        case when f.rr_now >= 1.45 then to_char(f.rr_now, 'FM990.0') || 'R reward left to target 1' end,
        case when f.trend_al = 1 then 'With the Nifty trend' when f.trend_al = -1 then 'Against the Nifty trend' end,
        case when f.news_al >= 15 then 'News backs it' end,
        case when f.risk_pct <= 3 then 'Tight stop (' || to_char(f.risk_pct, 'FM990.0') || '%)' end,
        case when f.mcap >= 2e11 then 'Large cap' end
      ], null) as strengths
    from f)
  select jsonb_build_object(
    'server_now', now(), 'tf', p_tf,
    'active', (select count(*) from signal_log where status = 'active' and tf = p_tf),
    'tradable', (select count(*) from q),
    'picks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'symbol', symbol, 'name', nm, 'side', side, 'tf', tf, 'setup', setup, 'score', score, 'quality', quality,
        'ltp', ltp, 'change_percent', round(chg::numeric, 2), 'entry', entry, 'stop', stop, 'target1', target1, 'target2', target2,
        'risk_pct', round(risk_pct::numeric, 2), 'rr_now', round(rr_now::numeric, 2), 'issued_at', issued_at, 'expires_at', expires_at,
        'grp', x->>'grp', 'sector', x->>'sector', 'nifty_trend', x->>'nifty_trend', 'news_score', x->'news_score', 'strengths', strengths
      ) order by quality desc, score desc)
      from (select * from q order by quality desc, score desc limit greatest(1, least(p_limit, 30))) t), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.signal_best_trades(text, boolean, int) from public, anon;
grant execute on function public.signal_best_trades(text, boolean, int) to authenticated;
