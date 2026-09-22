import '../styles/app.css'
import { createRouter } from '../core/router/router'
import { renderSupabaseStatus } from '../core/components/supabase-status'
import { homeView, initHome } from './views/home'
import posView, { initPos } from './views/pos'
import { khataView, initKhata } from './views/khata'

function wrap(view: string, init?: () => void): string {
  // router will inject view; init called via mk:navigate
  return view
}

const mount = document.getElementById('app')!

const router = createRouter([
  { path: '/app', view: () => wrap(homeView()), title: 'Mekholi App — Home' },
  { path: '/app.html', view: () => wrap(homeView()), title: 'Mekholi App — Home' },
  { path: '/app/pos', view: () => wrap(posView()), title: 'Mekholi App — POS' },
  { path: '/app/khata', view: () => wrap(khataView()), title: 'Mekholi App — Khata' },
  { path: '/', view: () => { location.href = '/'; return '' } },
], mount)

window.addEventListener('mk:navigate', () => {
  const path = location.pathname
  renderSupabaseStatus('supabase-status')
  if (path === '/app' || path === '/app.html') initHome()
  if (path === '/app/pos') setTimeout(initPos, 0)
  if (path === '/app/khata') setTimeout(initKhata, 0)
})

// initial
setTimeout(() => {
  renderSupabaseStatus('supabase-status')
  const p = location.pathname
  if (p === '/app' || p === '/app.html') initHome()
  if (p === '/app/pos') initPos()
  if (p === '/app/khata') initKhata()
}, 0)
