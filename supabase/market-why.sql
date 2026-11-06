-- "Why is the market moving?" (market-why.js: Home card and the Global Market page).
-- market_why() lines up today's move with the data that explains it. It is an explanation from data that agrees with
-- the move, not proof of cause, and says so on the page.
--   India (Nifty 50): points each heavyweight added or took away (weight = free-float market cap, i.e. market cap
--     x (1 - promoter holding), among the Nifty 50 members), leading / lagging sectors, breadth, overnight US, Asia
--     today, US futures, crude, the rupee, the US 10-year yield, the dollar, FII / DII flows, today's events and the
--     headlines that match.
--   United States, Europe, Asia: each region's last session, and the cross-market drivers (yields, volatility, dollar,
--     oil, gold, bitcoin, yen, euro, US lead) plus the region's headlines.
-- Every driver has impact +1 (pushes stocks up), -1 (pushes them down) or 0, so the page can sort them into
-- "pushing up" and "holding back" against the actual move.
--   index_members   NSE index constituents (Nifty 50, Nifty Bank) from NSE's index lists; refreshed daily by the
--                   sector-history edge function

create table if not exists public.index_members (
  index_name text not null, symbol text not null, company text, industry text, updated_at timestamptz not null default now(),
  primary key (index_name, symbol)
);
alter table public.index_members enable row level security;
revoke all on public.index_members from anon, authenticated;

