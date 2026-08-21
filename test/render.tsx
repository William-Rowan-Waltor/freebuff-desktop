// Configurable mount helper for component tests, built directly on react-dom's
// createRoot (no testing-library dependency):
//
//   render(<MyComponent />, {
//     fakeTimers: { now: T0 },        // run under vitest fake timers, pinned to T0
//     resetStores: false,             // skip resetting the app's zustand stores
//     wrapper: ({ children }) => <Theme>{children}</Theme>,
//   })
//
// - The result exposes the mounted `container` (a div appended to
//   document.body), plus `rerender` and `unmount`.
// - After each test the tree is unmounted and fake timers are restored, so a
//   test that opts into fake timers can never leak them into the next one.
// - By default the five app stores (timer, settings, theme, workspace,
//   blocks) are reset to their module-load initial state so tests start clean;
//   pass `resetStores: false` when a test seeds a store before rendering.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, vi } from 'vitest'

import { useTimerStore } from '@/store/useTimerStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useThemeStore } from '@/store/useThemeStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useBlocksStore } from '@/store/useBlocksStore'

interface RenderOptions {
  /** Run the test under vitest's fake timers, optionally pinned to a Date.now(). */
  fakeTimers?: boolean | { now: number }
  /** Reset the app's known stores to their initial state before mounting. Default true. */
  resetStores?: boolean
  /** Wrap the rendered tree in a provider component. */
  wrapper?: (props: { children: ReactNode }) => ReactNode
}

interface RenderResult {
  container: HTMLElement
  rerender: (ui: ReactElement) => void
  unmount: () => void
}

// Snapshot each store at import time — that is its true initial state (the
// persist middleware hydrates synchronously from an empty test localStorage,
// so these are the defaults the app ships with).
const initialStates = {
  timer: useTimerStore.getState(),
  settings: useSettingsStore.getState(),
  theme: useThemeStore.getState(),
  workspace: useWorkspaceStore.getState(),
  blocks: useBlocksStore.getState(),
}

let root: Root | null = null
let container: HTMLElement | null = null

function cleanup(): void {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  if (container?.parentNode) {
    container.parentNode.removeChild(container)
  }
  container = null
}

afterEach(() => {
  cleanup()
  // A test that opted into fake timers must not leak them into the next one.
  vi.useRealTimers()
})

export function render(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  const { fakeTimers, resetStores = true, wrapper } = options

  // Unmount anything a previous render in the same test left mounted (the
  // afterEach cleanup handles the final one).
  if (root) {
    act(() => root!.unmount())
    root = null
    container?.parentNode?.removeChild(container)
    container = null
  }

  if (fakeTimers) {
    vi.useFakeTimers(fakeTimers === true ? undefined : { now: fakeTimers.now })
  }

  if (resetStores) {
    useTimerStore.setState(initialStates.timer)
    useSettingsStore.setState(initialStates.settings)
    useThemeStore.setState(initialStates.theme)
    useWorkspaceStore.setState(initialStates.workspace)
    useBlocksStore.setState(initialStates.blocks)
  }

  const host = document.createElement('div')
  document.body.appendChild(host)
  container = host
  root = createRoot(host)

  const renderTree = (el: ReactElement) => (wrapper ? wrapper({ children: el }) : el)

  act(() => {
    root!.render(renderTree(ui))
  })

  return {
    container: host,
    rerender: (next: ReactElement) => {
      act(() => {
        root!.render(renderTree(next))
      })
    },
    unmount: cleanup,
  }
}
