-- Starts the "Blog autopublish" GitHub Actions workflow from Supabase (pg_cron + pg_net), because
-- GitHub's own cron schedule drops or delays runs. Each run skips posts that are already published.
--
-- pg_cron -> public.dispatch_blog() -> edge function blog-dispatch -> GitHub API (workflow_dispatch).
-- The GitHub token is the Edge Function secret GIT_HUB_ACCESS (classic token, "repo" scope),
-- set in Supabase: Edge Functions -> Secrets. It is never stored in the database or the repo.
-- Test without starting anything:  select public.dispatch_blog('fiidii', true);
--   then read net._http_response for the returned id ({"ok":true,"status":200,...}).
create or replace function public.dispatch_blog(p_posts text, p_check boolean default false)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare rid bigint;
begin
  select net.http_post(
    url := 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/blog-dispatch?posts=' || p_posts || case when p_check then '&check=1' else '' end,
    body := '{}'::jsonb,
    headers := jsonb_build_object('x-cron-secret', (select value from public.app_secrets where name = 'crypto_cron'), 'Content-Type', 'application/json'),
    timeout_milliseconds := 20000
  ) into rid;
  return rid;
end $$;

revoke all on function public.dispatch_blog(text, boolean) from public, anon, authenticated;

-- Times in UTC, Monday to Friday, two minutes after GitHub's own schedule. IST = UTC + 5:30.
select cron.schedule('blog-market-posts',  '9 10 * * 1-5',  $$select public.dispatch_blog('wrap,sector,spotlight')$$); -- 3:39 PM IST
select cron.schedule('blog-market-backup', '39 11 * * 1-5', $$select public.dispatch_blog('wrap,sector,spotlight')$$); -- 5:09 PM IST
select cron.schedule('blog-fiidii',        '49 13 * * 1-5', $$select public.dispatch_blog('fiidii')$$);                -- 7:19 PM IST
select cron.schedule('blog-fiidii-retry',  '19 15 * * 1-5', $$select public.dispatch_blog('fiidii')$$);                -- 8:49 PM IST
select cron.schedule('blog-fiidii-backup', '45 16 * * 1-5', $$select public.dispatch_blog('fiidii')$$);                -- 10:15 PM IST
