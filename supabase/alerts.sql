-- Applied 10 Nov 2026 (migration user_alerts; cron "user-alerts" every 2 minutes; "same site only" policies added as in tenants.sql).
-- Personal alerts (Alerts page /alerts.html and the 🔔 bell's "My alerts" tab). Only about the user's own stocks:
-- their holdings (portfolio_transactions) and watchlist, plus their own price alerts and paper trades. Nothing here
-- recommends other stocks (paper / personal use until SEBI RA registration).
--   user_alert_settings    per user: which automatic alerts are on, the big-move threshold, which stocks they cover.
--   user_alerts            one row per alert; (user_id, key) makes each event alert once. Users read and dismiss their own.
--   mp_capture_user_alerts()  pg_cron every 2 minutes. Records:
--       * price alerts (stock_alerts) crossing their price: also sets triggered_at and switches the alert off
--       * a big move today (default ±3%, again at twice that), from stock_quotes, on trading days only
--       * results tomorrow (with the usual results-day move from the Events preview) and results out (with the verdict)
--       * a dividend going ex tomorrow
--       * a new scanner signal on one of their stocks (signal_log)
--       * one of their paper trades closing at its target or stop
--   my_alerts(p_limit)     the signed-in user's recent alerts. my_alerts_read(p_ids) marks them read (null = all).
create table if not exists public.user_alert_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  scope text not null default 'both' check (scope in ('both', 'holdings', 'watchlist')),
  big_move_pct numeric not null default 3 check (big_move_pct between 1 and 20),
  on_price boolean not null default true,
  on_big_move boolean not null default true,
  on_results boolean not null default true,
  on_dividend boolean not null default true,
  on_signal boolean not null default true,
  on_paper boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.user_alert_settings enable row level security;
revoke all on public.user_alert_settings from anon, authenticated;
grant select, insert, update on public.user_alert_settings to authenticated;
drop policy if exists "Own alert settings" on public.user_alert_settings;
create policy "Own alert settings" on public.user_alert_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.user_alerts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  kind text not null check (kind in ('price', 'move', 'results', 'dividend', 'signal', 'paper')),
  symbol text,
  icon text,
  title text not null,
  body text,
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, key)
);
create index if not exists user_alerts_user_idx on public.user_alerts (user_id, created_at desc);
alter table public.user_alerts enable row level security;
revoke all on public.user_alerts from anon, authenticated;
grant select, delete on public.user_alerts to authenticated;
drop policy if exists "Own alerts" on public.user_alerts;
create policy "Own alerts" on public.user_alerts for select to authenticated using (user_id = auth.uid());
drop policy if exists "Delete own alerts" on public.user_alerts;
create policy "Delete own alerts" on public.user_alerts for delete to authenticated using (user_id = auth.uid());

-- Every user's stocks: holdings (net quantity > 0) and watchlist, with where each comes from.
create or replace function public.mp_user_stocks()
returns table (user_id uuid, symbol text, held boolean, watched boolean)
language sql stable security definer set search_path = public as $$
  with h as (
    select t.user_id, upper(t.symbol) symbol from portfolio_transactions t
     group by 1, 2 having sum(case when upper(t.transaction_type) = 'SELL' then -t.quantity else t.quantity end) > 0),
  w as (select user_id, upper(symbol) symbol from watchlist group by 1, 2)
  select coalesce(h.user_id, w.user_id), coalesce(h.symbol, w.symbol), h.symbol is not null, w.symbol is not null
    from h full join w on w.user_id = h.user_id and w.symbol = h.symbol
$$;
revoke all on function public.mp_user_stocks() from public, anon, authenticated;

create or replace function public.mp_capture_user_alerts() returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0; k int;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  trading boolean := extract(isodow from (now() at time zone 'Asia/Kolkata')) < 6 and not mp_is_market_holiday();
  nxt date;
