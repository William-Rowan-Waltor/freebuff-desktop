import type { JSONContent } from '@tiptap/core'

export interface TaskCounts {
  done: number
  total: number
}

/**
 * Recursively count task items in a Tiptap JSON document.
 *
 * Tasks are stored as `taskList > taskItem` nodes (the Obsidian editor's
 * representation); `taskItem.attrs.checked === true` means done. Nested lists
 * inside a task item's content are counted too, so `total` reflects every
 * checkbox at any depth.
 */
export function countTasks(content: unknown): TaskCounts {
  const counts: TaskCounts = { done: 0, total: 0 }

  const visit = (nodes: JSONContent[] | undefined): void => {
    for (const node of nodes ?? []) {
      if (node.type === 'taskItem') {
        counts.total += 1
        if (node.attrs?.checked === true) counts.done += 1
      }
      if (node.content) visit(node.content)
    }
  }

  if (
    content &&
    typeof content === 'object' &&
    Array.isArray((content as { content?: unknown }).content)
  ) {
    visit((content as { content: JSONContent[] }).content)
  }
  return counts
}
