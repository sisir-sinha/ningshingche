export default function dashboard(): string {
  return `
  <section class="max-w-[1120px] mx-auto px-4 sm:px-6 py-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-black tracking-tight">Dashboard • ড্যাশবোর্ড</h1>
      <a href="/app" data-link class="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-bold">Open POS <span class="material-symbols-rounded text-[18px]">open_in_new</span></a>
    </div>
    <div class="mt-6 grid md:grid-cols-4 gap-4">
      <div class="bg-white border border-slate-200 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500">TODAY SALES</div><div class="text-2xl font-black">৳12,480</div><div class="text-xs text-emerald-600 font-bold">+18% vs yesterday</div></div>
      <div class="bg-white border border-slate-200 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500">DUE TO GET</div><div class="text-2xl font-black">৳8,350</div><div class="text-xs text-sky-600 font-bold">12 customers</div></div>
      <div class="bg-white border border-slate-200 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500">EXPENSE</div><div class="text-2xl font-black">৳1,200</div><div class="text-xs text-amber-600 font-bold">Today</div></div>
      <div class="bg-white border border-slate-200 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500">PROFIT</div><div class="text-2xl font-black">৳2,940</div><div class="text-xs text-violet-600 font-bold">Today</div></div>
    </div>
    <div class="mt-6 bg-amber-50 border border-amber-200 rounded-2xl p-5">
      <div class="font-bold">Lite Website Dashboard is connected to same Supabase as App.</div>
      <p class="text-sm text-slate-700 mt-1">When you build the full app, this page will show real Supabase data + charts. For now it’s a placeholder proving History API routing works (no #).</p>
      <div class="mt-3 flex gap-2">
        <a href="/app" data-link class="px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-bold">Go to App (PWA)</a>
        <span class="px-4 py-2 rounded-full bg-white border border-amber-200 text-sm font-semibold">Data: Supabase RLS ✓</span>
      </div>
    </div>
  </section>`
}
