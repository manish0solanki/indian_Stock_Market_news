-- "My stocks" ticker on Home, edited on /my-ticker.html: extra stocks each user adds (in order),
-- whether the ticker also shows the stocks they hold in Portfolio, and portfolio stocks they hid. One row per user, readable and writable
-- only by that user.
create table if not exists public.user_ticker (
  user_id uuid primary key references auth.users (id) on delete cascade,
  symbols text[] not null default '{}' check (cardinality(symbols) <= 50),
  show_portfolio boolean not null default true,
  hidden text[] not null default '{}' check (cardinality(hidden) <= 200),
  updated_at timestamptz not null default now()
);

alter table public.user_ticker enable row level security;

drop policy if exists "user_ticker own select" on public.user_ticker;
drop policy if exists "user_ticker own insert" on public.user_ticker;
drop policy if exists "user_ticker own update" on public.user_ticker;
drop policy if exists "user_ticker own delete" on public.user_ticker;
create policy "user_ticker own select" on public.user_ticker for select to authenticated using (auth.uid() = user_id);
create policy "user_ticker own insert" on public.user_ticker for insert to authenticated with check (auth.uid() = user_id);
create policy "user_ticker own update" on public.user_ticker for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_ticker own delete" on public.user_ticker for delete to authenticated using (auth.uid() = user_id);

revoke all on public.user_ticker from anon;
grant select, insert, update, delete on public.user_ticker to authenticated;

-- Users may edit only their own name and picture in profiles; role is not writable from the client.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, avatar_url) on public.profiles to authenticated;
revoke insert, delete, truncate, references, trigger on public.profiles from anon, authenticated;
