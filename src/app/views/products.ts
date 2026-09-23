import { supabase, isSupabaseConfigured } from '../../core/db/supabase'

export function productsView(): string {
  return `
  <div class="max-w-[1280px] mx-auto w-full px-4 lg:px-6 py-5">
    <div class="flex flex-wrap items-center gap-3 justify-between">
      <div class="flex items-center gap-3">
        <div class="relative">
          <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
          <input id="prod-search" placeholder="Search name / barcode / SKU" class="pl-9 pr-3 py-2.5 w-[260px] sm:w-[340px] rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white focus:border-slate-900 dark:focus:border-slate-600" />
        </div>
        <select id="prod-filter" class="hidden sm:block px-3 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white">
          <option value="">All</option><option value="low">Low stock</option><option value="expiry">Expiry soon</option><option value="out">Out of stock</option>
        </select>
        <button id="prod-export" class="hidden sm:inline-flex px-3 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700">Export CSV</button>
      </div>
      <div class="flex items-center gap-2">
        <button id="prod-print-barcode" class="hidden sm:inline-flex px-3 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold dark:text-white">Barcode labels</button>
        <a href="/app/products/new" data-link class="inline-flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2.5 rounded-full text-sm font-bold hover:bg-black dark:hover:bg-slate-100"><span class="material-symbols-rounded text-[18px]">add</span> Add Product</a>
      </div>
    </div>

    <!-- stats -->
    <div class="mt-4 grid grid-cols-3 gap-3">
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 text-center">
        <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">TOTAL SKUs</div>
        <div id="stat-total" class="font-black text-lg dark:text-white">0</div>
      </div>
      <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-3 text-center">
        <div class="text-xs font-bold tracking-widest text-amber-700 dark:text-amber-300">LOW STOCK</div>
        <div id="stat-low" class="font-black text-lg text-amber-700 dark:text-amber-300">0</div>
      </div>
      <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-3 text-center">
        <div class="text-xs font-bold tracking-widest text-red-700 dark:text-red-300">OUT</div>
        <div id="stat-out" class="font-black text-lg text-red-700 dark:text-red-300">0</div>
      </div>
    </div>

    <div class="mt-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] overflow-hidden">
      <div class="hidden sm:grid grid-cols-[1.5fr_0.7fr_0.5fr_0.5fr_0.6fr_0.4fr] gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">
        <div>PRODUCT</div><div>PRICE</div><div>STOCK</div><div>BATCH/EXP</div><div>VAT</div><div></div>
      </div>
      <div id="prod-list" class="divide-y divide-slate-100 dark:divide-slate-800"></div>
      <div id="prod-empty" class="hidden text-sm text-slate-500 dark:text-slate-400 py-10 text-center">No products — add your first • variants/batch/expiry supported</div>
    </div>
  </div>
  `
}

