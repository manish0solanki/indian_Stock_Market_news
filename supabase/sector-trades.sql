-- Sectors page, "Trade with the sector" panel (sectors-page.js).
--
-- What the data showed (Jul–Oct 2026, ~220 scanner stocks, next 20 trading days): the same stock setup did far
-- better when its sector index was strong (above its 50-day average AND beating the Nifty over a month) than when
-- it was weak (below its 50-day average AND behind the Nifty). Breakouts: −0.03% and 46% winners vs −2.69% and
-- 33%. The sector's rotation phase on its own showed no edge. So the sector is used as a filter on stock trades.
--
--   sector_group_index        which sector index stands for each stock group (first by pref with 60+ days of history)
--   mp_stock_group()          stock group from the industry, else a guess from the company name (supabase: applied
--                             with mp_broad_sector, see stock-screener.sql)
--   sector_trade_setup()      sector state now, breakouts / near-breakouts in the scanner's ~220 stocks, and the
--                             scanner's BUY signals, each tagged with its sector's state
--   sector_trade_evidence()   the test above, recomputed from the stored history (grows every day)
--   archive_swing_bars()      copies the scanner's daily bars (stock_swing_cache keeps only ~130 days) into
--                             stock_price_history; pg_cron 'swing-bars-archive' after the close

create table if not exists public.sector_group_index (grp text not null, symbol text not null, pref int not null default 1, primary key (grp, symbol));
alter table public.sector_group_index enable row level security;
revoke all on public.sector_group_index from anon, authenticated;
insert into public.sector_group_index (grp, symbol, pref) values
  ('Banks', '^NSEBANK', 1), ('Banks', 'NIFTY_PVT_BANK.NS', 2),
  ('Financial Services', 'NIFTY_FIN_SERVICE.NS', 1),
  ('IT & Technology', '^CNXIT', 1),
  ('Automobiles & Auto Parts', '^CNXAUTO', 1),
  ('FMCG & Food', '^CNXFMCG', 1), ('FMCG & Food', '^CNXCONSUM', 2),
  ('Healthcare & Pharma', 'NIFTY_HEALTHCARE.NS', 1), ('Healthcare & Pharma', '^CNXPHARMA', 2),
  ('Metals & Mining', '^CNXMETAL', 1), ('Metals & Mining', '^CNXCMDT', 2),
  ('Real Estate', '^CNXREALTY', 1),
  ('Energy & Power', '^CNXENERGY', 1), ('Energy & Power', 'NIFTY_OIL_AND_GAS.NS', 2),
  ('Construction & Infrastructure', '^CNXINFRA', 1),
  ('Capital Goods & Industrials', '^CNXINFRA', 1),
  ('Consumer Durables', 'NIFTY_CONSR_DURBL.NS', 1), ('Consumer Durables', '^CNXCONSUM', 2),
  ('Consumer Services & Retail', '^CNXCONSUM', 1),
  ('Telecom & Media', '^CNXMEDIA', 1)
on conflict (grp, symbol) do update set pref = excluded.pref;

-- Each group's index (the first by pref with 60+ days of history) and its state today.
create or replace function public.sector_group_states() returns table (grp text, symbol text, name text, price numeric, above50 boolean, m1 numeric, nifty_m1 numeric, state text)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date d),
  nifty as (
    select coalesce((select price from index_quotes where symbol = '^NSEI' and grp = 'snapshot' order by updated_at desc limit 1),
                    (select close from sector_index_history where symbol = '^NSEI' order by d desc limit 1)) px,
           (select close from sector_index_history, today where symbol = '^NSEI' and sector_index_history.d < today.d order by sector_index_history.d desc offset 20 limit 1) c21),
  pick as (
    select distinct on (g.grp) g.grp, g.symbol
      from sector_group_index g
     where (select count(*) from sector_index_history h, today where h.symbol = g.symbol and h.d < today.d) >= 60
     order by g.grp, g.pref),
  st as (
    select p.grp, p.symbol, coalesce(q.display_name, q.name) as name, q.price,
           (select (sum(c) + q.price) / (count(*) + 1) from (select close c from sector_index_history h, today where h.symbol = p.symbol and h.d < today.d order by h.d desc limit 49) z) as sma50,
           (select close from sector_index_history h, today where h.symbol = p.symbol and h.d < today.d order by h.d desc offset 20 limit 1) as c21
      from pick p join sector_index_quotes q on q.symbol = p.symbol where q.price > 0)
  select st.grp, st.symbol, st.name, st.price, st.price > st.sma50,
         round((st.price / st.c21 - 1) * 100, 2), round((n.px / n.c21 - 1) * 100, 2),
         case when st.price > st.sma50 and st.price / st.c21 > n.px / n.c21 then 'strong'
              when st.price < st.sma50 and st.price / st.c21 < n.px / n.c21 then 'weak' else 'neutral' end
    from st cross join nifty n
