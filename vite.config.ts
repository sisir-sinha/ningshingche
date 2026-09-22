import { defineConfig } from 'vite'

function historyFallback() {
  return {
    name: 'history-fallback',
    configureServer(server: any) {
      server.middlewares.use((req: any, _res: any, next: any) => {
        const url = req.url || '/'
        // keep vite internals and assets
        if (
          url.startsWith('/@') ||
          url.startsWith('/src/') ||
          url.startsWith('/node_modules/') ||
          url.includes('.') ||
          url.startsWith('/__')
        ) return next()
        // /app/* -> app.html
        if (url.startsWith('/app')) {
          req.url = '/app.html'
          return next()
        }
        // everything else without extension -> index.html (site router handles /pricing, /help, etc.)
        if (url.startsWith('/pricing') || url.startsWith('/help') || url.startsWith('/login') || url.startsWith('/dashboard') || url.startsWith('/khata')) {
          req.url = '/index.html'
          return next()
        }
        next()
      })
    },
  }
}

export default defineConfig({
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