export async function initProducts(){
  const list = document.getElementById('prod-list')!
  const empty = document.getElementById('prod-empty')!
  const search = document.getElementById('prod-search') as HTMLInputElement
  const filter = document.getElementById('prod-filter') as HTMLSelectElement

  async function fetchAll(q=''){
    let rows: any[] = []
    if(isSupabaseConfigured){
      try{
        let query:any = supabase.from('products').select('id,name,barcode,sku,price,cost_price,wholesale_price,stock_quantity,unit,vat_rate,low_stock_alert,variant,expiry,image_url').order('created_at' as any, { ascending:false }).limit(80)
        if(q) query = supabase.from('products').select('id,name,barcode,sku,price,cost_price,wholesale_price,stock_quantity,unit,vat_rate,low_stock_alert,variant,expiry,image_url').ilike('name', `%${q}%`).limit(80) as any
        const { data } = await query
        if(data) rows = data
        // also search barcode/sku if not found
        if(q && !rows.length){
          const { data: d2 } = await supabase.from('products').select('id,name,barcode,sku,price,cost_price,wholesale_price,stock_quantity,unit,vat_rate,low_stock_alert,variant,expiry,image_url').or(`barcode.ilike.%${q}%,sku.ilike.%${q}%`).limit(20) as any
          if(d2) rows = d2
        }
      }catch(e){ console.warn(e) }
    }
    if(!rows.length && !isSupabaseConfigured){
      const demoKey = JSON.parse(localStorage.getItem('demo-products')||'[]')
      const base = demoKey.length ? demoKey : [
        { id:'d1', name:'Miniket Rice 1kg', barcode:'890100001', sku:'RICE-1', price:78, cost_price:65, wholesale_price:70, stock_quantity:3, unit:'kg', vat_rate:0, low_stock_alert:5, variant:'1kg', expiry:'2026-12-01' },
        { id:'d2', name:'Parachute Oil 200ml', barcode:'890103002', sku:'OIL-200', price:180, cost_price:150, wholesale_price:165, stock_quantity:18, unit:'pcs', vat_rate:5, low_stock_alert:5, variant:'200ml' },
        { id:'d3', name:'Lux Soap', barcode:'890103004', sku:'LUX', price:55, cost_price:40, wholesale_price:45, stock_quantity:2, unit:'pcs', vat_rate:5, low_stock_alert:5, variant:'100g', expiry:'2027-01-15' },
      ]
      rows = base.filter((r:any)=> !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.barcode||'').includes(q) || (r.sku||'').toLowerCase().includes(q.toLowerCase()))
    }
    // filter
    if(filter.value==='low') rows = rows.filter((r:any)=> Number(r.stock_quantity) <= Number(r.low_stock_alert||5))
    if(filter.value==='out') rows = rows.filter((r:any)=> Number(r.stock_quantity)===0)
    if(filter.value==='expiry') rows = rows.filter((r:any)=> r.expiry && new Date(r.expiry) < new Date(Date.now()+ 30*86400000))
    render(rows)
  }

  function render(rows:any[]){
    const totalEl = document.getElementById('stat-total')!
    const lowEl = document.getElementById('stat-low')!
    const outEl = document.getElementById('stat-out')!
    totalEl.textContent = String(rows.length)
    lowEl.textContent = String(rows.filter((r:any)=> r.stock_quantity <= (r.low_stock_alert||5) && r.stock_quantity>0).length)
    outEl.textContent = String(rows.filter((r:any)=> r.stock_quantity===0).length)
    if(!rows.length){ list.innerHTML=''; empty.classList.remove('hidden'); return }
    empty.classList.add('hidden')
    list.innerHTML = rows.map((r:any)=> {
      const low = Number(r.stock_quantity) <= Number(r.low_stock_alert||5)
      const out = Number(r.stock_quantity)===0
      const expSoon = r.expiry && (new Date(r.expiry).getTime() - Date.now() < 30*86400000)
      return `
      <div class="grid sm:grid-cols-[1.5fr_0.7fr_0.5fr_0.5fr_0.6fr_0.4fr] gap-2 sm:gap-3 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 grid place-items-center text-slate-500 dark:text-slate-400 shrink-0 overflow-hidden">${r.image_url?`<img src="${r.image_url}" class="w-full h-full object-cover">`:`<span class="material-symbols-rounded text-[18px]">inventory_2</span>`}</div>
          <div class="min-w-0">
            <div class="text-sm font-bold leading-none truncate dark:text-white">${r.name} ${r.variant?`<span class="text-xs font-normal text-slate-500">• ${r.variant}</span>`:''}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 truncate">${r.barcode||r.sku||'no code'} ${r.sku&&r.barcode?`• ${r.sku}`:''}</div>
          </div>
        </div>
        <div class="text-sm font-black dark:text-white">৳${Number(r.price).toFixed(2)} ${r.wholesale_price?`<span class="text-xs font-normal text-slate-500">/ Ws ৳${r.wholesale_price}</span>`:''}</div>
        <div><span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold border ${out?'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300': low?'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300':'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}">${r.stock_quantity} ${r.unit}</span></div>
        <div class="text-xs ${expSoon?'text-red-600 font-bold':'text-slate-600 dark:text-slate-400'} truncate">${r.expiry? new Date(r.expiry).toLocaleDateString('en-GB') : '—'} ${r.batch?`<br><span class="font-mono text-[11px]">${r.batch}</span>`:''}</div>
        <div class="text-xs font-bold dark:text-white">${r.vat_rate||0}%</div>
        <div class="flex justify-end gap-1">
          <button data-edit="${r.id}" class="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white"><span class="material-symbols-rounded text-[16px]">edit</span></button>
          <button data-barcode="${r.id}" class="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white" title="Print barcode"><span class="material-symbols-rounded text-[16px]">barcode</span></button>
          <button data-del="${r.id}" class="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-600"><span class="material-symbols-rounded text-[16px]">delete</span></button>
        </div>
      </div>
    `}).join('')
    list.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', async ()=>{
      if(!confirm('Delete product? This will keep order history.')) return
      const id=(b as HTMLElement).dataset.del!
      if(isSupabaseConfigured && !id.startsWith('d')){
        const { error } = await supabase.from('products').delete().eq('id', id) as any
        if(error) { (window as any).toast?.(error.message); return }
      } else {
        const arr=JSON.parse(localStorage.getItem('demo-products')||'[]'); localStorage.setItem('demo-products', JSON.stringify(arr.filter((x:any)=>x.id!==id)))
      }
      ;(window as any).toast?.('Deleted'); fetchAll(search.value.trim())
    }))
    list.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', ()=>{
      const id=(b as HTMLElement).dataset.edit!
      location.href = `/app/products/new?edit=${id}`
    }))
    list.querySelectorAll('[data-barcode]').forEach(b=> b.addEventListener('click', ()=>{
      const r = rows.find((x:any)=> x.id===(b as HTMLElement).dataset.barcode)
      const w=window.open('','_blank','width=400,height=600')
      if(!w) return
      w.document.write(`<div style="font-family:monospace;text-align:center;padding:20px"><h3>${r.name}</h3><div style="font-size:32px;letter-spacing:4px">${r.barcode||r.sku}</div><div>৳${r.price}</div><div style="margin-top:20px"><img src="https://barcodeapi.org/api/128/${r.barcode||r.sku}" style="width:100%"/></div><script>window.print()</script></div>`)
    }))
  }

  document.getElementById('prod-export')?.addEventListener('click', async ()=>{
    const rows:any[] = []
    // naive export current view
    const text = [['Name','Barcode','SKU','Price','Stock','Unit','VAT']].concat(
      Array.from(list.querySelectorAll('[data-edit]')).map((b, i)=> {
        const id=(b as HTMLElement).dataset.edit!
        // fallback to demo
        return [id, id, '', '0','0','','']
      })
    ).map(r=> r.join(',')).join('\n')
    const blob=new Blob([text],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='products.csv'; a.click(); URL.revokeObjectURL(url)
  })
  document.getElementById('prod-print-barcode')?.addEventListener('click', ()=> (window as any).toast?.('Select barcode icon on a product'))

  let t:any
  search.addEventListener('input', ()=>{ clearTimeout(t); t=setTimeout(()=> fetchAll(search.value.trim()), 250) })
  filter.addEventListener('change', ()=> fetchAll(search.value.trim()))
  fetchAll('')
}