$$;
revoke execute on function public.sector_group_states() from anon, authenticated, public;

create or replace function public.sector_trade_setup() returns jsonb
language sql stable security definer set search_path = public as $$
  with states as (select * from sector_group_states()),
  stk as (
    select c.symbol, coalesce(s.company_name, c.symbol) as name, mp_stock_group(s.sector, s.company_name) as grp,
           q.price, q.change_percent, q.volume, q.market_cap, (q.quote_time at time zone 'Asia/Kolkata')::date as qd, c.bars
      from stock_swing_cache c join stock_quotes q using (symbol) left join stocks s using (symbol)
     where q.price > 0 and q.quote_time > now() - interval '10 days' and abs(coalesce(q.change_percent, 0)) <= 20),
  m as (
    select k.*, b.hi20, b.lo20, b.sma50, b.vol20, b.n
      from stk k cross join lateral (
        select max(c) filter (where rn <= 20) as hi20, min(l) filter (where rn <= 20) as lo20,
               (sum(c) filter (where rn <= 49) + k.price) / (count(*) filter (where rn <= 49) + 1) as sma50,
               avg(v) filter (where rn <= 20) as vol20, count(*) as n
          from (select (x.b->>3)::numeric l, (x.b->>4)::numeric c, (x.b->>5)::numeric v,
                       row_number() over (order by x.ord desc) rn
                  from jsonb_array_elements(k.bars) with ordinality x(b, ord)
                 where (x.b->>0)::date < k.qd) z) b),
  t as (
    select m.*, st.state, st.name as idx_name,
           case when m.price > m.hi20 and m.price > m.sma50 then 'breakout'
                when m.price >= 0.98 * m.hi20 and m.price > m.sma50 then 'near' end as setup
      from m left join states st on st.grp = m.grp where m.n >= 40)
  select jsonb_build_object(
    'as_of', now(),
    'nifty_m1', (select max(nifty_m1) from states),
    'sectors', (select coalesce(jsonb_agg(jsonb_build_object('grp', grp, 'symbol', symbol, 'index', name, 'above50', above50, 'm1', m1, 'state', state) order by m1 desc), '[]'::jsonb) from states),
    'ideas', (select coalesce(jsonb_agg(jsonb_build_object(
        's', symbol, 'n', name, 'g', grp, 'st', coalesce(state, 'none'), 'setup', setup, 'p', price, 'chg', round(change_percent::numeric, 2),
        'hi20', round(hi20, 2), 'lo20', round(lo20, 2), 'risk', round((price / lo20 - 1) * 100, 1),
        'a50', round((price / sma50 - 1) * 100, 1), 'vr', case when vol20 > 0 then round(volume / vol20, 2) end,
        'mcap', round(market_cap / 1e7)) order by setup, (price / hi20) desc), '[]'::jsonb)
      from t where setup is not null),
    'signals', (select coalesce(jsonb_agg(jsonb_build_object(
        's', g.symbol, 'n', coalesce(s.company_name, g.name, g.symbol), 'g', mp_stock_group(s.sector, s.company_name), 'st', coalesce(st.state, 'none'),
        'setup', g.setup, 'score', g.score, 'entry', g.entry, 'stop', g.stop, 't1', g.target1, 't2', g.target2, 'risk', g.risk_pct, 'at', g.generated_at)
        order by case st.state when 'strong' then 0 when 'neutral' then 1 when 'weak' then 3 else 2 end, g.score desc), '[]'::jsonb)
      from stock_signals g left join stocks s on s.symbol = g.symbol left join states st on st.grp = mp_stock_group(s.sector, s.company_name)
     where g.side = 'BUY'));
$$;
grant execute on function public.sector_trade_setup() to anon, authenticated;

