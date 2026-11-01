-- Site notifications (the 🔔 bell in the header on every page, notify.js).
-- site_notifications holds one row per event; the dedupe key makes each event notify once.
-- mp_capture_notifications() runs every 5 minutes (pg_cron) and records:
--   * a strong, tradable stock signal (the Home "top signals": stock_signals_top), once per stock/side/bar
--   * festive picks published, and the day before they go out
--   * a festive pick reaching its target
--   * an IPO opening or listing today
-- Announcements of new features ("update") are added with admin_post_notification() or by hand.
-- site_notifications_feed() is the public read: recent items, newest first. "New" is tracked per device
-- in the browser (last time the bell was opened), so it works without signing in.

create table if not exists public.site_notifications (
  id bigserial primary key,
  key text not null unique,
  kind text not null check (kind in ('picks', 'signal', 'target', 'ipo', 'update')),
  icon text,
  title text not null,
  body text,
  url text,
  created_at timestamptz not null default now()
);
create index if not exists site_notifications_created_idx on public.site_notifications (created_at desc);
alter table public.site_notifications enable row level security;
revoke all on public.site_notifications from anon, authenticated;

-- ₹ amounts: whole rupees from ₹1,000 up, paise below.
create or replace function public.mp_inr(v numeric) returns text language sql immutable as $$
  select case when v is null then '—' when abs(v) >= 1000 then '₹' || to_char(round(v), 'FM99,99,99,990') else '₹' || to_char(v, 'FM99,990.00') end $$;

create or replace function public.mp_capture_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0; k int;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  fmt text := 'FM99,99,99,990.00';
begin
  -- strong tradable signals (same list as Home's top signals)
  insert into site_notifications (key, kind, icon, title, body, url, created_at)
  select 'sig:' || (p->>'symbol') || ':' || (p->>'side') || ':' || coalesce(s.bar_date, today::text), 'signal',
         case when p->>'side' = 'BUY' then '📈' else '📉' end,
         'Strong ' || (p->>'side') || ' setup: ' || regexp_replace(coalesce(p->>'name', p->>'symbol'), '\s+(Limited|Ltd\.?)$', '', 'i'),
         initcap(coalesce(p->>'tf', 'swing')) || ' · ' || coalesce(p->>'setup', 'signal') || ' · entry ' || mp_inr((p->>'entry')::numeric)
           || ', target ' || mp_inr((p->>'target1')::numeric) || ', stop ' || mp_inr((p->>'stop')::numeric),
         '/stock-signals.html', now()
    from jsonb_array_elements(coalesce(stock_signals_top(6, 120)->'picks', '[]'::jsonb)) p
    left join stock_signals s on s.symbol = p->>'symbol' and s.side = p->>'side' and s.tf = p->>'tf'
  on conflict (key) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- festive picks published
  insert into site_notifications (key, kind, icon, title, body, url, created_at)
  select 'picks:' || o.slug, 'picks', case o.theme when 'diwali' then '🪔' when 'newyear' then '🎆' when 'holi' then '🎨' when 'akshaya' then '🪙' when 'independence' then '🇮🇳' else '✨' end,
         o.title || ' are out',
         '15 stocks for the next 12 months: 5 large, 5 mid and 5 small caps, with targets, reasons and a calculator.',
         '/picks.html?o=' || o.slug, coalesce(o.published_at, now())
    from pick_occasions o where o.status = 'published'
  on conflict (key) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- festive picks coming tomorrow
  insert into site_notifications (key, kind, icon, title, body, url)
  select 'picks-soon:' || o.slug, 'picks', '⏳', o.title || ' go live tomorrow',
         'Our ' || o.name || ' stock picks publish on ' || to_char(o.publish_on, 'DD Mon') || ' before the market opens.',
         '/picks.html?o=' || o.slug
    from pick_occasions o where o.status = 'scheduled' and o.publish_on = today + 1
  on conflict (key) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- festive pick reached its target
  insert into site_notifications (key, kind, icon, title, body, url)
  select 'hit:' || f.occasion || ':' || f.symbol, 'target', '🎯',
         regexp_replace(coalesce(f.company_name, f.symbol), '\s+(Limited|Ltd\.?)$', '', 'i') || ' hit its ' || o.title || ' target',
         'Picked at ' || mp_inr(f.pick_price) || ', target ' || mp_inr(f.target_price) || ' reached on ' || to_char(f.target_hit_on, 'DD Mon') || '.',
         '/picks.html?o=' || f.occasion
    from festive_picks f join pick_occasions o on o.slug = f.occasion
   where f.target_hit_on is not null and f.target_hit_on >= today - 7
  on conflict (key) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- IPOs opening or listing today
  insert into site_notifications (key, kind, icon, title, body, url)
  select 'ipo-open:' || i.symbol || ':' || i.open_date, 'ipo', '🆕', 'IPO opens today: ' || regexp_replace(i.company, '\s+(Limited|Ltd\.?)$', '', 'i'),
         coalesce('Price band ₹' || to_char(i.price_low, 'FM99,990') || '–' || to_char(i.price_high, 'FM99,990') || ' · ', '')
           || coalesce('closes ' || to_char(i.close_date, 'DD Mon'), '') || coalesce(' · ' || i.segment, ''),
         '/ipo.html'
    from ipos i where i.open_date = today
  on conflict (key) do nothing;
  get diagnostics k = row_count; n := n + k;
  insert into site_notifications (key, kind, icon, title, body, url)
  select 'ipo-list:' || i.symbol || ':' || i.listing_date, 'ipo', '🔔', regexp_replace(i.company, '\s+(Limited|Ltd\.?)$', '', 'i') || ' lists today',
         coalesce('Issue price ₹' || to_char(coalesce(i.issue_price, i.price_high), 'FM99,990') || '. ', '') || 'See subscription and grey-market data.',
         '/ipo.html'
    from ipos i where i.listing_date = today
  on conflict (key) do nothing;
  get diagnostics k = row_count; n := n + k;

  delete from site_notifications where created_at < now() - interval '60 days';
  return n;
end $$;
revoke all on function public.mp_capture_notifications() from public, anon, authenticated;

-- Public feed: announcements and picks for 30 days, signals for 3 days, everything else for 14.
create or replace function public.site_notifications_feed(p_limit int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('now', now(), 'items', coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'icon', icon, 'title', title, 'body', body, 'url', url, 'at', created_at
  ) order by created_at desc, id desc), '[]'::jsonb))
  from (
    select * from site_notifications
     where created_at > now() - case kind when 'signal' then interval '3 days' when 'update' then interval '30 days'
                                         when 'picks' then interval '30 days' else interval '14 days' end
     order by created_at desc, id desc limit greatest(1, least(p_limit, 60))
  ) t;
