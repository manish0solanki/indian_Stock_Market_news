-- Data health check for the admin Data Health page (admin-health.html). Admins only.
-- Each check compares a feed's newest data with what is expected right now, so evenings and
-- weekends don't raise false alarms: "live" feeds are strict during NSE hours (Mon–Fri 09:15–15:30
-- IST) and only need the last session's data otherwise. Exchange holidays are not known here.
-- Status: ok | warn | fail | idle (not expected to update right now) | info.
-- Age check: ok under warn_min, warn under fail_min, fail beyond (minutes since t).
create or replace function public.mp_health_age(grp text, name text, t timestamptz, warn_min int, fail_min int, note text) returns jsonb
language sql stable as $$
  select jsonb_build_object('group', grp, 'name', name, 'last', t,
    'status', case when t is null then 'fail' when now() - t <= make_interval(mins => warn_min) then 'ok'
                   when now() - t <= make_interval(mins => fail_min) then 'warn' else 'fail' end,
    'detail', case when t is null then 'No data at all' else note end,
    'expect', 'Updated within ' || case when warn_min >= 60 then round(warn_min / 60.0, 1) || ' h' else warn_min || ' min' end)
$$;
-- Session check: the newest data date must be the expected session date (or later).
create or replace function public.mp_health_day(grp text, name text, d date, want date, note text) returns jsonb
language sql stable as $$
  select jsonb_build_object('group', grp, 'name', name, 'last', d,
    'status', case when d is null then 'fail' when d >= want then 'ok' when d >= want - 3 then 'warn' else 'fail' end,
    'detail', case when d is null then 'No data at all' else note || ' · have ' || to_char(d, 'DD Mon') || ', expected ' || to_char(want, 'DD Mon') end,
    'expect', 'Data for ' || to_char(want, 'DD Mon'))
