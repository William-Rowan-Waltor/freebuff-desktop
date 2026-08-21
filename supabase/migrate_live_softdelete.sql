-- Soft-delete tombstone for blocks: rows are hidden while deleted_at is set
-- (fetchBlocks filters deleted_at is null), undo clears the column, and a
-- purge job hard-deletes tombstones older than the undo window. Lets the
-- delete banner survive a page reload.
--
-- Run in the Supabase SQL Editor (project qfiwcriminirvyjsvasf), then:
--   notify pgrst, 'reload schema';
alter table public.blocks add column if not exists deleted_at timestamptz;
create index if not exists blocks_deleted_at_idx on public.blocks (deleted_at);

notify pgrst, 'reload schema';
