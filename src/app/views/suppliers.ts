import { supabase, isSupabaseConfigured } from '../../core/db/supabase'

export function suppliersView(): string {
  return `
  <div class="max-w-[1280px] mx-auto w-full px-4 lg:px-6 py-5">
    <div class="flex flex-wrap items-center gap-3 justify-between">
      <div>
        <h1 class="text-[18px] font-black dark:text-white">Suppliers</h1>
        <p class="text-xs text-slate-500 dark:text-slate-400">Due ledger • Purchase GRN source</p>
      </div>
      <div class="flex gap-2">
        <input id="sup-search" placeholder="Search name/phone" class="px-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white w-[220px]" />
        <button id="sup-add" class="px-4 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold">+ Add</button>
      </div>
    </div>
    <div class="mt-4 grid sm:grid-cols-3 gap-3">
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 text-center"><div class="text-xs font-bold tracking-widest text-slate-500">TOTAL DUE</div><div id="sup-total" class="font-black dark:text-white">৳0</div></div>
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 text-center"><div class="text-xs font-bold tracking-widest text-slate-500">SUPPLIERS</div><div id="sup-count" class="font-black dark:text-white">0</div></div>
      <div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-3 text-center"><div class="text-xs font-bold tracking-widest text-emerald-700">PURCHASES</div><div class="text-sm font-bold text-emerald-700 dark:text-emerald-300">GRN → stock +</div></div>
    </div>
    <div id="sup-list" class="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3"></div>
    <div id="sup-empty" class="hidden text-center py-10 text-sm text-slate-500">No suppliers — add first</div>
  </div>
  <div id="sup-modal" class="hidden fixed inset-0 z-50">
    <div id="sup-backdrop" class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"></div>
    <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[420px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5">
      <h3 class="font-black dark:text-white">Add Supplier</h3>
      <div class="mt-4 space-y-3">
        <input id="sup-name" placeholder="M/S Rahman Traders" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white" />
        <input id="sup-phone" placeholder="01XXXXXXXXX" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white" />
        <input id="sup-addr" placeholder="Address" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white" />
      </div>
      <div class="mt-5 flex gap-2">
        <button id="sup-cancel" class="flex-1 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white font-bold">Cancel</button>
        <button id="sup-save" class="flex-1 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold">Save</button>
      </div>
    </div>
  </div>
  `
}