$$;
create or replace function public.data_health_checks() returns jsonb
language plpgsql stable security definer set search_path = public, cron as $$
declare
  ist timestamp := now() at time zone 'Asia/Kolkata';
  dow int := extract(isodow from ist);
  mins int := extract(hour from ist) * 60 + extract(minute from ist);
  mkt_open boolean := dow <= 5 and mins between 555 and 935;
  day_time boolean := mins between 420 and 1380;           -- 07:00–23:00 IST
  -- last weekday on which the session has closed (or today after 15:30)
  last_session date := case
    when dow <= 5 and mins >= 935 then ist::date
    when dow = 1 then ist::date - 3 when dow = 7 then ist::date - 2 when dow = 6 then ist::date - 1
    else ist::date - case when extract(isodow from ist::date - 1) = 7 then 3 else 1 end end;
  checks jsonb := '[]'::jsonb;
  r record;
  t timestamptz; n bigint; m bigint; dd date;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admins only' using errcode = '42501';
  end if;

  -- ---------- Market data ----------
  select max(updated_at) into t from index_quotes where grp = 'snapshot';
  checks := checks || public.mp_health_age('Market data', 'Indian indices (Nifty, Sensex, Bank Nifty…)', t, 5, 15, 'index-refresh, every minute');
  select max(updated_at) into t from index_quotes where grp in ('global', 'world');
  checks := checks || public.mp_health_age('Market data', 'Global markets, currencies, commodities', t, 3, 10, 'index-refresh fast run, every 30 s');
  select max(updated_at), count(*), count(*) filter (where updated_at > now() - interval '30 hours') into t, n, m from stock_quotes;
  checks := checks || case when mkt_open then public.mp_health_age('Market data', 'Stock quotes (all NSE stocks)', t, 15, 45, 'sector-refresh, every 3 min in market hours')
    else public.mp_health_day('Market data', 'Stock quotes (all NSE stocks)', (t at time zone 'Asia/Kolkata')::date, last_session, 'last session''s closing prices') end;
  checks := checks || jsonb_build_object('group', 'Market data', 'name', 'Stock quote coverage',
    'status', case when n = 0 then 'fail' when m::numeric / n < 0.8 then 'fail' when m::numeric / n < 0.95 then 'warn' else 'ok' end,
    'detail', m || ' of ' || n || ' stocks updated in the last 30 hours (' || round(100.0 * m / greatest(n, 1)) || '%)', 'last', t);
  select max(updated_at) into t from sector_index_quotes;
  checks := checks || case when mkt_open then public.mp_health_age('Market data', 'Sector indices', t, 10, 30, 'sector-refresh')
    else public.mp_health_day('Market data', 'Sector indices', (t at time zone 'Asia/Kolkata')::date, last_session, 'last session') end;
  select max(updated_at) into t from market_quotes;
  checks := checks || case when mkt_open then public.mp_health_age('Market data', 'Market quotes (Nifty, VIX, crude, gold, USD/INR)', t, 10, 30, 'sector-refresh')
    else public.mp_health_day('Market data', 'Market quotes (Nifty, VIX, crude, gold, USD/INR)', (t at time zone 'Asia/Kolkata')::date, last_session, 'last session') end;
  select max(last_bar_date), count(*) into dd, n from stock_swing_cache;
  checks := checks || public.mp_health_day('Market data', 'Daily price history (scanner, ' || n || ' stocks)', dd, last_session, 'latest daily bar');
  select max(trade_date) into dd from fii_dii_daily;
  checks := checks || public.mp_health_day('Market data', 'FII / DII flows', dd,
    case when ist::date = last_session and mins < 1260 then last_session - case when extract(isodow from last_session) = 1 then 3 else 1 end else last_session end,
    'NSE publishes in the evening');

  -- ---------- News & content ----------
  select max(created_at) into t from news;
  checks := checks || case when day_time then public.mp_health_age('News & content', 'Market news (company news)', t, 360, 1440, 'news-refresh, every 15 min; only company-specific items are kept')
    else public.mp_health_age('News & content', 'Market news (company news)', t, 720, 1440, 'news-refresh, quieter overnight') end;
  select max(created_at) into t from global_headlines;
  checks := checks || public.mp_health_age('News & content', 'Global headlines', t, 60, 240, 'feeds-refresh, every 10 min');
  select max(generated_at) into t from crude_feed;
  checks := checks || public.mp_health_age('News & content', 'Crude oil feed', t, 75, 240, 'crude-refresh, every 30 min');
  select max(created_at) into t from live_insights;
  checks := checks || case when mkt_open and mins >= 575 then public.mp_health_age('News & content', 'Live insights', t, 30, 90, 'live-insights, every 15 min in market hours')
    else jsonb_build_object('group', 'News & content', 'name', 'Live insights', 'status', 'idle', 'detail', 'Only runs in market hours', 'last', t) end;
  select max(updated_at) into t from market_events;
  checks := checks || public.mp_health_age('News & content', 'Events calendar', t, 120, 360, 'events-refresh, hourly');
  select max(updated_at) into t from ipos;
  checks := checks || public.mp_health_age('News & content', 'IPOs', t, 30, 120, 'ipo-refresh, every 10 min');
  select max(event_date) into dd from econ_events;
  checks := checks || jsonb_build_object('group', 'News & content', 'name', 'Economic calendar schedule',
    'status', case when dd is null or dd < ist::date + 30 then 'fail' when dd < ist::date + 75 then 'warn' else 'ok' end,
    'detail', case when dd is null then 'No dates' else 'Dates entered up to ' || to_char(dd, 'DD Mon YYYY') || case when dd < ist::date + 75 then ' — add the next RBI / Fed / CPI dates (supabase/econ-events.sql)' else '' end end, 'last', null);

  -- ---------- Signals ----------
  select max(generated_at) into t from stock_signals;
  checks := checks || case when mkt_open then public.mp_health_age('Signals', 'Stock Signals scanner', t, 12, 30, 'stock-signals-refresh, every 5 min in market hours')
    else public.mp_health_day('Signals', 'Stock Signals scanner', (t at time zone 'Asia/Kolkata')::date, last_session, 'last scan of the session') end;
  select count(*) into n from stock_signals;
  checks := checks || jsonb_build_object('group', 'Signals', 'name', 'Active stock signals', 'status', 'info', 'detail', n || ' signals live', 'last', null);
  select max(fetched_at) into t from stock_fundamentals_cache;
  checks := checks || jsonb_build_object('group', 'Signals', 'name', 'Quarterly results cache', 'status', 'info', 'detail', 'Filled on demand when a stock is opened', 'last', t);
  select count(*), max(updated_at) into n, t from stocks;
  checks := checks || jsonb_build_object('group', 'Signals', 'name', 'Stock master list', 'status', case when n < 2000 then 'fail' else 'ok' end,
    'detail', n || ' NSE stocks (stocks-sync twice a day; rows change only when listings change)', 'last', t);

  -- ---------- Background jobs (crypto_bot_status heartbeats) ----------
  for r in select * from crypto_bot_status order by job loop
    checks := checks || jsonb_build_object('group', 'Background jobs', 'name', r.job,
      'status', case
        when r.last_ok is false then 'fail'
        when r.running_since is not null and r.running_since < now() - interval '5 minutes' then 'warn'
        when r.job in ('sector', 'stock-signals', 'stock-paper') and not mkt_open then 'idle'
        when r.last_run_at < now() - make_interval(secs => greatest(r.interval_sec, 30) * 5) then 'warn'
        else 'ok' end,
      'detail', coalesce('Error: ' || left(r.last_error, 160),
        case when r.job in ('sector', 'stock-signals', 'stock-paper') and not mkt_open then 'Runs in market hours only' else 'Runs every ' || case when r.interval_sec >= 60 then (r.interval_sec / 60) || ' min' else r.interval_sec || ' s' end end)
        || coalesce(' · last run took ' || round(r.last_duration_ms / 1000.0, 1) || ' s', ''),
      'last', r.last_run_at);
  end loop;

  -- ---------- Scheduler (pg_cron) ----------
  for r in
    select j.jobname, j.active, count(jr.*) filter (where jr.status = 'failed') as failed, count(jr.*) as runs,
           max(jr.start_time) as last_run, (array_agg(jr.return_message order by jr.start_time desc) filter (where jr.status = 'failed'))[1] as msg
    from cron.job j left join cron.job_run_details jr on jr.jobid = j.jobid and jr.start_time > now() - interval '24 hours'
    group by j.jobname, j.active order by j.jobname
  loop
    checks := checks || jsonb_build_object('group', 'Scheduler', 'name', r.jobname,
      'status', case when not r.active then 'warn' when r.failed > 0 then case when r.failed * 4 >= r.runs then 'fail' else 'warn' end else 'ok' end,
      'detail', case when not r.active then 'Paused' when r.failed > 0 then r.failed || ' of ' || r.runs || ' runs failed in 24 h: ' || left(coalesce(r.msg, ''), 140) else r.runs || ' runs in 24 h, none failed' end,
      'last', r.last_run);
  end loop;

  return jsonb_build_object('checked_at', now(), 'market_open', mkt_open, 'last_session', last_session,
    'ist', to_char(ist, 'Dy DD Mon, HH24:MI'), 'checks', checks);
