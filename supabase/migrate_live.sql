-- LIVE migration (idempotent) - chạy trong Supabase SQL Editor cho project qfiwcriminirvyjsvasf
-- Bổ sung cột + policy cho các bảng ĐÃ tồn tại (create table if not exists không ăn).

-- 1. Columns
alter table public.blocks add column if not exists owner_id uuid default auth.uid();
alter table public.blocks alter column workspace_id set default gen_random_uuid();
alter table public.blocks add column if not exists recurrence text;
alter table public.blocks add column if not exists recurrence_exceptions text[];
alter table public.block_relations add column if not exists owner_id uuid default auth.uid();
alter table public.block_relations add column if not exists position integer not null default 0;

-- 2. Indexes
create index if not exists blocks_type_idx on public.blocks (type);
create index if not exists blocks_start_time_idx on public.blocks (start_time);
create index if not exists blocks_owner_idx on public.blocks (owner_id);
create index if not exists block_relations_child_idx on public.block_relations (child_id);

-- 3. BOOTSTRAP policies (pre-auth): anon key chỉ thấy/nghi row owner_id is null.
drop policy if exists "anon_select_blocks" on public.blocks;
drop policy if exists "anon_insert_blocks" on public.blocks;
drop policy if exists "anon_update_blocks" on public.blocks;
drop policy if exists "anon_delete_blocks" on public.blocks;
create policy "anon_select_blocks" on public.blocks for select using (owner_id is null);
create policy "anon_insert_blocks" on public.blocks for insert with check (owner_id is null);
create policy "anon_update_blocks" on public.blocks for update using (owner_id is null);
create policy "anon_delete_blocks" on public.blocks for delete using (owner_id is null);

drop policy if exists "anon_select_block_relations" on public.block_relations;
drop policy if exists "anon_insert_block_relations" on public.block_relations;
drop policy if exists "anon_update_block_relations" on public.block_relations;
drop policy if exists "anon_delete_block_relations" on public.block_relations;
create policy "anon_select_block_relations" on public.block_relations for select using (owner_id is null);
create policy "anon_insert_block_relations" on public.block_relations for insert with check (owner_id is null);
create policy "anon_update_block_relations" on public.block_relations for update using (owner_id is null);
create policy "anon_delete_block_relations" on public.block_relations for delete using (owner_id is null);

-- 4. Storage (bucket files, public): cho phép anon đọc/ghi như state hiện tại.
insert into storage.buckets (id, name, public)
values ('files', 'files', true)
on conflict (id) do nothing;
drop policy if exists "files_public_access" on storage.objects;
create policy "files_public_access" on storage.objects
  for all using (bucket_id = 'files') with check (bucket_id = 'files');

-- 5. PHASE 2 (sau khi T4 login OK): drop 8 policy anon_* ở trên rồi chạy batch owner_*
-- đã ghi sẵn trong supabase/schema.sql (comment block cuối file).

-- Verify nhanh sau khi chạy:
--   select count(*) from pg_policies where tablename in ('blocks','block_relations');
--   → phải trả về 8 + 1 (files_public_access trên storage.objects khác schema)
--   GET /rest/v1/block_relations?order=position.asc → 200 thay vì 400
--   POST /rest/v1/blocks {type:'event', title:'probe'} → 201 thay vì 42501