-- Applied 8 Nov 2026 (migration special_session_prevclose). For a new special session: run
--   special-prevclose?d=<session date>&prev=<last regular session>   then
--   update stock_quotes set price = price where (quote_time at time zone 'Asia/Kolkata')::date = '<session date>';
-- Special sessions (e.g. the Diwali Muhurat session on a Sunday): Yahoo's quotes then report the change from the close
-- two sessions back (on 8 Nov 2026 it measured from Thursday 5 Nov, so ICICI Bank showed +4.33% for a -0.39% session).
--   session_prev_close  (d = the special session's IST date, symbol, prev = the true previous close), filled from NSE's
--                       bhavcopy of the last regular session by the special-prevclose Edge Function.
--   stock_quotes_special_prev (trigger)  a quote whose trade time falls on such a date gets previous_close, change and
--                       change_percent from that table, so later refreshes can't bring the wrong figure back.
create table if not exists public.session_prev_close (
  d date not null, symbol text not null, prev numeric not null, primary key (d, symbol)
);
alter table public.session_prev_close enable row level security;
revoke all on public.session_prev_close from anon, authenticated;

create or replace function public.stock_quotes_special_prev() returns trigger
language plpgsql security definer set search_path = public as $$
declare p numeric;
begin
  if new.quote_time is not null and new.price > 0 then
    select prev into p from session_prev_close where d = (new.quote_time at time zone 'Asia/Kolkata')::date and symbol = new.symbol;
    if p > 0 then
      new.previous_close := p;
      new.change := new.price - p;
      new.change_percent := (new.price / p - 1) * 100;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists stock_quotes_special_prev on public.stock_quotes;
create trigger stock_quotes_special_prev before insert or update on public.stock_quotes
  for each row execute function public.stock_quotes_special_prev();
