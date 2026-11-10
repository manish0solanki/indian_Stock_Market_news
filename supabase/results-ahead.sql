-- Applied 11 Nov 2026 (migration results_ahead; cron "results-lean-log" 15 10 * * 1-5, skipping holidays).
-- Results ahead (Events page, platform admin only): companies with results in a date range, ranked by how their
-- set-up going in looks, for "which results might I buy into". Paper / personal use until SEBI RA registration.
--   results_ahead(p_from, p_to, p_min_mcap_cr)  one row per company: the preview's rule-based factors (last quarter's
--       trend, sector peers this season, how the shares reacted to past results, the run-up vs the Nifty), the usual
--       results-day move, the scanner's active swing signal on the stock, price, market cap and liquidity.
--       score = sum of the preview's factor weights + 1 for an active BUY signal (−1 for SELL). The page adds news.
--   results_lean_log  a snapshot of each company's score the day before its results (cron 'results-lean-log',
--       15:45 IST on trading days, with that day's price), settled on the first trading day after the results with
--       the price then (the move through the results) and the results verdict where one was read, so the panel can
--       show how well the leans have worked so far: results_lean_record().
create or replace function public.results_ahead(p_from date, p_to date, p_min_mcap_cr numeric default 1000)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not coalesce(mp_is_platform_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  with ev as (
    select distinct on (e.symbol) e.id, e.symbol, e.company, e.event_date, e.preview
      from market_events e
     where e.kind = 'results' and e.event_date between p_from and least(p_to, p_from + 10)
       and e.preview->>'status' = 'ready'
     order by e.symbol, e.event_date),
  sig as (
    select distinct on (symbol) symbol, side, setup, score, entry, stop, target1, issued_at
      from signal_log where status = 'active' and tf = 'swing' order by symbol, issued_at desc),
  rows as (
    select ev.*, q.price, q.change_percent, q.market_cap, q.volume, q.avg_volume_3m, st.sector,
           s.side sig_side, s.setup sig_setup, s.score sig_score, s.entry sig_entry, s.stop sig_stop, s.target1 sig_t1,
           coalesce((select sum((f->>'w')::numeric) from jsonb_array_elements(ev.preview->'factors') f), 0)
             + case s.side when 'BUY' then 1 when 'SELL' then -1 else 0 end as score
      from ev
      join stock_quotes q on q.symbol = ev.symbol
      left join stocks st on st.symbol = ev.symbol
      left join sig s on s.symbol = ev.symbol
     where q.price >= 20 and coalesce(q.market_cap, 0) >= p_min_mcap_cr * 1e7
       and coalesce(q.avg_volume_3m, q.volume, 0) * q.price >= 2e7)   -- at least ~₹2 Cr traded a day
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'server_now', now(),
    'total', (select count(*) from market_events where kind = 'results' and event_date between p_from and p_to),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'symbol', symbol, 'company', company, 'date', event_date, 'sector', sector,
      'price', price, 'change_percent', round(change_percent::numeric, 2), 'mcap_cr', round((market_cap / 1e7)::numeric),
      'score', score, 'factors', preview->'factors', 'stats', preview->'stats', 'last', preview->'last', 'base', preview->'base',
      'runup', preview->'runup', 'peers', case when jsonb_typeof(preview->'peers') = 'object' then (preview->'peers') - 'list'::text end, 'day_abs', preview->'dayAbs',
      'signal', case when sig_side is null then null else jsonb_build_object('side', sig_side, 'setup', sig_setup, 'score', sig_score, 'entry', sig_entry, 'stop', sig_stop, 'target1', sig_t1) end
    ) order by score desc, market_cap desc nulls last), '[]'::jsonb)) into out
  from rows;
  return out;
end $$;
revoke all on function public.results_ahead(date, date, numeric) from public, anon;
grant execute on function public.results_ahead(date, date, numeric) to authenticated;

