-- Per-client user separation for white-label (brand.js, admin-clients.html).
--
-- Every user belongs to exactly one client site ("tenant"): marketpulse (the main site), demo (white-label
-- demo links), or a client's slug. The tenant is stored in the user's app_metadata, which only the
-- server can write, so it is inside every login token (JWT). Each request also says which site it came
-- from (header x-mp-tenant, added by brand.js to every Supabase call). A restrictive policy on every
-- table that holds a user's own data lets a request through only when the two match, so an account
-- made on one client's site can't read or write anything when used on another.
--
--   tenants          the client sites (slug = the brand slug in brand.js BRANDS)
--   tenant_admins    who can see a client's user list (the client's own admins)
--   claim_tenant()   first sign-in by Google / phone (no sign-up form) records the site it happened on
--   tenants_overview(), tenant_users()                       client and platform admin views
--   admin_upsert_tenant(), admin_set_tenant_admin()          platform admin (MarketPulse) only
--
-- Logins themselves are one pool for the whole project: an email can hold one account, on one site.

create table if not exists public.tenants (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  hosts text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.tenants enable row level security;
revoke all on public.tenants from anon, authenticated;
insert into public.tenants (slug, name) values ('marketpulse', 'MarketPulse'), ('demo', 'White-label demos')
on conflict (slug) do nothing;

create table if not exists public.tenant_admins (
  tenant text not null references public.tenants (slug) on delete cascade on update cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (tenant, user_id)
);
create index if not exists tenant_admins_user on public.tenant_admins (user_id);
alter table public.tenant_admins enable row level security;
revoke all on public.tenant_admins from anon, authenticated;

-- Which site the request came from, and which site the signed-in user belongs to.
-- Requests without the header (cron jobs, the main site before this change) count as marketpulse.
create or replace function public.mp_request_tenant() returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(lower(current_setting('request.headers', true)::json ->> 'x-mp-tenant'), ''), 'marketpulse')
$$;
create or replace function public.mp_user_tenant() returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'tenant', ''), 'marketpulse')
$$;
create or replace function public.mp_tenant_ok() returns boolean
language sql stable set search_path = public as $$
  select public.mp_user_tenant() = public.mp_request_tenant()
$$;
grant execute on function public.mp_request_tenant(), public.mp_user_tenant(), public.mp_tenant_ok() to anon, authenticated;

-- The gate: on every table of a user's own data, both sides must be the same site.
do $$ declare t text; begin
  foreach t in array array[
    'profiles', 'watchlist', 'stock_alerts', 'user_ticker', 'portfolios', 'portfolio_transactions', 'portfolio_mf_transactions',
    'stock_paper_accounts', 'stock_paper_trades', 'crypto_bot_settings', 'crypto_trades', 'crypto_wallet_transactions', 'crypto_shadow_trades',
    'pf_categories', 'pf_months', 'pf_budgets', 'pf_bills', 'pf_goals', 'pf_transactions', 'pf_income_sources', 'pf_incomes', 'user_moonshot_api_keys']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "same site only" on public.%I', t);
    execute format('create policy "same site only" on public.%I as restrictive for all to authenticated using ((select public.mp_tenant_ok())) with check ((select public.mp_tenant_ok()))', t);
  end loop;
end $$;

-- New accounts: the site they signed up on (sent by brand.js with the sign-up form) becomes their tenant,
-- if it's a real, active client. Google / phone sign-ins carry no form data and are claimed on first sign-in.
create or replace function public.mp_set_new_user_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
declare want text := lower(new.raw_user_meta_data ->> 'tenant');
begin
  if coalesce(new.raw_app_meta_data ->> 'tenant', '') = '' and want is not null
     and exists (select 1 from public.tenants where slug = want and active) then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('tenant', want);
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_tenant on auth.users;
create trigger on_auth_user_tenant before insert on auth.users for each row execute function public.mp_set_new_user_tenant();

-- First sign-in without a tenant (Google / phone): record the site, once. Returns the user's tenant,
-- or null when that site isn't taking accounts.
create or replace function public.claim_tenant(p_tenant text) returns text
language plpgsql security definer set search_path = public as $$
declare cur text; want text := lower(coalesce(p_tenant, ''));
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select raw_app_meta_data ->> 'tenant' into cur from auth.users where id = auth.uid();
  if coalesce(cur, '') <> '' then return cur; end if;
  -- an unknown or switched-off site gets no accounts (the page then signs the user out)
  if not exists (select 1 from public.tenants where slug = want and active) then return null; end if;
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('tenant', want) where id = auth.uid();
  return want;
end $$;
revoke all on function public.claim_tenant(text) from public, anon;
grant execute on function public.claim_tenant(text) to authenticated;

