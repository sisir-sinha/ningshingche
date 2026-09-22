import { supabase, isSupabaseConfigured } from '../../core/db/supabase'

export function expensesView(): string {
  return `
  <div class="max-w-[1280px] mx-auto w-full px-4 lg:px-6 py-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-[15px] font-black">Expenses • Kharcha</h2>
      <a href="/app/expenses/new" data-link class="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-full text-sm font-bold hover:bg-black"><span class="material-symbols-rounded text-[18px]">add</span> Add Expense</a>
    </div>
    <div class="mt-4 bg-white border border-slate-200 rounded-[18px] overflow-hidden">
      <div class="hidden sm:grid grid-cols-[0.7fr_0.6fr_1fr_0.6fr] gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold tracking-widest text-slate-500">
        <div>DATE</div><div>CATEGORY</div><div>NOTE</div><div class="text-right">AMOUNT</div>
      </div>
      <div id="exp-list" class="divide-y divide-slate-100"></div>
      <div id="exp-empty" class="hidden text-sm text-slate-500 py-10 text-center">No expenses</div>
      <div id="exp-total" class="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
        <span class="text-sm font-bold">Total</span><span id="exp-total-val" class="font-black">৳0.00</span>
      </div>
    </div>
  </div>
  `
}

export async function initExpenses(){
  const list = document.getElementById('exp-list')!
  const empty = document.getElementById('exp-empty')!
  const totalEl = document.getElementById('exp-total-val')!

  async function load(){
    let rows:any[]=[]
    if(isSupabaseConfigured){
      try{
        const { data: { user } } = await supabase.auth.getUser()
        if(user){
          const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
          const sid = prof?.store_id
          if(sid){
            const { data } = await supabase.from('expenses').select('id,category,amount,note,expense_date,created_at').eq('store_id', sid).order('expense_date', { ascending:false }).limit(50) as any
            if(data) rows=data
          }
        }
      }catch{}
    }
    if(!rows.length){
      rows = JSON.parse(localStorage.getItem('demo-expenses')||'[]')
      if(!rows.length) rows = [
        { category:'rent', amount:5000, note:'Shop rent', expense_date: new Date().toISOString().slice(0,10) },
        { category:'electricity', amount:800, note:'Current bill', expense_date: new Date(Date.now()-86400000).toISOString().slice(0,10) },
      ]
    }
    if(!rows.length){ list.innerHTML=''; empty.classList.remove('hidden'); totalEl.textContent='৳0.00'; return }
    empty.classList.add('hidden')
    const total = rows.reduce((s:number,r:any)=> s+Number(r.amount||0),0)
    totalEl.textContent = `৳${total.toFixed(2)}`
    list.innerHTML = rows.map((r:any)=> `
      <div class="grid sm:grid-cols-[0.7fr_0.6fr_1fr_0.6fr] gap-2 sm:gap-3 px-4 py-3 items-center hover:bg-slate-50">
        <div class="text-sm font-medium">${new Date(r.expense_date||r.created_at).toLocaleDateString('en-GB')}</div>
        <div><span class="inline-flex px-2 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-bold capitalize">${r.category}</span></div>
        <div class="text-sm text-slate-600 truncate">${r.note||'—'}</div>
        <div class="text-sm font-black text-right">৳${Number(r.amount).toFixed(2)}</div>
      </div>
    `).join('')
  }
  load()
}
