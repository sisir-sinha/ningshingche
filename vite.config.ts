<<<<<<< HEAD
import { defineConfig } from 'vite'
declare const process: any

function historyFallback() {
  const handler = (req: any, _res: any, next: any) => {
    const url: string = req.url || '/'
    const clean = url.split('?')[0].split('#')[0]
    // keep vite internals and assets
    if (
      clean.startsWith('/@') ||
      clean.startsWith('/src/') ||
      clean.startsWith('/node_modules/') ||
      clean.startsWith('/__') ||
      // file with extension (js, css, png, ico, etc.)
      /\.[a-z0-9]+$/i.test(clean)
    ) return next()
    // /app/* -> app.html (pos, products, etc.)
    if (clean === '/app' || clean === '/app.html' || clean.startsWith('/app/')) {
      req.url = '/app.html'
      return next()
    }
    // all other SPA routes -> index.html (site router handles /login, /pricing, /help, /dashboard, etc.)
    // previously we listed only few paths — now generic so /login never 404s from server
    if (clean === '/' || !clean.includes('.')) {
      // only rewrite if not already index/app
      if (clean !== '/index.html' && clean !== '/app.html') {
        req.url = '/index.html'
      }
    }
    next()
  }
  return {
    name: 'history-fallback',
    configureServer(server: any) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler)
    },
  }
}

export default defineConfig({
  // GitHub Pages project site lives under /<repo>/ . Set VITE_BASE=/Mekholi/ in Actions env to enable.
  // Vercel/Netlify/custom-domain keeps base = '/' (default). Local dev ignores base.
  base: process.env.VITE_BASE || '/',
  appType: 'mpa' as any,
  plugins: [historyFallback()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    cors: true,
    headers: { 'X-Frame-Options': 'ALLOWALL' },
=======
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// `base: './'` so the built bundle works from any sub-path (GitHub Pages,
// a CDN prefix, or an Android WebView asset root) without a rebuild.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Dev server only, never shipped. Sandboxed preview environments proxy
    // through a generated hostname, and Vite's host check rejects unknown
    // hosts by default. There is no production surface here to protect.
    allowedHosts: true,
>>>>>>> 30d95614fd203d94c586b0dd2b3d52ad7b55a0e1
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
<<<<<<< HEAD
    allowedHosts: true as any,
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: 'index.html',
        app: 'app.html',
=======
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep vendor code in its own chunk so app chunks stay small and
        // cache-friendly across deploys.
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
        },
>>>>>>> 30d95614fd203d94c586b0dd2b3d52ad7b55a0e1
      },
    },
  },
})
