import { supabase, isSupabaseConfigured } from '../../core/db/supabase'

export function stockAdjustView(): string {
  return `
  <div class="max-w-[760px] mx-auto w-full px-4 lg:px-6 py-6">
    <div class="flex items-center gap-3">
      <a href="/app/products" data-link class="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 grid place-items-center dark:text-white"><span class="material-symbols-rounded">arrow_back</span></a>
      <div><h1 class="text-[18px] font-black dark:text-white">Stock Adjust</h1><p class="text-xs text-slate-500">Damage / expired / lost / found • updates stock_quantity</p></div>
    </div>

    <form id="adj-form" class="mt-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5 space-y-4">
      <label class="text-sm font-bold dark:text-white">Product
        <div class="relative mt-1">
          <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
          <input id="adj-search" placeholder="Search name / SKU / barcode" class="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 outline-none text-sm dark:text-white" autocomplete="off" />
          <div id="adj-results" class="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl hidden max-h-48 overflow-auto z-20"></div>
        </div>
        <div id="adj-selected" class="hidden mt-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center"><span class="material-symbols-rounded text-[18px]">inventory_2</span></div>
          <div class="min-w-0 flex-1"><div id="adj-name" class="text-sm font-bold dark:text-white truncate"></div><div id="adj-stock" class="text-xs text-slate-500"></div></div>
          <button type="button" id="adj-clear" class="text-xs font-bold px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-700 dark:text-white">Clear</button>
        </div>
      </label>

      <div class="grid sm:grid-cols-3 gap-4">
        <label class="text-sm font-bold dark:text-white">Reason
          <select id="adj-reason" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white">
            <option value="damage">Damage</option><option value="expired">Expired</option><option value="lost">Lost</option><option value="found">Found (+)</option><option value="correction">Correction</option>
          </select>
        </label>
        <label class="text-sm font-bold dark:text-white">Quantity
          <input id="adj-qty" type="number" min="1" value="1" step="0.01" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white" />
        </label>
        <label class="text-sm font-bold dark:text-white">Effect
          <div id="adj-effect" class="mt-1 px-3 py-2.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-sm font-black text-amber-700 dark:text-amber-300">- 1</div>
        </label>
      </div>

      <label class="text-sm font-bold dark:text-white">Note
        <input id="adj-note" placeholder="e.g. Broken during transport" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" />
      </label>

      <button type="submit" class="w-full py-3 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black hover:bg-black dark:hover:bg-slate-100">Apply Adjust → Stock</button>
      <div id="adj-msg" class="hidden text-sm font-semibold"></div>

      <!-- recent logs -->
      <div class="pt-2 border-t border-slate-200 dark:border-slate-700">
        <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">RECENT ADJUSTMENTS (demo)</div>
        <div id="adj-log" class="mt-2 space-y-2 text-sm"></div>
      </div>
    </form>
  </div>
  `
}

