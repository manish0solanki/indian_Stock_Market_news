-- MarketPulse Portfolio Tracker
-- DEV BRANCH ONLY. Run this in Supabase SQL Editor before testing live portfolio data.
-- This schema stores transactions, not just a calculated holding.
-- RLS ensures each signed-in user can access only their own portfolios/transactions.

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Portfolio',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_transactions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  exchange text not null default 'NSE' check (exchange in ('NSE','BSE')),
  transaction_type text not null check (transaction_type in ('BUY','SELL')),
  quantity numeric(18,6) not null check (quantity > 0),
  price numeric(18,4) not null check (price > 0),
  charges numeric(18,4) not null default 0 check (charges >= 0),
  trade_date date not null default current_date,
  notes text,
  source text not null default 'MANUAL' check (source in ('MANUAL','CSV')),
  created_at timestamptz not null default now()
);

create index if not exists portfolios_user_idx
  on public.portfolios(user_id);

create index if not exists portfolio_transactions_user_idx
  on public.portfolio_transactions(user_id, trade_date desc);

create index if not exists portfolio_transactions_portfolio_idx
  on public.portfolio_transactions(portfolio_id, symbol, trade_date asc);

alter table public.portfolios enable row level security;
alter table public.portfolio_transactions enable row level security;

revoke all on table public.portfolios from anon;
revoke all on table public.portfolio_transactions from anon;

grant select, insert, update, delete on table public.portfolios to authenticated;
grant select, insert, update, delete on table public.portfolio_transactions to authenticated;

drop policy if exists "Users can read own portfolios" on public.portfolios;
create policy "Users can read own portfolios"
on public.portfolios for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own portfolios" on public.portfolios;
create policy "Users can create own portfolios"
on public.portfolios for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own portfolios" on public.portfolios;
create policy "Users can update own portfolios"
on public.portfolios for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own portfolios" on public.portfolios;
create policy "Users can delete own portfolios"
on public.portfolios for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own portfolio transactions" on public.portfolio_transactions;
create policy "Users can read own portfolio transactions"
on public.portfolio_transactions for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own portfolio transactions" on public.portfolio_transactions;
create policy "Users can create own portfolio transactions"
on public.portfolio_transactions for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own portfolio transactions" on public.portfolio_transactions;
create policy "Users can update own portfolio transactions"
on public.portfolio_transactions for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own portfolio transactions" on public.portfolio_transactions;
create policy "Users can delete own portfolio transactions"
on public.portfolio_transactions for delete to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_portfolio_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portfolios_updated_at on public.portfolios;
create trigger portfolios_updated_at
before update on public.portfolios
for each row execute function public.set_portfolio_updated_at();

-- Optional: automatically create the first portfolio for a new Auth user.
-- This is safe to run if the profiles trigger already exists.
create or replace function public.ensure_default_portfolio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.portfolios(user_id, name)
  values (new.id, 'My Portfolio')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_portfolio on auth.users;
create trigger on_auth_user_created_portfolio
after insert on auth.users
for each row execute function public.ensure_default_portfolio();

-- Backfill one default portfolio for users who already exist.
insert into public.portfolios(user_id, name)
select id, 'My Portfolio'
from auth.users
where not exists (
  select 1 from public.portfolios p where p.user_id = auth.users.id
);
