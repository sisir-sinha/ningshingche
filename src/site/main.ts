import '../styles/app.css'
import { createRouter } from '../core/router/router'
import { initTheme } from '../core/utils/theme'
import { requireAuth, redirectIfAuthed } from '../core/auth/guard'
import { renderSupabaseStatus, mountSupabaseBanner } from '../core/components/supabase-status'
import landing from './views/landing'
import pricing from './views/pricing'
import help from './views/help'
import loginView, { initLogin } from './views/login'
import dashboard from './views/dashboard'

initTheme()

const mount = document.getElementById('site')!

const router = createRouter([
  { path: '/', view: landing, title: 'Mekholi — দোকানের হিসাব, এখন আরও সহজ' },
  { path: '/pricing', view: pricing, title: 'Mekholi Pricing — BDT via bKash' },
  { path: '/help', view: help, title: 'Mekholi Help' },
  { path: '/login', view: loginView, title: 'Mekholi — Log in / Register', guard: () => redirectIfAuthed() },
  { path: '/dashboard', view: dashboard, title: 'Mekholi — Dashboard', guard: () => requireAuth() },
  { path: '/app', view: () => { location.href = '/app.html'; return '' } },
  { path: '/app.html', view: () => { location.href = '/app.html'; return '' } },
], mount)

function toast(msg: string, ms = 2200) {
  try {
    const el = document.getElementById('toast') as HTMLElement | null
    if (!el) { console.log('[toast]', msg); return }
    el.textContent = msg
    el.classList.remove('hidden')
    clearTimeout((window as any)._t)
    ;(window as any)._t = setTimeout(() => el.classList.add('hidden'), ms)
  } catch { console.log('[toast]', msg) }
}
;(window as any).toast = toast

window.addEventListener('mk:navigate', () => {
  setTimeout(()=> initSite(), 0)
  renderSupabaseStatus('supabase-status')
  mountSupabaseBanner()
  if(location.pathname==='/login') setTimeout(()=> initLogin(), 50)
  if(location.pathname==='/dashboard') setTimeout(async ()=>{
    const { initDashboard } = await import('./views/dashboard')
    initDashboard()
  }, 80)
})

function initSite() {
  const tBtn = document.getElementById('site-theme-toggle')
  const tBtnM = document.getElementById('site-theme-toggle-mobile')
  import('../core/utils/theme').then(m=>{
    tBtn?.addEventListener('click', ()=> m.toggleTheme())
    tBtnM?.addEventListener('click', ()=> m.toggleTheme())
    const upd = ()=>{
      const th = m.getTheme()
      document.querySelectorAll('[data-theme-icon]').forEach(el=>{
        ;(el as HTMLElement).textContent = th==='dark' ? 'light_mode' : 'dark_mode'
      })
    }
    window.addEventListener('mk:theme', upd as any)
    upd()
  })
  const btn = document.getElementById('mobile-menu-btn')
  const menu = document.getElementById('mobile-menu')
  if (btn && menu) {
    btn.onclick = () => menu.classList.toggle('hidden')
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => menu.classList.add('hidden')))
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        const id = (a as HTMLAnchorElement).getAttribute('href')!.slice(1)
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        menu.classList.add('hidden')
      })
    })
  }
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    if(a.closest('#mobile-menu')) return
    a.addEventListener('click', (e) => {
      const href = (a as HTMLAnchorElement).getAttribute('href')!
      if (href.length > 1) {
        e.preventDefault()
        document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' })
      }
    })
  })
  const langBtn = document.getElementById('lang-toggle')
  const langLabel = document.getElementById('lang-label')
  let bn = true
  langBtn?.addEventListener('click', () => {
    bn = !bn
    if (langLabel) langLabel.textContent = bn ? 'BN / EN' : 'EN / BN'
    toast(bn ? 'বাংলা মোড' : 'English mode')
  })
  initDemoCart()
  const monthly = document.getElementById('bill-monthly')
  const yearly = document.getElementById('bill-yearly')
  const priceMain = document.getElementById('price-main')
  const priceSub = document.getElementById('price-sub')
  function setMonthly() {
    monthly?.classList.add('bg-white','text-slate-900','dark:bg-white'); yearly?.classList.remove('bg-white','text-slate-900'); yearly?.classList.add('text-white')
    if(priceMain) priceMain.textContent = '৳499'
    priceSub?.classList.add('hidden')
  }
  function setYearly() {
    yearly?.classList.add('bg-white','text-slate-900'); yearly?.classList.remove('text-white'); monthly?.classList.remove('bg-white','text-slate-900'); monthly?.classList.add('text-white')
    if(priceMain) priceMain.textContent = '৳4,999'
    priceSub?.classList.remove('hidden')
  }
  monthly?.addEventListener('click', setMonthly)
  yearly?.addEventListener('click', setYearly)
  const header = document.getElementById('site-header')
  if (header) {
    const onScroll = () => {
      if (window.scrollY > 8) header.classList.add('shadow-sm')
      else header.classList.remove('shadow-sm')
    }
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll()
  }
}

