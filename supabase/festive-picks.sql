-- Festive picks (picks.html): 5 large-cap, 5 mid-cap and 5 small-cap stocks for long-term investment,
-- published for each occasion (Diwali, New Year, Holi, ...). Picked by the festive-picks Edge Function:
--   1. festive_pick_candidates() screens every stock for quality, value, trend and liquidity and returns a
--      shortlist per size bucket (SEBI style: top 100 by market cap = large, 101-250 = mid, rest = small);
--   2. the function adds the latest quarterly results (growth), drops shrinking businesses, keeps sectors
--      diverse, sets a 12-month model target and writes the reasons and risks.
-- Published picks are never rewritten, so every occasion keeps an honest track record (return since the
-- pick vs Nifty 50). Add or move occasions by editing pick_occasions (dates below are planned dates).

create table if not exists public.pick_occasions (
  slug text primary key,
  name text not null,                -- "Diwali"
  title text not null,               -- "Diwali Picks 2026"
  subtitle text,                     -- "Samvat 2083"
  theme text not null default 'diwali',
  event_date date not null,
  publish_on date not null,          -- picks are generated on this day (IST) from the latest prices
  horizon_months int not null default 12,
  status text not null default 'scheduled' check (status in ('scheduled', 'published', 'skipped')),
  published_at timestamptz,
  nifty_at_pick numeric,
  market_note jsonb,
  created_at timestamptz not null default now()
);
alter table public.pick_occasions enable row level security;
revoke all on public.pick_occasions from anon, authenticated;

create table if not exists public.festive_picks (
  id bigserial primary key,
  occasion text not null references public.pick_occasions(slug) on delete cascade,
  cap text not null check (cap in ('large', 'mid', 'small')),
  rank int not null,
  symbol text not null,
  company_name text,
  sector text,
  broad_sector text,
  pick_price numeric not null,
  target_price numeric not null,
  mcap_cr numeric,
  score numeric,
  metrics jsonb,          -- pe, sector pe, roe, roce, growth, 52w range, promoter holding, target maths
  thesis text[],
  risks text[],
  target_hit_on date,
  created_at timestamptz not null default now(),
  unique (occasion, symbol)
);
alter table public.festive_picks enable row level security;
revoke all on public.festive_picks from anon, authenticated;

insert into public.pick_occasions (slug, name, title, subtitle, theme, event_date, publish_on) values
  ('diwali-2026', 'Diwali', 'Diwali Picks 2026', 'Samvat 2083', 'diwali', '2026-11-08', '2026-10-31'),
  ('new-year-2027', 'New Year', 'New Year Picks 2027', 'Fresh start for 2027', 'newyear', '2027-01-01', '2027-01-01'),
  ('holi-2027', 'Holi', 'Holi Picks 2027', 'A colourful portfolio', 'holi', '2027-03-22', '2027-03-19'),
  ('akshaya-tritiya-2027', 'Akshaya Tritiya', 'Akshaya Tritiya Picks 2027', 'Buy what lasts', 'akshaya', '2027-05-09', '2027-05-07'),
  ('independence-day-2027', 'Independence Day', 'Independence Day Picks 2027', 'Bet on India', 'independence', '2027-08-15', '2027-08-13'),
  ('diwali-2027', 'Diwali', 'Diwali Picks 2027', 'Samvat 2084', 'diwali', '2027-10-29', '2027-10-25')
on conflict (slug) do nothing;

