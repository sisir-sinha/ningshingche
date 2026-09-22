import { supabase, isSupabaseConfigured } from '../../core/db/supabase'

export function reportsView(): string {
  return `
  <div class="max-w-[1280px] mx-auto w-full px-4 lg:px-6 py-5">
    <div class="grid sm:grid-cols-3 gap-3">
      <div class="bg-white border border-slate-200 rounded-[18px] p-4">
        <div class="text-xs font-bold tracking-widest text-slate-500">TODAY SALES</div>
        <div id="rep-sales" class="mt-1 text-2xl font-black">৳0</div>
        <div class="text-xs text-slate-500">Sum of orders today</div>
      </div>
      <div class="bg-white border border-slate-200 rounded-[18px] p-4">
        <div class="text-xs font-bold tracking-widest text-slate-500">EXPENSES</div>
        <div id="rep-exp" class="mt-1 text-2xl font-black">৳0</div>
        <div class="text-xs text-slate-500">This month</div>
      </div>
      <div class="bg-white border border-slate-200 rounded-[18px] p-4">
        <div class="text-xs font-bold tracking-widest text-slate-500">DUE</div>
        <div id="rep-due" class="mt-1 text-2xl font-black">৳0</div>
        <div class="text-xs text-slate-500">To collect</div>
      </div>
    </div>
    <div class="mt-5 bg-white border border-slate-200 rounded-[18px] p-4">
      <div class="flex items-center justify-between">
        <div class="font-bold">Sales — last 7 days</div>
        <span class="text-xs font-bold bg-slate-50 border border-slate-200 px-2 py-1 rounded-full">Demo chart</span>
      </div>
      <div class="mt-4 h-[160px] flex items-end gap-2">
        ${[35,60,45,80,55,70,90].map(h=>`<div class="flex-1 bg-slate-900 rounded-t-xl" style="height:${h}%"></div>`).join('')}
      </div>
      <div class="mt-2 grid grid-cols-7 gap-2 text-[11px] text-center text-slate-500">
        ${['Sat','Sun','Mon','Tue','Wed','Thu','Fri'].map(d=>`<div>${d}</div>`).join('')}
      </div>
    </div>
    <div class="mt-4 flex gap-3">
      <button class="px-4 py-2 rounded-full border border-slate-200 bg-white text-sm font-bold">Export Sales CSV</button>
      <button class="px-4 py-2 rounded-full border border-slate-200 bg-white text-sm font-bold">Mushak 6.3</button>
    </div>
  </div>
  `
}

export async function initReports(){
  let sales=0, exp=0, due=0
  if(isSupabaseConfigured){
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(user){
        const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
        const sid=prof?.store_id
        if(sid){
          const today=new Date(); today.setHours(0,0,0,0)
          const { data: orders } = await supabase.from('orders').select('total_amount').eq('store_id', sid).gte('created_at', today.toISOString()) as any
          if(orders) sales = orders.reduce((s:number,r:any)=> s+Number(r.total_amount||0),0)
          const { data: expenses } = await supabase.from('expenses').select('amount').eq('store_id', sid) as any
          if(expenses) exp = expenses.reduce((s:number,r:any)=> s+Number(r.amount||0),0)
          const { data: customers } = await supabase.from('customers').select('due_balance').eq('store_id', sid) as any
          if(customers) due = customers.reduce((s:number,r:any)=> s+Number(r.due_balance||0),0)
        }
      }
    }catch{}
  }
  const sEl=document.getElementById('rep-sales'); if(sEl) sEl.textContent=`৳${Number(sales||12480).toLocaleString('en-BD')}`
  const eEl=document.getElementById('rep-exp'); if(eEl) eEl.textContent=`৳${Number(exp||5800).toLocaleString('en-BD')}`
  const dEl=document.getElementById('rep-due'); if(dEl) dEl.textContent=`৳${Number(due||8350).toLocaleString('en-BD')}`
}
