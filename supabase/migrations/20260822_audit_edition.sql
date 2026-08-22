-- NOTE 2026-08-23: phan roles cua file nay duoc hop nhat vao
-- 20260823_workspace_roles.sql (CANONICAL). Chay mot trong hai la du cho roles;
-- block_history chi co trong file nay.
-- ============================================================================
-- Dresplace "Audit Edition" foundation — 2026-08-22
-- Run in Supabase SQL Editor, then: notify pgrst, 'reload schema';
-- Idempotent: safe to re-run any number of times.
--
-- 1. Roles unification: workspace_members gains the 5-role model
--    (owner / admin / editor / contributor / viewer). Legacy 'member' rows
--    migrate to 'editor'. join-by-code now lands as VIEWER (read-only) —
--    the owner promotes from the members UI. This fixes the P0 conflict
--    between migrate_workspaces.sql ('owner','member') and
--    migrations/20260821_multi_user.sql ('owner','admin','editor','viewer').
-- 2. Role-aware RLS on blocks/block_relations (replaces member_* policies):
--      viewer       → SELECT only
--      contributor  → SELECT + INSERT + UPDATE own rows (no delete)
--      editor/admin → full CRUD inside the workspace
--      owner        → everything + workspace management
-- 3. Admin RPCs: set_member_role / remove_member / rotate_share_code
--    (SECURITY DEFINER, guarded to owner/admin, protects the last owner).
-- 4. block_history: trigger-based server-side audit trail (actor, old/new
--    row, changed fields) + read RLS + 12-month retention helper.
--    updated_at-only churn is NOT recorded.
-- ============================================================================

-- ---------- 1a. workspace_members: unify role model ----------
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  role text not null default 'viewer'
    check (role in ('owner', 'admin', 'editor', 'contributor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- Legacy rows: 'member' (old 2-role model) → 'editor' (full edit, no admin).
update public.workspace_members set role = 'editor' where role = 'member';

-- Replace whichever CHECK exists with the 5-role one.
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'editor', 'contributor', 'viewer'));

create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

-- ---------- 1b. join-by-code lands as viewer ----------
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
  values (v_ws.id, auth.uid(), 'viewer')
  on conflict (workspace_id, user_id) do nothing;
  return v_ws;
end;
$$;
revoke all on function public.join_workspace(text) from public;
grant execute on function public.join_workspace(text) to authenticated;

