import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Unit tests for the kernel.
 *
 * The node environment is deliberate: the event bus, the plugin registry and
 * the permission matcher must not depend on a browser. `LocalPluginStorage`
 * falls back to an in-memory map when `localStorage` is absent, which is the
 * same path an Android WebView with storage disabled would take.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: ['verbose'],
    /**
     * The two screens that gate on the environment (login's sign-up notice,
     * the POS floor) ask `env.isSupabaseConfigured` before they render. On a
     * developer machine that is true because a gitignored `.env` exists; on a
     * fresh checkout — CI, or anyone cloning the repo — it is false, and those
     * tests failed with "expected null not to be null" on every run since
     * Phase 2. CI had been red for so long it read as normal.
     *
     * These placeholders make the unit tests hermetic: they assert what the
     * screens do when Supabase *is* configured, without needing a project.
     * No request is made to the address — every test stubs the data layer.
     */
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_APP_ENV: 'test',
    },
  },
})
