-- Signal log: every signal is issued once and then frozen.
-- The scanner (stock-signals-refresh, every 5 min) rewrites stock_signals with whatever qualifies right now, so
-- its levels move and setups come and go. signal_log_sync() (pg_cron, every minute) turns that into a record:
--   * a scanner setup with no active signal for the same stock / timeframe / side is ISSUED: its entry, stop and
--     targets are copied and never change, and it gets an expiry (intraday: 15:20 IST the same day; swing: the
--     close of the 5th trading day after issue);
--   * each active signal is tracked against live quotes (highest / lowest price seen since issue; on later days
--     the day's high and low count too) and CLOSES at the first of: stop hit, target 1 hit, or expiry (at the
--     last price). If stop and target fall in the same check, the stop is assumed (conservative);
--   * a new setup in the same stock after a signal closes is a NEW signal (a fresh row).
-- Everything that showed stock_signals now reads the active signals from here (stock_signals_feed,
-- stock_signals_top, the notification bell); signal_history() is the track record for the History tab.

create table if not exists public.signal_log (
  id bigserial primary key,
  symbol text not null,
  name text,
  tf text not null check (tf in ('swing', 'intraday')),
  side text not null check (side in ('BUY', 'SELL')),
  setup text, score int,
  entry numeric not null, stop numeric not null, target1 numeric not null, target2 numeric,
  risk_per_share numeric, risk_pct numeric, rsi numeric, atr numeric, ema_fast numeric, ema_slow numeric, vol_ratio numeric,
  bar_date text, reasons jsonb, closes jsonb,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'target', 'stop', 'expired')),
  hi_since numeric, lo_since numeric, last_price numeric, hit_t2 boolean not null default false,
  closed_at timestamptz, exit_price numeric, result_pct numeric, result_r numeric
);
create index if not exists signal_log_status_idx on public.signal_log (status);
create index if not exists signal_log_issued_idx on public.signal_log (issued_at desc);
create index if not exists signal_log_sym_idx on public.signal_log (symbol, tf, side, issued_at desc);
create unique index if not exists signal_log_one_active on public.signal_log (symbol, tf, side) where status = 'active';
alter table public.signal_log enable row level security;
revoke all on public.signal_log from anon, authenticated;

-- n weekdays after d (exchange holidays are not skipped)
create or replace function public.mp_add_weekdays(d date, n int) returns date
language plpgsql immutable as $$
declare r date := d; k int := 0;
begin
  while k < n loop
    r := r + 1;
    if extract(isodow from r) < 6 then k := k + 1; end if;
  end loop;
  return r;
end $$;

-- When a signal issued at t expires.
create or replace function public.mp_signal_expiry(p_tf text, t timestamptz) returns timestamptz
language sql immutable as $$
  select case
    when p_tf = 'intraday' then
      case when (t at time zone 'Asia/Kolkata')::time < time '15:20' and extract(isodow from (t at time zone 'Asia/Kolkata')) < 6
           then ((t at time zone 'Asia/Kolkata')::date + time '15:20') at time zone 'Asia/Kolkata'
           else (mp_add_weekdays((t at time zone 'Asia/Kolkata')::date, 1) + time '15:20') at time zone 'Asia/Kolkata' end
    else (mp_add_weekdays((t at time zone 'Asia/Kolkata')::date, 5) + time '15:30') at time zone 'Asia/Kolkata'
  end
$$;

create or replace view public.signals_active as
  select id, symbol, name, tf, side, setup, score, entry, stop, target1, target2, risk_per_share, risk_pct, rsi, atr,
         ema_fast, ema_slow, vol_ratio, bar_date, reasons, closes, issued_at as generated_at, issued_at, expires_at
    from public.signal_log where status = 'active';
revoke all on public.signals_active from anon, authenticated;

create or replace function public.signal_log_sync() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  issued int := 0; closed int := 0;
  scan_at timestamptz := (select max(generated_at) from stock_signals);
  ist_now timestamp := now() at time zone 'Asia/Kolkata';
