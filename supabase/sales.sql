-- Sales desk (admin-sales.html) and demo requests (for-advisors.html).
--   sales_leads        prospects: SEBI-registered research analysts imported from SEBI's public register
--                      (sales-import Edge Function), demo requests from the website, and ones added by hand
--   sales_activities   what happened with each lead (email, call, WhatsApp, demo, note, stage change)
-- Only the MarketPulse platform admin can read or change them (mp_is_platform_admin(), supabase/tenants.sql).
-- Website visitors can only submit a demo request (submit_demo_request()).

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual' check (source in ('sebi', 'inbound', 'manual', 'referral')),
  reg_no text unique,                        -- SEBI registration number (INH…)
  name text not null,                        -- firm or individual, as registered
  contact_person text,
  email text,
  phone text,
  address text,
  city text,
  validity text,
  kind text check (kind in ('individual', 'firm', 'large')),
  website text,
  priority int not null default 0,           -- higher = better fit (small, independent, reachable)
  stage text not null default 'new' check (stage in ('new', 'contacted', 'replied', 'demo', 'pilot', 'won', 'lost', 'skip')),
  plan text,                                 -- founding / starter / pro / enterprise
  mrr numeric(12, 2),                        -- monthly fee once won (₹, before GST)
  next_action_at date,
  last_contacted_at timestamptz,
  touches int not null default 0,
  demo_link text,
  message text,                              -- what an inbound lead wrote
  notes text,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_leads_stage on public.sales_leads (stage, priority desc);
create index if not exists sales_leads_next on public.sales_leads (next_action_at) where next_action_at is not null;

create table if not exists public.sales_activities (
  id bigserial primary key,
  lead_id uuid not null references public.sales_leads (id) on delete cascade,
  kind text not null check (kind in ('email', 'call', 'whatsapp', 'linkedin', 'demo', 'note', 'stage')),
  body text,
  at timestamptz not null default now()
);
create index if not exists sales_activities_lead on public.sales_activities (lead_id, at desc);

alter table public.sales_leads enable row level security;
alter table public.sales_activities enable row level security;
revoke all on public.sales_leads, public.sales_activities from anon;
grant select, insert, update, delete on public.sales_leads, public.sales_activities to authenticated;
grant usage, select on sequence public.sales_activities_id_seq to authenticated;
drop policy if exists "platform admin" on public.sales_leads;
create policy "platform admin" on public.sales_leads for all to authenticated using ((select public.mp_is_platform_admin())) with check ((select public.mp_is_platform_admin()));
drop policy if exists "platform admin" on public.sales_activities;
create policy "platform admin" on public.sales_activities for all to authenticated using ((select public.mp_is_platform_admin())) with check ((select public.mp_is_platform_admin()));

-- Keep updated_at fresh, and log stage changes.
create or replace function public.sales_lead_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into public.sales_activities (lead_id, kind, body) values (new.id, 'stage', old.stage || ' → ' || new.stage);
  end if;
  return new;
end $$;
drop trigger if exists sales_lead_touch on public.sales_leads;
create trigger sales_lead_touch before update on public.sales_leads for each row execute function public.sales_lead_touch();

-- How well a registered analyst fits: small independents first, big brokers / banks / AMCs last.
create or replace function public.sales_fit(p_name text, p_email text, p_phone text) returns table (kind text, priority int)
language sql immutable as $$
  with n as (select lower(coalesce(p_name, '')) s)
  select k,
         (case k when 'individual' then 60 when 'firm' then 45 else 5 end)
         + (case when coalesce(p_email, '') like '%@%' then 20 else 0 end)
         + (case when coalesce(p_phone, '') ~ '[0-9]{8}' then 10 else 0 end)
         + (case when coalesce(p_email, '') ~* '@(gmail|yahoo|outlook|hotmail|rediffmail)\.' then 10 else 0 end)  -- a one-person shop, likely no tech team
  from (select case
      when s ~ '(bank|insurance|asset management|mutual fund|securities limited|broking|stock ?brokers?|capital markets? (private )?limited|financial services limited|international|global|holdings|jm financial|motilal|kotak|icici|hdfc|axis|sbi|morgan|goldman|jefferies|nomura|citi|ubs|macquarie|barclays|clsa|bofa|credit suisse|360 one|nuvama|angel one|zerodha|upstox|groww|paytm|5paisa|sharekhan|iifl|edelweiss|anand rathi|prabhudas|emkay|ambit|elara|systematix|nirmal bang|antique|dolat|centrum|equirus|investec|bnp|hsbc|dsp|nippon)' then 'large'
      when s ~ '(limited|ltd|llp|private|pvt|partners|associates|research|advisors|advisory|capital|ventures|wealth|consultants?)' then 'firm'
      else 'individual' end k from n) t
$$;