end $$;


-- What the admin page calls: the checks above plus, for each, the scheduled job that refreshes it
-- (the panel's "Run now" button, see supabase/admin-run-job.sql).
create or replace function public.data_health() returns jsonb
language plpgsql stable security definer set search_path = public, cron as $$
declare h jsonb := public.data_health_checks(); checks jsonb := h->'checks';
begin
  -- Which scheduled job refreshes each check, for the panel's "Run now" button (admin_run_job()).
  select coalesce(jsonb_agg(c || coalesce((select jsonb_build_object('job', j) from (values
      ('Indian indices', 'index-refresh'), ('Global markets', 'index-refresh-global-30s'), ('Stock quote', 'sector-refresh'),
      ('Sector indices', 'sector-refresh'), ('Market quotes', 'sector-refresh'), ('Daily price history', 'stock-signals-refresh'),
      ('FII / DII', 'feeds-refresh'), ('Market news', 'news-refresh'), ('Global headlines', 'feeds-refresh'), ('Crude oil', 'crude-refresh'),
      ('Live insights', 'live-insights'), ('Events calendar', 'events-refresh'), ('IPOs', 'ipo-refresh'),
      ('Stock Signals scanner', 'stock-signals-refresh'), ('Stock master', 'stocks-sync')) m(prefix, j)
    where c->>'group' not in ('Background jobs', 'Scheduler') and c->>'name' like m.prefix || '%' limit 1),
    (select jsonb_build_object('job', j) from (values ('crude', 'crude-refresh'), ('feeds', 'feeds-refresh'), ('index', 'index-refresh'),
      ('index-fast', 'index-refresh-global-30s'), ('sector', 'sector-refresh'), ('stock-signals', 'stock-signals-refresh')) m(k, j)
     where c->>'group' = 'Background jobs' and c->>'name' = m.k),
    case when c->>'group' = 'Scheduler' and (c->>'name') = any (admin_runnable_jobs()) then jsonb_build_object('job', c->>'name') end,
    '{}'::jsonb) order by ord), '[]'::jsonb)
  into checks from jsonb_array_elements(checks) with ordinality x(c, ord);

  return jsonb_set(h, '{checks}', checks);
end $$;

revoke all on function public.data_health_checks() from public, anon, authenticated;
revoke all on function public.data_health() from public, anon;
grant execute on function public.data_health() to authenticated;
revoke all on function public.mp_health_age(text, text, timestamptz, int, int, text) from public, anon;
revoke all on function public.mp_health_day(text, text, date, date, text) from public, anon;
