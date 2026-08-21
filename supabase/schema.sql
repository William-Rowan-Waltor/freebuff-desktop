create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default gen_random_uuid(),
  type text not null check (type in ('event', 'note', 'file', 'code')),
  title text,
  content jsonb,
  start_time timestamptz,
  end_time timestamptz,
  recurrence text,
  recurrence_exceptions text[],
  file_url text,
  file_extension text,
  owner_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft-delete tombstone: rows are hidden (deleted_at is null filter) until
  -- the undo window passes, then a purge job hard-deletes them. Lets the
  -- delete banner survive a page reload.
  deleted_at timestamptz
);

create table if not exists public.block_relations (
  parent_id uuid not null references public.blocks (id) on delete cascade,
  child_id uuid not null references public.blocks (id) on delete cascade,
  relation_type text not null check (relation_type in ('attached', 'embedded')),
  position integer not null default 0,
  owner_id uuid default auth.uid(),
  primary key (parent_id, child_id)
);

create index if not exists blocks_type_idx on public.blocks (type);
create index if not exists blocks_start_time_idx on public.blocks (start_time);
create index if not exists blocks_owner_idx on public.blocks (owner_id);
create index if not exists blocks_deleted_at_idx on public.blocks (deleted_at);
create index if not exists block_relations_child_idx on public.block_relations (child_id);

alter table public.blocks enable row level security;
alter table public.block_relations enable row level security;

-- BOOTSTRAP (pre-auth): anon key chỉ thấy/nghi các row chưa có chủ (owner_id is null).
-- App chưa có auth nên row mới tạo bằng anon key nhận owner_id = null và hoạt động như cũ.
create policy "anon_select_blocks" on public.blocks for select using (owner_id is null);
create policy "anon_insert_blocks" on public.blocks for insert with check (owner_id is null);
create policy "anon_update_blocks" on public.blocks for update using (owner_id is null);
create policy "anon_delete_blocks" on public.blocks for delete using (owner_id is null);

create policy "anon_select_block_relations" on public.block_relations for select using (owner_id is null);
create policy "anon_insert_block_relations" on public.block_relations for insert with check (owner_id is null);
create policy "anon_update_block_relations" on public.block_relations for update using (owner_id is null);
create policy "anon_delete_block_relations" on public.block_relations for delete using (owner_id is null);

-- PHASE 2 (khi auth UI xong - T4): thay thế toàn bộ policy anon_* bằng owner_* sau:
--   drop policy anon_select_blocks on public.blocks; ... (tương tự 3 policy còn lại và 4 policy relation)
--   create policy "owner_select_blocks" on public.blocks for select using (owner_id = auth.uid());
--   create policy "owner_insert_blocks" on public.blocks for insert with check (owner_id = auth.uid());
--   create policy "owner_update_blocks" on public.blocks for update using (owner_id = auth.uid());
--   create policy "owner_delete_blocks" on public.blocks for delete using (owner_id = auth.uid());
--   create policy "owner_select_block_relations" on public.block_relations for select using (owner_id = auth.uid());
--   create policy "owner_insert_block_relations" on public.block_relations for insert with check (owner_id = auth.uid());
--   create policy "owner_update_block_relations" on public.block_relations for update using (owner_id = auth.uid());
--   create policy "owner_delete_block_relations" on public.block_relations for delete using (owner_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('files', 'files', true)
on conflict (id) do nothing;

-- Storage: giữ quyền công khai như state hiện tại (bucket public + anon upload tới root).
-- PHASE 2: thay bằng owner-scoped (upload theo folder <user_id>/ ...).
drop policy if exists "files_public_access" on storage.objects;
create policy "files_public_access" on storage.objects
  for all using (bucket_id = 'files') with check (bucket_id = 'files');
