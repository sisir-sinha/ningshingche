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
  },
})
