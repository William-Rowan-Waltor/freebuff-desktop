import { useBlocksStore } from '@/store/useBlocksStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { Block, BlockInput } from '@/types'

export type CreateKind = 'note' | 'event' | 'code' | 'file'

/** End time = start + the user-configured default event duration (minutes). */
export function withDefaultDuration(startIso: string): string {
  const minutes = useSettingsStore.getState().defaultEventDuration
  return new Date(new Date(startIso).getTime() + minutes * 60_000).toISOString()
}

export function defaultInput(kind: Exclude<CreateKind, 'file'>): BlockInput {
  switch (kind) {
    case 'event': {
      const start = new Date().toISOString()
      return {
        type: 'event',
        title: 'Sự kiện mới',
        content: { type: 'doc', content: [] },
        start_time: start,
        end_time: withDefaultDuration(start),
      }
    }
    case 'code':
      return { type: 'code', title: 'Mã nguồn mới', content: '' }
    default:
      return { type: 'note', title: 'Ghi chú mới', content: { type: 'doc', content: [] } }
  }
}

export function fileBlockInput(file: File): BlockInput {
  return {
    type: 'file',
    title: file.name,
    content: null,
    file_url: null,
    file_extension: file.name.split('.').pop()?.toLowerCase() ?? null,
  }
}

/** Single source of truth for creation defaults + the open-flow (select + right pane). */
export function useCreateBlock() {
  const addBlock = useBlocksStore((s) => s.addBlock)
  const uploadFile = useBlocksStore((s) => s.uploadFile)
  const setSelectedBlock = useWorkspaceStore((s) => s.setSelectedBlock)
  const setActiveRightPane = useWorkspaceStore((s) => s.setActiveRightPane)

  const create = async (kind: CreateKind): Promise<Block | null> => {
    if (kind === 'file') return null
    const block = await addBlock(defaultInput(kind))
    setSelectedBlock(block.id)
    setActiveRightPane('editor')
    return block
  }

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      const block = await addBlock(fileBlockInput(file))
      await uploadFile(file, block.id)
    }
  }

  return { create, upload }
}