-- The test behind the panel: scanner stocks on every past day, grouped by setup and by the state of their sector
-- index that day; returns over the next 10 and 20 trading days, the share that went up, and the gap to the Nifty.
create or replace function public.sector_trade_evidence() returns jsonb
language sql stable security definer set search_path = public as $$
  with gi as (select grp, symbol from sector_group_index g
                where pref = (select min(pref) from sector_group_index g2 where g2.grp = g.grp
                               and (select count(*) from sector_index_history h where h.symbol = g2.symbol) >= 120)),
  st as (select p.symbol, gi.symbol as idx, p.trade_date d, p.close c, row_number() over (partition by p.symbol order by p.trade_date) ord
           from stock_price_history p join stocks s using (symbol) join gi on gi.grp = mp_stock_group(s.sector, s.company_name)
          where p.close > 0),
  sf as (select *, avg(c) over (partition by symbol order by ord rows between 49 preceding and current row) s50,
                max(c) over (partition by symbol order by ord rows between 20 preceding and 1 preceding) hi20,
                lead(c, 10) over (partition by symbol order by ord) / c - 1 f10, lead(c, 20) over (partition by symbol order by ord) / c - 1 f20
           from st),
  ix as (select h.symbol idx, h.d, h.close > avg(h.close) over (partition by h.symbol order by h.d rows between 49 preceding and current row) a50,
                h.close / lag(h.close, 21) over (partition by h.symbol order by h.d) - n.close / lag(n.close, 21) over (partition by h.symbol order by h.d) rel1m,
                lead(n.close, 20) over (partition by h.symbol order by h.d) / n.close - 1 nf20
           from sector_index_history h join sector_index_history n on n.symbol = '^NSEI' and n.d = h.d),
  j as (select sf.*, case when ix.a50 and ix.rel1m > 0 then 'strong' when not ix.a50 and ix.rel1m < 0 then 'weak' else 'neutral' end sec, ix.nf20
          from sf join ix on ix.idx = sf.idx and ix.d = sf.d where sf.ord > 50 and sf.f20 is not null and ix.rel1m is not null),
  k as (select 'breakout' setup, * from j where c > hi20 and c > s50
        union all select 'uptrend', * from j where c > s50
        union all select 'all', * from j),
  r as (select setup, sec, count(*) n, round(100 * avg(f10), 2) avg10, round(100 * avg(f20), 2) avg20,
               round(100 * avg((f20 > 0)::int), 1) win20, round(100 * avg(f20 - nf20), 2) vs_nifty20
          from k group by setup, sec)
  select jsonb_build_object('from', (select min(d) from j), 'to', (select max(d) from j), 'stocks', (select count(distinct symbol) from j),
    'nifty20', (select round(100 * avg(nf20), 2) from j), 'rows', (select jsonb_agg(to_jsonb(r) order by setup, sec) from r))
$$;
grant execute on function public.sector_trade_evidence() to anon, authenticated;

-- Keep every daily bar the scanner has seen, so the evidence above covers more than the cache's ~130 days.
create or replace function public.archive_swing_bars() returns int
language sql volatile security definer set search_path = public as $$
  with ins as (
    insert into stock_price_history (symbol, trade_date, open, high, low, close, volume, source, updated_at)
    select c.symbol, (x.b->>0)::date, (x.b->>1)::numeric, (x.b->>2)::numeric, (x.b->>3)::numeric, (x.b->>4)::numeric,
           nullif(x.b->>5, '')::numeric::bigint, 'swing_cache', now()
      from stock_swing_cache c join stocks s using (symbol)
      cross join lateral jsonb_array_elements(c.bars) x(b)
     where (x.b->>0)::date < (now() at time zone 'Asia/Kolkata')::date and (x.b->>4)::numeric > 0
    on conflict (symbol, trade_date) do update set open = excluded.open, high = excluded.high, low = excluded.low,
      close = excluded.close, volume = excluded.volume, updated_at = now()
    returning 1)
  select count(*)::int from ins
$$;
revoke execute on function public.archive_swing_bars() from anon, authenticated, public;
select cron.schedule('swing-bars-archive', '15 11,16 * * 1-6', $$select public.archive_swing_bars()$$);

-- One stock's sector state, for the badge on Stock Analysis.
create or replace function public.stock_sector_state(p_symbol text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('symbol', s.symbol, 'grp', g.grp, 'index', st.name, 'index_symbol', st.symbol,
           'state', coalesce(st.state, 'none'), 'above50', st.above50, 'm1', st.m1, 'nifty_m1', st.nifty_m1)
    from stocks s
    cross join lateral (select mp_stock_group(s.sector, s.company_name) as grp) g
    left join sector_group_states() st on st.grp = g.grp
   where s.symbol = upper(p_symbol)
$$;
grant execute on function public.stock_sector_state(text) to anon, authenticated;