create table if not exists public.results_lean_log (
  event_id text primary key,
  symbol text not null,
  event_date date not null,
  score numeric not null,
  lean text not null,               -- positive | negative | none
  factors jsonb,
  logged_at timestamptz not null default now(),
  price_before numeric,             -- the price when logged (the session before the results)
  price_after numeric,              -- the price at 15:45 IST on the first trading day after the results day
  reaction_pct numeric,             -- price_after vs price_before, %
  verdict text,                     -- the results verdict where one was read: positive | negative | mixed
  settled_at timestamptz
);
alter table public.results_lean_log enable row level security;
revoke all on public.results_lean_log from anon, authenticated;

-- Snapshot tomorrow's (next trading day's) leans, and settle past ones whose results are out.
create or replace function public.mp_log_results_leans() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; today date := (now() at time zone 'Asia/Kolkata')::date; nxt date;
begin
  select g::date into nxt from generate_series(today + 1, today + 10, interval '1 day') g
   where extract(isodow from g) < 6 and not exists (select 1 from market_holidays mh where mh.d = g::date) order by g limit 1;
  insert into results_lean_log (event_id, symbol, event_date, score, lean, factors, price_before)
  select e.id, e.symbol, e.event_date, sc, case when sc >= 1 then 'positive' when sc <= -1 then 'negative' else 'none' end, e.preview->'factors', q.price
    from market_events e
    join stock_quotes q on q.symbol = e.symbol,
         lateral (select coalesce((select sum((f->>'w')::numeric) from jsonb_array_elements(e.preview->'factors') f), 0)
                        + coalesce((select case side when 'BUY' then 1 when 'SELL' then -1 else 0 end from signal_log l
                                     where l.symbol = e.symbol and l.status = 'active' and l.tf = 'swing' order by issued_at desc limit 1), 0) sc) x
   where e.kind = 'results' and e.event_date between today + 1 and nxt and e.preview->>'status' = 'ready'
     and q.price >= 20 and coalesce(q.market_cap, 0) >= 1e10
  on conflict (event_id) do nothing;
  get diagnostics k = row_count; n := n + k;
  -- Settle: on (or after) the first trading day after the results day, with today's price (quoted today).
  update results_lean_log l set price_after = q.price, reaction_pct = round((q.price / l.price_before - 1) * 100, 2), settled_at = now(),
         verdict = (select e.outcome->'verdict'->>'label' from market_events e where e.id = l.event_id)
    from stock_quotes q
   where q.symbol = l.symbol and l.settled_at is null and l.price_before > 0 and q.price > 0
     and (q.quote_time at time zone 'Asia/Kolkata')::date = today
     and today > (select min(g::date) from generate_series(l.event_date + 1, l.event_date + 10, interval '1 day') g
                   where extract(isodow from g) < 6 and not exists (select 1 from market_holidays mh where mh.d = g::date)) - 1;
  get diagnostics k = row_count; n := n + k;
  -- Verdicts that arrive after settling.
  update results_lean_log l set verdict = e.outcome->'verdict'->>'label'
    from market_events e where e.id = l.event_id and l.verdict is null and l.settled_at is not null and e.outcome->'verdict' is not null
     and not coalesce((e.outcome->'verdict'->>'early')::boolean, false);
  return n;
end $$;
revoke all on function public.mp_log_results_leans() from public, anon, authenticated;

-- How the leans have done: per lean, how many settled, how many rose on results day, the average move.
create or replace function public.results_lean_record()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not coalesce(mp_is_platform_admin(), false) then raise exception 'admin only' using errcode = '42501'; end if;
  select coalesce(jsonb_object_agg(lean, jsonb_build_object('n', n, 'rose', rose, 'avg', avg_move, 'positive', pos)), '{}'::jsonb) into out
    from (select lean, count(*) n, count(*) filter (where reaction_pct > 0) rose, round(avg(reaction_pct), 2) avg_move,
                 count(*) filter (where verdict = 'positive') pos
            from results_lean_log where settled_at is not null group by lean) t;
  return jsonb_build_object('by_lean', out, 'pending', (select count(*) from results_lean_log where settled_at is null));
end $$;
revoke all on function public.results_lean_record() from public, anon;
grant execute on function public.results_lean_record() to authenticated;

-- select cron.schedule('results-lean-log', '15 10 * * 1-5', 'select public.mp_log_results_leans()');  -- 15:45 IST
