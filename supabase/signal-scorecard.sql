-- Signal scorecard: which conditions make the scanner's signals work better or worse.
--   signal_log.ctx        the conditions when the signal was issued, using only data from before it (no hindsight):
--                         {grp, sector, sector_index, sec_m1, nifty_trend, nifty_m1, news_pos, news_neg, news_neu,
--                          news_score, mkt_score, v}
--     sector        strong / neutral / weak / none: the stock's sector index vs its 50-day average and vs the Nifty over a
--                   month, from the closes before the issue day (same rule as the Sectors page);
--     nifty_trend   up / down: the Nifty's last close before the issue day vs its 50-day average;
--     news_*        the stock's MarketPulse news (AI impact tags) in the 7 days before the signal, scored -100..+100;
--     mkt_score     the India market news sentiment (market_reasons) at that moment; only recorded live (from Nov 2026).
--   mp_signal_context(symbol, at)  computes it; signal_context_fill() fills new signals (pg_cron, every 5 minutes)
--                                  and was run once over the signals logged before this existed.
--   signal_scorecard(tf, days)     the closed signals grouped by setup, score, time of day, sector, news, market trend
--                                  and mood (each read as with / against the signal's side), with win rate, average R
--                                  and whether a group differs from the rest by more than chance (and over how many
--                                  trading days, since same-day signals aren't independent).

alter table public.signal_log add column if not exists ctx jsonb;

-- Sector index state on a day, from closes before that day.
create or replace function public.mp_index_state_on(p_symbol text, p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  with h as (select d, close from sector_index_history where symbol = p_symbol and d < p_day order by d desc limit 50),
  n as (select d, close from sector_index_history where symbol = '^NSEI' and d < p_day order by d desc limit 50),
  x as (
    select (select close from h order by d desc limit 1) c0, (select avg(close) from h) sma50,
           (select close from h order by d desc offset 21 limit 1) c21, (select count(*) from h) k,
           (select close from n order by d desc limit 1) n0, (select avg(close) from n) nsma,
           (select close from n order by d desc offset 21 limit 1) n21)
  select case when k < 50 or c21 is null or n21 is null then null else jsonb_build_object(
      'state', case when c0 > sma50 and c0 / c21 > n0 / n21 then 'strong' when c0 < sma50 and c0 / c21 < n0 / n21 then 'weak' else 'neutral' end,
      'm1', round((c0 / c21 - 1) * 100, 2), 'nifty_m1', round((n0 / n21 - 1) * 100, 2),
      'nifty_trend', case when n0 > nsma then 'up' else 'down' end) end
    from x
$$;
revoke all on function public.mp_index_state_on(text, date) from public, anon, authenticated;

create or replace function public.mp_signal_context(p_symbol text, p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  dday date := (p_at at time zone 'Asia/Kolkata')::date;
  g text; idx text; si jsonb; ni jsonb; pos int; neg int; neu int; ms numeric;
begin
  select mp_stock_group(s.sector, s.company_name) into g from stocks s where s.symbol = p_symbol;
  -- the group's sector index (the preferred one with enough history)
  select gi.symbol into idx from sector_group_index gi
   where gi.grp = g and (select count(*) from sector_index_history h where h.symbol = gi.symbol and h.d < dday) >= 50
   order by gi.pref limit 1;
  if idx is not null then si := mp_index_state_on(idx, dday); end if;
  -- the Nifty on its own (for its trend), using the same function on the Nifty itself
  ni := mp_index_state_on('^NSEI', dday);
  select count(*) filter (where short_term_impact ilike 'pos%'), count(*) filter (where short_term_impact ilike 'neg%'),
         count(*) filter (where short_term_impact is null or (short_term_impact not ilike 'pos%' and short_term_impact not ilike 'neg%'))
    into pos, neg, neu
    from news where symbol = p_symbol and coalesce(is_visible, true)
     and coalesce(published_at, created_at) >= p_at - interval '7 days' and coalesce(published_at, created_at) < p_at;
  -- market mood only when recorded live (the sentiment row is from within the last 3 hours of the signal)
  select (sentiment->>'score')::numeric into ms from market_reasons
   where region = 'india' and sentiment ? 'score' and updated_at between p_at - interval '3 hours' and p_at + interval '10 minutes';
  return jsonb_build_object(
    'v', 1, 'grp', g, 'sector_index', idx,
    'sector', coalesce(si->>'state', 'none'), 'sec_m1', si->'m1',
    'nifty_trend', ni->>'nifty_trend', 'nifty_m1', ni->'nifty_m1',
    'news_pos', pos, 'news_neg', neg, 'news_neu', neu,
    'news_score', case when pos + neg > 0 then round(100.0 * (pos - neg) / (pos + neg + 0.5 * neu)) end,
    'mkt_score', ms);
end $$;
revoke all on function public.mp_signal_context(text, timestamptz) from public, anon, authenticated;

create or replace function public.signal_context_fill(p_limit int default 300) returns int
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  update signal_log l set ctx = mp_signal_context(l.symbol, l.issued_at)
   where l.id in (select id from signal_log where ctx is null order by issued_at desc limit p_limit);
  get diagnostics k = row_count;
  return k;
end $$;
revoke all on function public.signal_context_fill(int) from public, anon, authenticated;

select cron.unschedule('signal-context') where exists (select 1 from cron.job where jobname = 'signal-context');
select cron.schedule('signal-context', '*/5 * * * *', $c$select public.signal_context_fill(300)$c$);

-- The scorecard.
create or replace function public.signal_scorecard(p_tf text default null, p_days int default 90) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select l.*, coalesce(l.ctx, '{}'::jsonb) x, case when l.side = 'BUY' then 1 else -1 end dir,
           (l.issued_at at time zone 'Asia/Kolkata')::time t
      from signal_log l
     where l.status <> 'active' and l.result_r is not null
       and l.closed_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
       and (p_tf is null or l.tf = p_tf)),
  b as (
    select c.*,
      case when score >= 100 then '100' when score >= 90 then '90–99' when score >= 85 then '85–89' else '80–84' end as score_band,
      case when t < time '10:30' then '1 · 9:15–10:30' when t < time '12:30' then '2 · 10:30–12:30' when t < time '14:00' then '3 · 12:30–2:00'
           else '4 · 2:00–3:30' end as tod,
      case when x->>'sector' is null or x->>'sector' = 'none' then 'no sector index'
           when x->>'sector' = 'neutral' then 'neutral sector'
           when (x->>'sector' = 'strong') = (dir = 1) then 'with the sector' else 'against the sector' end as sec_al,
      case when x->>'news_score' is null then 'no rated news'
           when (x->>'news_score')::numeric * dir >= 15 then 'news agrees'
           when (x->>'news_score')::numeric * dir <= -15 then 'news conflicts' else 'mixed news' end as news_al,
      case when x->>'nifty_trend' is null then 'unknown'
           when (x->>'nifty_trend' = 'up') = (dir = 1) then 'with the Nifty trend' else 'against the Nifty trend' end as trend_al,
      case when x->>'mkt_score' is null then 'not recorded'
           when (x->>'mkt_score')::numeric * dir >= 15 then 'mood with'
           when (x->>'mkt_score')::numeric * dir <= -15 then 'mood against' else 'mood mixed' end as mood_al
      from c),
  base as (
    select count(*) n, count(*) filter (where result_r > 0) wins, avg(result_r) avg_r, stddev_samp(result_r) sd_r,
           sum(result_r) sum_r, avg(result_pct) avg_pct,
           count(*) filter (where status = 'target') targets, count(*) filter (where status = 'stop') stops,
           count(*) filter (where status = 'expired') expired, count(*) filter (where ctx is not null) with_ctx,
           count(distinct (issued_at at time zone 'Asia/Kolkata')::date) days, min(issued_at) since
      from b),
  g as (
    select v.dim, v.k, count(*) n, count(*) filter (where b.result_r > 0) wins, avg(b.result_r) avg_r, stddev_samp(b.result_r) sd_r,
           sum(b.result_r) sum_r, avg(b.result_pct) avg_pct,
           count(*) filter (where b.status = 'target') targets, count(*) filter (where b.status = 'stop') stops,
           count(*) filter (where b.status = 'expired') expired,
           count(distinct (b.issued_at at time zone 'Asia/Kolkata')::date) days
      from b cross join lateral (values
        ('setup', b.tf || ' · ' || coalesce(b.setup, '?')), ('side', b.side), ('score', b.score_band), ('time', b.tod),
        ('sector', b.sec_al), ('news', b.news_al), ('trend', b.trend_al), ('mood', b.mood_al),
        ('combo', b.sec_al || ' + ' || b.trend_al)) v(dim, k)
     group by v.dim, v.k)
  select jsonb_build_object(
    'server_now', now(), 'tf', p_tf, 'window_days', p_days,
    'base', (select jsonb_build_object('n', n, 'wins', wins, 'avg_r', round(avg_r, 3), 'sd_r', round(sd_r, 3), 'sum_r', round(sum_r, 2),
             'avg_pct', round(avg_pct, 3), 'targets', targets, 'stops', stops, 'expired', expired, 'with_ctx', with_ctx, 'days', days, 'since', since) from base),
    'mood_since', (select min(updated_at) from market_reasons),
    'groups', coalesce((select jsonb_object_agg(dim, rows) from (
       select g.dim, jsonb_agg(jsonb_build_object('k', g.k, 'n', g.n, 'wins', g.wins, 'avg_r', round(g.avg_r, 3), 'sd_r', round(g.sd_r, 3),
                'sum_r', round(g.sum_r, 2), 'avg_pct', round(g.avg_pct, 3), 'targets', g.targets, 'stops', g.stops, 'expired', g.expired, 'days', g.days,
                -- does this group differ from the rest by more than chance? An approximate t-statistic on avg R vs the rest
                -- (the rest's spread is taken as the overall spread); |t| >= 2 counts as a difference. Signals on the same
                -- day move together, so the page only calls it settled once the group spans 10+ trading days.
                'vs_rest', (select case when g.n >= 20 and base.n - g.n >= 20 and g.sd_r > 0 then
                              round(((g.avg_r - (base.avg_r * base.n - g.avg_r * g.n) / (base.n - g.n))
                                / sqrt(g.sd_r ^ 2 / g.n + base.sd_r ^ 2 / (base.n - g.n)))::numeric, 2) end from base))
                order by g.k) rows
         from g group by g.dim) z), '{}'::jsonb));
$$;
grant execute on function public.signal_scorecard(text, int) to anon, authenticated;
