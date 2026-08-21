import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      // Match tsconfig.json paths so tests can import app modules as @/...
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // rrule ships a webpack-UMD CJS build (getter-based named exports); under
    // Node's ESM-CJS interop the rrule plugin's `import * as rruleLib from
    // 'rrule'` can't see RRule, so inline both so Vite's interop handles them.
    server: {
      deps: {
        inline: ['@fullcalendar/rrule', 'rrule'],
      },
    },
    // lib/supabase/client.ts throws at import when these are missing, and the
    // render helper pulls useBlocksStore (hence the client) into most suites.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    // The real-FullCalendar suite waits for lazy imports + post-mount paint.
    testTimeout: 20_000,
  },
})
