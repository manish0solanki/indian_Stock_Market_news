-- Live market insights for the Home page during the trading session.
-- refresh_live_insights() runs every 15 minutes from pg_cron (09:20-15:35 IST, Mon-Fri). Each run writes
-- one batch of insights (run_id) built from the tables the site already keeps fresh: index_quotes,
-- sector_index_quotes, stock_quotes (~2,600 stocks every 3 min), stock_signals and market_events.
-- Holidays are skipped automatically: no stock quote stamped today means no session.
-- The page shows the newest batch while the market is open, and the blog cards after the close.

create table if not exists public.live_insights (
  id bigserial primary key,
  run_id uuid not null,
  session_date date not null,
  created_at timestamptz not null default now(),
  sort smallint not null default 0,
  kind text not null,          -- pulse | breadth | sectors | movers | volume | highs | results | signals | global
  tone text not null default 'neutral',  -- positive | negative | neutral | mixed
  title text not null,
  body text,
  symbols text[] not null default '{}',
  data jsonb not null default '{}'
);
create index if not exists live_insights_session_idx on public.live_insights (session_date, created_at desc);
alter table public.live_insights enable row level security;
drop policy if exists "live insights are public" on public.live_insights;
create policy "live insights are public" on public.live_insights for select using (true);
grant select on public.live_insights to anon, authenticated;

create or replace function public.mp_pct(v numeric) returns text language sql immutable as $$
  select case when v is null then '—' else (case when v >= 0 then '+' else '−' end) || to_char(abs(v), 'FM990.00') || '%' end
$$;

create or replace function public.refresh_live_insights() returns text
language plpgsql security definer set search_path = public as $$
declare
  now_ist timestamp := now() at time zone 'Asia/Kolkata';
  d date := (now() at time zone 'Asia/Kolkata')::date;
  day_start timestamptz := ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata';
  mins int := extract(hour from now() at time zone 'Asia/Kolkata')::int * 60 + extract(minute from now() at time zone 'Asia/Kolkata')::int;
  frac numeric;
  rid uuid := gen_random_uuid();
  n_sort int := 0;
  nifty record; sensex record; bank record; midcap record;
  prev jsonb; since text := '';
  n_adv int; n_dec int; n_unch int;
  r record; t text; b text; syms text[]; tone text;