export async function initSuppliers(){
  const list = document.getElementById('sup-list')!
  const empty = document.getElementById('sup-empty')!
  const search = document.getElementById('sup-search') as HTMLInputElement

  async function load(q=''){
    let rows:any[]=[]
    if(isSupabaseConfigured){
      try{
        const { data:{ user } } = await supabase.auth.getUser()
        if(user){
          const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
          const sid=prof?.store_id
          if(sid){
            let query:any = supabase.from('suppliers').select('id,name,phone,address,due_balance,created_at').eq('store_id', sid).order('created_at',{ascending:false}).limit(50)
            if(q) query = supabase.from('suppliers').select('id,name,phone,address,due_balance,created_at').eq('store_id', sid).ilike('name', `%${q}%`).limit(30)
            const { data } = await query
            if(data) rows=data
          }
        }
      }catch{}
    }
    if(!rows.length){
      const demo = JSON.parse(localStorage.getItem('demo-suppliers')||'[]') as any[]
      const base = demo.length? demo : [{id:'d1',name:'Rahman Traders',phone:'01720000001',address:'Zindabazar',due_balance:12500,created_at:new Date().toISOString()}, {id:'d2',name:'Haque & Sons',phone:'01720000002',address:'Kumarpara',due_balance:0,created_at:new Date().toISOString()}]
      if(!demo.length) localStorage.setItem('demo-suppliers', JSON.stringify(base))
      rows = base.filter((r:any)=> !q || r.name.toLowerCase().includes(q.toLowerCase()) || r.phone.includes(q))
      if(demo.length && !q) rows = demo
    }
    document.getElementById('sup-count')!.textContent = String(rows.length)
    document.getElementById('sup-total')!.textContent = `৳${rows.reduce((s:number,r:any)=>s+Number(r.due_balance||0),0).toLocaleString('en-BD')}`
    if(!rows.length){ list.innerHTML=''; empty.classList.remove('hidden'); return }
    empty.classList.add('hidden')
    list.innerHTML = rows.map((r:any)=>`
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
        <div class="flex items-start justify-between">
          <div class="font-bold dark:text-white">${r.name}</div>
          <span class="text-xs px-2 py-1 rounded-full border ${r.due_balance>0?'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300':'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'} font-bold">Due ৳${r.due_balance}</span>
        </div>
        <div class="text-xs text-slate-500 dark:text-slate-400">${r.phone} • ${r.address||'—'}</div>
        <div class="mt-3 flex gap-2">
          <button data-sup-pay="${r.id}" class="flex-1 py-2 rounded-full bg-emerald-600 text-white text-xs font-bold">Pay Due</button>
          <button data-sup-purchase="${r.id}" class="flex-1 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold dark:text-white">New GRN</button>
        </div>
      </div>
    `).join('')
    list.querySelectorAll('[data-sup-pay]').forEach(b=> b.addEventListener('click', async ()=>{
      const amt=parseFloat(prompt('Pay amount:','1000')||'0'); if(!amt) return
      const id=(b as HTMLElement).dataset.supPay!
      if(isSupabaseConfigured && !id.startsWith('d')){
        const { data:{ user } } = await supabase.auth.getUser()
        let sid=null; if(user){ const { data:p }=await supabase.from('profiles').select('store_id').eq('id',user.id).maybeSingle() as any; sid=p?.store_id }
        await supabase.from('khata_entries').insert({ store_id:sid, supplier_id:id, type:'pelam', amount:amt, note:'Supplier pay', client_uuid:Math.random().toString(36).slice(2)} as any)
      }
      ;(window as any).toast?.('Paid ৳'+amt); load(search.value)
    }))
    list.querySelectorAll('[data-sup-purchase]').forEach(b=> b.addEventListener('click', ()=> location.href=`/app/purchases/new?supplier=${(b as HTMLElement).dataset.supPurchase}`))
  }

  function showModal(show:boolean){ document.getElementById('sup-modal')!.classList.toggle('hidden', !show) }
  document.getElementById('sup-add')!.addEventListener('click', ()=> showModal(true))
  document.getElementById('sup-cancel')!.addEventListener('click', ()=> showModal(false))
  document.getElementById('sup-backdrop')!.addEventListener('click', ()=> showModal(false))
  document.getElementById('sup-save')!.addEventListener('click', async ()=>{
    const name=(document.getElementById('sup-name') as HTMLInputElement).value.trim()
    const phone=(document.getElementById('sup-phone') as HTMLInputElement).value.trim()
    const addr=(document.getElementById('sup-addr') as HTMLInputElement).value.trim()
    if(!name) return (window as any).toast?.('Name required')
    if(isSupabaseConfigured){
      const { data:{ user } } = await supabase.auth.getUser()
      let sid=null; if(user){ const { data:p }=await supabase.from('profiles').select('store_id').eq('id',user.id).maybeSingle() as any; sid=p?.store_id }
      const { error } = await supabase.from('suppliers').insert({ store_id:sid, name, phone, address:addr } as any)
      if(error) return (window as any).toast?.(error.message)
    } else {
      const arr=JSON.parse(localStorage.getItem('demo-suppliers')||'[]'); arr.push({id:'d'+Date.now(), name, phone, address:addr, due_balance:0, created_at:new Date().toISOString()}); localStorage.setItem('demo-suppliers', JSON.stringify(arr))
    }
    showModal(false); (document.getElementById('sup-name') as HTMLInputElement).value=''; (window as any).toast?.('Supplier added'); load(search.value)
  })

  let t:any
  search.addEventListener('input', ()=>{ clearTimeout(t); t=setTimeout(()=> load(search.value.trim()), 250)})
  load('')
}
