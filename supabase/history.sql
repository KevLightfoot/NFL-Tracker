-- Keeps the previous version of every slip whenever one is overwritten or deleted, so a bad sync can be inspected and undone.
-- Run once in Supabase → SQL editor. Safe to run again.
create table if not exists public.slip_history (
  hid         bigint generated always as identity primary key,
  user_id     uuid   not null,
  id          text   not null,
  data        jsonb  not null,
  updated_at  bigint,
  archived_at timestamptz not null default now(),
  action      text
);
create index if not exists slip_history_lookup on public.slip_history (user_id, id, archived_at desc);

alter table public.slip_history enable row level security;
drop policy if exists "own history" on public.slip_history;
create policy "own history" on public.slip_history for select to authenticated using (auth.uid() = user_id);

create or replace function public.archive_slip() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or old.data is distinct from new.data then
    insert into public.slip_history (user_id, id, data, updated_at, action) values (old.user_id, old.id, old.data, old.updated_at, tg_op);
  end if;
  -- keep two weeks, and no more than 30 versions per slip
  delete from public.slip_history where user_id = old.user_id and id = old.id and (archived_at < now() - interval '14 days'
    or hid in (select hid from public.slip_history where user_id = old.user_id and id = old.id order by archived_at desc offset 30));
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists slips_archive on public.slips;
create trigger slips_archive before update or delete on public.slips for each row execute function public.archive_slip();

-- To look at one slip's history:  select archived_at, action, data from slip_history where id = '<slip id>' order by archived_at desc;
