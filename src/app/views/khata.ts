import { supabase, isSupabaseConfigured } from '../../core/db/supabase'

export function khataView(): string {
  return `
  <div class="min-h-screen bg-slate-50">
    <header class="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div class="max-w-[1120px] mx-auto px-4 h-[56px] flex items-center gap-3">
        <a href="/app.html" data-link class="w-8 h-8 rounded-full border border-slate-200 grid place-items-center"><span class="material-symbols-rounded text-[18px]">arrow_back</span></a>
        <div class="font-bold">Khata / Baki</div>
        <span class="text-xs font-bold bg-red-50 border border-red-200 text-red-700 px-2 py-1 rounded-full">Dilam • Pelam</span>
        <a href="/" data-link class="ml-auto text-sm font-semibold">Website →</a>
      </div>
    </header>
    <div class="max-w-[1120px] mx-auto px-4 py-6">
      <div id="supabase-status" class="mb-4"></div>
      <div class="grid lg:grid-cols-[0.9fr_1.1fr] gap-4">
        <div class="bg-white border border-slate-200 rounded-[24px] p-4">
          <div class="flex items-center gap-2">
            <input id="khata-phone" placeholder="Search phone or name" class="flex-1 px-4 py-2.5 rounded-full border border-slate-200 outline-none text-sm" />
            <button id="khata-search" class="px-4 py-2.5 rounded-full bg-slate-900 text-white text-sm font-bold">Search</button>
          </div>
          <div id="khata-list" class="mt-4 space-y-2 max-h-[60vh] overflow-auto"></div>
        </div>
        <div class="bg-white border border-slate-200 rounded-[24px] p-4">
          <div id="khata-detail" class="text-sm text-slate-500 py-12 text-center border-2 border-dashed border-slate-200 rounded-2xl">Select a customer to see ledger</div>
        </div>
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

  async function load(q=''){
    list.innerHTML = `<div class="text-sm text-slate-500 py-6 text-center">Loading...</div>`
    let rows: any[] = []
    if(isSupabaseConfigured){
      try{
        const { data } = q
          ? await (supabase.from('customers').select('id,name,phone,due_balance').or(`phone.ilike.%${q}%,name.ilike.%${q}%`).limit(30) as any)
          : await (supabase.from('customers').select('id,name,phone,due_balance,total_purchase').order('due_balance', { ascending:false }).limit(30) as any)
        if(data) rows = data
      }catch{}
    }
    if(!rows.length){
      // demo
      rows = [
        { id:'d1', name:'Rahim Traders', phone:'01712345678', due_balance:1170 },
        { id:'d2', name:'Karim Store', phone:'01787654321', due_balance:0 },
        { id:'d3', name:'Walk-in', phone:'01700000000', due_balance:250 },
      ].filter(r=> !q || r.phone.includes(q) || r.name.toLowerCase().includes(q.toLowerCase()))
    }
    if(!rows.length){ list.innerHTML = `<div class="text-sm text-slate-500 py-6 text-center">No customers</div>`; return }
    list.innerHTML = rows.map((r:any)=>`
      <button data-khata="${r.id}" class="w-full text-left bg-slate-50 hover:bg-white border border-slate-200 hover:border-slate-900 rounded-2xl p-3 flex items-center justify-between transition">
        <div>
          <div class="font-bold text-sm">${r.name}</div>
          <div class="text-xs text-slate-500">${r.phone}</div>
        </div>
        <div class="text-right">
          <div class="text-xs font-bold ${r.due_balance>0?'text-red-600':'text-emerald-600'}">Due ৳${Number(r.due_balance).toFixed(2)}</div>
          <div class="text-[11px] text-slate-500">Tap → ledger</div>
        </div>
      </button>
    `).join('')
    list.querySelectorAll('[data-khata]').forEach(b=> b.addEventListener('click', ()=> openLedger((b as HTMLElement).dataset.khata!, rows.find(r=>r.id===(b as HTMLElement).dataset.khata!))))
  }

  async function openLedger(id:string, cust:any){
    detail.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <div class="font-black">${cust.name}</div>
          <div class="text-xs text-slate-500">${cust.phone} • Due ৳${Number(cust.due_balance).toFixed(2)}</div>
        </div>
        <div class="flex gap-2">
          <button id="khata-pelam" class="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-bold">+ Pelam</button>
          <button id="khata-dilam" class="px-3 py-1.5 rounded-full bg-red-600 text-white text-xs font-bold">+ Dilam</button>
        </div>
      </div>
      <div class="mt-3 flex gap-2">
        <button id="khata-sms" class="flex-1 bg-slate-900 text-white rounded-full py-2 text-sm font-bold flex items-center justify-center gap-2"><span class="material-symbols-rounded text-[16px]">sms</span> Tagada SMS</button>
        <a href="tel:${cust.phone}" class="px-4 py-2 rounded-full border border-slate-200 text-sm font-bold">Call</a>
      </div>
      <div id="khata-entries" class="mt-4 space-y-2 max-h-[40vh] overflow-auto"></div>
    `
    // load entries
    let entries: any[] = []
    if(isSupabaseConfigured && id && !id.startsWith('d')){
      try{
        const { data } = await supabase.from('khata_entries').select('type,amount,note,created_at').eq('customer_id', id).order('created_at', { ascending:false }).limit(20) as any
        if(data) entries = data
      }catch{}
    }
    if(!entries.length){
      entries = [
        { type:'dilam', amount:500, note:'Sale MEK-2026-123', created_at: new Date(Date.now()-86400000*2).toISOString() },
        { type:'pelam', amount:200, note:'Partial', created_at: new Date(Date.now()-86400000).toISOString() },
      ]
    }
    const entriesEl = document.getElementById('khata-entries')!
    entriesEl.innerHTML = entries.map((e:any)=>`
      <div class="flex items-center justify-between bg-${e.type==='dilam'?'red':'emerald'}-50 border border-${e.type==='dilam'?'red':'emerald'}-200 rounded-xl px-3 py-2">
        <div>
          <div class="text-xs font-bold ${e.type==='dilam'?'text-red-700':'text-emerald-700'}">${e.type==='dilam'?'Dilam (gave)':'Pelam (received)'} — ৳${Number(e.amount).toFixed(2)}</div>
          <div class="text-[11px] text-slate-500">${e.note||''} • ${new Date(e.created_at).toLocaleDateString('en-GB')}</div>
        </div>
        <span class="material-symbols-rounded ${e.type==='dilam'?'text-red-500':'text-emerald-600'}">${e.type==='dilam'?'arrow_upward':'arrow_downward'}</span>
      </div>
    `).join('') || `<div class="text-xs text-slate-500 py-6 text-center">No entries yet</div>`

    document.getElementById('khata-sms')?.addEventListener('click', ()=>{
      const msg = `Assalamu Alaikum, apnar baki ৳${Number(cust.due_balance).toFixed(2)} — ${cust.name} — Mekholi Store. Dhonnobad!`
      window.location.href = `sms:${cust.phone}?&body=${encodeURIComponent(msg)}`
    })
    document.getElementById('khata-pelam')?.addEventListener('click', async ()=>{
      const amt = parseFloat(prompt('Pelam amount ৳:', '100')||'0')
      if(!amt) return
      if(isSupabaseConfigured && cust.id && !String(cust.id).startsWith('d')){
        const { data:{ user } } = await supabase.auth.getUser()
        let store_id = null
        if(user){ const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any; store_id = prof?.store_id }
        await supabase.from('khata_entries').insert({ store_id, customer_id: cust.id, type:'pelam', amount: amt, note:'Received', client_uuid: Math.random().toString(36).slice(2) } as any)
        ;(window as any).toast?.('Pelam ৳'+amt+' saved')
        load(cust.phone)
        openLedger(id, { ...cust, due_balance: Number(cust.due_balance)-amt })
      } else (window as any).toast?.('Demo: Pelam ৳'+amt)
    })
    document.getElementById('khata-dilam')?.addEventListener('click', async ()=>{
      const amt = parseFloat(prompt('Dilam amount ৳:', '100')||'0')
      if(!amt) return
      if(isSupabaseConfigured && cust.id && !String(cust.id).startsWith('d')){
        const { data:{ user } } = await supabase.auth.getUser()
        let store_id = null
        if(user){ const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any; store_id = prof?.store_id }
        await supabase.from('khata_entries').insert({ store_id, customer_id: cust.id, type:'dilam', amount: amt, note:'Given', client_uuid: Math.random().toString(36).slice(2) } as any)
        ;(window as any).toast?.('Dilam ৳'+amt+' saved')
        load(cust.phone)
        openLedger(id, { ...cust, due_balance: Number(cust.due_balance)+amt })
      } else (window as any).toast?.('Demo: Dilam ৳'+amt)
    })
  }

  btn.addEventListener('click', ()=> load(phone.value.trim()))
  phone.addEventListener('keydown', (e)=> { if(e.key==='Enter') load(phone.value.trim()) })
  load('')
}
