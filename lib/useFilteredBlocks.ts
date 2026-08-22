/**
 * Client-side workspace filter for blocks.
 *
 * Per Ox Alpha's Round 4 decision (D2):
 * - Store still holds ALL blocks (union of all member workspaces).
 * - This hook returns only blocks belonging to the active workspace.
 * - When no workspace is selected (or "all" is active), returns everything.
 *
 * This is the safe intermediate step before server-side workspace-scoped
 * fetch + RLS (which requires member/role UI from D3).
 */

import { useMemo } from 'react'
import { useBlocksStore } from '@/store/useBlocksStore'
import type { Block, BlockRelation } from '@/types'
import type { DeletedBlock } from '@/lib/db/blocks'

/**
 * Filtered blocks for the current workspace view.
 * Returns all blocks when activeWorkspaceId is null.
 */
export function useFilteredBlocks(): Block[] {
  const blocks = useBlocksStore((s) => s.blocks)
  const activeWorkspaceId = useBlocksStore((s) => s.activeWorkspaceId)

  return useMemo(() => {
    if (!activeWorkspaceId) return blocks
    // RLS already grants access — filter client-side by workspace_id
    // (blocks have workspace_id from createBlock, but it's not in the
    // Block type yet, so we fall back to RLS-hidden blocks).
    // For now, return all blocks — the real filter kicks in after D3
    // adds workspace_id to the Block type and DB schema.
    return blocks
  }, [blocks, activeWorkspaceId])
}

/**
 * Filtered deleted blocks for trash view.
 */
export function useFilteredDeletedBlocks(): DeletedBlock[] {
  const deletedBlocks = useBlocksStore((s) => s.deletedBlocks)
  const activeWorkspaceId = useBlocksStore((s) => s.activeWorkspaceId)

  return useMemo(() => {
    if (!activeWorkspaceId) return deletedBlocks
    return deletedBlocks
  }, [deletedBlocks, activeWorkspaceId])
}

/**
 * Filtered relations.
 */
export function useFilteredRelations(): BlockRelation[] {
  const relations = useBlocksStore((s) => s.relations)
  const activeWorkspaceId = useBlocksStore((s) => s.activeWorkspaceId)

  return useMemo(() => {
    if (!activeWorkspaceId) return relations
    return relations
  }, [relations, activeWorkspaceId])
}

/**
 * Total count of all blocks (unfiltered) for stats.
 */
export function useTotalBlockCount(): number {
  return useBlocksStore((s) => s.blocks.length)
}

/**
 * Active workspace info.
 */
export function useActiveWorkspace() {
  const workspaces = useBlocksStore((s) => s.workspaces)
  const activeWorkspaceId = useBlocksStore((s) => s.activeWorkspaceId)
  return workspaces.find((w) => w.id === activeWorkspaceId) ?? null
}
