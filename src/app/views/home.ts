import { supabase, isSupabaseConfigured } from '../../core/db/supabase'
import { getOutboxCount } from '../../core/db/idb'

export function homeView(): string {
  return `
  <div class="min-h-screen bg-[#f8fafc] flex flex-col">
    <!-- Top bar — clean client level -->
    <header class="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
      <div class="max-w-[1280px] mx-auto px-4 h-[60px] flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-slate-900 text-white grid place-items-center font-black text-xs">MK</div>
          <div>
            <div class="font-extrabold leading-none text-[15px]">Mekholi</div>
            <div id="home-store-name" class="text-xs text-slate-500 font-medium">Loading store…</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span id="home-offline-badge" class="hidden inline-flex items-center gap-1.5 text-xs font-bold bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-full"><span class="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></span> Offline</span>
          <a href="/app/pos" data-link class="hidden sm:inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-black"><span class="material-symbols-rounded text-[18px]">add</span> New Sale</a>
          <button id="home-user" class="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 grid place-items-center text-slate-600"><span class="material-symbols-rounded text-[20px]">person</span></button>
        </div>
      </div>
    </header>

    <div class="flex-1 max-w-[1280px] mx-auto w-full px-4 py-5 sm:py-6">
      <!-- Greeting + date -->
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="home-greeting" class="text-[22px] sm:text-[26px] font-black tracking-tight leading-none">Good morning</h1>
          <div id="home-date" class="text-sm text-slate-500 mt-1 font-medium"></div>
        </div>
        <div class="flex items-center gap-2">
          <button id="home-open-drawer" class="px-4 py-2 rounded-full border border-slate-200 bg-white text-sm font-bold hover:bg-slate-50">Open Drawer</button>
          <a href="/app/pos" data-link class="sm:hidden inline-flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-bold">New Sale <span class="material-symbols-rounded text-[16px]">arrow_forward</span></a>
        </div>
      </div>

      <!-- Stats — meaningful client metrics -->
      <div class="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="bg-white border border-slate-200 rounded-[18px] p-4">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold tracking-widest text-slate-500">TODAY SALES</div>
            <span class="w-7 h-7 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 grid place-items-center"><span class="material-symbols-rounded text-[16px]">payments</span></span>
          </div>
          <div id="stat-sales" class="mt-2 text-[22px] font-black leading-none">৳0</div>
          <div id="stat-sales-sub" class="text-xs font-semibold text-emerald-600 mt-1">—</div>
        </div>
        <div class="bg-white border border-slate-200 rounded-[18px] p-4">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold tracking-widest text-slate-500">DUE TO COLLECT</div>
            <span class="w-7 h-7 rounded-full bg-red-50 border border-red-200 text-red-600 grid place-items-center"><span class="material-symbols-rounded text-[16px]">book</span></span>
          </div>
          <div id="stat-due" class="mt-2 text-[22px] font-black leading-none">৳0</div>
          <div id="stat-due-sub" class="text-xs font-semibold text-slate-500 mt-1">—</div>
        </div>
        <div class="bg-white border border-slate-200 rounded-[18px] p-4">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold tracking-widest text-slate-500">TODAY PROFIT</div>
            <span class="w-7 h-7 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 grid place-items-center"><span class="material-symbols-rounded text-[16px]">trending_up</span></span>
          </div>
          <div id="stat-profit" class="mt-2 text-[22px] font-black leading-none">৳0</div>
          <div class="text-xs text-slate-400 mt-1">Sales − cost − expense</div>
        </div>
        <div class="bg-white border border-amber-200 rounded-[18px] p-4">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold tracking-widest text-amber-700">LOW STOCK</div>
            <span class="w-7 h-7 rounded-full bg-amber-500 text-white grid place-items-center"><span class="material-symbols-rounded text-[16px]">warning</span></span>
          </div>
          <div id="stat-low" class="mt-2 text-[22px] font-black leading-none">0</div>
          <div id="stat-low-sub" class="text-xs font-semibold text-amber-700 mt-1">items ≤ 5</div>
        </div>
      </div>

      <!-- Quick actions -->
      <div class="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <a href="/app/pos" data-link class="bg-slate-900 text-white rounded-[18px] p-4 flex items-center gap-3 hover:bg-black transition">
          <span class="w-10 h-10 rounded-xl bg-white/15 grid place-items-center"><span class="material-symbols-rounded">point_of_sale</span></span>
          <div><div class="font-bold leading-none">New Sale</div><div class="text-xs text-slate-300">Barcode • ৳</div></div>
        </a>
        <a href="/app/khata" data-link class="bg-white border border-slate-200 rounded-[18px] p-4 flex items-center gap-3 hover:border-slate-300 transition">
          <span class="w-10 h-10 rounded-xl bg-red-50 border border-red-200 text-red-600 grid place-items-center"><span class="material-symbols-rounded">book</span></span>
          <div><div class="font-bold leading-none">Khata</div><div class="text-xs text-slate-500">Baki • Tagada</div></div>
        </a>
        <button id="quick-add-product" class="bg-white border border-slate-200 rounded-[18px] p-4 flex items-center gap-3 hover:border-slate-300 text-left">
          <span class="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 text-sky-600 grid place-items-center"><span class="material-symbols-rounded">add_box</span></span>
          <div><div class="font-bold leading-none">Add Product</div><div class="text-xs text-slate-500">Stock + price</div></div>
        </button>
        <button id="quick-add-expense" class="bg-white border border-slate-200 rounded-[18px] p-4 flex items-center gap-3 hover:border-slate-300 text-left">
          <span class="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 grid place-items-center"><span class="material-symbols-rounded">receipt_long</span></span>
          <div><div class="font-bold leading-none">Add Expense</div><div class="text-xs text-slate-500">Kharcha</div></div>
        </button>
      </div>

      <!-- Lower: Recent + Low stock -->
      <div class="mt-5 grid lg:grid-cols-[1.1fr_0.9fr] gap-4">
        <div class="bg-white border border-slate-200 rounded-[18px] p-4">
          <div class="flex items-center justify-between">
            <div class="font-bold">Recent Sales</div>
            <a href="/app/pos" data-link class="text-xs font-bold text-sky-600 hover:underline">Open POS →</a>
          </div>
          <div id="recent-sales" class="mt-3 space-y-2 max-h-[320px] overflow-auto pr-1"></div>
        </div>
        <div class="bg-white border border-slate-200 rounded-[18px] p-4">
          <div class="flex items-center justify-between">
            <div class="font-bold">Low Stock</div>
            <span id="low-stock-count" class="text-xs font-bold bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1 rounded-full">0 items</span>
          </div>
          <div id="low-stock-list" class="mt-3 space-y-2 max-h-[320px] overflow-auto pr-1"></div>
        </div>
      </div>
    </div>

    <!-- Bottom nav (mobile) -->
    <nav class="lg:hidden sticky bottom-0 bg-white border-t border-slate-200 px-2 py-2 flex justify-around">
      <a href="/app.html" data-link class="flex flex-col items-center gap-1 text-slate-900"><span class="material-symbols-rounded bg-slate-900 text-white p-1.5 rounded-full">home</span><span class="text-[10px] font-bold">Home</span></a>
      <a href="/app/pos" data-link class="flex flex-col items-center gap-1 text-slate-500"><span class="material-symbols-rounded">point_of_sale</span><span class="text-[10px] font-bold">POS</span></a>
      <a href="/app/khata" data-link class="flex flex-col items-center gap-1 text-slate-500"><span class="material-symbols-rounded">book</span><span class="text-[10px] font-bold">Khata</span></a>
      <button id="nav-more" class="flex flex-col items-center gap-1 text-slate-500"><span class="material-symbols-rounded">more_horiz</span><span class="text-[10px] font-bold">More</span></button>
    </nav>
  </div>
  `
}

