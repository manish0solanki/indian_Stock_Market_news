-- Manual "Run now" for the admin Data Health tab (admin-health.js). Admins only.
-- Runs a scheduled job's own pg_cron command immediately (same function, same shared secret, which
-- never leaves the database). Data jobs only: trading bots and clean-up jobs are not runnable here.
-- HTTP jobs are run with force=1 so they skip their own throttles (e.g. sector-refresh outside market
-- hours, crude-refresh "refreshed recently"); index-refresh also with global=1 (full refresh).
create table if not exists public.admin_job_runs (
  id bigserial primary key,
  job text not null,
  run_by uuid,
  run_at timestamptz not null default now(),
  request_id bigint,
  result text
);
alter table public.admin_job_runs enable row level security;   -- no policies: read through the functions below

create or replace function public.admin_runnable_jobs() returns text[]
language sql immutable as $$
  select array['index-refresh', 'index-refresh-global-30s', 'sector-refresh', 'stock-signals-refresh', 'feeds-refresh',
               'news-refresh', 'crude-refresh', 'events-refresh', 'ipo-refresh', 'live-insights', 'stocks-sync',
               'blog-market-posts', 'blog-fiidii']
$$;

create or replace function public.admin_run_job(p_job text) returns jsonb
language plpgsql volatile security definer set search_path = public, cron, net as $$
declare cmd text; res text; rid bigint;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if not (p_job = any (admin_runnable_jobs())) then
    raise exception 'job % cannot be run from here', p_job;
  end if;
  if exists (select 1 from admin_job_runs where job = p_job and run_at > now() - interval '30 seconds') then
    raise exception 'job % was started less than 30 seconds ago; wait for it to finish', p_job;
  end if;
  select command into cmd from cron.job where jobname = p_job;
  if cmd is null then raise exception 'no scheduled job named %', p_job; end if;
  -- Manual runs skip the functions' own throttles (force=1; functions that have none ignore it).
  cmd := regexp_replace(cmd, '(/functions/v1/[a-z0-9-]+\?[a-z0-9=&]+)''', '\1&force=1''');  -- URL with a query string
  cmd := regexp_replace(cmd, '(/functions/v1/[a-z0-9-]+)''', '\1?force=1''');                -- plain URL
  if p_job = 'index-refresh' then cmd := replace(cmd, 'index-refresh?force=1', 'index-refresh?global=1&force=1'); end if;
  execute cmd into res;
  -- HTTP jobs return a pg_net request id; database jobs return their own result text.
  if cmd ~ 'net\.http_post' then rid := res::bigint; res := null; end if;
  insert into admin_job_runs (job, run_by, request_id, result) values (p_job, auth.uid(), rid, res);
  return jsonb_build_object('job', p_job, 'request_id', rid, 'result', res, 'started_at', now());
end $$;

-- Outcome of a manual run's HTTP call (pg_net keeps responses for a few hours).
create or replace function public.admin_job_result(p_request_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, net as $$
declare r record;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select status_code, timed_out, error_msg, left(content, 600) as body into r from net._http_response where id = p_request_id;
  if not found then return jsonb_build_object('done', false); end if;
  return jsonb_build_object('done', true, 'status', r.status_code, 'timed_out', r.timed_out, 'error', r.error_msg, 'body', r.body);
end $$;

revoke all on function public.admin_run_job(text) from public, anon;
revoke all on function public.admin_job_result(bigint) from public, anon;
grant execute on function public.admin_run_job(text) to authenticated;
grant execute on function public.admin_job_result(bigint) to authenticated;
