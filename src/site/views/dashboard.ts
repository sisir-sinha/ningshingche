export default function dashboard(): string {
  return `
  <section class="max-w-[1120px] mx-auto px-4 sm:px-6 py-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-black tracking-tight">Dashboard • ড্যাশবোর্ড</h1>
      <a href="/app.html" data-link class="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-bold">Open POS <span class="material-symbols-rounded text-[18px]">open_in_new</span></a>
    </div>
    <div class="mt-4" id="supabase-status"></div>
    <div class="mt-6 grid md:grid-cols-4 gap-4">
      <div class="bg-white border border-slate-200 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500">TODAY SALES</div><div class="text-2xl font-black">৳12,480</div><div class="text-xs text-emerald-600 font-bold">+18% vs yesterday</div></div>
      <div class="bg-white border border-slate-200 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500">DUE TO GET</div><div class="text-2xl font-black">৳8,350</div><div class="text-xs text-sky-600 font-bold">12 customers</div></div>
      <div class="bg-white border border-slate-200 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500">EXPENSE</div><div class="text-2xl font-black">৳1,200</div><div class="text-xs text-amber-600 font-bold">Today</div></div>
      <div class="bg-white border border-slate-200 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500">PROFIT</div><div class="text-2xl font-black">৳2,940</div><div class="text-xs text-violet-600 font-bold">Today</div></div>
    </div>
    <div class="mt-6 bg-white border border-slate-200 rounded-2xl p-5">
      <div class="font-bold flex items-center gap-2"><span class="material-symbols-rounded text-violet-600">database</span> Supabase — How to connect</div>
      <ol class="mt-2 text-sm text-slate-700 leading-6 list-decimal ml-5">
        <li>Create project at <a href="https://supabase.com/dashboard" target="_blank" class="text-sky-600 font-semibold hover:underline">supabase.com/dashboard</a></li>
        <li>Project Settings → API → copy <code class="bg-slate-50 border px-1 rounded">URL</code> and <code class="bg-slate-50 border px-1 rounded">anon public key</code></li>
        <li>Paste into <code class="bg-slate-50 border px-1 rounded">/home/user/Mekholi/.env</code> as <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code></li>
        <li>SQL Editor → run <code class="bg-slate-50 border px-1 rounded">supabase/schema.sql</code> (creates 14 tables + RLS + triggers)</li>
        <li>Auth → Enable Phone OTP + Email + Google as needed</li>
      </ol>
      <div class="mt-3 flex gap-2">
        <a href="/app.html" data-link class="px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-bold">Go to App (PWA)</a>
        <span class="px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold">RLS: store_id isolation ✓</span>
      </div>
    </div>
  </section>`
}
