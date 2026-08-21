-- Migration: Add priority and status columns to blocks table
-- Run in Supabase SQL Editor or via `supabase db push`
-- Date: 2026-08-21

-- Add priority column (urgent > high > normal > low)
ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal'
  CHECK (priority IN ('urgent', 'high', 'normal', 'low'));

-- Add status column (draft > pending > approved/rejected > completed)
ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft'
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'completed'));

-- Index for PlannerView priority sorting
CREATE INDEX IF NOT EXISTS idx_blocks_priority ON blocks (priority);

-- Index for status filtering (e.g. hide completed from planner)
CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks (status);

-- Backfill existing rows
UPDATE blocks SET priority = 'normal' WHERE priority IS NULL;
UPDATE blocks SET status = 'draft' WHERE status IS NULL;
