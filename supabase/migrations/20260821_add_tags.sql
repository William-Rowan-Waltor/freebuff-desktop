-- Add tags column to blocks table for categorization.
ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS tags text;
NOTIFY pgrst, 'reload schema';