-- ---------- 2. role helper + role-aware policies ----------
-- SECURITY DEFINER so policies can read membership rows without recursing
-- through workspace_members' own RLS (whose SELECT is user-scoped).
create or replace function public.my_workspace_role(p_workspace uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.workspace_members
  where workspace_id = p_workspace and user_id = auth.uid()
  limit 1
$$;
revoke all on function public.my_workspace_role(uuid) from public;
grant execute on function public.my_workspace_role(uuid) to authenticated;

-- Members list: you see your own memberships, and — for shared workspaces —
-- everyone's rows, so the members UI can render (viewer included).
drop policy if exists "member_select_workspace_members" on public.workspace_members;
create policy "member_select_workspace_members" on public.workspace_members
  for select using (
    user_id = auth.uid()
    or public.my_workspace_role(workspace_id) is not null
  );
-- (insert/delete member policies from migrate_workspaces.sql stay as-is; role
-- changes go through the guarded RPCs below.)

-- Blocks -----------------------------------------------------------------
drop policy if exists "member_select_blocks" on public.blocks;
drop policy if exists "member_insert_blocks" on public.blocks;
drop policy if exists "member_update_blocks" on public.blocks;
drop policy if exists "member_delete_blocks" on public.blocks;

create policy "member_select_blocks" on public.blocks
  for select using (
    owner_id = auth.uid()
    or public.my_workspace_role(workspace_id) is not null
  );

-- Insert: your own row, inside a workspace where you can contribute.
create policy "member_insert_blocks" on public.blocks
  for insert with check (
    owner_id = auth.uid()
    and (
      exists (
        select 1 from public.workspace_members m
        where m.workspace_id = workspace_id and m.user_id = auth.uid()
          and m.role in ('owner', 'admin', 'editor', 'contributor')
      )
      or exists (
        select 1 from public.workspaces w
        where w.id = workspace_id and w.created_by = auth.uid()
      )
    )
  );

-- Update: editors+ edit anything in the workspace; contributors only their
-- own rows; viewers never.
create policy "member_update_blocks" on public.blocks
  for update using (
    owner_id = auth.uid()
    or public.my_workspace_role(workspace_id) in ('owner', 'admin', 'editor')
    or (
      public.my_workspace_role(workspace_id) = 'contributor'
      and owner_id = auth.uid()
    )
  );

-- Delete: editors+ only — contributors and viewers cannot delete.
create policy "member_delete_blocks" on public.blocks
  for delete using (
    owner_id = auth.uid()
    or public.my_workspace_role(workspace_id) in ('owner', 'admin', 'editor')
  );

-- Relations: same role logic, resolved through the PARENT block's workspace.
drop policy if exists "member_select_block_relations" on public.block_relations;
drop policy if exists "member_insert_block_relations" on public.block_relations;
drop policy if exists "member_update_block_relations" on public.block_relations;
drop policy if exists "member_delete_block_relations" on public.block_relations;

create policy "member_select_block_relations" on public.block_relations
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.blocks b
      where b.id = block_relations.parent_id
        and public.my_workspace_role(b.workspace_id) is not null
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
          or public.my_workspace_role(b.workspace_id) in ('owner', 'admin', 'editor', 'contributor')
        )
    )
  );
create policy "member_update_block_relations" on public.block_relations
  for update using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.blocks b
      where b.id = block_relations.parent_id
        and (
          public.my_workspace_role(b.workspace_id) in ('owner', 'admin', 'editor')
          or (public.my_workspace_role(b.workspace_id) = 'contributor' and owner_id = auth.uid())
        )
    )
  );
create policy "member_delete_block_relations" on public.block_relations
  for delete using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.blocks b
      where b.id = block_relations.parent_id
        and public.my_workspace_role(b.workspace_id) in ('owner', 'admin', 'editor')
    )
  );

-- ---------- 3. admin RPCs ----------
create or replace function public.set_member_role(p_workspace uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_role not in ('owner', 'admin', 'editor', 'contributor', 'viewer') then
    raise exception 'Vai trò không hợp lệ';
  end if;
  if coalesce(public.my_workspace_role(p_workspace), '') not in ('owner', 'admin') then
    raise exception 'Chỉ owner hoặc admin mới được đổi vai trò';
  end if;
  -- Never demote the last owner.
  if p_role <> 'owner'
     and exists (
       select 1 from public.workspace_members
       where workspace_id = p_workspace and user_id = p_user and role = 'owner'
     )
     and (select count(*) from public.workspace_members where workspace_id = p_workspace and role = 'owner') <= 1 then
    raise exception 'Không gian phải còn ít nhất một owner';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace, p_user, p_role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;
end;
$$;

create or replace function public.remove_member(p_workspace uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.my_workspace_role(p_workspace), '') not in ('owner', 'admin') then
    raise exception 'Chỉ owner hoặc admin mới được xóa thành viên';
  end if;
  if p_user = auth.uid() then
    raise exception 'Không thể tự xóa mình khỏi không gian';
  end if;
  if exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace and user_id = p_user and role = 'owner'
  ) and (select count(*) from public.workspace_members where workspace_id = p_workspace and role = 'owner') <= 1 then
    raise exception 'Không thể xóa owner cuối cùng';
  end if;
  delete from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
end;
$$;

create or replace function public.rotate_share_code(p_workspace uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if coalesce(public.my_workspace_role(p_workspace), '') not in ('owner', 'admin') then
    raise exception 'Chỉ owner hoặc admin mới được đổi mã chia sẻ';
  end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.workspaces where share_code = v_code);
  end loop;
  update public.workspaces set share_code = v_code where id = p_workspace;
  return v_code;
