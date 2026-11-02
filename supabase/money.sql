-- Money: personal finance manager (money.html). Every table is private to its owner (RLS on user_id = auth.uid()).
--   pf_categories    the user's spending categories (seeded with sensible defaults on first visit)
--   pf_months        per-month income
--   pf_budgets       planned amount per category per month
--   pf_transactions  actual expenses (optionally flagged as a major expense, linked to a bill or a goal)
--   pf_bills         recurring bills / EMIs / subscriptions with a due day; paid when a transaction links to it that month
--   pf_goals         major planned expenses & savings goals: target, date, amount set aside so far

create table if not exists public.pf_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  icon text not null default '🧾' check (char_length(icon) <= 8),
  kind text not null default 'expense' check (kind in ('expense', 'saving')),
  sort int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.pf_months (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  income numeric(14, 2) not null default 0 check (income >= 0),
  note text check (char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

create table if not exists public.pf_budgets (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  category_id uuid not null references public.pf_categories (id) on delete cascade,
  planned numeric(14, 2) not null default 0 check (planned >= 0),
  primary key (user_id, month, category_id)
);

create table if not exists public.pf_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  icon text not null default '🧾' check (char_length(icon) <= 8),
  amount numeric(14, 2) not null check (amount > 0),
  due_day int not null check (due_day between 1 and 31),
  category_id uuid references public.pf_categories (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pf_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  icon text not null default '🎯' check (char_length(icon) <= 8),
  target_amount numeric(14, 2) not null check (target_amount > 0),
  target_date date,
  saved numeric(14, 2) not null default 0 check (saved >= 0),
  status text not null default 'planned' check (status in ('planned', 'done', 'dropped')),
  category_id uuid references public.pf_categories (id) on delete set null,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create table if not exists public.pf_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  txn_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  amount numeric(14, 2) not null check (amount > 0 and amount < 1e11),
  category_id uuid references public.pf_categories (id) on delete set null,
  note text check (char_length(note) <= 200),
  method text check (method in ('UPI', 'Card', 'Cash', 'Net banking', 'Auto-debit', 'Other')),
  is_major boolean not null default false,
  bill_id uuid references public.pf_bills (id) on delete set null,
  goal_id uuid references public.pf_goals (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists pf_transactions_user_date on public.pf_transactions (user_id, txn_date desc);
create index if not exists pf_transactions_major on public.pf_transactions (user_id, txn_date desc) where is_major;
create index if not exists pf_budgets_category on public.pf_budgets (category_id);
create index if not exists pf_bills_user on public.pf_bills (user_id);
create index if not exists pf_goals_user on public.pf_goals (user_id);
create index if not exists pf_transactions_category on public.pf_transactions (category_id);
create index if not exists pf_transactions_bill on public.pf_transactions (bill_id);
create index if not exists pf_transactions_goal on public.pf_transactions (goal_id);
create index if not exists pf_bills_category on public.pf_bills (category_id);
create index if not exists pf_goals_category on public.pf_goals (category_id);

-- Row level security: each user reads and writes only their own rows.
do $$ declare t text; begin
  foreach t in array array['pf_categories', 'pf_months', 'pf_budgets', 'pf_bills', 'pf_goals', 'pf_transactions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