-- one driver row
create or replace function public.mw_driver(p_key text, p_label text, p_value text, p_impact int, p_why text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('key', p_key, 'label', p_label, 'value', p_value, 'impact', p_impact, 'why', p_why)
$$;
-- sign with a dead zone: small moves count as no push either way
create or replace function public.mw_sign(v numeric, dead numeric) returns int
language sql immutable as $$ select case when v is null or abs(v) < dead then 0 when v > 0 then 1 else -1 end $$;
create or replace function public.mw_pct(v numeric) returns text
language sql immutable as $$ select case when v is null then '—' else (case when v > 0 then '+' when v < 0 then '−' else '' end) || to_char(abs(v), 'FM990.00') || '%' end $$;

create or replace function public.market_why() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  Q jsonb; today date := (now() at time zone 'Asia/Kolkata')::date;
  mins int := extract(hour from now() at time zone 'Asia/Kolkata')::int * 60 + extract(minute from now() at time zone 'Asia/Kolkata')::int;
  dow int := extract(isodow from now() at time zone 'Asia/Kolkata')::int;
  n_px numeric; n_prev numeric; n_chg numeric; n_pts numeric;
  contrib jsonb; est_pts numeric; covered int;
  drivers jsonb := '[]'::jsonb; f record; adv int; dcl int; sec_top jsonb; sec_bot jsonb;
  us numeric; asia numeric; fut numeric; brent numeric; inr numeric; tnx numeric; dxy numeric; vix numeric; gold numeric; btc numeric; jpy numeric; eur numeric;
  heads_in jsonb; events jsonb; regions jsonb;
begin
  -- latest quote per symbol: price, change %, last trade time, name
  select jsonb_object_agg(symbol, jsonb_build_object('p', price, 'c', change_percent, 't', coalesce(market_time, updated_at), 'n', display_name))
    into Q from (select distinct on (symbol) * from index_quotes order by symbol, updated_at desc) z;
  n_px := (Q->'^NSEI'->>'p')::numeric; n_chg := (Q->'^NSEI'->>'c')::numeric;
  select previous_close into n_prev from index_quotes where symbol = '^NSEI' and grp = 'snapshot' order by updated_at desc limit 1;
  n_pts := case when n_prev > 0 then n_px - n_prev end;

  us := (Q->'^GSPC'->>'c')::numeric; fut := (Q->'ES=F'->>'c')::numeric; brent := (Q->'BZ=F'->>'c')::numeric;
  inr := (Q->'INR=X'->>'c')::numeric; tnx := (Q->'^TNX'->>'c')::numeric; dxy := (Q->'DX-Y.NYB'->>'c')::numeric;
  vix := (Q->'^VIX'->>'c')::numeric; gold := (Q->'GC=F'->>'c')::numeric; btc := (Q->'BTC-USD'->>'c')::numeric;
  jpy := (Q->'JPY=X'->>'c')::numeric; eur := (Q->'EURUSD=X'->>'c')::numeric;
  select avg(c) into asia from (select (Q->s->>'c')::numeric c from unnest(array['^N225', '^HSI', '000001.SS', '^KS11']) s) z where c is not null;

  -- ---------- India: which Nifty 50 stocks added or took away the points ----------
  with m as (
    select q.symbol, coalesce(s.company_name, im.company) as name, q.change_percent as chg,
           q.market_cap * (1 - least(greatest(coalesce(s.promoters_latest, 0), 0), 0.95)) as ff
      from index_members im join stock_quotes q on q.symbol = im.symbol left join stocks s on s.symbol = im.symbol
     where im.index_name = 'NIFTY 50' and q.price > 0 and q.market_cap > 0 and q.quote_time > now() - interval '5 days'
       and abs(coalesce(q.change_percent, 0)) <= 20),
  w as (select *, ff / nullif(sum(ff) over (), 0) as wt from m),
  c as (select *, wt * chg / 100 * n_prev as pts from w)
  select jsonb_build_object(
      'up', (select coalesce(jsonb_agg(jsonb_build_object('s', symbol, 'n', name, 'chg', round(chg::numeric, 2), 'pts', round(pts::numeric, 1), 'wt', round(wt::numeric * 100, 1)) order by pts desc), '[]') from (select * from c where pts > 0 order by pts desc limit 5) x),
      'down', (select coalesce(jsonb_agg(jsonb_build_object('s', symbol, 'n', name, 'chg', round(chg::numeric, 2), 'pts', round(pts::numeric, 1), 'wt', round(wt::numeric * 100, 1)) order by pts), '[]') from (select * from c where pts < 0 order by pts limit 5) x),
      'top5_pts', (select round(sum(pts)::numeric, 1) from (select pts from c order by abs(pts) desc limit 5) x)),
      (select round(sum(pts)::numeric, 1) from c), (select count(*) from c)
    into contrib, est_pts, covered;

  -- breadth and sectors
  select count(*) filter (where change_percent > 0), count(*) filter (where change_percent < 0) into adv, dcl
    from stock_quotes where price > 0 and quote_time > now() - interval '5 days' and abs(coalesce(change_percent, 0)) <= 20;
  select jsonb_agg(jsonb_build_object('n', coalesce(display_name, name), 'c', round(change_percent::numeric, 2)) order by change_percent desc) into sec_top
    from (select * from sector_index_quotes where price > 0 and change_percent is not null order by change_percent desc limit 3) z;
  select jsonb_agg(jsonb_build_object('n', coalesce(display_name, name), 'c', round(change_percent::numeric, 2)) order by change_percent) into sec_bot
    from (select * from sector_index_quotes where price > 0 and change_percent is not null order by change_percent limit 3) z;

  -- drivers for India (impact = what the factor does to Indian stocks)
  if adv + dcl > 0 then
    drivers := drivers || mw_driver('breadth', 'Breadth', format('%s up, %s down (%s%% rising)', adv, dcl, round(100.0 * adv / (adv + dcl))),
      case when 100.0 * adv / (adv + dcl) >= 58 then 1 when 100.0 * adv / (adv + dcl) <= 42 then -1 else 0 end,
      case when 100.0 * adv / (adv + dcl) >= 58 then 'Most stocks are rising: the move is broad, not just a few heavyweights.'
           when 100.0 * adv / (adv + dcl) <= 42 then 'Most stocks are falling: selling is broad.'
           else 'Rising and falling stocks are roughly even: the index move rests on a few large stocks.' end);
  end if;
  if us is not null then drivers := drivers || mw_driver('us', 'US stocks (last session)', 'S&P 500 ' || mw_pct(us) || ', Nasdaq ' || mw_pct((Q->'^IXIC'->>'c')::numeric), mw_sign(us, 0.3),
      case mw_sign(us, 0.3) when 1 then 'A strong Wall Street close usually lifts Asian and Indian markets the next day.' when -1 then 'A weak Wall Street close usually weighs on Asia and India the next day.' else 'Wall Street was little changed.' end); end if;
  if asia is not null then drivers := drivers || mw_driver('asia', 'Asian markets today', 'Nikkei ' || mw_pct((Q->'^N225'->>'c')::numeric) || ', Hang Seng ' || mw_pct((Q->'^HSI'->>'c')::numeric) || ', Shanghai ' || mw_pct((Q->'000001.SS'->>'c')::numeric), mw_sign(asia, 0.4),
      case mw_sign(asia, 0.4) when 1 then 'Regional markets are rising alongside.' when -1 then 'Regional markets are falling.' else 'Regional markets are mixed.' end); end if;
  if fut is not null then drivers := drivers || mw_driver('usfut', 'US futures now', 'S&P 500 futures ' || mw_pct(fut), mw_sign(fut, 0.3),
      case mw_sign(fut, 0.3) when 1 then 'Futures point to a firmer US open tonight.' when -1 then 'Futures point to a weaker US open tonight.' else 'Futures are flat.' end); end if;
  if brent is not null then drivers := drivers || mw_driver('crude', 'Crude oil', 'Brent ' || mw_pct(brent), -mw_sign(brent, 1.0),
      case -mw_sign(brent, 1.0) when 1 then 'Cheaper oil helps India, a big oil importer: lower costs for airlines, paints, OMCs and the import bill.' when -1 then 'Dearer oil hurts India, a big oil importer: inflation, the import bill and input costs rise.' else 'Oil is little changed.' end); end if;
  if inr is not null then drivers := drivers || mw_driver('rupee', 'Rupee', 'USD/INR ' || to_char((Q->'INR=X'->>'p')::numeric, 'FM990.00') || ' (' || mw_pct(inr) || ')', -mw_sign(inr, 0.15),
      case -mw_sign(inr, 0.15) when 1 then 'A stronger rupee tends to attract and keep foreign money.' when -1 then 'A weaker rupee tends to push foreign investors out.' else 'The rupee is steady.' end); end if;
  if tnx is not null then drivers := drivers || mw_driver('yield', 'US 10-year yield', to_char((Q->'^TNX'->>'p')::numeric, 'FM990.000') || '% (' || mw_pct(tnx) || ')', -mw_sign(tnx, 1.0),
      case -mw_sign(tnx, 1.0) when 1 then 'Falling US yields make emerging-market stocks like India''s more attractive.' when -1 then 'Rising US yields pull money back to the US and away from emerging markets.' else 'US yields are steady.' end); end if;
  if dxy is not null then drivers := drivers || mw_driver('dollar', 'US dollar index', mw_pct(dxy), -mw_sign(dxy, 0.3),
      case -mw_sign(dxy, 0.3) when 1 then 'A softer dollar usually helps emerging markets.' when -1 then 'A stronger dollar usually weighs on emerging markets.' else 'The dollar is steady.' end); end if;
  select * into f from fii_dii_daily where trade_date <= today order by trade_date desc limit 1;
  if f.trade_date is not null then
    drivers := drivers || mw_driver('fii', 'Foreign investors (FII)', format('%s ₹%s Cr on %s', case when f.fii_net >= 0 then 'bought' else 'sold' end, to_char(abs(f.fii_net), 'FM99,99,99,990'), to_char(f.trade_date, 'DD Mon')), mw_sign(f.fii_net, 500),
      case mw_sign(f.fii_net, 500) when 1 then 'Heavy foreign buying adds demand, mostly in large caps.' when -1 then 'Foreign selling adds supply, mostly in large caps.' else 'Foreign flows were small.' end
      || case when f.trade_date < today then ' (latest available: NSE publishes after the close.)' else '' end);
    drivers := drivers || mw_driver('dii', 'Domestic institutions (DII)', format('%s ₹%s Cr on %s', case when f.dii_net >= 0 then 'bought' else 'sold' end, to_char(abs(f.dii_net), 'FM99,99,99,990'), to_char(f.trade_date, 'DD Mon')), mw_sign(f.dii_net, 500),
      case mw_sign(f.dii_net, 500) when 1 then 'Mutual funds and insurers were buyers.' when -1 then 'Mutual funds and insurers were sellers (often booking profits into strength).' else 'Domestic flows were small.' end);
  end if;

  -- today's scheduled events and Nifty 50 results
  select coalesce(jsonb_agg(x), '[]') into events from (
    select title || coalesce(' (' || period || ')', '') as t, 'economy' as k from econ_events where event_date = today
    union all
    select e.symbol || ' results' as t, 'results' as k from market_events e join index_members im on im.symbol = e.symbol and im.index_name = 'NIFTY 50'
     where e.kind = 'results' and e.event_date between today - 1 and today) x;

  -- headlines: market-wide Indian news, and news on today's biggest contributors
  select coalesce(jsonb_agg(x order by x.at desc), '[]') into heads_in from (
    select distinct on (lower(left(title, 60))) title, coalesce(source, '') as source, source_link as url, coalesce(published_at, created_at) as at, short_term_impact as impact, symbol
      from news
     where is_visible is not false and coalesce(published_at, created_at) > now() - interval '30 hours'
       and title !~* 'share price (highlights|today|live)|stock price history'
       and (title ~* '(nifty|sensex|stock market|markets? (rally|fall|crash|surge|today)|dalal street|\mrbi\M|repo rate|\mfii|\mfpi|foreign investors?|rupee|crude|inflation|\mgdp\M|budget|sebi|tariff|fed\M|rate cut)'
            or symbol in (select value->>'s' from jsonb_array_elements(coalesce(contrib->'up', '[]') || coalesce(contrib->'down', '[]'))))
     order by lower(left(title, 60)), coalesce(published_at, created_at) desc
     limit 40) x;
  heads_in := (select coalesce(jsonb_agg(v), '[]') from (select v from jsonb_array_elements(heads_in) v order by (v->>'at') desc limit 6) z);

  -- ---------- United States, Europe, Asia ----------
  regions := jsonb_build_array(
    jsonb_build_object('key', 'us', 'name', 'United States',
      'indices', jsonb_build_array(jsonb_build_object('n', 'S&P 500', 'c', us, 't', Q->'^GSPC'->'t'), jsonb_build_object('n', 'Nasdaq', 'c', Q->'^IXIC'->'c', 't', Q->'^IXIC'->'t'), jsonb_build_object('n', 'Dow Jones', 'c', Q->'^DJI'->'c', 't', Q->'^DJI'->'t')),
      'move', us,
      'drivers', jsonb_build_array(
        mw_driver('yield', 'US 10-year yield', mw_pct(tnx), -mw_sign(tnx, 1.0), case when tnx >= 1 then 'Yields rose: borrowing costs up, which hits richly valued tech hardest.' when tnx <= -1 then 'Yields fell: cheaper money supports stock valuations.' else 'Yields were steady.' end),
        mw_driver('vix', 'Volatility (VIX)', mw_pct(vix), -mw_sign(vix, 5), case when vix >= 5 then 'Fear rose: investors paid up for protection.' when vix <= -5 then 'Fear eased.' else 'Volatility was steady.' end),
        mw_driver('dollar', 'Dollar index', mw_pct(dxy), -mw_sign(dxy, 0.4), case when dxy >= 0.4 then 'A stronger dollar weighs on multinational earnings.' when dxy <= -0.4 then 'A softer dollar helps multinational earnings.' else 'The dollar was steady.' end),
        mw_driver('gold', 'Gold', mw_pct(gold), -mw_sign(gold, 1.0), case when gold >= 1 then 'Gold rose: money moving to safety.' when gold <= -1 then 'Gold fell: less demand for safety.' else 'Gold was steady.' end),
        mw_driver('btc', 'Bitcoin', mw_pct(btc), mw_sign(btc, 3), case when btc >= 3 then 'Risk appetite is strong.' when btc <= -3 then 'Risk appetite is weak across assets.' else 'Crypto was quiet.' end),
        mw_driver('usfut', 'Futures now', 'S&P 500 futures ' || mw_pct(fut), mw_sign(fut, 0.3), case when fut >= 0.3 then 'Futures point higher for the next session.' when fut <= -0.3 then 'Futures point lower for the next session.' else 'Futures are flat.' end))),
    jsonb_build_object('key', 'europe', 'name', 'Europe',
      'indices', jsonb_build_array(jsonb_build_object('n', 'Euro Stoxx 50', 'c', Q->'^STOXX50E'->'c', 't', Q->'^STOXX50E'->'t'), jsonb_build_object('n', 'DAX', 'c', Q->'^GDAXI'->'c', 't', Q->'^GDAXI'->'t'), jsonb_build_object('n', 'FTSE 100', 'c', Q->'^FTSE'->'c', 't', Q->'^FTSE'->'t'), jsonb_build_object('n', 'CAC 40', 'c', Q->'^FCHI'->'c', 't', Q->'^FCHI'->'t')),
      'move', (Q->'^STOXX50E'->>'c')::numeric,
      'drivers', jsonb_build_array(
        mw_driver('us', 'Wall Street lead', 'S&P 500 ' || mw_pct(us) || ', futures ' || mw_pct(fut), mw_sign(coalesce(fut, 0) + coalesce(us, 0) * 0.5, 0.3), case when coalesce(fut, 0) + coalesce(us, 0) * 0.5 >= 0.3 then 'A firm US lead lifts European stocks.' when coalesce(fut, 0) + coalesce(us, 0) * 0.5 <= -0.3 then 'A weak US lead drags on Europe.' else 'The US lead is mixed.' end),
        mw_driver('euro', 'Euro', 'EUR/USD ' || mw_pct(eur), -mw_sign(eur, 0.4), case when eur >= 0.4 then 'A stronger euro hurts European exporters.' when eur <= -0.4 then 'A weaker euro helps European exporters.' else 'The euro was steady.' end),
        mw_driver('crude', 'Crude oil', 'Brent ' || mw_pct(brent), 0, case when brent >= 1 then 'Dearer oil lifts energy stocks (BP, Shell, TotalEnergies) but raises costs for others.' when brent <= -1 then 'Cheaper oil weighs on energy stocks but eases costs for others.' else 'Oil was steady.' end),
        mw_driver('yield', 'US 10-year yield', mw_pct(tnx), -mw_sign(tnx, 1.0), case when tnx >= 1 then 'Rising global yields weigh on stocks.' when tnx <= -1 then 'Falling yields support stocks.' else 'Yields were steady.' end))),
    jsonb_build_object('key', 'asia', 'name', 'Asia',
      'indices', jsonb_build_array(jsonb_build_object('n', 'Nikkei 225', 'c', Q->'^N225'->'c', 't', Q->'^N225'->'t'), jsonb_build_object('n', 'Hang Seng', 'c', Q->'^HSI'->'c', 't', Q->'^HSI'->'t'), jsonb_build_object('n', 'Shanghai', 'c', Q->'000001.SS'->'c', 't', Q->'000001.SS'->'t'), jsonb_build_object('n', 'KOSPI', 'c', Q->'^KS11'->'c', 't', Q->'^KS11'->'t'), jsonb_build_object('n', 'Taiwan', 'c', Q->'^TWII'->'c', 't', Q->'^TWII'->'t')),
      'move', asia,
      'drivers', jsonb_build_array(
        mw_driver('us', 'Wall Street overnight', 'S&P 500 ' || mw_pct(us) || ', Nasdaq ' || mw_pct((Q->'^IXIC'->>'c')::numeric), mw_sign(us, 0.3), case when us >= 0.3 then 'A strong US close usually lifts Asia the next morning.' when us <= -0.3 then 'A weak US close, especially in tech, usually drags Asia (Japan, Korea and Taiwan are tech-heavy).' else 'The US lead was flat.' end),
        mw_driver('yen', 'Yen', 'USD/JPY ' || mw_pct(jpy), mw_sign(jpy, 0.4), case when jpy >= 0.4 then 'A weaker yen helps Japanese exporters (Nikkei).' when jpy <= -0.4 then 'A stronger yen hurts Japanese exporters (Nikkei).' else 'The yen was steady.' end),
        mw_driver('usfut', 'US futures now', mw_pct(fut), mw_sign(fut, 0.3), case when fut >= 0.3 then 'US futures are recovering.' when fut <= -0.3 then 'US futures are still falling.' else 'US futures are flat.' end),
        mw_driver('dollar', 'Dollar index', mw_pct(dxy), -mw_sign(dxy, 0.3), case when dxy >= 0.3 then 'A stronger dollar weighs on Asian currencies and stocks.' when dxy <= -0.3 then 'A softer dollar helps Asian markets.' else 'The dollar was steady.' end))));

  -- region headlines from the global feed
  regions := (select jsonb_agg(r || jsonb_build_object('headlines', coalesce((
      select jsonb_agg(jsonb_build_object('title', h.title, 'source', h.source, 'url', h.url, 'at', h.published_at) order by h.published_at desc)
        from (select * from (select distinct on (lower(left(title, 60))) * from global_headlines
               where published_at > now() - interval '30 hours'
                 and title ~* case r->>'key'
                   when 'us' then '(wall street|s&p|nasdaq|dow\M|\mfed\M|federal reserve|powell|treasur|\mcpi\M|inflation|jobs|payroll|tariff|earnings|nvidia|apple|microsoft|tesla|\mai\M|tech stocks|recession)'
                   when 'europe' then '(europe|\mecb\M|lagarde|\meuro\M|stoxx|\mdax\M|ftse|germany|german|france|french|britain|\muk\M|bank of england|london)'
                   else '(asia|japan|nikkei|\mboj\M|\myen\M|china|chinese|hang seng|hong kong|yuan|pboc|korea|kospi|taiwan|tsmc|samsung)' end
               order by lower(left(title, 60)), published_at desc) d order by d.published_at desc limit 4) h), '[]'::jsonb)) order by ord) from jsonb_array_elements(regions) with ordinality a(r, ord));

  return jsonb_build_object(
    'as_of', now(),
    'india', jsonb_build_object(
      'name', 'Nifty 50', 'price', n_px, 'prev', n_prev, 'chg', round(n_chg, 2), 'pts', round(n_pts, 1),
      'session', case when dow <= 5 and mins between 555 and 930 then 'open' else 'closed' end,
      'sensex', round((Q->'^BSESN'->>'c')::numeric, 2), 'bank', round((Q->'^NSEBANK'->>'c')::numeric, 2), 'midcap', round((Q->'^NSEMDCP50'->>'c')::numeric, 2),
      'contributors', contrib, 'est_pts', est_pts, 'covered', covered,
      'sectors', jsonb_build_object('top', coalesce(sec_top, '[]'), 'bottom', coalesce(sec_bot, '[]')),
      'breadth', jsonb_build_object('up', adv, 'down', dcl),
      'drivers', drivers, 'events', events, 'headlines', heads_in),
    'regions', regions);
end $$;
grant execute on function public.market_why() to anon, authenticated;
