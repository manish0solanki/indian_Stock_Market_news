-- Economic calendar shown on events.html next to company events: RBI policy, India CPI and GDP,
-- the Union Budget, US Fed (FOMC) decisions and US CPI.
-- event_date / time_ist are when the number or decision reaches Indian screens (IST), so a Fed
-- decision at 2 pm New York time lands on the next IST day in winter (00:30 IST).
-- confirmed = false marks dates that follow the usual pattern but were not read from the official
-- calendar (or that the publisher itself calls tentative). actual / previous / note can be filled in
-- after each release; the page shows whatever is there.
create table if not exists public.econ_events (
  id text primary key,
  event_date date not null,
  time_ist text,
  country text not null check (country in ('IN', 'US')),
  kind text not null,          -- rbi | fomc | cpi | gdp | uscpi | budget
  title text not null,
  period text,                 -- the month / quarter the data is for
  confirmed boolean not null default true,
  previous text,
  actual text,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.econ_events enable row level security;
drop policy if exists "Public can read econ events" on public.econ_events;
create policy "Public can read econ events" on public.econ_events for select using (true);
create index if not exists econ_events_date on public.econ_events (event_date);

insert into public.econ_events (id, event_date, time_ist, country, kind, title, period, confirmed, note) values
  -- RBI Monetary Policy Committee, FY 2026-27 (RBI press release, 23 Mar 2026). Decision on the last day, 10:00 IST.
  ('rbi-2026-08', '2026-08-05', '10:00', 'IN', 'rbi', 'RBI policy decision', 'MPC meeting 3–5 Aug 2026', true, null),
  ('rbi-2026-10', '2026-10-07', '10:00', 'IN', 'rbi', 'RBI policy decision', 'MPC meeting 5–7 Oct 2026', true, null),
  ('rbi-2026-12', '2026-12-04', '10:00', 'IN', 'rbi', 'RBI policy decision', 'MPC meeting 2–4 Dec 2026', true, null),
  ('rbi-2027-02', '2027-02-05', '10:00', 'IN', 'rbi', 'RBI policy decision', 'MPC meeting 3–5 Feb 2027', true, null),
  -- India CPI (MoSPI), 16:00 IST on the 12th, or the next working day.
  ('cpi-in-2026-07', '2026-08-12', '16:00', 'IN', 'cpi', 'India CPI inflation', 'July 2026', false, null),
  ('cpi-in-2026-08', '2026-09-14', '16:00', 'IN', 'cpi', 'India CPI inflation', 'August 2026', false, null),
  ('cpi-in-2026-09', '2026-10-12', '16:00', 'IN', 'cpi', 'India CPI inflation', 'September 2026', false, null),
  ('cpi-in-2026-10', '2026-11-12', '16:00', 'IN', 'cpi', 'India CPI inflation', 'October 2026', false, null),
  ('cpi-in-2026-11', '2026-12-14', '16:00', 'IN', 'cpi', 'India CPI inflation', 'November 2026', false, null),
  ('cpi-in-2026-12', '2027-01-12', '16:00', 'IN', 'cpi', 'India CPI inflation', 'December 2026', false, null),
  ('cpi-in-2027-01', '2027-02-12', '16:00', 'IN', 'cpi', 'India CPI inflation', 'January 2027', false, null),
  ('cpi-in-2027-02', '2027-03-12', '16:00', 'IN', 'cpi', 'India CPI inflation', 'February 2027', false, null),
  ('cpi-in-2027-03', '2027-04-12', '16:00', 'IN', 'cpi', 'India CPI inflation', 'March 2027', false, null),
  ('cpi-in-2027-04', '2027-05-12', '16:00', 'IN', 'cpi', 'India CPI inflation', 'April 2027', false, null),
  ('cpi-in-2027-05', '2027-06-14', '16:00', 'IN', 'cpi', 'India CPI inflation', 'May 2027', false, null),
  ('cpi-in-2027-06', '2027-07-12', '16:00', 'IN', 'cpi', 'India CPI inflation', 'June 2027', false, null),
  -- India GDP (MoSPI), usually the last working day of the second month after the quarter, 16:00 IST.
  ('gdp-in-2026-q1', '2026-08-28', '16:00', 'IN', 'gdp', 'India GDP growth', 'Apr–Jun 2026 (Q1 FY27)', false, null),
  ('gdp-in-2026-q2', '2026-11-27', '16:00', 'IN', 'gdp', 'India GDP growth', 'Jul–Sep 2026 (Q2 FY27)', false, null),
  ('gdp-in-2026-q3', '2027-02-26', '16:00', 'IN', 'gdp', 'India GDP growth', 'Oct–Dec 2026 (Q3 FY27)', false, null),
  ('gdp-in-2027-q4', '2027-05-31', '16:00', 'IN', 'gdp', 'India GDP growth', 'Jan–Mar 2027 (Q4) and FY27', false, null),
  -- Union Budget, 1 February, 11:00 IST.
  ('budget-2027', '2027-02-01', '11:00', 'IN', 'budget', 'Union Budget 2027-28', 'FY 2027-28', true, null),
  -- US Fed (FOMC) decisions: 2 pm New York time on the second day = 23:30 IST in US summer time, 00:30 IST the next day in winter.
  ('fomc-2026-07', '2026-07-29', '23:30', 'US', 'fomc', 'US Fed rate decision', 'FOMC 28–29 Jul 2026', true, null),
  ('fomc-2026-09', '2026-09-16', '23:30', 'US', 'fomc', 'US Fed rate decision', 'FOMC 15–16 Sep 2026', true, null),
  ('fomc-2026-10', '2026-10-28', '23:30', 'US', 'fomc', 'US Fed rate decision', 'FOMC 27–28 Oct 2026', true, null),
  ('fomc-2026-12', '2026-12-10', '00:30', 'US', 'fomc', 'US Fed rate decision', 'FOMC 8–9 Dec 2026', true, null),
  ('fomc-2027-01', '2027-01-28', '00:30', 'US', 'fomc', 'US Fed rate decision', 'FOMC 26–27 Jan 2027', false, 'The Fed lists 2027 dates as tentative.'),
  ('fomc-2027-03', '2027-03-17', '23:30', 'US', 'fomc', 'US Fed rate decision', 'FOMC 16–17 Mar 2027', false, 'The Fed lists 2027 dates as tentative.'),
  ('fomc-2027-04', '2027-04-28', '23:30', 'US', 'fomc', 'US Fed rate decision', 'FOMC 27–28 Apr 2027', false, 'The Fed lists 2027 dates as tentative.'),
  ('fomc-2027-06', '2027-06-09', '23:30', 'US', 'fomc', 'US Fed rate decision', 'FOMC 8–9 Jun 2027', false, 'The Fed lists 2027 dates as tentative.'),
  ('fomc-2027-07', '2027-07-28', '23:30', 'US', 'fomc', 'US Fed rate decision', 'FOMC 27–28 Jul 2027', false, 'The Fed lists 2027 dates as tentative.'),
  -- US CPI (BLS schedule), 8:30 am New York time = 19:00 IST in winter, 18:00 IST in summer.
  ('cpi-us-2026-10', '2026-11-10', '19:00', 'US', 'uscpi', 'US CPI inflation', 'October 2026', true, null),
  ('cpi-us-2026-11', '2026-12-10', '19:00', 'US', 'uscpi', 'US CPI inflation', 'November 2026', true, null),
  ('cpi-us-2026-12', '2027-01-13', '19:00', 'US', 'uscpi', 'US CPI inflation', 'December 2026', true, null),
  ('cpi-us-2027-01', '2027-02-11', '19:00', 'US', 'uscpi', 'US CPI inflation', 'January 2027', true, null),
  ('cpi-us-2027-02', '2027-03-10', '19:00', 'US', 'uscpi', 'US CPI inflation', 'February 2027', true, null),
  ('cpi-us-2027-03', '2027-04-13', '18:00', 'US', 'uscpi', 'US CPI inflation', 'March 2027', true, null),
  ('cpi-us-2027-04', '2027-05-12', '18:00', 'US', 'uscpi', 'US CPI inflation', 'April 2027', true, null),
  ('cpi-us-2027-05', '2027-06-10', '18:00', 'US', 'uscpi', 'US CPI inflation', 'May 2027', true, null),
  ('cpi-us-2027-06', '2027-07-14', '18:00', 'US', 'uscpi', 'US CPI inflation', 'June 2027', true, null)
on conflict (id) do update set event_date = excluded.event_date, time_ist = excluded.time_ist, title = excluded.title,
  period = excluded.period, confirmed = excluded.confirmed, note = coalesce(econ_events.note, excluded.note), updated_at = now();
