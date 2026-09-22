import '../styles/app.css'
import { createRouter } from '../core/router/router'

// Minimal Lite App shell — PWA POS
// For now, placeholder that proves History API (no hash) and shared auth.
// Full POS (barcode, khata, offline queue) will be added next step.

function appHome(): string {
  return `
  <div class="min-h-screen bg-slate-50">
    <header class="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div class="max-w-[1120px] mx-auto px-4 h-[56px] flex items-center justify-between">
        <a href="/" data-link class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-slate-900 text-white grid place-items-center font-black text-xs">MK</div>
          <div class="font-extrabold">Mekholi <span class="text-emerald-600">App</span></div>
          <span class="ml-2 text-[10px] font-bold tracking-widest bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full">LITE • PWA</span>
        </a>
        <div class="flex items-center gap-2">
          <span class="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-500 text-white px-2.5 py-1 rounded-full"><span class="w-2 h-2 bg-white rounded-full animate-pulse"></span> Offline Ready</span>
          <a href="/" data-link class="text-sm font-semibold px-3 py-1.5 rounded-full hover:bg-slate-50">Website →</a>
        </div>
      </div>
    </header>

    <div class="max-w-[1120px] mx-auto px-4 py-6">
      <div class="bg-white border border-slate-200 rounded-[24px] p-6 sm:p-8">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-2xl sm:text-3xl font-black tracking-tight">Mekholi Lite App — PWA POS</h1>
            <p class="mt-2 text-slate-600 max-w-2xl">This is the installable Lite App shell. It uses the <b>same Supabase session</b> as the website, same History API router (no #), and is ready for the full POS build next.</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <span class="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-full">History API ✓ No hash</span>
              <span class="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full">Vanilla TS ✓ No Vue</span>
              <span class="text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-full">IndexedDB queue next</span>
            </div>
          </div>
          <div class="hidden sm:grid w-14 h-14 rounded-2xl bg-slate-900 text-white place-items-center text-xl"><span class="material-symbols-rounded">point_of_sale</span></div>
        </div>

        <div class="mt-8 grid sm:grid-cols-3 gap-4">
          <a href="/app/pos" data-link class="group bg-slate-900 text-white rounded-2xl p-5 hover:bg-black transition">
            <div class="w-9 h-9 rounded-xl bg-white/10 grid place-items-center"><span class="material-symbols-rounded">barcode_scanner</span></div>
            <div class="mt-3 font-bold">POS Billing</div>
            <div class="text-sm text-slate-400">Barcode + loose + VAT</div>
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
            <div class="mt-3 text-xs font-bold text-emerald-700">Next step → wire Supabase</div>
          </div>
        </div>

        <div class="mt-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div class="text-sm"><span class="font-bold">Next up:</span> I’ll build the full POS (scan, cart, bKash, due, receipt, offline queue) into <code class="bg-white border px-1.5 py-0.5 rounded">/app/pos</code> — tell me to continue.</div>
          <a href="/app/pos" data-link class="shrink-0 bg-amber-500 text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-amber-600">Build POS →</a>
        </div>
      </div>

      <!-- Bottom tabs preview -->
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
function appPos(): string {
  return `
  <div class="min-h-screen bg-slate-50">
    <header class="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div class="max-w-[1120px] mx-auto px-4 h-[56px] flex items-center gap-3">
        <a href="/app.html" data-link class="w-8 h-8 rounded-full border border-slate-200 grid place-items-center"><span class="material-symbols-rounded text-[18px]">arrow_back</span></a>
        <div class="font-bold">POS Billing</div>
        <span class="text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full">Lite • Offline</span>
        <a href="/" data-link class="ml-auto text-sm font-semibold">Website →</a>
      </div>
    </header>
    <div class="max-w-[1120px] mx-auto px-4 py-8">
      <div class="bg-white border border-slate-200 rounded-[24px] p-8 text-center">
        <div class="w-12 h-12 rounded-2xl bg-slate-900 text-white grid place-items-center mx-auto"><span class="material-symbols-rounded">construction</span></div>
        <h2 class="mt-3 text-xl font-black">POS is next</h2>
        <p class="text-slate-600 mt-1">Full scan, cart, 58mm receipt, bKash TrxID, due & offline queue builds in the next step.</p>
        <a href="/app.html" data-link class="mt-4 inline-flex bg-slate-900 text-white px-5 py-2.5 rounded-full font-bold">Back to App Home</a>
      </div>
    </div>
  </div>
  `
}
function appKhata(): string {
  return `
  <div class="min-h-screen bg-slate-50">
    <header class="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div class="max-w-[1120px] mx-auto px-4 h-[56px] flex items-center gap-3">
        <a href="/app.html" data-link class="w-8 h-8 rounded-full border border-slate-200 grid place-items-center"><span class="material-symbols-rounded text-[18px]">arrow_back</span></a>
        <div class="font-bold">Khata / Baki</div>
        <span class="text-xs font-bold bg-red-50 border border-red-200 text-red-700 px-2 py-1 rounded-full">Dilam • Pelam</span>
      </div>
    </header>
    <div class="max-w-[1120px] mx-auto px-4 py-8">
      <div class="bg-white border border-slate-200 rounded-[24px] p-8 text-center">
        <div class="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 text-red-600 grid place-items-center mx-auto"><span class="material-symbols-rounded">book</span></div>
        <h2 class="mt-3 text-xl font-black">Khata ledger — coming next</h2>
        <p class="text-slate-600 mt-1">Customers by phone, due balance, Dilam/Pelam timeline + Tagada SMS.</p>
        <a href="/app.html" data-link class="mt-4 inline-flex bg-slate-900 text-white px-5 py-2.5 rounded-full font-bold">Back to App Home</a>
      </div>
    </div>
  </div>
  `
}

const mount = document.getElementById('app')!
createRouter([
  { path: '/app', view: appHome, title: 'Mekholi App — Home' },
  { path: '/app.html', view: appHome, title: 'Mekholi App — Home' },
  { path: '/app/pos', view: appPos, title: 'Mekholi App — POS' },
  { path: '/app/khata', view: appKhata, title: 'Mekholi App — Khata' },
  { path: '/', view: () => { location.href = '/'; return '' } },
], mount)