begin
  -- the next trading day after today (for "tomorrow" alerts)
  select g::date into nxt from generate_series(today + 1, today + 10, interval '1 day') g
   where extract(isodow from g) < 6 and not exists (select 1 from market_holidays mh where mh.d = g::date) order by g limit 1;

  create temp table if not exists _us (user_id uuid, symbol text, held boolean, watched boolean,
    scope text, big numeric, on_move boolean, on_results boolean, on_dividend boolean, on_signal boolean) on commit drop;
  truncate _us;
  insert into _us
  select s.user_id, s.symbol, s.held, s.watched, coalesce(a.scope, 'both'), coalesce(a.big_move_pct, 3),
         coalesce(a.on_big_move, true), coalesce(a.on_results, true), coalesce(a.on_dividend, true), coalesce(a.on_signal, true)
    from mp_user_stocks() s left join user_alert_settings a on a.user_id = s.user_id
   where coalesce(a.scope, 'both') = 'both' or (a.scope = 'holdings' and s.held) or (a.scope = 'watchlist' and s.watched);

  -- 1. Price alerts: a fresh quote (traded today) at or past the price.
  with hit as (
    update stock_alerts sa set triggered_at = now(), is_active = false
      from stock_quotes q
     where sa.is_active and sa.triggered_at is null and q.symbol = upper(sa.symbol) and q.price > 0
       and (q.quote_time at time zone 'Asia/Kolkata')::date = today
       and ((sa.condition = 'above' and q.price >= sa.target_price) or (sa.condition = 'below' and q.price <= sa.target_price))
       and not exists (select 1 from user_alert_settings x where x.user_id = sa.user_id and not x.on_price)
    returning sa.id, sa.user_id, upper(sa.symbol) sym, sa.condition, sa.target_price, q.price, q.change_percent)
  insert into user_alerts (user_id, key, kind, symbol, icon, title, body, url)
  select user_id, 'price|' || id, 'price', sym, '🎯',
         sym || ' is ' || case when condition = 'above' then 'above ' else 'below ' end || mp_inr(target_price),
         'Now ' || mp_inr(price) || coalesce(' (' || case when change_percent >= 0 then '+' else '' end || round(change_percent::numeric, 2) || '% today)', '') ||
         '. Your price alert has been switched off; set a new one on the Alerts page.',
         '/stock-analysis.html?symbol=' || sym
    from hit
  on conflict (user_id, key) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- 2. Big move today: at the threshold, and again at twice it. Trading days only, quote from today.
  if trading then
    insert into user_alerts (user_id, key, kind, symbol, icon, title, body, url)
    select u.user_id, 'move|' || u.symbol || '|' || today || '|' || sign(q.change_percent) || '|' || lvl, 'move', u.symbol,
           case when q.change_percent > 0 then '🚀' else '🔻' end,
           u.symbol || case when q.change_percent > 0 then ' up ' else ' down ' end || round(abs(q.change_percent)::numeric, 1) || '% today',
           'At ' || mp_inr(q.price) || ' (previous close ' || mp_inr(q.previous_close) || '). ' ||
           case when u.held and u.watched then 'In your holdings and watchlist.' when u.held then 'In your holdings.' else 'On your watchlist.' end,
           '/stock-analysis.html?symbol=' || u.symbol
      from _us u join stock_quotes q on q.symbol = u.symbol,
           lateral (select case when abs(q.change_percent) >= 2 * u.big then 2 else 1 end lvl) l
     where u.on_move and q.price > 0 and abs(q.change_percent) >= u.big and abs(q.change_percent) < 25
       and (q.quote_time at time zone 'Asia/Kolkata')::date = today
    on conflict (user_id, key) do nothing;
    get diagnostics k = row_count; n := n + k;
  end if;

  -- 3a. Results on the next trading day (sent from 3 PM IST the day before, so it lands after the session).
  if (now() at time zone 'Asia/Kolkata')::time >= '15:00' and nxt is not null then
    insert into user_alerts (user_id, key, kind, symbol, icon, title, body, url)
    select u.user_id, 'resdue|' || e.id, 'results', u.symbol, '📊',
           u.symbol || ' results ' || case when nxt = today + 1 then 'tomorrow' else 'on ' || to_char(nxt, 'Dy DD Mon') end,
           coalesce('On its last ' || (e.preview->'stats'->>'n') || ' results days it moved ±' || round((e.preview->'stats'->>'avgAbs')::numeric, 1) || '% on average. ', '') ||
           'Prices can gap on results; see what to expect on the Events page.',
           '/events.html'
      from _us u join market_events e on e.symbol = u.symbol and e.kind = 'results' and e.event_date = nxt
     where u.on_results
    on conflict (user_id, key) do nothing;
    get diagnostics k = row_count; n := n + k;

    -- Dividend going ex on the next trading day.
    insert into user_alerts (user_id, key, kind, symbol, icon, title, body, url)
    select u.user_id, 'divex|' || e.id, 'dividend', u.symbol, '💰',
           u.symbol || ' goes ex-dividend ' || case when nxt = today + 1 then 'tomorrow' else 'on ' || to_char(nxt, 'Dy DD Mon') end,
           coalesce(mp_inr(e.amount) || ' a share. ', '') || 'Hold the shares at today''s close to receive it; the price usually opens lower by about the dividend.',
           '/events.html'
      from _us u join market_events e on e.symbol = u.symbol and e.kind = 'dividend' and e.event_date = nxt
     where u.on_dividend
    on conflict (user_id, key) do nothing;
    get diagnostics k = row_count; n := n + k;
  end if;

  -- 3b. Results out: the verdict for one of their stocks (within 5 days of the meeting).
  insert into user_alerts (user_id, key, kind, symbol, icon, title, body, url)
  select u.user_id, 'resout|' || e.id, 'results', u.symbol,
         case e.outcome->'verdict'->>'label' when 'positive' then '🟢' when 'negative' then '🔴' else '🟡' end,
         u.symbol || ' results: ' || (e.outcome->'verdict'->>'label') || case when (e.outcome->'verdict'->>'early')::boolean then ' (early read)' else '' end,
         e.outcome->'verdict'->>'summary',
         '/events.html'
    from _us u join market_events e on e.symbol = u.symbol and e.kind = 'results'
   where u.on_results and e.event_date >= today - 5 and e.outcome->'verdict' is not null
  on conflict (user_id, key) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- 4. A new scanner signal on one of their stocks (issued in the last 30 minutes).
  insert into user_alerts (user_id, key, kind, symbol, icon, title, body, url)
  select u.user_id, 'sig|' || l.id, 'signal', u.symbol, case when l.side = 'BUY' then '📈' else '📉' end,
         u.symbol || ': ' || case when l.side = 'BUY' then 'buy' else 'sell' end || ' signal (' || l.tf || ')',
         coalesce(l.setup, 'Setup') || ' · entry ' || mp_inr(l.entry) || ', stop ' || mp_inr(l.stop) || ', target ' || mp_inr(l.target1) ||
         '. Scanner signal on a stock you ' || case when u.held then 'hold' else 'watch' end || ', not advice.',
         '/stock-signals.html'
    from _us u join signal_log l on l.symbol = u.symbol
   where u.on_signal and l.issued_at > now() - interval '30 minutes'
  on conflict (user_id, key) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- 5. Their paper trades closing (last 30 minutes).
  insert into user_alerts (user_id, key, kind, symbol, icon, title, body, url)
  select p.user_id, 'paper|' || p.id, 'paper', p.symbol, case when p.realized_pnl >= 0 then '✅' else '⛔' end,
         'Paper trade closed: ' || p.symbol || ' ' || case when p.realized_pnl >= 0 then '+' else '−' end || mp_inr(abs(p.realized_pnl)),
         initcap(lower(p.direction)) || ' ' || p.quantity || ' at ' || mp_inr(p.entry_price) || ', out at ' || mp_inr(p.exit_price) || '.',
         '/stock-signals.html'
    from stock_paper_trades p
   where p.status = 'CLOSED' and p.closed_at > now() - interval '30 minutes' and p.realized_pnl is not null
     and not exists (select 1 from user_alert_settings x where x.user_id = p.user_id and not x.on_paper)
  on conflict (user_id, key) do nothing;
  get diagnostics k = row_count; n := n + k;

  delete from user_alerts where created_at < now() - interval '45 days';
  return n;
end $$;
revoke all on function public.mp_capture_user_alerts() from public, anon, authenticated;

create or replace function public.my_alerts(p_limit int default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(a) - 'user_id' - 'key' order by a.created_at desc), '[]'::jsonb)
    from (select * from user_alerts where user_id = auth.uid() order by created_at desc limit greatest(1, least(p_limit, 200))) a
$$;
revoke all on function public.my_alerts(int) from public, anon;
grant execute on function public.my_alerts(int) to authenticated;

create or replace function public.my_alerts_read(p_ids bigint[] default null)
returns int language sql security definer set search_path = public as $$
  with u as (update user_alerts set read_at = now() where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids)) returning 1)
  select count(*)::int from u
$$;
revoke all on function public.my_alerts_read(bigint[]) from public, anon;
grant execute on function public.my_alerts_read(bigint[]) to authenticated;

-- Applied: select cron.schedule('user-alerts', '*/2 * * * *', 'select public.mp_capture_user_alerts()');