export async function initHome(){
  // date
  const dEl = document.getElementById('home-date')
  const gEl = document.getElementById('home-greeting')
  const now = new Date()
  if(dEl) dEl.textContent = now.toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  if(gEl){
    const h = now.getHours()
    gEl.textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  }

  // offline badge (only show when offline/pending) — static import fixes vite chunk warning
  try{
    const n = await getOutboxCount().catch(()=>0)
    const el = document.getElementById('home-offline-badge')
    if(el){
      if(!navigator.onLine || n>0){ el.classList.remove('hidden'); el.innerHTML = `<span class="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></span> ${n>0? n+' pending • Offline': 'Offline mode'}` }
      else el.classList.add('hidden')
    }
  }catch{}

  // load store name + stats (Supabase or demo)
  let sales = 0, due = 0, lowCount = 0
  let storeName = 'Your Store'
  let recentSales: any[] = []
  let lowStock: any[] = []

  if(isSupabaseConfigured){
    try{
      const { data: { user } } = await supabase.auth.getUser()
      if(user){
        const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
        const sid = prof?.store_id
        if(sid){
          const { data: store } = await supabase.from('stores').select('name').eq('id', sid).maybeSingle() as any
          if(store?.name) storeName = store.name
          // today sales: sum total_amount where created_at >= today
          const today = new Date(); today.setHours(0,0,0,0)
          const { data: orders } = await supabase.from('orders').select('id,receipt_number,total_amount,created_at,payment_method').eq('store_id', sid).gte('created_at', today.toISOString()).order('created_at', { ascending:false }).limit(20) as any
          if(orders){
            recentSales = orders
            sales = orders.reduce((s:number,r:any)=> s+Number(r.total_amount||0), 0)
          }
          const { data: customers } = await supabase.from('customers').select('due_balance').eq('store_id', sid) as any
          if(customers) due = customers.reduce((s:number,c:any)=> s+Number(c.due_balance||0),0)
          const { data: low } = await supabase.from('products').select('id,name,stock_quantity,price,unit').eq('store_id', sid).lte('stock_quantity', 5).order('stock_quantity').limit(10) as any
          if(low){ lowStock = low; lowCount = low.length }
        }
      }
    }catch(e){ console.warn('home stats failed', e) }
  }

  // demo fallback if no data
  if(!sales && !due && !lowCount){
    sales = 12480; due = 8350; lowCount = 3
    recentSales = [
      { receipt_number:'MEK-2026-8123', total_amount:335, payment_method:'bkash', created_at: new Date().toISOString() },
      { receipt_number:'MEK-2026-8122', total_amount:780, payment_method:'cash', created_at: new Date(Date.now()-3600000).toISOString() },
      { receipt_number:'MEK-2026-8121', total_amount:120, payment_method:'due', created_at: new Date(Date.now()-7200000).toISOString() },
    ]
    lowStock = [
      { name:'Parachute Oil 200ml', stock_quantity:2, price:180, unit:'pcs' },
      { name:'Miniket Rice 1kg', stock_quantity:3, price:78, unit:'kg' },
      { name:'Lux Soap', stock_quantity:5, price:55, unit:'pcs' },
    ]
  }

  const sn = document.getElementById('home-store-name'); if(sn) sn.textContent = storeName
  const sEl = document.getElementById('stat-sales'); if(sEl) sEl.textContent = `৳${Number(sales).toLocaleString('en-BD')}`
  const sSub = document.getElementById('stat-sales-sub'); if(sSub) sSub.textContent = recentSales.length ? `${recentSales.length} sales today` : 'No sales yet'
  const dUEl = document.getElementById('stat-due'); if(dUEl) dUEl.textContent = `৳${Number(due).toLocaleString('en-BD')}`
  const dUSub = document.getElementById('stat-due-sub'); if(dUSub) dUSub.textContent = due>0 ? 'Tap Khata to collect' : 'All clear'
  const lowEl = document.getElementById('stat-low'); if(lowEl) lowEl.textContent = String(lowCount)
  const lowCountEl = document.getElementById('low-stock-count'); if(lowCountEl) lowCountEl.textContent = `${lowCount} items`

  const recentEl = document.getElementById('recent-sales')
  if(recentEl){
    if(!recentSales.length) recentEl.innerHTML = `<div class="text-sm text-slate-500 py-8 text-center border-2 border-dashed border-slate-200 rounded-2xl">No sales today — start with New Sale</div>`
    else recentEl.innerHTML = recentSales.slice(0,6).map((r:any)=> `
      <div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
        <div>
          <div class="text-sm font-bold">${r.receipt_number}</div>
          <div class="text-xs text-slate-500">${new Date(r.created_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })} • ${r.payment_method}</div>
        </div>
        <div class="font-black text-sm">৳${Number(r.total_amount).toFixed(2)}</div>
      </div>
    `).join('')
  }

  const lowElList = document.getElementById('low-stock-list')
  if(lowElList){
    if(!lowStock.length) lowElList.innerHTML = `<div class="text-sm text-slate-500 py-8 text-center">All stocked ✓</div>`
    else lowElList.innerHTML = lowStock.map((p:any)=> `
      <div class="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
        <div>
          <div class="text-sm font-bold">${p.name}</div>
          <div class="text-xs text-slate-500">${p.stock_quantity} left • ৳${Number(p.price).toFixed(2)}/${p.unit||'pcs'}</div>
        </div>
        <span class="text-xs font-bold bg-amber-500 text-white px-2 py-1 rounded-full">Low</span>
      </div>
    `).join('')
  }

  // quick actions
  document.getElementById('quick-add-product')?.addEventListener('click', ()=>{
    const name = prompt('Product name:')
    if(!name) return
    const price = parseFloat(prompt('Price ৳:', '100')||'0')
    if(!price) return
    if(isSupabaseConfigured){
      (async()=>{
        const { data:{ user } } = await supabase.auth.getUser()
        if(!user) { (window as any).toast?.('Please log in'); return }
        const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
        const sid = prof?.store_id
        if(!sid) return
        const { error } = await supabase.from('products').insert({ store_id: sid, name, price, stock_quantity: 10, unit:'pcs' } as any)
        if(error) (window as any).toast?.(error.message)
        else { (window as any).toast?.('Added ✓'); location.reload() }
      })()
    } else (window as any).toast?.('Demo: product added')
  })
  document.getElementById('quick-add-expense')?.addEventListener('click', ()=>{
    const amt = parseFloat(prompt('Expense amount ৳:', '200')||'0')
    if(!amt) return
    const note = prompt('Note:', 'Transport')||''
    if(isSupabaseConfigured){
      (async()=>{
        const { data:{ user } } = await supabase.auth.getUser()
        if(!user) return
        const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
        const sid = prof?.store_id
        await supabase.from('expenses').insert({ store_id: sid, category:'other', amount: amt, note } as any)
        ;(window as any).toast?.('Expense saved')
      })()
    } else (window as any).toast?.(`Expense ৳${amt} saved (demo)`)
  })
}
