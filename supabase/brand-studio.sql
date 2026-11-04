-- Brand Studio clients (brand-studio.html → brand-publish Edge Function → brands.js on GitHub).
-- A client's white-label brand is saved on its tenants row (supabase/tenants.sql). Publishing writes all
-- active brands to brands.js in the repo, which every page loads before brand.js; Vercel deploys the commit.
-- Platform admin (MarketPulse admin on the main site) only.

alter table public.tenants add column if not exists brand jsonb;
alter table public.tenants add column if not exists updated_at timestamptz not null default now();
alter table public.tenants add column if not exists published_at timestamptz;

-- Saved clients with their brand config and user counts.
create or replace function public.admin_brands() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'slug', t.slug, 'name', t.name, 'hosts', t.hosts, 'active', t.active, 'brand', t.brand,
      'updated_at', t.updated_at, 'published_at', t.published_at,
      'users', (select count(*) from auth.users u where u.raw_app_meta_data ->> 'tenant' = t.slug)
    ) order by t.name)
    from public.tenants t where t.slug not in ('marketpulse', 'demo')), '[]'::jsonb);
end $$;
revoke all on function public.admin_brands() from public, anon;
grant execute on function public.admin_brands() to authenticated;

-- Add or update a client: its slug, domains, on/off and brand (the Brand Studio form).
create or replace function public.admin_save_brand(p_slug text, p_brand jsonb, p_hosts text[] default '{}', p_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s text := lower(trim(coalesce(p_slug, ''))); nm text := trim(coalesce(p_brand ->> 'name', ''));
  h text[] := array(select distinct regexp_replace(regexp_replace(lower(trim(x)), '^https?://', ''), '[/?#].*$', '')
                      from unnest(coalesce(p_hosts, '{}')) x where trim(x) <> '');
  clash text;
begin
  if not public.mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if s !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'slug: 2–40 lowercase letters, numbers or hyphens'; end if;
  if s in ('marketpulse', 'demo', 'reset') then raise exception '"%" is reserved', s; end if;
  if nm = '' then raise exception 'the brand needs a name'; end if;
  if octet_length(p_brand::text) > 250000 then raise exception 'the brand is too large (use a smaller logo)'; end if;
  if exists (select 1 from unnest(h) d where d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') then raise exception 'check the domain(s): use something like research.acme.in'; end if;
  select slug into clash from public.tenants where slug <> s and hosts && h limit 1;
  if clash is not null then raise exception 'a domain is already used by %', clash; end if;
  insert into public.tenants (slug, name, hosts, active, brand, updated_at)
  values (s, left(nm, 80), h, coalesce(p_active, true), p_brand - 'hosts', now())
  on conflict (slug) do update set name = excluded.name, hosts = excluded.hosts, active = excluded.active, brand = excluded.brand, updated_at = now();
  return jsonb_build_object('slug', s, 'hosts', h);
end $$;
revoke all on function public.admin_save_brand(text, jsonb, text[], boolean) from public, anon;
grant execute on function public.admin_save_brand(text, jsonb, text[], boolean) to authenticated;

-- Remove a client. With no users it is deleted; with users it is switched off and its brand removed
-- (accounts are kept, and nobody can sign up on its site any more). Publish afterwards to take it off the site.
create or replace function public.admin_delete_brand(p_slug text) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_slug in ('marketpulse', 'demo') then raise exception '"%" can''t be removed', p_slug; end if;
  select count(*) into n from auth.users where raw_app_meta_data ->> 'tenant' = p_slug;
  if n = 0 then delete from public.tenants where slug = p_slug; return 'deleted'; end if;
  update public.tenants set active = false, brand = null, hosts = '{}', updated_at = now() where slug = p_slug;
  return 'archived';
end $$;
revoke all on function public.admin_delete_brand(text) from public, anon;
grant execute on function public.admin_delete_brand(text) to authenticated;