end;
$$;

revoke all on function public.set_member_role(uuid, uuid, text) from public;
revoke all on function public.remove_member(uuid, uuid) from public;
revoke all on function public.rotate_share_code(uuid) from public;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.rotate_share_code(uuid) to authenticated;

-- ---------- 4. block_history (server-side audit trail) ----------
create table if not exists public.block_history (
  id bigint generated always as identity primary key,
  block_id uuid not null,
  workspace_id uuid,
  block_owner uuid,
  block_title text,
  actor uuid,
  action text not null check (action in ('create', 'update', 'delete')),
  changed_fields text[],
  old_row jsonb,
  new_row jsonb,
  created_at timestamptz not null default now()
);
create index if not exists block_history_block_idx on public.block_history (block_id, created_at desc);
create index if not exists block_history_workspace_idx on public.block_history (workspace_id, created_at desc);

alter table public.block_history enable row level security;
-- Read: the actor, the block owner, or any member of the block's workspace
-- (viewers can audit too). Writes happen ONLY through the definer trigger.
drop policy if exists "history_read" on public.block_history;
create policy "history_read" on public.block_history
  for select using (
    auth.uid() is not null
    and (
      actor = auth.uid()
      or block_owner = auth.uid()
      or (workspace_id is not null and public.my_workspace_role(workspace_id) is not null)
    )
  );

create or replace function public.audit_block_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_fields text[];
begin
  if tg_op = 'DELETE' then
    insert into public.block_history
      (block_id, workspace_id, block_owner, block_title, actor, action, old_row)
    values
      (old.id, old.workspace_id, old.owner_id, old.title, auth.uid(), 'delete', to_jsonb(old));
    return old;
  end if;

  v_new := to_jsonb(new);
  if tg_op = 'INSERT' then
    insert into public.block_history
      (block_id, workspace_id, block_owner, block_title, actor, action, new_row)
    values
      (new.id, new.workspace_id, new.owner_id, new.title, auth.uid(), 'create', v_new);
    return new;
  end if;

  v_old := to_jsonb(old);
  select coalesce(array_agg(key order by key), '{}') into v_fields
  from jsonb_each(v_old)
  where v_old -> key is distinct from v_new -> key;
  -- Skip autosave churn: an update that only bumps updated_at is noise.
  if v_fields = array['updated_at'] or v_fields = '{}'::text[] then
    return new;
  end if;
  insert into public.block_history
    (block_id, workspace_id, block_owner, block_title, actor, action, changed_fields, old_row, new_row)
  values
    (new.id, new.workspace_id, new.owner_id, new.title, auth.uid(), 'update', v_fields, v_old, v_new);
  return new;
end;
$$;

drop trigger if exists block_history_trigger on public.blocks;
create trigger block_history_trigger
  after insert or update or delete on public.blocks
  for each row execute function public.audit_block_change();

-- Retention: keep ~12 months by default (panel condition: accounting/audit
-- cycles live on fiscal years, not quarters). Run periodically (cron /
-- pg_cron / manual) — never shorter than 30 days.
create or replace function public.purge_block_history(p_keep_days int default 365)
returns bigint
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.block_history
    where created_at < now() - make_interval(days => greatest(p_keep_days, 30))
    returning 1
  )
  select count(*)::bigint from deleted
$$;
revoke all on function public.purge_block_history(int) from public;
grant execute on function public.purge_block_history(int) to authenticated;

-- ---------- verify ----------
-- select count(*) from pg_policies where tablename in ('blocks','block_relations','workspace_members','block_history');
-- select proname from pg_proc where proname in ('set_member_role','remove_member','rotate_share_code','my_workspace_role','audit_block_change','purge_block_history');
-- select tgname from pg_trigger where tgrelid = 'public.blocks'::regclass and not tgisinternal;
