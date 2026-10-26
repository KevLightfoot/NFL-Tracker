-- Run this once in Supabase (SQL Editor -> New query -> paste -> Run) to turn on push notifications.
-- push_subs : one row per phone/computer that turned notifications on (each user manages their own rows)
-- leg_state : the server's memory of each leg's last state, so it knows when something CHANGES. Server-only.

create table if not exists public.push_subs (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint   text   not null,
  sub        jsonb  not null,
  created_at bigint not null,
  primary key (user_id, endpoint)
);
alter table public.push_subs enable row level security;
drop policy if exists "own push subs" on public.push_subs;
create policy "own push subs" on public.push_subs
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.push_subs to authenticated;

create table if not exists public.leg_state (
  user_id    uuid   not null references auth.users (id) on delete cascade,
  slip_id    text   not null,
  leg_id     text   not null,
  state      text   not null,
  updated_at bigint not null,
  primary key (user_id, slip_id, leg_id)
);
alter table public.leg_state enable row level security;   -- no policies on purpose: only the server's secret key can read/write it

-- the server uses the secret (service_role) key
grant all on public.push_subs, public.leg_state, public.slips to service_role;