-- Accounts made before this change belong to the main site.
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"tenant":"marketpulse"}'::jsonb
 where coalesce(raw_app_meta_data ->> 'tenant', '') = '';

-- Platform admin: a MarketPulse admin (profiles.role = 'admin') signed in on the main site.
create or replace function public.mp_is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mp_user_tenant() = 'marketpulse' and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;
revoke all on function public.mp_is_platform_admin() from public, anon;
grant execute on function public.mp_is_platform_admin() to authenticated;

-- Clients the caller can see, with user counts: all of them for the platform admin, their own for a client admin.
create or replace function public.tenants_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare plat boolean := public.mp_is_platform_admin();
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  return jsonb_build_object('platform', plat, 'me', public.mp_user_tenant(), 'tenants', coalesce((
    select jsonb_agg(jsonb_build_object(
      'slug', t.slug, 'name', t.name, 'hosts', t.hosts, 'active', t.active, 'created_at', t.created_at,
      'users', (select count(*) from auth.users u where coalesce(u.raw_app_meta_data ->> 'tenant', 'marketpulse') = t.slug),
      'new_30d', (select count(*) from auth.users u where coalesce(u.raw_app_meta_data ->> 'tenant', 'marketpulse') = t.slug and u.created_at > now() - interval '30 days'),
      'admins', (select coalesce(jsonb_agg(u.email order by u.email), '[]'::jsonb) from public.tenant_admins a join auth.users u on u.id = a.user_id where a.tenant = t.slug)
    ) order by t.slug = 'marketpulse' desc, t.slug = 'demo' desc, t.name)
    from public.tenants t
    where plat or exists (select 1 from public.tenant_admins a where a.tenant = t.slug and a.user_id = auth.uid() and t.slug = public.mp_user_tenant())
  ), '[]'::jsonb));
end $$;
revoke all on function public.tenants_overview() from public, anon;
grant execute on function public.tenants_overview() to authenticated;

-- A client's users (newest first). Client admins see only their own client, and only from its site.
create or replace function public.tenant_users(p_tenant text, p_limit int default 100, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.mp_is_platform_admin()
          or (p_tenant = public.mp_user_tenant() and exists (select 1 from public.tenant_admins where tenant = p_tenant and user_id = auth.uid()))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object('tenant', p_tenant,
    'total', (select count(*) from auth.users u where coalesce(u.raw_app_meta_data ->> 'tenant', 'marketpulse') = p_tenant),
    'users', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select u.email, u.phone, coalesce(p.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') as name,
             u.raw_app_meta_data ->> 'provider' as provider, u.created_at, u.last_sign_in_at,
             exists (select 1 from public.tenant_admins a where a.tenant = p_tenant and a.user_id = u.id) as admin
        from auth.users u left join public.profiles p on p.id = u.id
       where coalesce(u.raw_app_meta_data ->> 'tenant', 'marketpulse') = p_tenant
       order by u.created_at desc limit greatest(1, least(p_limit, 500)) offset greatest(0, p_offset)) x), '[]'::jsonb));
end $$;
revoke all on function public.tenant_users(text, int, int) from public, anon;
grant execute on function public.tenant_users(text, int, int) to authenticated;

-- Platform admin: add or edit a client site.
create or replace function public.admin_upsert_tenant(p_slug text, p_name text, p_hosts text[] default '{}', p_active boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if lower(p_slug) in ('marketpulse') and not p_active then raise exception 'the main site cannot be switched off'; end if;
  insert into public.tenants (slug, name, hosts, active) values (lower(trim(p_slug)), trim(p_name), coalesce(p_hosts, '{}'), p_active)
  on conflict (slug) do update set name = excluded.name, hosts = excluded.hosts, active = excluded.active;
end $$;
revoke all on function public.admin_upsert_tenant(text, text, text[], boolean) from public, anon;
grant execute on function public.admin_upsert_tenant(text, text, text[], boolean) to authenticated;

-- Platform admin: make a user (by email) an admin of a client, or remove them. The user must belong to that client.
create or replace function public.admin_set_tenant_admin(p_tenant text, p_email text, p_add boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid; ut text;
begin
  if not public.mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select id, coalesce(raw_app_meta_data ->> 'tenant', 'marketpulse') into uid, ut from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'no account with that email'; end if;
  if p_add then
    if ut <> p_tenant then raise exception 'that account belongs to %, not %', ut, p_tenant; end if;
    insert into public.tenant_admins (tenant, user_id) values (p_tenant, uid) on conflict do nothing;
    return 'added';
  end if;
  delete from public.tenant_admins where tenant = p_tenant and user_id = uid;
  return 'removed';
end $$;
revoke all on function public.admin_set_tenant_admin(text, text, boolean) from public, anon;
grant execute on function public.admin_set_tenant_admin(text, text, boolean) to authenticated;
