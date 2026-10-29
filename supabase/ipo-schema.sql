-- IPO list for /ipo.html, written by the ipo-refresh edge function (cron: every 10 minutes) from NSE's public IPO feeds.
create table if not exists public.ipos (
  symbol text primary key,
  company text not null,
  segment text not null default 'Mainboard',      -- Mainboard | SME
  status_nse text,                                 -- Active | Forthcoming | Closed | Listed (as NSE reports it)
  open_date date,
  close_date date,
  listing_date date,
  price_low numeric,
  price_high numeric,
  issue_price numeric,                             -- final price once listed
  lot_size integer,
  shares_offered numeric,
  subscription jsonb,                              -- {total, qib, nii, bnii, snii, retail, employee, ...} in times
  details jsonb,                                   -- [{title, value}] from NSE issue information
  updated_at timestamptz not null default now()
);
create index if not exists ipos_dates_idx on public.ipos (close_date desc);
alter table public.ipos enable row level security;
create policy "IPOs are public" on public.ipos for select to anon, authenticated using (true);

-- select cron.schedule('ipo-refresh', '*/10 * * * *', $$select net.http_post(
--   url := 'https://<project>.supabase.co/functions/v1/ipo-refresh',
--   headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where name='crypto_cron')),
--   body := '{}'::jsonb, timeout_milliseconds := 120000)$$);
