export function homeView(): string {
  return `
  <div class="min-h-screen bg-slate-50">
    <header class="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div class="max-w-[1280px] mx-auto px-4 h-[56px] flex items-center justify-between">
        <a href="/" data-link class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-slate-900 text-white grid place-items-center font-black text-xs">MK</div>
          <div class="font-extrabold">Mekholi <span class="text-emerald-600">App</span></div>
          <span class="ml-2 text-[10px] font-bold tracking-widest bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full">LITE • PWA</span>
        </a>
        <div class="flex items-center gap-2">
          <span id="outbox-badge-home" class="hidden text-xs font-bold bg-amber-500 text-white px-2.5 py-1 rounded-full"></span>
          <a href="/" data-link class="text-sm font-semibold px-3 py-1.5 rounded-full hover:bg-slate-50">Website →</a>
        </div>
      </div>
    </header>
    <div class="max-w-[1280px] mx-auto px-4 py-6">
      <div id="supabase-status"></div>
      <div class="mt-4 bg-white border border-slate-200 rounded-[24px] p-6 sm:p-8">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-2xl sm:text-3xl font-black tracking-tight">Mekholi Lite App</h1>
            <p class="mt-2 text-slate-600 max-w-2xl">Offline-first POS + Khata. Same Supabase auth as Website. History API (no #).</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <span class="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-full">History API ✓</span>
              <span class="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full">Vanilla TS ✓</span>
              <span class="text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-full">Supabase connected? check above</span>
            </div>
          </div>
          <div class="hidden sm:grid w-14 h-14 rounded-2xl bg-slate-900 text-white place-items-center text-xl"><span class="material-symbols-rounded">point_of_sale</span></div>
        </div>
        <div class="mt-8 grid sm:grid-cols-3 gap-4">
          <a href="/app/pos" data-link class="group bg-slate-900 text-white rounded-2xl p-5 hover:bg-black transition">
            <div class="w-9 h-9 rounded-xl bg-white/10 grid place-items-center"><span class="material-symbols-rounded">barcode_scanner</span></div>
            <div class="mt-3 font-bold">POS Billing</div>
            <div class="text-sm text-slate-400">Scan • Cart • ৳ + VAT + Due</div>
            <div class="mt-3 text-xs font-bold flex items-center gap-1">Open <span class="material-symbols-rounded text-[16px] group-hover:translate-x-0.5 transition">arrow_forward</span></div>
          </a>
          <a href="/app/khata" data-link class="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-slate-300 transition">
            <div class="w-9 h-9 rounded-xl bg-red-50 border border-red-200 text-red-600 grid place-items-center"><span class="material-symbols-rounded">book</span></div>
            <div class="mt-3 font-bold">Khata / Baki</div>
            <div class="text-sm text-slate-500">Dilam / Pelam + Tagada</div>
            <div class="mt-3 text-xs font-bold flex items-center gap-1">Open <span class="material-symbols-rounded text-[16px] group-hover:translate-x-0.5 transition">arrow_forward</span></div>
          </a>
          <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
            <div class="w-9 h-9 rounded-xl bg-emerald-600 text-white grid place-items-center"><span class="material-symbols-rounded">inventory_2</span></div>
            <div class="mt-3 font-bold">Stock</div>
            <div class="text-sm text-slate-600">Purchase → +10, Sale → -1</div>
            <div class="mt-3 text-xs font-bold text-emerald-700">Supabase products ✓</div>
          </div>
        </div>
      </div>
      <div class="mt-6 lg:hidden bg-white border border-slate-200 rounded-[20px] p-3 flex justify-around">
        ${['home','point_of_sale','book','inventory_2','bar_chart'].map((icon,i)=>`
          <div class="flex flex-col items-center gap-1 ${i===0?'text-slate-900':'text-slate-400'}">
            <span class="material-symbols-rounded ${i===0?'bg-slate-900 text-white p-1.5 rounded-full':''}">${icon}</span>
            <span class="text-[10px] font-bold">${['Home','POS','Khata','Stock','Hisab'][i]}</span>
          </div>
        `).join('')}
      </div>
    </div>
  </div>
  `
}
export function initHome(){
  import('../../core/db/idb').then(async m=>{
    const n = await m.getOutboxCount().catch(()=>0)
    const el = document.getElementById('outbox-badge-home')
    if(el && n>0){ el.textContent = `Offline: ${n} pending`; el.classList.remove('hidden')}
  })
}
