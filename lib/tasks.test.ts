import { describe, expect, it } from 'vitest'
import { countTasks } from './tasks'

const taskItem = (checked: boolean, content: unknown[] = []) => ({
  type: 'taskItem',
  attrs: { checked },
  content,
})

describe('countTasks', () => {
  it('returns zero for null / non-document content', () => {
    expect(countTasks(null)).toEqual({ done: 0, total: 0 })
    expect(countTasks('just a string')).toEqual({ done: 0, total: 0 })
    expect(countTasks({})).toEqual({ done: 0, total: 0 })
  })

  it('returns zero for an empty document', () => {
    expect(countTasks({ type: 'doc', content: [] })).toEqual({ done: 0, total: 0 })
  })

  it('counts top-level task items with their checked split', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
        {
          type: 'taskList',
          content: [
            taskItem(false),
            taskItem(true),
            taskItem(true),
          ],
        },
      ],
    }
    expect(countTasks(doc)).toEqual({ done: 2, total: 3 })
  })

  it('counts nested task lists inside a task item (any depth)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            taskItem(false, [
              { type: 'paragraph', content: [{ type: 'text', text: 'parent' }] },
              {
                type: 'taskList',
                content: [
                  taskItem(true),
                  taskItem(false, [
                    {
                      type: 'taskList',
                      content: [taskItem(true)],
                    },
                  ]),
                ],
              },
            ]),
          ],
        },
      ],
    }
    // 1 parent (unchecked) + 2 siblings (checked) + 1 grandchild (checked).
    expect(countTasks(doc)).toEqual({ done: 2, total: 4 })
  })

  it('only counts items whose checked is literally true', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            taskItem(true),
            { type: 'taskItem', attrs: { checked: 'true' }, content: [] },
            taskItem(false),
          ],
        },
      ],
    }
    expect(countTasks(doc)).toEqual({ done: 1, total: 3 })
  })

  it('does not count plain list items', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
        },
        { type: 'taskList', content: [taskItem(true)] },
      ],
    }
    expect(countTasks(doc)).toEqual({ done: 1, total: 1 })
  })

  it('handles documents where content is present but not an array', () => {
    expect(countTasks({ type: 'doc', content: 'nope' })).toEqual({ done: 0, total: 0 })
  })
})