-- Shortlist for the Edge Function (service role only). One row per eligible stock, best first per bucket.
create or replace function public.festive_pick_candidates(p_per_bucket int default 16)
returns jsonb language sql stable security definer set search_path = public as $$
  with base as (
    select q.symbol, coalesce(s.company_name, q.symbol) as name, s.sector, mp_broad_sector(s.sector) as bs,
           q.price, q.market_cap / 1e7 as mcap, s.pe, s.roe, s.roce, coalesce(s.dividend_yield, 0) * 100 as dy,
           s.book_value, s.promoters_latest * 100 as promoter, s.promoters_change as promoter_chg,
           q.high_52w, q.low_52w, q.fifty_day_avg as d50, q.two_hundred_day_avg as d200,
           q.avg_volume_3m * q.price / 1e7 as turnover_cr,
           row_number() over (order by q.market_cap desc nulls last) as mrank
    from stock_quotes q join stocks s on s.symbol = q.symbol
    where q.price > 0 and q.market_cap > 0 and q.updated_at > now() - interval '7 days'
  ), b as (
    select *, case when mrank <= 100 then 'large' when mrank <= 250 then 'mid' else 'small' end as cap,
           bs in ('Banks', 'Financial Services') as fin
    from base
  ), med as (  -- sector P/E: the industry median when it has 5+ profitable peers, else the broad sector's
    select sector, percentile_cont(0.5) within group (order by pe) as pe_med, count(*) as n
    from b where pe > 0 and pe < 200 group by sector
  ), bmed as (
    select bs, percentile_cont(0.5) within group (order by pe) as pe_med
    from b where pe > 0 and pe < 200 group by bs
  ), e as (
    select b.*, case when m.n >= 5 then m.pe_med else bm.pe_med end as sector_pe
    from b left join med m on m.sector = b.sector left join bmed bm on bm.bs = b.bs
    where b.sector is not null and b.bs <> 'Other'
      and b.price >= 20 and b.mcap >= 3000
      and b.pe between 3 and case when b.fin then 35 when b.cap = 'small' then 60 else 75 end
      and b.roe >= case when b.fin then 11 else 13 end and b.roe <= 100   -- >100% ROE is usually a one-off gain
      and (b.fin or b.pe >= 6)                                            -- so is a P/E under 6
      and (b.fin or coalesce(b.roce, 0) >= 13)
      and b.d200 > 0 and b.price between 0.88 * b.d200 and 1.4 * b.d200      -- no falling knives, not overheated
      and b.high_52w > 0 and b.price >= 0.55 * b.high_52w
      and b.turnover_cr >= case b.cap when 'small' then 2 when 'mid' then 8 else 20 end
      and coalesce(b.promoter_chg, 0) > -5
  ), s as (
    select e.*,
      percent_rank() over (partition by cap order by case when fin then roe else (roe + roce) / 2 end) as q_rank,
      1 - percent_rank() over (partition by cap order by pe / nullif(sector_pe, 0)) as v_rank,
      -- trend: best a little above the 200-day average with the 50-day above the 200-day
      greatest(0, 1 - abs(price / d200 - 1.08) / 0.3) * 0.7 + case when d50 > d200 then 0.3 else 0 end as t_score,
      -- room to the 52-week high: 8-30% below it scores best
      greatest(0, 1 - abs((1 - price / high_52w) - 0.18) / 0.25) as r_score
    from e
  ), scored as (
    select s.*, round((0.38 * q_rank + 0.30 * v_rank + 0.18 * t_score + 0.10 * r_score
           + least(dy, 4) / 100 + case when promoter_chg > 0.2 then 0.02 else 0 end)::numeric, 4) as score1
    from s
  ), ranked as (
    select scored.*, row_number() over (partition by cap, bs order by score1 desc) as sector_rk
    from scored
  ), short as (
    select *, row_number() over (partition by cap order by score1 desc) as srk
    from ranked where sector_rk <= 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'symbol', symbol, 'name', name, 'sector', sector, 'broad_sector', bs, 'cap', cap, 'fin', fin,
    'price', round(price::numeric, 2), 'mcap_cr', round(mcap::numeric), 'pe', round(pe::numeric, 1),
    'sector_pe', round(sector_pe::numeric, 1), 'roe', round(roe::numeric, 1), 'roce', round(roce::numeric, 1),
    'dy', round(dy::numeric, 2), 'pb', case when book_value > 0 then round((price / book_value)::numeric, 2) end,
    'promoter', round(promoter::numeric, 1), 'promoter_chg', round(promoter_chg::numeric, 2),
    'high_52w', high_52w, 'low_52w', low_52w, 'd50', round(d50::numeric, 2), 'd200', round(d200::numeric, 2),
    'turnover_cr', round(turnover_cr::numeric, 1), 'score1', score1,
    'q_rank', round(q_rank::numeric, 3), 'v_rank', round(v_rank::numeric, 3)
  ) order by cap, score1 desc), '[]'::jsonb)
  from short where srk <= p_per_bucket;