type DemoItem = { id: string; name: string; price: number; qty: number }
let demoItems: DemoItem[] = []
let paper: '58'|'80' = '58'
function initDemoCart() {
  const addRice = document.getElementById('demo-add-rice')
  const addOil = document.getElementById('demo-add-oil')
  const clear = document.getElementById('demo-clear')
  const paperBtn = document.getElementById('paper-toggle')
  if (!addRice) return
  addRice.onclick = () => upsert({ id: 'rice', name: 'Miniket Rice 1kg', price: 78 })
  if (addOil) addOil.onclick = () => upsert({ id: 'oil', name: 'Parachute Oil', price: 180 })
  if (clear) clear.onclick = () => { demoItems = []; renderDemo() }
  if (paperBtn) (paperBtn as HTMLElement).onclick = () => {
    paper = paper === '58' ? '80' : '58'
    ;(paperBtn as HTMLElement).textContent = `Paper: ${paper}mm`
    toast(`Paper → ${paper}mm (${paper==='58'?'32 chars':'48 chars'})`)
  }
  renderDemo()
}
function upsert(it: Omit<DemoItem,'qty'>) {
  const f = demoItems.find(x=>x.id===it.id)
  if (f) f.qty += 1
  else demoItems.push({ ...it, qty: 1 })
  renderDemo()
}
function renderDemo() {
  const cart = document.getElementById('demo-cart')
  const totals = document.getElementById('demo-totals')
  if (!cart || !totals) return
  if (demoItems.length === 0) {
    cart.innerHTML = `<div class="text-sm text-slate-500 py-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">Cart empty — click “+ Add”</div>`
    totals.classList.add('hidden')
    return
  }
  cart.innerHTML = demoItems.map(it => `
    <div class="flex items-center justify-between bg-white dark:bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-200 dark:border-slate-700">
      <div>
        <div class="text-sm font-bold dark:text-white">${it.name}</div>
        <div class="text-xs text-slate-500">${it.qty} × ৳${it.price}</div>
      </div>
      <div class="flex items-center gap-2">
        <button data-dec="${it.id}" class="w-7 h-7 rounded-full border border-slate-200 dark:border-slate-700 grid place-items-center hover:bg-slate-50 dark:text-white">−</button>
        <span class="w-6 text-center text-sm font-bold dark:text-white">${it.qty}</span>
        <button data-inc="${it.id}" class="w-7 h-7 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center">+</button>
        <span class="ml-2 font-bold text-sm dark:text-white">৳${(it.price*it.qty).toFixed(2)}</span>
      </div>
    </div>
  `).join('')
  cart.querySelectorAll('[data-inc]').forEach(b=> b.addEventListener('click', ()=>{ const id=(b as HTMLElement).dataset.inc!; demoItems.find(x=>x.id===id)!.qty++; renderDemo()}))
  cart.querySelectorAll('[data-dec]').forEach(b=> b.addEventListener('click', ()=>{ const id=(b as HTMLElement).dataset.dec!; const f=demoItems.find(x=>x.id===id)!; f.qty--; if(f.qty<=0) demoItems=demoItems.filter(x=>x.id!==id); renderDemo()}))
  const sub = demoItems.reduce((s,x)=> s + x.price*x.qty, 0)
  const vat = +(sub * 0.05).toFixed(2)
  const total = +(sub + vat).toFixed(2)
  ;(document.getElementById('demo-sub') as HTMLElement).textContent = `৳${sub.toFixed(2)}`
  ;(document.getElementById('demo-vat') as HTMLElement).textContent = `৳${vat.toFixed(2)}`
  ;(document.getElementById('demo-total') as HTMLElement).textContent = `৳${total.toFixed(2)}`
  ;(document.getElementById('demo-pay') as HTMLElement).textContent = `৳${total.toFixed(2)}`
  totals.classList.remove('hidden')
}
setTimeout(()=> { initSite(); if(location.pathname==='/login') initLogin(); if(location.pathname==='/dashboard') import('./views/dashboard').then(m=>m.initDashboard()) }, 0)

// global auth sync: if signed out while on /dashboard, bounce to /login
import('./../core/db/supabase').then(({ supabase })=>{
  supabase.auth.onAuthStateChange((event)=>{
    if(event==='SIGNED_OUT' && location.pathname==='/dashboard'){
      location.href = '/login?redirect=' + encodeURIComponent(location.pathname)
    }
    if(event==='SIGNED_IN' && location.pathname==='/login'){
      const p = new URLSearchParams(location.search).get('redirect')
      location.href = p && p.startsWith('/app') ? p : '/app'
    }
  })
})
