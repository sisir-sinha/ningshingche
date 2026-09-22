import { supabase, isSupabaseConfigured } from '../../core/db/supabase'

export function productsView(): string {
  return `
  <div class="max-w-[1280px] mx-auto w-full px-4 lg:px-6 py-5">
    <div class="flex flex-wrap items-center gap-3 justify-between">
      <div class="flex items-center gap-3">
        <div class="relative">
          <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
          <input id="prod-search" placeholder="Search products" class="pl-9 pr-3 py-2.5 w-[260px] sm:w-[320px] rounded-full border border-slate-200 bg-white outline-none text-sm focus:border-slate-900" />
        </div>
        <select id="prod-filter" class="hidden sm:block px-3 py-2.5 rounded-full border border-slate-200 bg-white text-sm">
          <option value="">All</option><option value="low">Low stock</option>
        </select>
      </div>
      <a href="/app/products/new" data-link class="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-full text-sm font-bold hover:bg-black"><span class="material-symbols-rounded text-[18px]">add</span> Add Product</a>
    </div>

    <div class="mt-4 bg-white border border-slate-200 rounded-[18px] overflow-hidden">
      <div class="hidden sm:grid grid-cols-[1.4fr_0.6fr_0.5fr_0.6fr_0.4fr] gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold tracking-widest text-slate-500">
        <div>PRODUCT</div><div>PRICE</div><div>STOCK</div><div>UNIT</div><div></div>
      </div>
      <div id="prod-list" class="divide-y divide-slate-100"></div>
      <div id="prod-empty" class="hidden text-sm text-slate-500 py-10 text-center">No products — add your first</div>
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
        let query = supabase.from('products').select('id,name,barcode,sku,price,stock_quantity,unit,vat_rate').order('created_at' as any, { ascending:false }).limit(50) as any
        // simple search via ilike name if q
        if(q) query = supabase.from('products').select('id,name,barcode,sku,price,stock_quantity,unit,vat_rate').ilike('name', `%${q}%`).limit(50) as any
        const { data } = await query
        if(data) rows = data
      }catch{}
    }
    if(!rows.length && !isSupabaseConfigured){
      rows = [
        { id:'d1', name:'Miniket Rice 1kg', barcode:'890100001', sku:'RICE-1', price:78, stock_quantity:3, unit:'kg', vat_rate:0 },
        { id:'d2', name:'Parachute Oil 200ml', barcode:'890103002', sku:'OIL-200', price:180, stock_quantity:18, unit:'pcs', vat_rate:5 },
        { id:'d3', name:'Lux Soap', barcode:'890103004', sku:'LUX', price:55, stock_quantity:60, unit:'pcs', vat_rate:5 },
      ].filter(r=> !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.barcode||'').includes(q))
    }
    // low filter
    if(filter.value==='low') rows = rows.filter(r=> Number(r.stock_quantity)<=5)
    render(rows)
  }

  function render(rows:any[]){
    if(!rows.length){ list.innerHTML=''; empty.classList.remove('hidden'); return }
    empty.classList.add('hidden')
    list.innerHTML = rows.map((r:any)=> `
      <div class="grid sm:grid-cols-[1.4fr_0.6fr_0.5fr_0.6fr_0.4fr] gap-2 sm:gap-3 px-4 py-3 items-center hover:bg-slate-50">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 grid place-items-center text-slate-500"><span class="material-symbols-rounded text-[18px]">inventory_2</span></div>
          <div>
            <div class="text-sm font-bold leading-none">${r.name}</div>
            <div class="text-xs text-slate-500">${r.barcode||r.sku||'no code'} • VAT ${r.vat_rate||0}%</div>
          </div>
        </div>
        <div class="text-sm font-black">৳${Number(r.price).toFixed(2)}</div>
        <div><span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold border ${Number(r.stock_quantity)<=5?'bg-amber-50 border-amber-200 text-amber-700':'bg-white border-slate-200 text-slate-600'}">${r.stock_quantity} left</span></div>
        <div class="text-sm text-slate-600">${r.unit||'pcs'}</div>
        <div class="flex justify-end gap-1">
          <button data-edit="${r.id}" class="w-8 h-8 rounded-full border border-slate-200 bg-white grid place-items-center hover:bg-slate-50"><span class="material-symbols-rounded text-[16px]">edit</span></button>
          <button data-del="${r.id}" class="w-8 h-8 rounded-full border border-slate-200 bg-white grid place-items-center hover:bg-red-50 text-slate-500 hover:text-red-600"><span class="material-symbols-rounded text-[16px]">delete</span></button>
        </div>
      </div>
    `).join('')
    list.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', async ()=>{
      if(!confirm('Delete product?')) return
      const id=(b as HTMLElement).dataset.del!
      if(isSupabaseConfigured && !id.startsWith('d')){
        const { error } = await supabase.from('products').delete().eq('id', id) as any
        if(error) { (window as any).toast?.(error.message); return }
      }
      ;(window as any).toast?.('Deleted'); fetchAll(search.value.trim())
    }))
    list.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', ()=> (window as any).toast?.('Edit coming soon')))
  }

  let t:any
  search.addEventListener('input', ()=>{ clearTimeout(t); t=setTimeout(()=> fetchAll(search.value.trim()), 250) })
  filter.addEventListener('change', ()=> fetchAll(search.value.trim()))
  fetchAll('')
}
