-- Starts the "Blog autopublish" GitHub Actions workflow from Supabase (pg_cron + pg_net), because
-- GitHub's own cron schedule drops runs. Each run skips posts that are already published.
--
-- The token: a fine-grained GitHub token for manish0solanki/indian_Stock_Market_news with
-- "Actions: Read and write". Store it once in the Supabase SQL editor (never in the repo):
--   insert into public.app_secrets (name, value) values ('github_actions', '<token>')
--   on conflict (name) do update set value = excluded.value;
create or replace function public.dispatch_blog(p_posts text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare tok text; rid bigint;
begin
  select value into tok from public.app_secrets where name = 'github_actions';
  if tok is null or tok = '' then
    raise notice 'dispatch_blog: no github_actions token in app_secrets';
    return null;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/manish0solanki/indian_Stock_Market_news/actions/workflows/blog.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('posts', p_posts)),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'marketpulse-supabase-cron',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 15000
  ) into rid;
  return rid;
end $$;

revoke all on function public.dispatch_blog(text) from public, anon, authenticated;

-- Times in UTC, Monday to Friday, two minutes after GitHub's own schedule. IST = UTC + 5:30.
select cron.schedule('blog-market-posts',  '9 10 * * 1-5',  $$select public.dispatch_blog('wrap,sector,spotlight')$$); -- 3:39 PM IST
select cron.schedule('blog-market-backup', '39 11 * * 1-5', $$select public.dispatch_blog('wrap,sector,spotlight')$$); -- 5:09 PM IST
select cron.schedule('blog-fiidii',        '49 13 * * 1-5', $$select public.dispatch_blog('fiidii')$$);                -- 7:19 PM IST
select cron.schedule('blog-fiidii-retry',  '19 15 * * 1-5', $$select public.dispatch_blog('fiidii')$$);                -- 8:49 PM IST
select cron.schedule('blog-fiidii-backup', '45 16 * * 1-5', $$select public.dispatch_blog('fiidii')$$);                -- 10:15 PM IST
