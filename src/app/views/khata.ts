import { supabase, isSupabaseConfigured } from '../../core/db/supabase'
import { showPrompt, showConfirm } from '../../core/components/modal'

export function khataView(): string {
  return `
  <div class="max-w-[1280px] mx-auto w-full px-4 lg:px-6 py-4">
      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 text-center">
          <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">TOTAL DUE</div>
          <div id="khata-total-due" class="font-black text-lg text-red-600">৳0</div>
        </div>
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 text-center">
          <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">OVERDUE 60d+</div>
          <div id="khata-overdue" class="font-black text-lg text-amber-600">৳0</div>
        </div>
        <div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-3 text-center">
          <div class="text-xs font-bold tracking-widest text-emerald-700 dark:text-emerald-300">TO COLLECT TODAY</div>
          <div class="text-xs font-bold text-emerald-700 dark:text-emerald-300">Bulk Tagada ↓</div>
        </div>
      </div>
      <div class="grid lg:grid-cols-[0.95fr_1.05fr] gap-4">
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-4">
          <div class="flex gap-2">
            <div class="flex-1 relative">
              <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
              <input id="khata-phone" placeholder="Search phone / name" class="w-full pl-9 pr-3 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 outline-none text-sm dark:text-white" />
            </div>
            <button id="khata-search" class="px-4 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold hover:bg-black dark:hover:bg-slate-100">Search</button>
            <button id="khata-bulk" class="hidden sm:inline-flex px-4 py-2.5 rounded-full bg-amber-500 text-white text-sm font-bold hover:bg-amber-600">Bulk SMS</button>
          </div>
          <div class="mt-3 flex gap-2 text-xs">
            <button data-filter="all" class="filter-btn px-3 py-1.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold">All</button>
            <button data-filter="due" class="filter-btn px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white">Due >0</button>
            <button data-filter="overdue" class="filter-btn px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white">60d+</button>
          </div>
          <div id="khata-list" class="mt-3 space-y-2 max-h-[60vh] overflow-auto pr-1"></div>
        </div>
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-4 min-h-[420px] flex flex-col">
          <div id="khata-detail" class="flex-1 text-sm text-slate-500 dark:text-slate-400 py-16 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">Select a customer → ledger, aging, collect</div>
        </div>
      </div>
  </div>
  `
}

