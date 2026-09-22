export type NavKey = 'home'|'pos'|'products'|'khata'|'expenses'|'reports'|'settings'

const NAV: { key: NavKey; label: string; href: string; icon: string }[] = [
  { key:'home', label:'Home', href:'/app.html', icon:'home' },
  { key:'pos', label:'POS', href:'/app/pos', icon:'point_of_sale' },
  { key:'products', label:'Products', href:'/app/products', icon:'inventory_2' },
  { key:'khata', label:'Khata', href:'/app/khata', icon:'book' },
  { key:'expenses', label:'Expenses', href:'/app/expenses', icon:'receipt_long' },
  { key:'reports', label:'Reports', href:'/app/reports', icon:'bar_chart' },
]

export function appLayout(active: NavKey, content: string, opts?: { title?: string; storeName?: string }): string {
  const title = opts?.title || ''
  const storeName = opts?.storeName || ''
  return `
  <div class="min-h-screen bg-[#f8fafc] flex">
    <!-- Desktop sidebar -->
    <aside class="hidden lg:flex w-[260px] shrink-0 bg-white border-r border-slate-200 flex-col sticky top-0 h-screen">
      <div class="h-[60px] flex items-center gap-3 px-5 border-b border-slate-200">
        <div class="w-9 h-9 rounded-xl bg-slate-900 text-white grid place-items-center font-black text-xs">MK</div>
        <div>
          <div class="font-extrabold leading-none">Mekholi</div>
          <div class="text-xs text-slate-500 font-medium truncate max-w-[140px]">${storeName || 'Your Store'}</div>
        </div>
      </div>
      <nav class="flex-1 p-3 space-y-1 overflow-auto">
        ${NAV.map(n=> `
          <a href="${n.href}" data-link class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition ${active===n.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}">
            <span class="material-symbols-rounded text-[20px]">${n.icon}</span> ${n.label}
          </a>
        `).join('')}
      </nav>
      <div class="p-3 border-t border-slate-200">
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <div class="text-xs font-bold text-slate-600">Store</div>
          <div class="text-sm font-bold truncate">${storeName || 'Your Store'}</div>
          <div class="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><span class="w-2 h-2 bg-emerald-500 rounded-full"></span> Online</div>
        </div>
        <a href="/" data-link class="mt-2 flex items-center justify-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-900"><span class="material-symbols-rounded text-[16px]">language</span> Website</a>
      </div>
    </aside>

    <!-- Mobile drawer -->
    <div id="app-drawer" class="lg:hidden fixed inset-0 z-40 hidden">
      <div id="drawer-backdrop" class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"></div>
      <aside class="absolute left-0 top-0 bottom-0 w-[280px] bg-white border-r border-slate-200 flex flex-col">
        <div class="h-[60px] flex items-center justify-between px-5 border-b border-slate-200">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-slate-900 text-white grid place-items-center font-black text-xs">MK</div>
            <div class="font-extrabold">Mekholi</div>
          </div>
          <button id="drawer-close" class="w-8 h-8 rounded-full border border-slate-200 grid place-items-center"><span class="material-symbols-rounded text-[18px]">close</span></button>
        </div>
        <nav class="flex-1 p-3 space-y-1 overflow-auto">
          ${NAV.map(n=> `
            <a href="${n.href}" data-link class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold ${active===n.key ? 'bg-slate-900 text-white' : 'text-slate-600'}">
              <span class="material-symbols-rounded text-[20px]">${n.icon}</span> ${n.label}
            </a>
          `).join('')}
        </nav>
      </aside>
    </div>

    <!-- Main -->
    <div class="flex-1 min-w-0 flex flex-col">
      <!-- Top bar mobile -->
      <header class="lg:hidden sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
        <div class="h-[56px] flex items-center gap-3 px-4">
          <button id="drawer-open" class="w-9 h-9 rounded-full border border-slate-200 grid place-items-center"><span class="material-symbols-rounded">menu</span></button>
          <div class="font-bold text-sm">${title || 'Mekholi'}</div>
          <div class="ml-auto flex items-center gap-2">
            <a href="/app/pos" data-link class="inline-flex items-center gap-1 bg-slate-900 text-white px-3 py-1.5 rounded-full text-xs font-bold">New Sale</a>
          </div>
        </div>
      </header>

      <!-- Desktop top bar (only title + actions) -->
      <header class="hidden lg:flex sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200">
        <div class="flex-1 max-w-[1280px] mx-auto w-full px-6 h-[60px] flex items-center justify-between">
          <h1 class="text-[18px] font-black tracking-tight">${title}</h1>
          <div class="flex items-center gap-2">
            <span id="layout-offline" class="hidden text-xs font-bold bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1 rounded-full">Offline</span>
            <a href="/app/pos" data-link class="inline-flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-black"><span class="material-symbols-rounded text-[18px]">add</span> New Sale</a>
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
  // close drawer on nav click
  drawer?.querySelectorAll('a[data-link]').forEach(a=> a.addEventListener('click', hide))
  // offline badge
  import('../../core/db/idb').then(async m=>{
    try{
      const n = await m.getOutboxCount().catch(()=>0)
      const el = document.getElementById('layout-offline')
      if(el && (n>0 || !navigator.onLine)){ el.classList.remove('hidden'); el.textContent = n>0 ? `${n} pending • Offline` : 'Offline' }
    }catch{}
  })
}
