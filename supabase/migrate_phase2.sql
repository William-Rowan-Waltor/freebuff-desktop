-- PHASE 2 migration (idempotent) — CHỈ CHẠY SAU KHI T4 login hoạt động end-to-end (session OK).
-- Thay thế toàn bộ bootstrap policy anon_* (owner_id is null) bằng owner_* (auth.uid())
-- cho public.blocks + public.block_relations. Storage nằm ở NOTE cuối (cần code change trước).

-- 1. Drop bootstrap anon policies (blocks)
drop policy if exists "anon_select_blocks" on public.blocks;
drop policy if exists "anon_insert_blocks" on public.blocks;
drop policy if exists "anon_update_blocks" on public.blocks;
drop policy if exists "anon_delete_blocks" on public.blocks;

-- 2. Drop bootstrap anon policies (block_relations)
drop policy if exists "anon_select_block_relations" on public.block_relations;
drop policy if exists "anon_insert_block_relations" on public.block_relations;
drop policy if exists "anon_update_block_relations" on public.block_relations;
drop policy if exists "anon_delete_block_relations" on public.block_relations;

-- 3. Owner policies (blocks) — drop trước rồi create để idempotent (chạy lại nhiều lần được)
drop policy if exists "owner_select_blocks" on public.blocks;
drop policy if exists "owner_insert_blocks" on public.blocks;
drop policy if exists "owner_update_blocks" on public.blocks;
drop policy if exists "owner_delete_blocks" on public.blocks;
create policy "owner_select_blocks" on public.blocks for select using (owner_id = auth.uid());
create policy "owner_insert_blocks" on public.blocks for insert with check (owner_id = auth.uid());
create policy "owner_update_blocks" on public.blocks for update using (owner_id = auth.uid());
create policy "owner_delete_blocks" on public.blocks for delete using (owner_id = auth.uid());

-- 4. Owner policies (block_relations)
drop policy if exists "owner_select_block_relations" on public.block_relations;
drop policy if exists "owner_insert_block_relations" on public.block_relations;
drop policy if exists "owner_update_block_relations" on public.block_relations;
drop policy if exists "owner_delete_block_relations" on public.block_relations;
create policy "owner_select_block_relations" on public.block_relations for select using (owner_id = auth.uid());
create policy "owner_insert_block_relations" on public.block_relations for insert with check (owner_id = auth.uid());
create policy "owner_update_block_relations" on public.block_relations for update using (owner_id = auth.uid());
create policy "owner_delete_block_relations" on public.block_relations for delete using (owner_id = auth.uid());

-- 5. STORAGE swap (client code đã sẵn sàng: useBlocksStore upload '<user_id>/<blockId>/...'):
--    bỏ quyền public toàn phần, chỉ cho owner ghi folder <uid>/... riêng của mình.
--    (BẮT BUỘC sau các policy trên — chưa chạy thì anon vẫn tải file bất kỳ đâu: LEAK.)
drop policy if exists "files_public_access" on storage.objects;
create policy "owner_files_access" on storage.objects
  for all using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);

-- 6. VERIFY (3 bước, đọc kết quả bên dưới để báo lại):
--    a) select count(*) from pg_policies where tablename in ('blocks','block_relations');
--       → 8 policy, tên bắt đầu owner_* (không còn anon_* trên 2 bảng).
--    b) Hỏi lại OpenCode sau khi chạy → sẽ probe: authed POST/PATCH/DELETE (owner_id tự
--       điền = auth.uid()), anon đọc → 0 rows, anon upload folder lạ → 403 blocked.
--    c) anon key giờ KHÔNG còn thấy/ghi được dữ liệu — đúng mong muốn sau khi login OK.