export async function initKhata(){
  const list = document.getElementById('khata-list')!
  const detail = document.getElementById('khata-detail')!
  const phone = document.getElementById('khata-phone') as HTMLInputElement
  const btn = document.getElementById('khata-search') as HTMLButtonElement
  let allRows:any[]=[]
  let filter='all'

  async function load(q=''){
    list.innerHTML = `<div class="text-sm text-slate-500 py-6 text-center">Loading…</div>`
    let rows: any[] = []
    if(isSupabaseConfigured){
      try{
        const { data } = q
          ? await (supabase.from('customers').select('id,name,phone,due_balance,created_at').or(`phone.ilike.%${q}%,name.ilike.%${q}%`).limit(40) as any)
          : await (supabase.from('customers').select('id,name,phone,due_balance,created_at').order('due_balance', { ascending:false }).limit(40) as any)
        if(data) rows = data
      }catch{}
    }
    if(!rows.length){
      rows = [
        { id:'d1', name:'Rahim Traders', phone:'01712345678', due_balance:1170, created_at: new Date(Date.now()-86400000*65).toISOString() },
        { id:'d2', name:'Karim Store', phone:'01787654321', due_balance:350, created_at: new Date(Date.now()-86400000*10).toISOString() },
        { id:'d3', name:'Ayesha', phone:'01812345678', due_balance:0, created_at: new Date().toISOString() },
        { id:'d4', name:'Jamal', phone:'01911223344', due_balance:2450, created_at: new Date(Date.now()-86400000*70).toISOString() },
      ].filter(r=> !q || r.phone.includes(q) || r.name.toLowerCase().includes(q.toLowerCase()))
    }
    allRows = rows
    renderList()
    updateStats()
  }

  function updateStats(){
    const total = allRows.reduce((s,r)=> s+Number(r.due_balance||0),0)
    const overdue = allRows.filter(r=> (Date.now()- new Date(r.created_at).getTime()) > 60*86400000 && r.due_balance>0).reduce((s,r)=>s+r.due_balance,0)
    document.getElementById('khata-total-due')!.textContent = `৳${total.toLocaleString('en-BD')}`
    document.getElementById('khata-overdue')!.textContent = `৳${overdue.toLocaleString('en-BD')}`
  }

  function renderList(){
    let rows = [...allRows]
    if(filter==='due') rows = rows.filter(r=> r.due_balance>0)
    if(filter==='overdue') rows = rows.filter(r=> r.due_balance>0 && (Date.now()- new Date(r.created_at).getTime())>60*86400000)
    if(!rows.length){ list.innerHTML = `<div class="text-sm text-slate-500 py-6 text-center">No customers in this filter</div>`; return }
    rows.sort((a,b)=> b.due_balance - a.due_balance)
    list.innerHTML = rows.map((r:any)=>{
      const days = Math.floor((Date.now()-new Date(r.created_at).getTime())/86400000)
      const aging = days>60? '60d+': days>30? '30-60d': '0-30d'
      const color = r.due_balance>0 ? (days>60?'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300':'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300') : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
      return `
      <button data-khata="${r.id}" class="w-full text-left bg-slate-50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-2xl p-3 flex items-center justify-between transition">
        <div>
          <div class="font-bold text-sm dark:text-white">${r.name} <span class="text-xs font-normal text-slate-500">${aging} • ${days}d</span></div>
          <div class="text-xs text-slate-500">${r.phone}</div>
        </div>
        <div class="text-right">
          <div class="text-xs font-black px-2 py-1 rounded-full border ${color}">৳${Number(r.due_balance).toFixed(0)}</div>
          <div class="text-[11px] text-slate-500 mt-1">View →</div>
        </div>
      </button>
    `}).join('')
    list.querySelectorAll('[data-khata]').forEach(b=> b.addEventListener('click', ()=> openLedger((b as HTMLElement).dataset.khata!, allRows.find(r=>r.id===(b as HTMLElement).dataset.khata!))))
  }

  async function openLedger(id:string, cust:any){
    const agingDays = Math.floor((Date.now()-new Date(cust.created_at).getTime())/86400000)
    detail.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-black text-[15px] dark:text-white">${cust.name}</div>
          <div class="text-xs text-slate-500">${cust.phone} • ${agingDays}d • Due aging ${agingDays>60?'60d+': agingDays>30?'30-60d':'0-30d'}</div>
          <div class="mt-1 inline-flex items-center gap-1.5 text-xs font-black ${Number(cust.due_balance)>0?'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300':'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'} px-2.5 py-1 rounded-full">Due ৳${Number(cust.due_balance).toFixed(2)}</div>
        </div>
        <div class="flex gap-2 shrink-0">
          <button id="khata-pelam" class="px-3.5 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">Pelam +</button>
          <button id="khata-dilam" class="px-3.5 py-1.5 rounded-full bg-red-600 text-white text-xs font-bold hover:bg-red-700">Dilam +</button>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-3 gap-2 text-center">
        <div class="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2"><div class="text-xs text-slate-500">Due</div><div class="font-black dark:text-white">৳${cust.due_balance}</div></div>
        <div class="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2"><div class="text-xs text-slate-500">Aging</div><div class="font-bold dark:text-white">${agingDays}d</div></div>
        <div class="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2"><div class="text-xs text-slate-500">Limit</div><div class="text-xs dark:text-white">৳5000</div></div>
      </div>
      <div class="mt-3 flex gap-2">
        <button id="khata-sms" class="flex-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-full py-2.5 text-sm font-bold flex items-center justify-center gap-2 hover:bg-black dark:hover:bg-slate-100"><span class="material-symbols-rounded text-[16px]">sms</span> Tagada SMS</button>
        <a href="tel:${cust.phone}" class="px-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white">Call</a>
        <button id="khata-wa" class="px-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white">WA</button>
      </div>
      <div class="mt-4">
        <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">LEDGER TIMELINE</div>
        <div id="khata-entries" class="mt-2 space-y-2 max-h-[36vh] overflow-auto pr-1"></div>
      </div>
    `
    let entries: any[] = []
    if(isSupabaseConfigured && id && !id.startsWith('d')){
      try{
        const { data } = await supabase.from('khata_entries').select('type,amount,note,created_at').eq('customer_id', id).order('created_at', { ascending:false }).limit(30) as any
        if(data) entries = data
      }catch{}
    }
    if(!entries.length){
      entries = [
        { type:'dilam', amount:800, note:'Sale MEK-2026-123 • 2x Rice', created_at: new Date(Date.now()-86400000*12).toISOString() },
        { type:'pelam', amount:300, note:'Received • bKash', created_at: new Date(Date.now()-86400000*5).toISOString() },
        { type:'dilam', amount:670, note:'Sale MEK-2026-130', created_at: new Date(Date.now()-86400000*2).toISOString() },
      ]
    }
    const entriesEl = document.getElementById('khata-entries')!
    entriesEl.innerHTML = entries.map((e:any)=>`
      <div class="flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
        <div>
          <div class="text-xs font-bold ${e.type==='dilam'?'text-red-700 dark:text-red-300':'text-emerald-700 dark:text-emerald-300'}">${e.type==='dilam'?'Dilam':'Pelam'} — ৳${Number(e.amount).toFixed(2)}</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">${e.note||''} • ${new Date(e.created_at).toLocaleDateString('en-GB')} ${new Date(e.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <span class="material-symbols-rounded ${e.type==='dilam'?'text-red-500':'text-emerald-600'} text-[18px]">${e.type==='dilam'?'arrow_upward':'arrow_downward'}</span>
      </div>
    `).join('')

    document.getElementById('khata-sms')?.addEventListener('click', ()=>{
      const msg = `Assalamu Alaikum ${cust.name}, baki ৳${Number(cust.due_balance).toFixed(2)} — ${agingDays}d pending — Mekholi. bKash 017XX.`
      window.location.href = `sms:${cust.phone}?&body=${encodeURIComponent(msg)}`
    })
    document.getElementById('khata-wa')?.addEventListener('click', ()=>{
      const msg = `Hi ${cust.name}, your due ৳${cust.due_balance} at Mekholi. Please pay.`
      window.open(`https://wa.me/88${cust.phone}?text=${encodeURIComponent(msg)}`,'_blank')
    })
    document.getElementById('khata-pelam')?.addEventListener('click', async ()=>{
      const val = await showPrompt({ title:'Pelam — Received', message:`Amount received from ${cust.name}`, placeholder:'500', defaultValue:'500', inputType:'number', required:true, validator: v=> { const n=parseFloat(v); return (!n||n<=0)?'Enter valid amount':null } })
      if(!val) return
      const amt = parseFloat(val)
      if(isSupabaseConfigured && cust.id && !String(cust.id).startsWith('d')){
        const { data:{ user } } = await supabase.auth.getUser()
        let store_id = null
        if(user){ const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any; store_id = prof?.store_id }
        await supabase.from('khata_entries').insert({ store_id, customer_id: cust.id, type:'pelam', amount: amt, note:'Received', client_uuid: Math.random().toString(36).slice(2) } as any)
        ;(window as any).toast?.('Pelam saved'); load(phone.value.trim()); openLedger(id, { ...cust, due_balance: Number(cust.due_balance)-amt })
      } else (window as any).toast?.('Demo: ৳'+amt)
    })
    document.getElementById('khata-dilam')?.addEventListener('click', async ()=>{
      const val = await showPrompt({ title:'Dilam — Given', message:`Amount given to ${cust.name}`, placeholder:'500', defaultValue:'500', inputType:'number', required:true, validator: v=> { const n=parseFloat(v); return (!n||n<=0)?'Enter valid amount':null } })
      if(!val) return
      const amt = parseFloat(val)
      if(isSupabaseConfigured && cust.id && !String(cust.id).startsWith('d')){
        const { data:{ user } } = await supabase.auth.getUser()
        let store_id = null
        if(user){ const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any; store_id = prof?.store_id }
        await supabase.from('khata_entries').insert({ store_id, customer_id: cust.id, type:'dilam', amount: amt, note:'Given', client_uuid: Math.random().toString(36).slice(2) } as any)
        ;(window as any).toast?.('Dilam saved'); load(phone.value.trim()); openLedger(id, { ...cust, due_balance: Number(cust.due_balance)+amt })
      } else (window as any).toast?.('Demo: ৳'+amt)
    })
  }

  document.querySelectorAll('.filter-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.querySelectorAll('.filter-btn').forEach(x=> x.className='filter-btn px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white')
      ;(b as HTMLElement).className='filter-btn px-3 py-1.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold'
      filter=(b as HTMLElement).dataset.filter!
      renderList()
    })
  })
  document.getElementById('khata-bulk')?.addEventListener('click', async ()=>{
    const dueCustomers = allRows.filter(r=> r.due_balance>0)
    if(!dueCustomers.length) return (window as any).toast?.('No dues')
    const ok = await showConfirm({ title:`Send SMS to ${dueCustomers.length} customers?`, message:`Bulk Tagada SMS will be queued for ${dueCustomers.length} dues. Proceed?`, confirmText:'Send SMS', variant:'default', icon:'sms' })
    if(!ok) return
    dueCustomers.forEach(c=>{
      const msg=`Baki ৳${c.due_balance} — please pay — Mekholi`
      console.log(`SMS to ${c.phone}: ${msg}`)
    })
    ;(window as any).toast?.(`Bulk SMS queued for ${dueCustomers.length}`)
  })

  btn.addEventListener('click', ()=> load(phone.value.trim()))
  phone.addEventListener('keydown', (e)=> { if(e.key==='Enter') load(phone.value.trim()) })
  load('')
}
