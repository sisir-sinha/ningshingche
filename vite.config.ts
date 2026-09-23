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
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true as any,
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: 'index.html',
        app: 'app.html',
      },
    },
  },
})