begin
  -- 1. issue new signals from a fresh scan
  if scan_at > now() - interval '15 minutes' then
    insert into signal_log (symbol, name, tf, side, setup, score, entry, stop, target1, target2, risk_per_share, risk_pct,
                            rsi, atr, ema_fast, ema_slow, vol_ratio, bar_date, reasons, closes, issued_at, expires_at,
                            hi_since, lo_since, last_price)
    select s.symbol, coalesce(s.name, st.company_name, s.symbol), s.tf, s.side, s.setup, s.score, s.entry, s.stop, s.target1, s.target2,
           s.risk_per_share, s.risk_pct, s.rsi, s.atr, s.ema_fast, s.ema_slow, s.vol_ratio, s.bar_date, s.reasons, s.closes,
           now(), mp_signal_expiry(s.tf, now()), s.entry, s.entry, coalesce(q.price, s.entry)
      from stock_signals s
      left join stocks st on st.symbol = s.symbol
      left join stock_quotes q on q.symbol = s.symbol
     where s.entry > 0 and s.stop > 0 and s.target1 > 0
       and (s.tf <> 'intraday' or (extract(isodow from ist_now) < 6 and ist_now::time between time '09:15' and time '15:15'))
       -- not the same scan bar again after a signal on it closed, and a short cool-down after any close
       and not exists (select 1 from signal_log l where l.symbol = s.symbol and l.tf = s.tf and l.side = s.side
                          and (l.bar_date = s.bar_date
                               or l.closed_at > now() - case when s.tf = 'intraday' then interval '30 minutes' else interval '1 day' end))
    on conflict (symbol, tf, side) where status = 'active' do nothing;
    get diagnostics issued = row_count;
  end if;

  -- 2. track active signals against live prices
  update signal_log l set
    last_price = q.price,
    hi_since = greatest(coalesce(l.hi_since, l.entry), q.price,
                 case when (q.updated_at at time zone 'Asia/Kolkata')::date > (l.issued_at at time zone 'Asia/Kolkata')::date then q.high end),
    lo_since = least(coalesce(l.lo_since, l.entry), q.price,
                 case when (q.updated_at at time zone 'Asia/Kolkata')::date > (l.issued_at at time zone 'Asia/Kolkata')::date and q.low > 0 then q.low end)
  from stock_quotes q
  where l.status = 'active' and q.symbol = l.symbol and q.price > 0 and q.updated_at > l.issued_at;

  -- 3. close: stop first (conservative), then target 1, then expiry at the last price
  with done as (
    update signal_log l set
      status = x.st,
      exit_price = x.px,
      closed_at = now(),
      hit_t2 = case when l.target2 is null then false when l.side = 'BUY' then l.hi_since >= l.target2 else l.lo_since <= l.target2 end,
      result_pct = round(((case when l.side = 'BUY' then 1 else -1 end) * (x.px / l.entry - 1) * 100)::numeric, 2),
      result_r = case when l.risk_per_share > 0
                      then round(((case when l.side = 'BUY' then 1 else -1 end) * (x.px - l.entry) / l.risk_per_share)::numeric, 2) end
    from (
      select id,
        case when (side = 'BUY' and lo_since <= stop) or (side = 'SELL' and hi_since >= stop) then 'stop'
             when (side = 'BUY' and hi_since >= target1) or (side = 'SELL' and lo_since <= target1) then 'target'
             when now() >= expires_at then 'expired' end as st,
        case when (side = 'BUY' and lo_since <= stop) or (side = 'SELL' and hi_since >= stop) then stop
             when (side = 'BUY' and hi_since >= target1) or (side = 'SELL' and lo_since <= target1) then target1
             else coalesce(last_price, entry) end as px
      from signal_log where status = 'active'
    ) x
    where l.id = x.id and x.st is not null
    returning 1
  ) select count(*) into closed from done;

  return jsonb_build_object('issued', issued, 'closed', closed, 'active', (select count(*) from signal_log where status = 'active'));
end $$;
revoke all on function public.signal_log_sync() from public, anon, authenticated;

