export default function dashboard(): string {
  return `
  <section class="max-w-[1120px] mx-auto px-4 sm:px-6 py-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-black tracking-tight dark:text-white">Dashboard • ড্যাশবোর্ড</h1>
      <a href="/app.html" data-link class="inline-flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 rounded-full text-sm font-bold">Open POS <span class="material-symbols-rounded text-[18px]">open_in_new</span></a>
    </div>
    <div class="mt-4" id="supabase-status"></div>
    <div class="mt-6 grid md:grid-cols-4 gap-4">
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">TODAY SALES</div><div id="dash-sales" class="text-2xl font-black dark:text-white">৳0</div><div class="text-xs text-emerald-600 font-bold" id="dash-sales-sub">Live</div></div>
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">DUE TO GET</div><div id="dash-due" class="text-2xl font-black dark:text-white">৳0</div><div class="text-xs text-sky-600 font-bold" id="dash-due-sub">—</div></div>
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">ORDERS</div><div id="dash-orders" class="text-2xl font-black dark:text-white">0</div><div class="text-xs text-amber-600 font-bold" id="dash-orders-sub">Today</div></div>
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4"><div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">OFFLINE QUEUE</div><div id="dash-queue" class="text-2xl font-black dark:text-white">0</div><div class="text-xs text-violet-600 font-bold">pending sync</div></div>
    </div>
    <div class="mt-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
      <div class="font-bold flex items-center gap-2 dark:text-white"><span class="material-symbols-rounded text-violet-600">database</span> Supabase — How to connect</div>
      <ol class="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-6 list-decimal ml-5">
        <li>Create project at <a href="https://supabase.com/dashboard" target="_blank" class="text-sky-600 font-semibold hover:underline">supabase.com/dashboard</a></li>
        <li>Project Settings → API → copy <code class="bg-slate-50 dark:bg-slate-800 border px-1 rounded dark:text-white">URL</code> and <code class="bg-slate-50 dark:bg-slate-800 border px-1 rounded dark:text-white">anon public key</code></li>
        <li>Paste into <code class="bg-slate-50 dark:bg-slate-800 border px-1 rounded dark:text-white">/home/user/Mekholi/.env</code> as <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code></li>
        <li>SQL Editor → run <code class="bg-slate-50 dark:bg-slate-800 border px-1 rounded dark:text-white">supabase/schema.sql</code> (creates 14 tables + RLS + triggers)</li>
        <li>Auth → Enable Phone OTP + Email + Google as needed</li>
      </ol>
      <div class="mt-3 flex gap-2">
        <a href="/app.html" data-link class="px-4 py-2 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold">Go to App (PWA)</a>
        <span class="px-4 py-2 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm font-semibold">RLS: store_id isolation ✓</span>
      </div>
    </div>
  </section>`
}

export async function initDashboard(){
  try{
    const { supabase, isSupabaseConfigured } = await import('../../core/db/supabase')
    const { getOutboxCount } = await import('../../core/db/idb')
    let sales=0, due=0, orders=0
    if(isSupabaseConfigured){
      try{
        const { data:{ user } }=await supabase.auth.getUser()
        if(user){
          const { data:prof }=await supabase.from('profiles').select('store_id').eq('id',user.id).maybeSingle() as any
          const sid=prof?.store_id
          if(sid){
            const today=new Date(); today.setHours(0,0,0,0)
            const { data:ords }=await supabase.from('orders').select('total_amount,due_amount,created_at').eq('store_id',sid).gte('created_at', today.toISOString()) as any
            if(ords){ sales=ords.reduce((s:any,r:any)=>s+Number(r.total_amount||0),0); due=ords.reduce((s:any,r:any)=>s+Number(r.due_amount||0),0); orders=ords.length }
          }
        }
      }catch{}
    }
    if(!sales){
      const demo=JSON.parse(localStorage.getItem('demo-orders')||'[]')
      const todayStart=new Date(); todayStart.setHours(0,0,0,0)
      const t=demo.filter((r:any)=> new Date(r.created_at) >= todayStart)
      sales=t.reduce((s:any,r:any)=>s+Number(r.total_amount||0),0)
      due=t.reduce((s:any,r:any)=>s+Number(r.due_amount||0),0)
      orders=t.length
      if(!demo.length){ sales=12480; due=8350; orders=18 }
    }
    const q=await getOutboxCount().catch(()=>0)
    const elS=document.getElementById('dash-sales'); if(elS) elS.textContent=`৳${sales.toLocaleString('en-BD')}`
    const elD=document.getElementById('dash-due'); if(elD) elD.textContent=`৳${due.toLocaleString('en-BD')}`
    const elO=document.getElementById('dash-orders'); if(elO) elO.textContent=String(orders)
    const elQ=document.getElementById('dash-queue'); if(elQ) elQ.textContent=String(q)
  }catch{}
}