begin
  if extract(isodow from now_ist) > 5 or mins < 555 or mins > 935 then return 'outside session'; end if;
  if not exists (select 1 from stock_quotes where quote_time >= day_start and updated_at > now() - interval '20 minutes') then
    return 'no live quotes today (holiday?)';
  end if;
  frac := greatest(0.05, least(1, (mins - 555) / 375.0));  -- share of the session gone, for volume pace

  select * into nifty from index_quotes where symbol = '^NSEI';
  select * into sensex from index_quotes where symbol = '^BSESN';
  select * into bank from index_quotes where symbol = '^NSEBANK';
  select * into midcap from index_quotes where symbol = '^NSEMDCP50';

  -- 1. Market pulse (with the move since the previous run today)
  select data into prev from live_insights where session_date = d and kind = 'pulse' order by created_at desc limit 1;
  if prev is not null and (prev->>'nifty')::numeric > 0 and nifty.price > 0 then
    since := format(' Since %s: Nifty %s.', prev->>'at', mp_pct((nifty.price / (prev->>'nifty')::numeric - 1) * 100));
  end if;
  if nifty.price is not null then
    insert into live_insights (run_id, session_date, sort, kind, tone, title, body, data) values (rid, d, n_sort, 'pulse',
      case when nifty.change_percent >= 0.15 then 'positive' when nifty.change_percent <= -0.15 then 'negative' else 'neutral' end,
      format('Nifty 50 %s at %s', mp_pct(nifty.change_percent), to_char(nifty.price, 'FM99,99,999.00')),
      format('Sensex %s, Bank Nifty %s, Midcap 50 %s.%s', mp_pct(sensex.change_percent), mp_pct(bank.change_percent), mp_pct(midcap.change_percent), since),
      jsonb_build_object('nifty', nifty.price, 'nifty_pct', round(nifty.change_percent, 2), 'sensex_pct', round(sensex.change_percent, 2),
        'bank_pct', round(bank.change_percent, 2), 'midcap_pct', round(midcap.change_percent, 2), 'at', to_char(now_ist, 'HH24:MI')));
    n_sort := n_sort + 1;
  end if;

  -- 2. Breadth (stocks with a live quote today), and whether it agrees with the index
  select count(*) filter (where change_percent > 0.05), count(*) filter (where change_percent < -0.05), count(*) filter (where abs(change_percent) <= 0.05)
    into n_adv, n_dec, n_unch
    from stock_quotes where quote_time >= day_start and price > 0 and previous_close > 0;
  if n_adv + n_dec > 100 then
    if nifty.change_percent > 0.2 and n_dec > n_adv * 1.15 then
      t := 'Narrow rally: Nifty is up but most stocks are falling'; tone := 'mixed';
    elsif nifty.change_percent < -0.2 and n_adv > n_dec * 1.15 then
      t := 'Index down, but the broader market is holding up'; tone := 'mixed';
    elsif n_adv > n_dec * 1.5 then t := 'Broad-based buying across the market'; tone := 'positive';
    elsif n_dec > n_adv * 1.5 then t := 'Broad-based selling across the market'; tone := 'negative';
    else t := 'Market breadth is balanced'; tone := 'neutral';
    end if;
    insert into live_insights (run_id, session_date, sort, kind, tone, title, body, data) values (rid, d, n_sort, 'breadth', tone, t,
      format('%s advancing, %s declining, %s unchanged (advance/decline %s).', to_char(n_adv, 'FM9,999'), to_char(n_dec, 'FM9,999'), to_char(n_unch, 'FM9,999'), to_char(n_adv::numeric / greatest(n_dec, 1), 'FM990.00')),
      jsonb_build_object('adv', n_adv, 'dec', n_dec, 'unch', n_unch));
    n_sort := n_sort + 1;
  end if;

  -- 3. Sector leaders and laggards
  with s as (select display_name, change_percent from sector_index_quotes where change_percent is not null and updated_at > now() - interval '30 minutes'),
       top as (select string_agg(format('%s %s', display_name, mp_pct(change_percent)), ', ' order by change_percent desc) x from (select * from s order by change_percent desc limit 3) a),
       bot as (select string_agg(format('%s %s', display_name, mp_pct(change_percent)), ', ' order by change_percent) x from (select * from s order by change_percent limit 3) a),
       best as (select * from s order by change_percent desc limit 1), worst as (select * from s order by change_percent limit 1)
  select format('%s leads (%s), %s lags (%s)', replace(best.display_name, 'Nifty ', ''), mp_pct(best.change_percent), replace(worst.display_name, 'Nifty ', ''), mp_pct(worst.change_percent)),
         format('Strongest: %s. Weakest: %s.', top.x, bot.x),
         case when best.change_percent > 0 and worst.change_percent < 0 then 'mixed' when worst.change_percent >= 0 then 'positive' else 'negative' end
    into t, b, tone from best, worst, top, bot;
  if t is not null then
    insert into live_insights (run_id, session_date, sort, kind, tone, title, body) values (rid, d, n_sort, 'sectors', tone, t, b);
    n_sort := n_sort + 1;
  end if;

  -- 4. Large-cap movers (market cap at least 20,000 Cr)
  with q as (select symbol, change_percent from stock_quotes where quote_time >= day_start and market_cap >= 2e11 and price > 0),
       g as (select * from q order by change_percent desc limit 3), l as (select * from q order by change_percent limit 3)
  select format('Top large-cap gainer %s %s, top loser %s %s', (select symbol from g limit 1), mp_pct((select change_percent from g limit 1)), (select symbol from l limit 1), mp_pct((select change_percent from l limit 1))),
         format('Gainers: %s. Losers: %s.', (select string_agg(symbol || ' ' || mp_pct(change_percent), ', ' order by change_percent desc) from g), (select string_agg(symbol || ' ' || mp_pct(change_percent), ', ' order by change_percent) from l)),
         array(select symbol from g) || array(select symbol from l)
    into t, b, syms;
  if syms is not null and array_length(syms, 1) > 0 then
    insert into live_insights (run_id, session_date, sort, kind, tone, title, body, symbols) values (rid, d, n_sort, 'movers', 'mixed', t, b, syms);
    n_sort := n_sort + 1;
  end if;

  -- 5. Unusual volume: traded at 3x+ the usual pace with a 2%+ move (market cap at least 1,000 Cr)
  with v as (
    select symbol, change_percent, volume / nullif(avg_volume_3m * frac, 0) as pace
      from stock_quotes
     where quote_time >= day_start and market_cap >= 1e10 and avg_volume_3m > 0 and volume > 0 and abs(change_percent) >= 2
  ), top as (select * from v where pace >= 3 order by pace desc limit 4)
  select string_agg(symbol, ', ' order by pace desc), string_agg(format('%s %s on %s× normal volume', symbol, mp_pct(change_percent), to_char(pace, 'FM990.0')), '; ' order by pace desc), array_agg(symbol order by pace desc),
         case when bool_and(change_percent > 0) then 'positive' when bool_and(change_percent < 0) then 'negative' else 'mixed' end
    into t, b, syms, tone from top;
  if syms is not null then
    insert into live_insights (run_id, session_date, sort, kind, tone, title, body, symbols) values (rid, d, n_sort, 'volume', tone,
      'Unusual volume in ' || t, b || '. Heavy volume behind a move often means institutions are active.', syms);
    n_sort := n_sort + 1;
  end if;

  -- 6. Stocks at 52-week highs / lows (market cap at least 1,000 Cr)
  with h as (select symbol, market_cap, change_percent from stock_quotes where quote_time >= day_start and market_cap >= 1e10 and high_52w > 0 and high >= high_52w * 0.999),
       lo as (select symbol, market_cap from stock_quotes where quote_time >= day_start and market_cap >= 1e10 and low_52w > 0 and low <= low_52w * 1.001)
  select (select count(*) from h)::int as f1, (select count(*) from lo)::int as f2,
         (select string_agg(symbol, ', ' order by market_cap desc) from (select * from h order by market_cap desc limit 5) x) as f3,
         (select string_agg(symbol, ', ' order by market_cap desc) from (select * from lo order by market_cap desc limit 5) y) as f4,
         (select array_agg(symbol order by market_cap desc) from (select * from h order by market_cap desc limit 5) z) as f5
    into r;
  if r.f1 + r.f2 > 0 then
    insert into live_insights (run_id, session_date, sort, kind, tone, title, body, symbols, data) values (rid, d, n_sort, 'highs',
      case when r.f1 > r.f2 * 2 then 'positive' when r.f2 > r.f1 * 2 then 'negative' else 'mixed' end,
      format('%s stocks at 52-week highs, %s at 52-week lows', r.f1, r.f2),
      concat_ws(' ', case when r.f1 > 0 then 'Highs include ' || r.f3 || '.' end, case when r.f2 > 0 then 'Lows include ' || r.f4 || '.' end),
      coalesce(r.f5, '{}'), jsonb_build_object('highs', r.f1, 'lows', r.f2));
    n_sort := n_sort + 1;
  end if;

  -- 7. Results: reactions to results out since yesterday, and who reports today
  with o as (
    select e.symbol, e.outcome->'verdict'->>'label' as label, q.change_percent, q.market_cap
      from market_events e join stock_quotes q on q.symbol = e.symbol and q.quote_time >= day_start
     where e.kind = 'results' and e.event_date between d - 1 and d and e.outcome->>'status' in ('done', 'partial') and e.outcome->'verdict' is not null
     order by q.market_cap desc nulls last limit 5
  ), today as (
    select e.symbol from market_events e left join stock_quotes q on q.symbol = e.symbol
     where e.kind = 'results' and e.event_date = d order by e.tracked desc, q.market_cap desc nulls last limit 6
  )
  select (select count(*) from market_events where kind = 'results' and event_date = d)::int as f1,
         (select string_agg(symbol, ', ') from today) as f2,
         (select string_agg(format('%s %s (%s)', symbol, mp_pct(change_percent), label), ', ') from o) as f3,
         coalesce((select array_agg(symbol) from o), '{}') || coalesce((select array_agg(symbol) from today), '{}') as f4
    into r;
  if r.f1 > 0 or r.f3 is not null then
    insert into live_insights (run_id, session_date, sort, kind, tone, title, body, symbols, data) values (rid, d, n_sort, 'results', 'neutral',
      case when r.f1 > 0 then format('%s companies report results today', r.f1) else 'Reacting to results' end,
      concat_ws(' ', case when r.f1 > 0 then 'Including ' || r.f2 || '.' end, case when r.f3 is not null then 'Reacting to fresh numbers: ' || r.f3 || '.' end),
      coalesce(r.f4[1:8], '{}'), jsonb_build_object('today', r.f1));
    n_sort := n_sort + 1;
  end if;

  -- 8. Trade signals generated in the last 30 minutes
  with s as (select symbol, side, setup, score from stock_signals where generated_at > now() - interval '30 minutes' order by score desc limit 4)
  select (select count(*) from stock_signals where generated_at > now() - interval '30 minutes')::int as f1,
         (select string_agg(format('%s %s (%s, score %s)', symbol, lower(side), setup, score), '; ') from s) as f2,
         (select array_agg(symbol) from s) as f3
    into r;
  if r.f1 > 0 then
    insert into live_insights (run_id, session_date, sort, kind, tone, title, body, symbols) values (rid, d, n_sort, 'signals', 'neutral',
      format('%s fresh trade signal%s', r.f1, case when r.f1 = 1 then '' else 's' end), r.f2 || '. See Stock Signals for entry, stop and targets.', coalesce(r.f3, '{}'));
    n_sort := n_sort + 1;
  end if;

  -- 9. Global cues
  select format('Crude %s at $%s; Nikkei %s, Hang Seng %s; US futures %s',
           mp_pct(max(change_percent) filter (where symbol = 'CL=F')), to_char(max(price) filter (where symbol = 'CL=F'), 'FM990.00'),
           mp_pct(max(change_percent) filter (where symbol = '^N225')), mp_pct(max(change_percent) filter (where symbol = '^HSI')),
           mp_pct(max(change_percent) filter (where symbol = 'ES=F')))
    into b from index_quotes where grp = 'global';
  if b is not null then
    insert into live_insights (run_id, session_date, sort, kind, tone, title, body) values (rid, d, n_sort, 'global', 'neutral', 'Global cues', b || '.');
    n_sort := n_sort + 1;
  end if;

  delete from live_insights where session_date < d - 7;
  return format('wrote %s insights', n_sort);
end $$;

revoke execute on function public.refresh_live_insights() from public, anon, authenticated;

select cron.unschedule('live-insights') where exists (select 1 from cron.job where jobname = 'live-insights');
-- 03:50-10:05 UTC = 09:20-15:35 IST; the function itself checks the session window and holidays.
select cron.schedule('live-insights', '5,20,35,50 3-10 * * 1-5', $$select public.refresh_live_insights()$$);
