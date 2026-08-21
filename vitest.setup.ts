// The suite runs in jsdom. Provide the browser APIs jsdom lacks that the app
// and React 19 depend on. In a node environment (opt-in via
// `@vitest-environment node`) provide a localStorage shim for zustand's
// `persist` middleware instead (which defaults to window.localStorage).
const isJsdom = typeof window !== 'undefined' && typeof document !== 'undefined'

if (!isJsdom) {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>()

    get length(): number {
      return this.store.size
    }

    clear(): void {
      this.store.clear()
    }

    getItem(key: string): string | null {
      return this.store.has(key) ? this.store.get(key)! : null
    }

    key(index: number): string | null {
      return [...this.store.keys()][index] ?? null
    }

    removeItem(key: string): void {
      this.store.delete(key)
    }

    setItem(key: string, value: string): void {
      this.store.set(key, value)
    }
  }

  const storage = new MemoryStorage()
  globalThis.localStorage = storage
  ;(globalThis as Record<string, unknown>).window = { localStorage: storage }
} else {
  // React 19 requires this flag for act() to work outside its own test
  // renderer (the render helper mounts through react-dom's createRoot).
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

  // jsdom ships no matchMedia (GSAP and media-query consumers call it).
  if (!window.matchMedia) {
    window.matchMedia = ((query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia
  }

  // ResizeObserver (some editor/canvas tooling schedules on it).
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver
  }

  // FullCalendar schedules layout on requestAnimationFrame, which jsdom does
  // not implement. Fire on the next macrotask so it works with real timers
  // (and is simply inert under fake timers, which drive setTimeout itself).
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
      window.setTimeout(() => cb(Date.now()), 0)) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = ((id: number): void =>
      window.clearTimeout(id)) as typeof window.cancelAnimationFrame
  }
}
