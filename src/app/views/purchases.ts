import { supabase, isSupabaseConfigured } from '../../core/db/supabase'

export function purchasesView(): string {
  return `
  <div class="max-w-[1280px] mx-auto w-full px-4 lg:px-6 py-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-[18px] font-black dark:text-white">Purchases (GRN)</h1>
        <p class="text-xs text-slate-500 dark:text-slate-400">Stock + via purchase_items trigger • Supplier due auto</p>
      </div>
      <a href="/app/purchases/new" data-link class="inline-flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2.5 rounded-full text-sm font-bold"><span class="material-symbols-rounded text-[18px]">add</span> New GRN</a>
    </div>
    <div class="mt-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] overflow-hidden">
      <div class="hidden sm:grid grid-cols-[1fr_0.7fr_0.7fr_0.7fr] gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400"><div>RECEIPT</div><div>SUPPLIER</div><div>TOTAL</div><div>PAID</div></div>
      <div id="pur-list" class="divide-y divide-slate-100 dark:divide-slate-800"></div>
      <div id="pur-empty" class="hidden text-center py-10 text-sm text-slate-500">No purchases — GRN adds stock</div>
      <div class="px-4 py-3 bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex justify-between text-sm font-bold dark:text-white"><span>Total purchases</span><span id="pur-total">৳0.00</span></div>
    </div>
  </div>
  `
}

export async function initPurchases(){
  const list=document.getElementById('pur-list')!
  const empty=document.getElementById('pur-empty')!
  let rows:any[]=[]
  if(isSupabaseConfigured){
    try{
      const { data:{ user } }=await supabase.auth.getUser()
      if(user){
        const { data:prof }=await supabase.from('profiles').select('store_id').eq('id',user.id).maybeSingle() as any
        const sid=prof?.store_id
        if(sid){
          const { data }=await supabase.from('purchases').select('id,receipt_no,subtotal,total_amount,paid_amount,supplier_id,created_at,suppliers(name)').eq('store_id',sid).order('created_at',{ascending:false}).limit(50) as any
          if(data) rows=data
        }
      }
    }catch{}
  }
  if(!rows.length){
    rows=JSON.parse(localStorage.getItem('demo-purchases')||'[]')
    if(!rows.length) rows=[{id:'d1',receipt_no:'GRN-2026-001',subtotal:5000,total_amount:5000,paid_amount:3000,created_at:new Date().toISOString(), suppliers:{name:'Rahman Traders'}}]
  }
  if(!rows.length){ list.innerHTML=''; empty.classList.remove('hidden'); return }
  empty.classList.add('hidden')
  const total=rows.reduce((s:number,r:any)=>s+Number(r.total_amount||0),0)
  document.getElementById('pur-total')!.textContent=`৳${total.toFixed(2)}`
  list.innerHTML=rows.map((r:any)=>`
    <div class="grid sm:grid-cols-[1fr_0.7fr_0.7fr_0.7fr] gap-2 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800">
      <div><div class="font-bold text-sm dark:text-white">${r.receipt_no}</div><div class="text-xs text-slate-500">${new Date(r.created_at).toLocaleDateString('en-GB')}</div></div>
      <div class="text-sm dark:text-white">${r.suppliers?.name||r.supplier_id||'—'}</div>
      <div class="font-black dark:text-white">৳${Number(r.total_amount).toFixed(2)}</div>
      <div><span class="px-2 py-1 rounded-full text-xs font-bold border ${r.paid_amount>=r.total_amount?'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700':'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700'}">৳${Number(r.paid_amount||0).toFixed(2)}</span></div>
    </div>
  `).join('')
}