-- Track record for the Signals page's History tab.
create or replace function public.signal_history(p_tf text default null, p_days int default 90, p_limit int default 300)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (
    select * from signal_log
     where status <> 'active' and closed_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
       and (p_tf is null or tf = p_tf)
  ), agg as (
    select tf, count(*) n,
           count(*) filter (where status = 'target') targets,
           count(*) filter (where status = 'stop') stops,
           count(*) filter (where status = 'expired') expired,
           count(*) filter (where result_pct > 0) wins,
           round(avg(result_r)::numeric, 2) avg_r, round(sum(result_r)::numeric, 2) sum_r,
           round(avg(result_pct)::numeric, 2) avg_pct
      from c group by grouping sets ((tf), ())
  )
  select jsonb_build_object(
    'server_now', now(),
    'active', (select count(*) from signal_log where status = 'active' and (p_tf is null or tf = p_tf)),
    'since', (select min(issued_at) from signal_log),
    'stats', coalesce((select jsonb_object_agg(coalesce(tf, 'all'), jsonb_build_object('n', n, 'targets', targets, 'stops', stops,
               'expired', expired, 'wins', wins, 'avg_r', avg_r, 'sum_r', sum_r, 'avg_pct', avg_pct)) from agg), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'symbol', symbol, 'name', name, 'tf', tf, 'side', side, 'setup', setup, 'score', score,
        'entry', entry, 'stop', stop, 'target1', target1, 'target2', target2, 'issued_at', issued_at, 'expires_at', expires_at,
        'closed_at', closed_at, 'status', status, 'exit_price', exit_price, 'result_pct', result_pct, 'result_r', result_r,
        'hit_t2', hit_t2) order by closed_at desc)
      from (select * from c order by closed_at desc limit greatest(1, least(p_limit, 1000))) t), '[]'::jsonb)
  );
$$;
grant execute on function public.signal_history(text, int, int) to anon, authenticated;

-- The Signals page feed now lists the active signals from the log (frozen levels, issue time and expiry).
create or replace function public.stock_signals_feed() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'server_now', now(),
    'generated_at', (select max(generated_at) from public.stock_signals),
    'signals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'symbol', s.symbol, 'tf', s.tf, 'name', coalesce(s.name, st.company_name, s.symbol), 'side', s.side, 'setup', s.setup,
        'score', s.score, 'entry', s.entry, 'stop', s.stop, 'target1', s.target1, 'target2', s.target2,
        'risk_per_share', s.risk_per_share, 'risk_pct', s.risk_pct, 'rsi', s.rsi, 'atr', s.atr,
        'ema_fast', s.ema_fast, 'ema_slow', s.ema_slow, 'vol_ratio', s.vol_ratio, 'bar_date', s.bar_date,
        'reasons', s.reasons, 'closes', s.closes, 'generated_at', s.issued_at, 'issued_at', s.issued_at, 'expires_at', s.expires_at,
        'ltp', q.price, 'change_percent', round(q.change_percent::numeric, 2), 'prev_close', q.previous_close,
        'day_high', q.high, 'day_low', q.low, 'quote_updated_at', q.updated_at, 'is_fno', coalesce(st.is_fno, false)
      ) order by s.score desc, s.symbol)
      from public.signals_active s
      left join public.stock_quotes q on q.symbol = s.symbol
      left join public.stocks st on st.symbol = s.symbol), '[]'::jsonb)
  );
$$;

-- stock_signals_top (Home's top signals, the bell) reads the active signals too.
do $do$ declare d text; begin
  d := pg_get_functiondef('public.stock_signals_top(int,int)'::regprocedure);
  d := replace(d, 'from stock_signals s', 'from signals_active s');
  d := replace(d, '(select count(*) from stock_signals)', '(select count(*) from signals_active)');
  d := replace(d, $q$'symbol', symbol, 'name', nm,$q$, $q$'id', id, 'symbol', symbol, 'name', nm, 'issued_at', issued_at, 'expires_at', expires_at,$q$);
  if position('from signals_active s' in d) = 0 then raise exception 'stock_signals_top not switched'; end if;
  execute d;
end $do$;

select cron.unschedule('signal-log-sync') where exists (select 1 from cron.job where jobname = 'signal-log-sync');
select cron.schedule('signal-log-sync', '* * * * *', $cron$select public.signal_log_sync()$cron$);

-- The bell marks a signal notification inactive once its signal has closed.
do $do$ declare d text; begin
  d := pg_get_functiondef('public.site_notifications_feed(int)'::regprocedure);
  d := replace(d, 'select 1 from stock_signals s', 'select 1 from signals_active s');
  if position('from signals_active s' in d) = 0 then raise exception 'feed not switched'; end if;
  execute d;
end $do$;
