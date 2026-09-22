import '../styles/app.css'
import { createRouter } from '../core/router/router'
import landing from './views/landing'
import pricing from './views/pricing'
import help from './views/help'
import login from './views/login'
import dashboard from './views/dashboard'

const mount = document.getElementById('site')!

const router = createRouter([
  { path: '/', view: landing, title: 'Mekholi — দোকানের হিসাব, এখন আরও সহজ' },
  { path: '/pricing', view: pricing, title: 'Mekholi Pricing — BDT via bKash' },
  { path: '/help', view: help, title: 'Mekholi Help' },
  { path: '/login', view: login, title: 'Mekholi — Log in' },
  { path: '/dashboard', view: dashboard, title: 'Mekholi — Dashboard' },
  // allow /app to redirect to PWA shell
  { path: '/app', view: () => { location.href = '/app.html'; return '' } },
  { path: '/app.html', view: () => { location.href = '/app.html'; return '' } },
], mount)

// global helpers: toast
function toast(msg: string, ms = 2200) {
  const el = document.getElementById('toast')!
  el.textContent = msg
  el.classList.remove('hidden')
  setTimeout(() => el.classList.add('hidden'), ms)
}
;(window as any).toast = toast

// site interactions after each navigate
window.addEventListener('mk:navigate', () => {
  initLanding()
})

function initLanding() {
  // mobile menu
  const btn = document.getElementById('mobile-menu-btn')
  const menu = document.getElementById('mobile-menu')
  if (btn && menu) {
    btn.onclick = () => menu.classList.toggle('hidden')
    // close on link click
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => menu.classList.add('hidden')))
    // close on anchor
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        const id = (a as HTMLAnchorElement).getAttribute('href')!.slice(1)
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        menu.classList.add('hidden')
      })
    })
  }

  // smooth scroll for desktop anchor links
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

  // lang toggle (demo)
  const langBtn = document.getElementById('lang-toggle')
  const langLabel = document.getElementById('lang-label')
  let bn = true
  langBtn?.addEventListener('click', () => {
    bn = !bn
    if (langLabel) langLabel.textContent = bn ? 'BN / EN' : 'EN / BN'
    toast(bn ? 'বাংলা মোড' : 'English mode')
  })

  // demo cart
  initDemoCart()

  // billing toggle
  const monthly = document.getElementById('bill-monthly')
  const yearly = document.getElementById('bill-yearly')
  const priceMain = document.getElementById('price-main')
  const priceSub = document.getElementById('price-sub')
  function setMonthly() {
    monthly?.classList.add('bg-white','text-slate-900'); yearly?.classList.remove('bg-white','text-slate-900'); yearly?.classList.add('text-white')
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

  // login otp demo
  const send = document.getElementById('otp-send')
  const verify = document.getElementById('otp-verify')
  const phone = document.getElementById('login-phone') as HTMLInputElement | null
  const code = document.getElementById('otp-code') as HTMLInputElement | null
  const msg = document.getElementById('login-msg')
  send?.addEventListener('click', () => {
    const v = phone?.value.trim() || ''
    if (!/^01[3-9]\d{8}$/.test(v)) { showMsg('Enter valid phone: 01XXXXXXXXX', true); return }
    showMsg('OTP sent (demo) — use 123456', false)
  })
  verify?.addEventListener('click', () => {
    if ((code?.value || '') === '123456') { showMsg('✓ Logged in (demo). Redirecting to /app …', false); setTimeout(()=> location.href='/app.html', 900) }
    else showMsg('Wrong OTP — try 123456 (demo)', true)
  })
  function showMsg(t: string, err: boolean) {
    if (!msg) return
    msg.textContent = t; msg.classList.remove('hidden'); msg.style.color = err ? '#dc2626' : '#059669'
  }

  // header shadow on scroll
  const header = document.getElementById('site-header')
  if (header) {
    const onScroll = () => {
      if (window.scrollY > 8) header.classList.add('shadow-sm')
      else header.classList.remove('shadow-sm')
    }
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll()
  }
}

// Demo cart logic (lite, vanilla)
type DemoItem = { id: string; name: string; price: number; qty: number }
let demoItems: DemoItem[] = []
let paper: '58'|'80' = '58'

function initDemoCart() {
  const addRice = document.getElementById('demo-add-rice')
  const addOil = document.getElementById('demo-add-oil')
  const clear = document.getElementById('demo-clear')
  const paperBtn = document.getElementById('paper-toggle')
  if (!addRice) return // not on landing

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
    cart.innerHTML = `<div class="text-sm text-slate-500 py-8 text-center border-2 border-dashed border-slate-200 rounded-2xl">Cart empty — click “+ Add”</div>`
    totals.classList.add('hidden')
    return
  }
  cart.innerHTML = demoItems.map(it => `
    <div class="flex items-center justify-between bg-white rounded-xl px-3 py-2.5 border border-slate-200">
      <div>
        <div class="text-sm font-bold">${it.name}</div>
        <div class="text-xs text-slate-500">${it.qty} × ৳${it.price}</div>
      </div>
      <div class="flex items-center gap-2">
        <button data-dec="${it.id}" class="w-7 h-7 rounded-full border border-slate-200 grid place-items-center hover:bg-slate-50">−</button>
        <span class="w-6 text-center text-sm font-bold">${it.qty}</span>
        <button data-inc="${it.id}" class="w-7 h-7 rounded-full bg-slate-900 text-white grid place-items-center">+</button>
        <span class="ml-2 font-bold text-sm">৳${(it.price*it.qty).toFixed(2)}</span>
      </div>
    </div>
  `).join('')
  // bind qty
  cart.querySelectorAll('[data-inc]').forEach(b=> b.addEventListener('click', ()=>{ const id=(b as HTMLElement).dataset.inc!; demoItems.find(x=>x.id===id)!.qty++; renderDemo()}))
  cart.querySelectorAll('[data-dec]').forEach(b=> b.addEventListener('click', ()=>{ const id=(b as HTMLElement).dataset.dec!; const f=demoItems.find(x=>x.id===id)!; f.qty--; if(f.qty<=0) demoItems=demoItems.filter(x=>x.id!==id); renderDemo()}))

  const sub = demoItems.reduce((s,x)=> s + x.price*x.qty, 0)
  const vat = +(sub * 0.05).toFixed(2)
  const total = +(sub + vat - 17).toFixed(2) // demo discount
  ;(document.getElementById('demo-sub') as HTMLElement).textContent = `৳${sub.toFixed(2)}`
  ;(document.getElementById('demo-vat') as HTMLElement).textContent = `৳${vat.toFixed(2)}`
  ;(document.getElementById('demo-total') as HTMLElement).textContent = `৳${total.toFixed(2)}`
  ;(document.getElementById('demo-pay') as HTMLElement).textContent = `৳${total.toFixed(2)}`
  totals.classList.remove('hidden')
}