-- Website demo requests (for-advisors.html): anyone may submit; one per email per hour.
create or replace function public.submit_demo_request(p_name text, p_firm text, p_email text, p_phone text default null, p_reg_no text default null, p_website text default null, p_message text default null, p_plan text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(p_email, ''))); r text := upper(trim(coalesce(p_reg_no, ''))); lid uuid;
begin
  if char_length(trim(coalesce(p_name, ''))) < 2 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter your name and a valid email.'; end if;
  if exists (select 1 from public.sales_leads where lower(email) = e and source = 'inbound' and created_at > now() - interval '1 hour') then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if r <> '' then select id into lid from public.sales_leads where reg_no = r; end if;
  if lid is not null then   -- already on the list from SEBI's register: mark it as a warm inbound lead
    update public.sales_leads set source = 'inbound', stage = case when stage in ('new', 'contacted', 'skip') then 'replied' else stage end,
      contact_person = coalesce(nullif(trim(p_name), ''), contact_person), email = e, phone = coalesce(nullif(trim(p_phone), ''), phone),
      website = coalesce(nullif(trim(p_website), ''), website), message = left(p_message, 2000), plan = coalesce(nullif(p_plan, ''), plan),
      priority = greatest(priority, 100), next_action_at = current_date where id = lid;
  else
    insert into public.sales_leads (source, reg_no, name, contact_person, email, phone, website, message, plan, kind, priority, stage, next_action_at)
    values ('inbound', nullif(r, ''), left(coalesce(nullif(trim(p_firm), ''), trim(p_name)), 160), left(trim(p_name), 120), e, left(trim(p_phone), 30),
            left(trim(p_website), 200), left(p_message, 2000), nullif(p_plan, ''), 'firm', 100, 'replied', current_date)
    returning id into lid;
  end if;
  insert into public.sales_activities (lead_id, kind, body) values (lid, 'note', 'Demo request from the website' || coalesce(': ' || left(p_message, 500), ''));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.submit_demo_request(text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_demo_request(text, text, text, text, text, text, text, text) to anon, authenticated;

-- Pipeline numbers for the Sales Desk header.
create or replace function public.sales_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mp_is_platform_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'by_stage', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (select stage, count(*) n from sales_leads group by stage) s),
    'mrr', (select coalesce(sum(mrr), 0) from sales_leads where stage = 'won'),
    'due', (select count(*) from sales_leads where next_action_at <= current_date and stage not in ('won', 'lost', 'skip')),
    'touches_7d', (select count(*) from sales_activities where at > now() - interval '7 days' and kind in ('email', 'call', 'whatsapp', 'linkedin', 'demo')),
    'demos_30d', (select count(*) from sales_activities where at > now() - interval '30 days' and kind = 'demo'),
    'total', (select count(*) from sales_leads),
    'last_import', (select max(created_at) from sales_leads where source = 'sebi'));
end $$;
revoke all on function public.sales_summary() from public, anon;
grant execute on function public.sales_summary() to authenticated;

-- SEBI's register writes emails and some names with numeric HTML entities (&#64; for @).
create or replace function public.mp_decode_entities(t text) returns text language plpgsql immutable as $$
declare m text[];
begin
  if t is null or position('&#' in t) = 0 then return t; end if;
  for m in select regexp_matches(t, '&#(\d{1,6});', 'g') loop
    t := replace(t, '&#' || m[1] || ';', chr(m[1]::int));
  end loop;
  return t;
end $$;
-- "…, CITY, STATE, PIN" → CITY
create or replace function public.mp_city_from_address(a text) returns text language sql immutable as $$
  with p as (select array_remove(regexp_split_to_array(trim(coalesce(a, '')), '\s*,\s*'), '') x)
  select nullif(initcap(lower(trim(case when array_length(x, 1) >= 3 and x[array_length(x, 1)] ~ '^\d{3}\s?\d{3}$' then x[array_length(x, 1) - 2]
                                          when array_length(x, 1) >= 2 then x[array_length(x, 1) - 1] end))), '') from p
$$;

-- SEBI register import (sales-import Edge Function, service role): insert new analysts, refresh details of
-- known ones, never touch a lead's stage, notes or a priority that has been worked on.
create or replace function public.sales_upsert_sebi(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with r as (
    select upper(trim(x->>'reg')) reg, left(trim(mp_decode_entities(x->>'name')), 160) nm, nullif(left(trim(mp_decode_entities(x->>'contact')), 120), '') cp,
           nullif(lower(left(trim(mp_decode_entities(x->>'email')), 160)), '') em, nullif(left(trim(mp_decode_entities(x->>'phone')), 60), '') ph,
           nullif(left(trim(mp_decode_entities(x->>'address')), 400), '') ad, nullif(left(trim(x->>'validity'), 80), '') va
      from jsonb_array_elements(p_rows) x where coalesce(trim(x->>'reg'), '') <> '' and coalesce(trim(x->>'name'), '') <> ''
  ), d as (select distinct on (reg) *, mp_city_from_address(ad) ci from r order by reg),
  f as (select d.*, (sales_fit(nm, em, ph)).* from d)
  insert into sales_leads (source, reg_no, name, contact_person, email, phone, address, city, validity, kind, priority)
  select 'sebi', reg, nm, cp, em, ph, ad, ci, va, kind, priority from f
  on conflict (reg_no) do update set
    name = excluded.name, contact_person = coalesce(excluded.contact_person, sales_leads.contact_person),
    email = coalesce(sales_leads.email, excluded.email), phone = coalesce(sales_leads.phone, excluded.phone),
    address = excluded.address, city = excluded.city, validity = excluded.validity,
    kind = case when sales_leads.source = 'sebi' then excluded.kind else sales_leads.kind end,
    priority = case when sales_leads.stage = 'new' and sales_leads.source = 'sebi' then excluded.priority else sales_leads.priority end;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sales_upsert_sebi(jsonb) from public, anon, authenticated;
