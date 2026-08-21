-- Shared workspaces: multiple people can see and edit the same blocks.
--
--   workspaces        — one row per workspace; created via create_workspace()
--   workspace_members — who belongs (owners can delete; members edit blocks)
--   join_workspace()  — SECURITY DEFINER RPC: validates a share code and adds
--                       the caller as a member (the only way to join a
--                       workspace you didn't create)
--
-- blocks.workspace_id (already on the table) now scopes sharing: a block is
-- visible/editable by its owner OR by any member of its workspace. The old
-- owner-only policies are replaced (idempotent: drops both anon_* bootstrap
-- and owner_* phase-2 policies, then creates member_*).
--
-- Run in the Supabase SQL Editor, then: notify pgrst, 'reload schema';

-- ---------- tables ----------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  share_code text not null unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists blocks_workspace_idx on public.blocks (workspace_id);

-- ---------- RLS ----------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- Workspaces: see the ones you created or belong to; only the creator
-- edits/removes the workspace itself.
drop policy if exists "member_select_workspaces" on public.workspaces;
drop policy if exists "member_insert_workspaces" on public.workspaces;
drop policy if exists "owner_update_workspaces" on public.workspaces;
drop policy if exists "owner_delete_workspaces" on public.workspaces;
create policy "member_select_workspaces" on public.workspaces
  for select using (
    created_by = auth.uid()
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspaces.id and m.user_id = auth.uid()
    )
  );
create policy "member_insert_workspaces" on public.workspaces
  for insert with check (created_by = auth.uid());
create policy "owner_update_workspaces" on public.workspaces
  for update using (created_by = auth.uid());
create policy "owner_delete_workspaces" on public.workspaces
  for delete using (created_by = auth.uid());

-- Members: see your own memberships. Self-join is only allowed into
-- workspaces you created (the join RPC handles real joins by share code).
drop policy if exists "member_select_workspace_members" on public.workspace_members;
drop policy if exists "member_insert_workspace_members" on public.workspace_members;
drop policy if exists "member_delete_workspace_members" on public.workspace_members;
create policy "member_select_workspace_members" on public.workspace_members
  for select using (user_id = auth.uid());
create policy "member_insert_workspace_members" on public.workspace_members
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.created_by = auth.uid()
    )
  );
create policy "member_delete_workspace_members" on public.workspace_members
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.created_by = auth.uid()
    )
  );

-- ---------- RPCs ----------
-- Create a workspace with a random 8-char share code; the creator is added as
-- the owner member. SECURITY DEFINER so both rows land atomically.
create or replace function public.create_workspace(p_name text)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_ws public.workspaces;
begin
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.workspaces where share_code = v_code);
  end loop;
  insert into public.workspaces (name, share_code, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Không gian của tôi'), v_code, auth.uid())
  returning * into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws.id, auth.uid(), 'owner');
  return v_ws;
end;
$$;

-- Join by share code: validates the code, adds the caller as a member, and
-- returns the workspace. Raises a clear error for unknown codes.
create or replace function public.join_workspace(p_code text)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws public.workspaces;
begin
  select * into v_ws
  from public.workspaces
  where share_code = upper(trim(p_code));
  if not found then
    raise exception 'Mã chia sẻ không hợp lệ';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws.id, auth.uid(), 'member')
  on conflict (workspace_id, user_id) do nothing;
  return v_ws;
end;
$$;

revoke all on function public.create_workspace(text) from public;
revoke all on function public.join_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.join_workspace(text) to authenticated;

-- ---------- blocks / block_relations policy swap ----------
-- Drop bootstrap (anon_*) and phase-2 (owner_*) policies, then create
-- membership policies. Idempotent against either prior state.
drop policy if exists "anon_select_blocks" on public.blocks;
drop policy if exists "anon_insert_blocks" on public.blocks;
drop policy if exists "anon_update_blocks" on public.blocks;
drop policy if exists "anon_delete_blocks" on public.blocks;
drop policy if exists "owner_select_blocks" on public.blocks;
drop policy if exists "owner_insert_blocks" on public.blocks;
drop policy if exists "owner_update_blocks" on public.blocks;
drop policy if exists "owner_delete_blocks" on public.blocks;

drop policy if exists "anon_select_block_relations" on public.block_relations;
drop policy if exists "anon_insert_block_relations" on public.block_relations;
drop policy if exists "anon_update_block_relations" on public.block_relations;
drop policy if exists "anon_delete_block_relations" on public.block_relations;
drop policy if exists "owner_select_block_relations" on public.block_relations;
drop policy if exists "owner_insert_block_relations" on public.block_relations;
drop policy if exists "owner_update_block_relations" on public.block_relations;
drop policy if exists "owner_delete_block_relations" on public.block_relations;

-- Blocks: owner always sees their rows (pre-workspace data keeps working);
-- members of a block's workspace see/edit everything in it.
create policy "member_select_blocks" on public.blocks
  for select using (
    owner_id = auth.uid()
    or workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );
-- Insert requires ownership AND a workspace the user belongs to or created
-- (covers the bootstrap race where the personal workspace exists but the
-- membership row hasn't propagated yet).
create policy "member_insert_blocks" on public.blocks
  for insert with check (
    owner_id = auth.uid()
    and (
      workspace_id in (
        select workspace_id from public.workspace_members where user_id = auth.uid()
      )
      or exists (
        select 1 from public.workspaces w
        where w.id = workspace_id and w.created_by = auth.uid()
      )
    )
  );
create policy "member_update_blocks" on public.blocks
  for update using (
    owner_id = auth.uid()
    or workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );
create policy "member_delete_blocks" on public.blocks
  for delete using (
    owner_id = auth.uid()
    or workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

-- Relations: owner always; otherwise the parent block's workspace grants
-- access to its whole relation tree.
create policy "member_select_block_relations" on public.block_relations
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.blocks b
      where b.id = block_relations.parent_id
        and b.workspace_id in (
          select workspace_id from public.workspace_members where user_id = auth.uid()
        )
    )
  );
create policy "member_insert_block_relations" on public.block_relations
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.blocks b
      where b.id = parent_id
        and (
          b.owner_id = auth.uid()
          or b.workspace_id in (
            select workspace_id from public.workspace_members where user_id = auth.uid()
          )
        )
    )
  );
create policy "member_update_block_relations" on public.block_relations
  for update using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.blocks b
      where b.id = block_relations.parent_id
        and b.workspace_id in (
          select workspace_id from public.workspace_members where user_id = auth.uid()
        )
    )
  );
create policy "member_delete_block_relations" on public.block_relations
  for delete using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.blocks b
      where b.id = block_relations.parent_id
        and b.workspace_id in (
          select workspace_id from public.workspace_members where user_id = auth.uid()
        )
    )
  );

-- ---------- storage stays owner-scoped (phase-2 policy untouched) ----------
-- Files remain private per user: `owner_files_access` on storage.objects is
-- unchanged. Workspace members share the BLOCKS (urls/notes), not the file
-- bytes — a member's upload lands in their own folder as before.

-- Verify:
--   select count(*) from pg_policies where tablename in ('blocks','block_relations','workspaces','workspace_members');
--   → 4 workspaces + 3 members + 8 blocks/relations policies = 19
