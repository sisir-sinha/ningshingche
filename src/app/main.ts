import '../styles/app.css'
import { createRouter } from '../core/router/router'
import { homeView, initHome } from './views/home'
import posView, { initPos } from './views/pos'
import { khataView, initKhata } from './views/khata'

const mount = document.getElementById('app')!

createRouter([
  { path: '/app', view: () => homeView(), title: 'Mekholi — Home' },
  { path: '/app.html', view: () => homeView(), title: 'Mekholi — Home' },
  { path: '/app/pos', view: () => posView(), title: 'Mekholi — POS' },
  { path: '/app/khata', view: () => khataView(), title: 'Mekholi — Khata' },
  { path: '/', view: () => { location.href = '/'; return '' } },
], mount)

window.addEventListener('mk:navigate', () => {
  const p = location.pathname
  if (p === '/app' || p === '/app.html') setTimeout(initHome, 0)
  if (p === '/app/pos') setTimeout(initPos, 0)
  if (p === '/app/khata') setTimeout(initKhata, 0)
})

setTimeout(() => {
  const p = location.pathname
  if (p === '/app' || p === '/app.html') initHome()
  if (p === '/app/pos') initPos()
  if (p === '/app/khata') initKhata()
}, 0)