export async function initStockAdjust(){
  const inp=document.getElementById('adj-search') as HTMLInputElement
  const results=document.getElementById('adj-results')!
  const selBox=document.getElementById('adj-selected')!
  const nameEl=document.getElementById('adj-name')!
  const stockEl=document.getElementById('adj-stock')!
  const reason=document.getElementById('adj-reason') as HTMLSelectElement
  const qty=document.getElementById('adj-qty') as HTMLInputElement
  const effect=document.getElementById('adj-effect')!
  const note=document.getElementById('adj-note') as HTMLInputElement
  const msg=document.getElementById('adj-msg')!
  const logEl=document.getElementById('adj-log')!
  let selected:any=null
  let products:any[]=[]

  async function fetchProducts(q=''){
    if(isSupabaseConfigured){
      try{
        const { data:{ user } }=await supabase.auth.getUser()
        if(user){
          const { data:prof }=await supabase.from('profiles').select('store_id').eq('id',user.id).maybeSingle() as any
          const sid=prof?.store_id
          if(sid){
            const { data }= q
              ? await supabase.from('products').select('id,name,barcode,sku,stock_quantity,unit').or(`name.ilike.%${q}%,barcode.ilike.%${q}%,sku.ilike.%${q}%`).eq('store_id',sid).limit(20) as any
              : await supabase.from('products').select('id,name,barcode,sku,stock_quantity,unit').eq('store_id',sid).limit(20) as any
            if(data && data.length){ products=data; return data }
          }
        }
      }catch{}
    }
    const demo=JSON.parse(localStorage.getItem('demo-products')||'[]')
    const base=demo.length? demo : [
      { id:'demo-1', name:'Miniket Rice 1kg', barcode:'890100001', sku:'RICE-1', stock_quantity:40, unit:'kg' },
      { id:'demo-2', name:'Parachute Oil 200ml', barcode:'890103002', sku:'OIL-200', stock_quantity:18, unit:'pcs' },
      { id:'demo-3', name:'Lux Soap', barcode:'890103004', sku:'LUX', stock_quantity:2, unit:'pcs' },
    ]
    const filtered=base.filter((p:any)=> !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.barcode||'').includes(q) || (p.sku||'').toLowerCase().includes(q.toLowerCase()))
    products=filtered
    return filtered
  }

  function updateEffect(){
    const v=parseFloat(qty.value)||0
    const isAdd=reason.value==='found'
    const sign=isAdd? '+' : '-'
    effect.textContent=`${sign} ${v}`
    effect.className=`mt-1 px-3 py-2.5 rounded-xl border text-sm font-black ${isAdd?'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300':'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'}`
  }
  reason.addEventListener('change', updateEffect)
  qty.addEventListener('input', updateEffect)

  async function showResults(q:string){
    const rows=await fetchProducts(q)
    if(!rows.length){ results.innerHTML=`<div class="p-3 text-sm text-slate-500">No match</div>`; results.classList.remove('hidden'); return }
    results.innerHTML=rows.map((p:any)=>`
      <button type="button" data-pick="${p.id}" class="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 flex justify-between gap-2">
        <div><div class="text-sm font-bold dark:text-white">${p.name}</div><div class="text-xs text-slate-500 font-mono">${p.barcode||p.sku||'no code'}</div></div>
        <span class="text-xs font-bold px-2 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white">${p.stock_quantity} ${p.unit}</span>
      </button>
    `).join('')
    results.classList.remove('hidden')
    results.querySelectorAll('[data-pick]').forEach(b=> b.addEventListener('click', ()=>{
      const id=(b as HTMLElement).dataset.pick!
      const p=rows.find((x:any)=>x.id===id)
      if(p) pick(p)
    }))
  }

  function pick(p:any){
    selected=p
    nameEl.textContent=p.name
    stockEl.textContent=`${p.stock_quantity} ${p.unit} • ${p.barcode||p.sku||''}`
    selBox.classList.remove('hidden')
    results.classList.add('hidden')
    inp.value=p.name
  }

  inp.addEventListener('input', ()=> {
    const v=inp.value.trim()
    if(!v){ results.classList.add('hidden'); return }
    showResults(v)
  })
  inp.addEventListener('focus', ()=> { if(inp.value.trim()) showResults(inp.value.trim()); else showResults('') })

  document.getElementById('adj-clear')!.addEventListener('click', ()=>{
    selected=null; selBox.classList.add('hidden'); inp.value=''; results.classList.add('hidden')
  })

  document.addEventListener('click', (e)=>{
    if(!(e.target as HTMLElement).closest('#adj-search') && !(e.target as HTMLElement).closest('#adj-results')) results.classList.add('hidden')
  })

  // initial list
  showResults('')

  // logs demo
  function renderLog(){
    const arr=JSON.parse(localStorage.getItem('demo-stock-log')||'[]')
    if(!arr.length){ logEl.innerHTML=`<div class="text-xs text-slate-500">No adjustments yet</div>`; return }
    logEl.innerHTML=arr.slice(-5).reverse().map((r:any)=>`
      <div class="flex justify-between bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
        <div><div class="font-bold dark:text-white text-xs">${r.product_name}</div><div class="text-[11px] text-slate-500">${r.reason} • ${r.note||''}</div></div>
        <div class="text-xs font-black ${r.qty>0?'text-emerald-600':'text-red-600'}">${r.qty>0?'+':''}${r.qty} ${r.unit}</div>
      </div>
    `).join('')
  }
  renderLog()

  document.getElementById('adj-form')!.addEventListener('submit', async (e)=>{
    e.preventDefault()
    if(!selected) { msg.textContent='Pick a product first'; msg.className='text-sm font-semibold text-red-600'; msg.classList.remove('hidden'); return }
    const qv=parseFloat(qty.value)||0; if(qv<=0) return
    const isAdd=reason.value==='found'
    const delta=isAdd? qv : -qv
    const btn=(document.querySelector('#adj-form button[type="submit"]') as HTMLButtonElement)
    btn.disabled=true; btn.textContent='Applying…'
    try{
      if(isSupabaseConfigured){
        const newStock=Number(selected.stock_quantity)+delta
        if(newStock<0) throw new Error('Stock cannot go negative')
        const { error }=await supabase.from('products').update({ stock_quantity:newStock } as any).eq('id',selected.id) as any
        if(error) throw error
        // optional: insert stock_logs if table exists — ignore if not
        try{ await supabase.from('stock_logs' as any).insert({ product_id:selected.id, reason:reason.value, quantity:qv, note:note.value } as any) }catch{}
        selected.stock_quantity=newStock
        stockEl.textContent=`${newStock} ${selected.unit}`
      } else {
        // demo: mutate demo-products
        const arr=JSON.parse(localStorage.getItem('demo-products')||'[]')
        // if demo key empty, create base then mutate
        let list=arr.length? arr : [
          { id:'demo-1', name:'Miniket Rice 1kg', barcode:'890100001', sku:'RICE-1', stock_quantity:40, unit:'kg' },
          { id:'demo-2', name:'Parachute Oil 200ml', barcode:'890103002', sku:'OIL-200', stock_quantity:18, unit:'pcs' },
          { id:'demo-3', name:'Lux Soap', barcode:'890103004', sku:'LUX', stock_quantity:2, unit:'pcs' },
        ]
        const idx=list.findIndex((x:any)=> x.id===selected.id)
        if(idx>=0){ list[idx].stock_quantity=Number(list[idx].stock_quantity)+delta; localStorage.setItem('demo-products', JSON.stringify(list)); selected.stock_quantity=list[idx].stock_quantity; stockEl.textContent=`${selected.stock_quantity} ${selected.unit}` }
        // log
        const logs=JSON.parse(localStorage.getItem('demo-stock-log')||'[]')
        logs.push({ product_name:selected.name, reason:reason.value, qty:delta, unit:selected.unit, note:note.value, at:new Date().toISOString() })
        localStorage.setItem('demo-stock-log', JSON.stringify(logs))
        renderLog()
      }
      msg.textContent=`Adjusted ${delta>0?'+':''}${delta} ${selected.unit} — new stock ${selected.stock_quantity} ✓`
      msg.className='text-sm font-semibold text-emerald-600'; msg.classList.remove('hidden')
      ;(window as any).toast?.('Stock adjusted')
      qty.value='1'; updateEffect()
    }catch(err:any){
      msg.textContent=err.message; msg.className='text-sm font-semibold text-red-600'; msg.classList.remove('hidden')
    } finally { btn.disabled=false; btn.textContent='Apply Adjust → Stock' }
  })

  updateEffect()
}