$$;
revoke all on function public.festive_pick_candidates(int) from public, anon, authenticated;

-- Public page data: every published or upcoming occasion, and the chosen occasion's picks with live prices.
create or replace function public.festive_picks_page(p_slug text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  sel text;
  nifty numeric;
begin
  select price into nifty from index_quotes where symbol = '^NSEI';
  sel := coalesce(p_slug, (select slug from pick_occasions where status = 'published' order by published_at desc limit 1));
  return jsonb_build_object(
    'nifty', nifty,
    'as_of', (select max(updated_at) from stock_quotes),
    'occasions', (select coalesce(jsonb_agg(jsonb_build_object(
        'slug', o.slug, 'name', o.name, 'title', o.title, 'subtitle', o.subtitle, 'theme', o.theme,
        'event_date', o.event_date, 'publish_on', o.publish_on, 'status', o.status, 'published_at', o.published_at,
        'nifty_at_pick', o.nifty_at_pick, 'horizon_months', o.horizon_months,
        'basket_return', (select round(avg((coalesce(q.price, p.pick_price) / p.pick_price - 1) * 100)::numeric, 2)
                          from festive_picks p left join stock_quotes q on q.symbol = p.symbol where p.occasion = o.slug)
      ) order by o.event_date), '[]'::jsonb)
      from pick_occasions o where o.status = 'published' or (o.status = 'scheduled' and o.event_date >= current_date - 7)),
    'selected', sel,
    'occasion', (select to_jsonb(o) - 'created_at' from pick_occasions o where o.slug = sel and o.status = 'published'),
    'picks', (select coalesce(jsonb_agg(jsonb_build_object(
        'cap', p.cap, 'rank', p.rank, 'symbol', p.symbol, 'name', p.company_name, 'sector', p.sector,
        'broad_sector', p.broad_sector, 'pick_price', p.pick_price, 'target_price', p.target_price,
        'mcap_cr', p.mcap_cr, 'metrics', p.metrics, 'thesis', p.thesis, 'risks', p.risks,
        'target_hit_on', p.target_hit_on, 'price', q.price, 'change_percent', round(q.change_percent::numeric, 2),
        'high_52w', q.high_52w, 'low_52w', q.low_52w
      ) order by case p.cap when 'large' then 1 when 'mid' then 2 else 3 end, p.rank), '[]'::jsonb)
      from festive_picks p left join stock_quotes q on q.symbol = p.symbol
      join pick_occasions o on o.slug = p.occasion and o.status = 'published'
      where p.occasion = sel)
  );
end $$;
grant execute on function public.festive_picks_page(text) to anon, authenticated;

-- Mark picks that reached their target (checked by the daily festive-picks run).
create or replace function public.festive_picks_mark_hits() returns int
language sql security definer set search_path = public as $$
  with u as (
    update festive_picks p set target_hit_on = current_date
    from stock_quotes q
    where q.symbol = p.symbol and p.target_hit_on is null
      and greatest(q.price, coalesce(q.high, 0)) >= p.target_price
    returning 1
  ) select count(*)::int from u;
$$;
revoke all on function public.festive_picks_mark_hits() from public, anon, authenticated;

-- Daily at 08:41 IST (before the market opens, so the pick price is the last close): publishes any occasion
-- whose publish date has come and marks picks that reached their target. Admins can also run it from
-- Admin Panel > Data health ("Run now"); a published occasion is never re-picked.
select cron.unschedule('festive-picks') where exists (select 1 from cron.job where jobname = 'festive-picks');
select cron.schedule('festive-picks', '11 3 * * *', $cron$select net.http_post(url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/festive-picks', headers := jsonb_build_object('x-cron-secret', (select value from public.app_secrets where name = 'crypto_cron'), 'Content-Type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 150000)$cron$);