$$;
grant execute on function public.site_notifications_feed(int) to anon, authenticated;

-- Admins post an announcement (shows in everyone's bell).
create or replace function public.admin_post_notification(p_title text, p_body text default null, p_url text default null, p_icon text default '✨')
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'admins only' using errcode = '42501'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'title required'; end if;
  insert into site_notifications (key, kind, icon, title, body, url)
  values ('update:' || gen_random_uuid(), 'update', coalesce(nullif(p_icon, ''), '✨'), left(trim(p_title), 140), left(p_body, 400), nullif(trim(p_url), ''))
  returning id into v;
  return v;
end $$;
revoke all on function public.admin_post_notification(text, text, text, text) from public, anon;
grant execute on function public.admin_post_notification(text, text, text, text) to authenticated;

select cron.unschedule('notifications-capture') where exists (select 1 from cron.job where jobname = 'notifications-capture');
select cron.schedule('notifications-capture', '*/5 * * * *', $cron$select public.mp_capture_notifications()$cron$);

-- Launch announcements
insert into public.site_notifications (key, kind, icon, title, body, url, created_at) values
  ('update:festive-picks-launch', 'update', '✨', 'New: Festive Picks', 'Stock picks for every festival, starting with Diwali 2026, with targets, reasons, risks and a live track record.', '/picks.html', '2026-10-31 20:35+00'),
  ('update:picks-downloads', 'update', '🖼️', 'Download the picks as an image or PDF', 'Share a festive poster or WhatsApp story, or keep the full PDF report.', '/picks.html', '2026-11-01 00:10+00'),
  ('update:picks-calculator', 'update', '💰', 'New: investment calculator', 'Enter an amount and see how many shares of each pick to buy.', '/picks.html#calc', now())
on conflict (key) do nothing;
