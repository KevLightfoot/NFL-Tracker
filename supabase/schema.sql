-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Two tables (active slips + portfolio log). Each row belongs to one user; row-level security keeps
-- everyone's data private even though the site's public key is visible in the page source.

create table if not exists public.slips (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         text   not null,
  data       jsonb  not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

create table if not exists public.portfolio (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         text   not null,
  data       jsonb  not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

alter table public.slips     enable row level security;
alter table public.portfolio enable row level security;

drop policy if exists "own slips" on public.slips;
create policy "own slips" on public.slips
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own portfolio" on public.portfolio;
create policy "own portfolio" on public.portfolio
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.slips     to authenticated;
grant select, insert, update, delete on public.portfolio to authenticated;
