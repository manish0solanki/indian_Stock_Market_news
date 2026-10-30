-- Stock screener data for screener.html.
-- mp_broad_sector() groups NSE's ~186 industries into ~20 broad sectors.
-- stock_screener() returns every stock with a recent quote as a compact array per stock:
--   [symbol, name, broad sector, industry, price, change %, market cap (Cr), P/E, ROE %, ROCE %,
--    dividend yield %, P/B, volume / 3-month avg volume, 52w high, 52w low, 50 DMA, 200 DMA, F&O]
-- Prices come from stock_quotes (refreshed every few minutes); P/E, ROE, ROCE, dividend yield and
-- book value come from the stocks table (refreshed less often), so both "as of" times are returned.

create or replace function public.mp_broad_sector(industry text) returns text
language sql immutable set search_path = public as $$
  select case
    when industry is null or industry = '' then 'Other'
    when industry ~* 'bank' then 'Banks'
    when industry ~* 'insurance|nbfc|finance|financial|stockbroking|asset management|investment company|holding company|microfinance|depositor|exchange and data|capital market|ratings|fintech' then 'Financial Services'
    when industry ~* 'software|it enabled|computers|bpo|kpo|data processing|consulting services' then 'IT & Technology'
    when industry ~* 'pharma|hospital|healthcare|medical|biotech|wellness|diagnostic' then 'Healthcare & Pharma'
    when industry ~* 'auto|wheeler|passenger cars|commercial vehicles|tractors|tyres|cycles|construction vehicles' then 'Automobiles & Auto Parts'
    when industry ~* 'fmcg|packaged foods|personal care|household products|breweries|distilleries|tea & coffee|edible oil|dairy|other food|beverages|cigarettes|tobacco|meat|seafood|animal feed' then 'FMCG & Food'
    when industry ~* 'appliances|consumer electronics|jewellery|footwear|furniture|houseware|plastic products - consumer|paints|sanitary|leisure|stationary|glass - consumer|diversified consumer|plywood|ceramics' then 'Consumer Durables'
    when industry ~* 'retail|e-commerce|restaurants|hotels|resorts|travel|amusement|education|e-learning|other consumer services' then 'Consumer Services & Retail'
    when industry ~* 'textile|garments|apparel|leather|jute' then 'Textiles & Apparel'
    when industry ~* 'iron|steel|aluminium|copper|zinc|metals|ferro|mining|minerals|coal|pig iron|sponge|precious' then 'Metals & Mining'
    when industry ~* 'chemical|pesticides|fertilizers|dyes|pigments|petrochemicals|industrial gases|carbon black|explosives|printing inks|lubricants|rubber' then 'Chemicals & Fertilisers'
    when industry ~* 'refineries|oil|gas|lpg|power|electricity|offshore|drilling' then 'Energy & Power'
    when industry ~* 'cement|construction|road assets|dredging|granites|marbles|water supply|waste management' then 'Construction & Infrastructure'
    when industry ~* 'residential|commercial projects|real estate' then 'Real Estate'
    when industry ~* 'telecom|media|broadcasting|film|entertainment|advertising|print|publication|web based' then 'Telecom & Media'
    when industry ~* 'aerospace|defense|ship building' then 'Defence & Aerospace'
    when industry ~* 'electrical|industrial products|compressors|pumps|castings|forgings|abrasives|bearings|electrodes|refractories|cables|plastic products - industrial|railway wagons|glass - industrial|other industrial' then 'Capital Goods & Industrials'
    when industry ~* 'logistics|shipping|\mport|airline|airport|transport|commercial services' then 'Logistics & Services'
    when industry ~* 'paper|packaging|forest' then 'Paper & Packaging'
    when industry ~* 'sugar|agricultural' then 'Agriculture'
    else 'Other'
  end
$$;

create or replace function public.stock_screener() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'as_of', (select max(updated_at) from stock_quotes),
    'fundamentals_as_of', (select max(updated_at) from stocks),
    'rows', coalesce(jsonb_agg(jsonb_build_array(
      q.symbol, coalesce(s.company_name, q.symbol), mp_broad_sector(s.sector), s.sector,
      round(q.price::numeric, 2), round(q.change_percent::numeric, 2),
      case when q.market_cap > 0 then round(q.market_cap / 1e7) end,
      case when s.pe > 0 then round(s.pe::numeric, 1) end,
      round(s.roe::numeric, 1), round(s.roce::numeric, 1),
      round((s.dividend_yield * 100)::numeric, 2),
      case when s.book_value > 0 then round((q.price / s.book_value)::numeric, 2) end,
      case when q.avg_volume_3m > 0 and q.volume >= 0 then round((q.volume / q.avg_volume_3m)::numeric, 2) end,
      round(q.high_52w::numeric, 2), round(q.low_52w::numeric, 2),
      round(q.fifty_day_avg::numeric, 2), round(q.two_hundred_day_avg::numeric, 2),
      coalesce(s.is_fno, false)
    ) order by q.market_cap desc nulls last), '[]'::jsonb)
  )
  from stock_quotes q
  left join stocks s on s.symbol = q.symbol
  where q.price > 0 and q.updated_at > now() - interval '7 days'
$$;
grant execute on function public.stock_screener() to anon, authenticated;
