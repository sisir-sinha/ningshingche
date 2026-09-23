import { getTheme, toggleTheme } from '../../core/utils/theme'
import { getOutboxCount } from '../../core/db/idb'
import { withBase } from '../../core/utils/base'

export type NavKey = 'home'|'pos'|'products'|'khata'|'expenses'|'reports'|'settings'|'purchases'|'suppliers'|'orders'|'stock'

const NAV: { key: NavKey; label: string; href: string; icon: string }[] = [
  { key:'home', label:'Home', href:'/app.html', icon:'home' },
  { key:'pos', label:'POS', href:'/app/pos', icon:'point_of_sale' },
  { key:'products', label:'Products', href:'/app/products', icon:'inventory_2' },
  { key:'purchases', label:'Purchases', href:'/app/purchases', icon:'local_shipping' },
  { key:'suppliers', label:'Suppliers', href:'/app/suppliers', icon:'storefront' },
  { key:'orders', label:'Orders', href:'/app/orders', icon:'shopping_bag' },
  { key:'stock', label:'Stock Adjust', href:'/app/stock', icon:'warehouse' },
  { key:'khata', label:'Khata', href:'/app/khata', icon:'book' },
  { key:'expenses', label:'Expenses', href:'/app/expenses', icon:'receipt_long' },
  { key:'reports', label:'Reports', href:'/app/reports', icon:'bar_chart' },
  { key:'settings', label:'Settings', href:'/app/settings', icon:'settings' },
]

