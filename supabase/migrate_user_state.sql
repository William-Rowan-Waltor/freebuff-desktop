-- User-level state (settings, timer, .ics import history): small JSONB blobs
-- keyed per user, so preferences follow the user across browsers/devices.
-- The client keeps a localStorage copy as an offline cache/fallback — the
-- server row is authoritative when reachable.
--
-- Run in the Supabase SQL Editor, then: notify pgrst, 'reload schema';

create table if not exists public.user_state (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_state enable row level security;

-- Each user can only read/write their own rows.
drop policy if exists "owner_user_state_select" on public.user_state;
drop policy if exists "owner_user_state_insert" on public.user_state;
drop policy if exists "owner_user_state_update" on public.user_state;
drop policy if exists "owner_user_state_delete" on public.user_state;
create policy "owner_user_state_select" on public.user_state
  for select using (user_id = auth.uid());
create policy "owner_user_state_insert" on public.user_state
  for insert with check (user_id = auth.uid());
create policy "owner_user_state_update" on public.user_state
  for update using (user_id = auth.uid());
create policy "owner_user_state_delete" on public.user_state
  for delete using (user_id = auth.uid());

-- Verify: select count(*) from pg_policies where tablename = 'user_state'; -- → 4