export function appLayout(active: NavKey, content: string, opts?: { title?: string; storeName?: string }): string {
  const title = opts?.title || ''
  const storeName = opts?.storeName || ''
  const themeIcon = getTheme() === 'dark' ? 'light_mode' : 'dark_mode'
  return `
  <div class="min-h-screen bg-[#f8fafc] dark:bg-[#020617] flex">
    <!-- Desktop sidebar -->
    <aside class="hidden lg:flex w-[260px] shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex-col sticky top-0 h-screen">
      <div class="h-[60px] flex items-center gap-3 px-5 border-b border-slate-200 dark:border-slate-800">
        <div class="w-9 h-9 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black text-xs">MK</div>
        <div>
          <div class="font-extrabold leading-none dark:text-white">Mekholi</div>
          <div class="text-xs text-slate-500 font-medium truncate max-w-[140px]">${storeName || 'Your Store'}</div>
        </div>
        <button id="theme-toggle-desktop" class="ml-auto w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center hover:bg-slate-50 dark:hover:bg-slate-700"><span class="material-symbols-rounded text-[18px]">${themeIcon}</span></button>
      </div>
      <nav class="flex-1 p-3 space-y-1 overflow-auto">
        ${NAV.map(n=> `
          <a href="${withBase(n.href)}" data-link class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition ${active===n.key ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'}">
            <span class="material-symbols-rounded text-[20px]">${n.icon}</span> ${n.label}
          </a>
        `).join('')}
      </nav>
      <div class="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
        <div class="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
          <div class="text-xs font-bold text-slate-600 dark:text-slate-400">Store</div>
          <div class="text-sm font-bold truncate dark:text-white">${storeName || 'Your Store'}</div>
          <div class="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><span class="w-2 h-2 bg-emerald-500 rounded-full"></span> Online</div>
        </div>
        <div class="flex gap-2">
          <a href="${withBase('/')}" data-link class="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-700">Website</a>
          <button id="app-logout" class="flex-1 text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2 rounded-full hover:bg-red-50 hover:text-red-600 hover:border-red-200">Log out</button>
        </div>
      </div>
    </aside>

    <!-- Mobile drawer -->
    <div id="app-drawer" class="lg:hidden fixed inset-0 z-40 hidden">
      <div id="drawer-backdrop" class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"></div>
      <aside class="absolute left-0 top-0 bottom-0 w-[280px] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
        <div class="h-[60px] flex items-center justify-between px-5 border-b border-slate-200 dark:border-slate-800">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black text-xs">MK</div>
            <div class="font-extrabold dark:text-white">Mekholi</div>
          </div>
          <div class="flex items-center gap-2">
            <button id="theme-toggle-mobile" class="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 grid place-items-center"><span class="material-symbols-rounded text-[18px]">${themeIcon}</span></button>
            <button id="drawer-close" class="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 grid place-items-center"><span class="material-symbols-rounded text-[18px]">close</span></button>
          </div>
        </div>
        <nav class="flex-1 p-3 space-y-1 overflow-auto">
          ${NAV.map(n=> `
            <a href="${withBase(n.href)}" data-link class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold ${active===n.key ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400'}">
              <span class="material-symbols-rounded text-[20px]">${n.icon}</span> ${n.label}
            </a>
          `).join('')}
        </nav>
        <div class="p-3 border-t border-slate-200 dark:border-slate-800">
          <button id="drawer-logout" class="w-full py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold">Log out</button>
        </div>
      </aside>
    </div>

    <!-- Main -->
    <div class="flex-1 min-w-0 flex flex-col">
      <!-- Top bar mobile -->
      <header class="lg:hidden sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div class="h-[56px] flex items-center gap-3 px-4">
          <button id="drawer-open" class="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 grid place-items-center"><span class="material-symbols-rounded">menu</span></button>
          <div class="font-bold text-sm dark:text-white">${title || 'Mekholi'}</div>
          <div class="ml-auto flex items-center gap-2">
            <button id="notif-btn-mobile" class="relative w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 grid place-items-center">
              <span class="material-symbols-rounded text-[18px]">notifications</span>
              <span id="notif-dot" class="hidden absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-900"></span>
            </button>
            <a href="${withBase('/app/pos')}" data-link class="inline-flex items-center gap-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-full text-xs font-bold">New Sale</a>
          </div>
        </div>
      </header>

      <!-- Desktop top bar -->
      <header class="hidden lg:flex sticky top-0 z-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div class="flex-1 max-w-[1280px] mx-auto w-full px-6 h-[60px] flex items-center justify-between">
          <h1 class="text-[18px] font-black tracking-tight dark:text-white">${title}</h1>
          <div class="flex items-center gap-2">
            <span id="layout-offline" class="hidden text-xs font-bold bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1 rounded-full">Offline</span>
            <button id="theme-toggle" class="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center hover:bg-slate-50 dark:hover:bg-slate-700"><span class="material-symbols-rounded text-[18px]">${themeIcon}</span></button>
            <div class="relative">
              <button id="notif-btn" class="relative w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center hover:bg-slate-50 dark:hover:bg-slate-700">
                <span class="material-symbols-rounded text-[18px]">notifications</span>
                <span id="notif-badge" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold grid place-items-center rounded-full px-1"></span>
              </button>
              <div id="notif-dropdown" class="hidden absolute right-0 top-full mt-2 z-50"></div>
            </div>
            <a href="${withBase('/app/settings')}" data-link class="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center hover:bg-slate-50"><span class="material-symbols-rounded text-[18px]">person</span></a>
            <a href="${withBase('/app/pos')}" data-link class="inline-flex items-center gap-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 rounded-full text-sm font-bold hover:bg-black dark:hover:bg-slate-100"><span class="material-symbols-rounded text-[18px]">add</span> New Sale</a>
          </div>
        </div>
      </header>

      <main class="flex-1">
        ${content}
      </main>
    </div>
  </div>
  `
}

export function initLayout(){
  const drawer = document.getElementById('app-drawer')
  const open = document.getElementById('drawer-open')
  const close = document.getElementById('drawer-close')
  const backdrop = document.getElementById('drawer-backdrop')
  function show(){ drawer?.classList.remove('hidden'); document.body.style.overflow='hidden' }
  function hide(){ drawer?.classList.add('hidden'); document.body.style.overflow='' }
  open?.addEventListener('click', show)
  close?.addEventListener('click', hide)
  backdrop?.addEventListener('click', hide)
  drawer?.querySelectorAll('a[data-link]').forEach(a=> a.addEventListener('click', hide))

  // theme toggles
  const toggles = ['theme-toggle','theme-toggle-desktop','theme-toggle-mobile'].map(id=> document.getElementById(id)).filter(Boolean) as HTMLElement[]
  toggles.forEach(b=> b.addEventListener('click', async ()=>{
    const { toggleTheme } = await import('../../core/utils/theme')
    toggleTheme()
    // update icon
    const { getTheme } = await import('../../core/utils/theme')
    const ic = getTheme()==='dark' ? 'light_mode' : 'dark_mode'
    toggles.forEach(x=> { const s=x.querySelector('.material-symbols-rounded'); if(s) s.textContent=ic })
  }))

  // notifications
  import('../../core/components/notifications').then(m=>{
    m.initNotifications()
    const btn = document.getElementById('notif-btn')
    const mob = document.getElementById('notif-btn-mobile')
    const dd = document.getElementById('notif-dropdown')
    function toggleDD(){
      if(!dd) return
      const isHidden = dd.classList.contains('hidden')
      if(isHidden){ m.renderNotifDropdown('notif-dropdown'); dd.classList.remove('hidden') }
      else dd.classList.add('hidden')
    }
    btn?.addEventListener('click', toggleDD)
    mob?.addEventListener('click', ()=>{ m.renderNotifDropdown('notif-dropdown'); dd?.classList.toggle('hidden') })
    document.addEventListener('click', (e)=>{
      const t = e.target as HTMLElement
      if(!t.closest('#notif-btn') && !t.closest('#notif-dropdown') && !t.closest('#notif-btn-mobile')) dd?.classList.add('hidden')
    })
  })

  // logout
  const doLogout = async ()=>{
    const { supabase } = await import('../../core/db/supabase')
    await supabase.auth.signOut()
    localStorage.removeItem('mekholi-auth')
    location.href = withBase('/login')
  }
  document.getElementById('app-logout')?.addEventListener('click', doLogout)
  document.getElementById('drawer-logout')?.addEventListener('click', doLogout)

  // offline badge (now static import — fixes vite chunk warning)
  getOutboxCount().then(n=>{
    const el = document.getElementById('layout-offline')
    if(el && (n>0 || !navigator.onLine)){ el.classList.remove('hidden'); el.textContent = n>0 ? `${n} pending • Offline` : 'Offline' }
  }).catch(()=>{})
}