import { supabase, isSupabaseConfigured } from '../../core/db/supabase'

export function productNewView(): string {
  return `
  <div class="max-w-[720px] mx-auto w-full px-4 lg:px-6 py-6">
    <div class="flex items-center gap-3">
      <a href="/app/products" data-link class="w-9 h-9 rounded-full border border-slate-200 bg-white grid place-items-center hover:bg-slate-50"><span class="material-symbols-rounded">arrow_back</span></a>
      <h1 class="text-[18px] font-black">Add Product</h1>
    </div>

    <form id="prod-form" class="mt-5 bg-white border border-slate-200 rounded-[18px] p-5 sm:p-6 space-y-4">
      <div class="grid sm:grid-cols-2 gap-4">
        <label class="text-sm font-bold">Name *
          <input name="name" required placeholder="e.g. Miniket Rice 1kg" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-slate-900 text-sm bg-white" />
        </label>
        <label class="text-sm font-bold">Price (৳) *
          <input name="price" required type="number" step="0.01" min="0" placeholder="78" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-slate-900 text-sm bg-white" />
        </label>
      </div>

      <div class="grid sm:grid-cols-3 gap-4">
        <label class="text-sm font-bold">Cost (৳)
          <input name="cost_price" type="number" step="0.01" min="0" placeholder="65" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm bg-white" />
        </label>
        <label class="text-sm font-bold">Stock *
          <input name="stock_quantity" required type="number" min="0" value="10" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm bg-white" />
        </label>
        <label class="text-sm font-bold">Unit
          <select name="unit" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm">
            <option value="pcs">pcs</option><option value="kg">kg</option><option value="gm">gm</option><option value="ltr">ltr</option><option value="ml">ml</option><option value="mtr">mtr</option><option value="dozen">dozen</option>
          </select>
        </label>
      </div>

      <div class="grid sm:grid-cols-2 gap-4">
        <label class="text-sm font-bold">Barcode
          <input name="barcode" placeholder="8901..." class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm bg-white font-mono" />
        </label>
        <label class="text-sm font-bold">SKU
          <input name="sku" placeholder="RICE-MIN-1" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm bg-white font-mono" />
        </label>
      </div>

      <div class="grid sm:grid-cols-3 gap-4">
        <label class="text-sm font-bold">VAT %
          <select name="vat_rate" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm">
            <option value="0">0%</option><option value="5">5%</option><option value="7.5">7.5%</option><option value="10">10%</option><option value="15" selected>15%</option>
          </select>
        </label>
        <label class="text-sm font-bold">Low stock alert
          <input name="low_stock_alert" type="number" min="1" value="5" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm bg-white" />
        </label>
        <label class="text-sm font-bold flex items-center gap-2 mt-6">
          <input name="is_loose" type="checkbox" class="w-4 h-4 rounded border-slate-300" /> Loose / weight
        </label>
      </div>

      <div class="pt-2 flex gap-3">
        <a href="/app/products" data-link class="flex-1 py-3 rounded-full border border-slate-200 bg-white text-sm font-bold text-center hover:bg-slate-50">Cancel</a>
        <button type="submit" class="flex-1 py-3 rounded-full bg-slate-900 text-white text-sm font-black hover:bg-black">Save Product</button>
      </div>
      <div id="prod-msg" class="hidden text-sm font-semibold"></div>
    </form>
  </div>
  `
}

export function initProductNew(){
  const form = document.getElementById('prod-form') as HTMLFormElement
  const msg = document.getElementById('prod-msg')!
  form.addEventListener('submit', async (e)=>{
    e.preventDefault()
    const fd = new FormData(form)
    const payload: any = {
      name: String(fd.get('name')||'').trim(),
      price: parseFloat(String(fd.get('price')||'0')),
      cost_price: fd.get('cost_price') ? parseFloat(String(fd.get('cost_price'))) : null,
      stock_quantity: parseInt(String(fd.get('stock_quantity')||'0'),10),
      unit: String(fd.get('unit')||'pcs'),
      barcode: String(fd.get('barcode')||'').trim() || null,
      sku: String(fd.get('sku')||'').trim() || null,
      vat_rate: parseFloat(String(fd.get('vat_rate')||'0')),
      low_stock_alert: parseInt(String(fd.get('low_stock_alert')||'5'),10),
      is_loose: !!fd.get('is_loose'),
    }
    if(!payload.name || !payload.price){ msg.textContent='Name and price required'; msg.className='text-sm font-semibold text-red-600'; msg.classList.remove('hidden'); return }
    const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement
    btn.disabled = true; btn.textContent = 'Saving…'
    try{
      if(isSupabaseConfigured){
        const { data:{ user } } = await supabase.auth.getUser()
        if(!user) throw new Error('Please log in first')
        const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
        const store_id = prof?.store_id
        if(!store_id) throw new Error('No store found for user')
        const { error } = await supabase.from('products').insert({ store_id, ...payload } as any)
        if(error) throw error
        msg.textContent='Product saved ✓'; msg.className='text-sm font-semibold text-emerald-600'; msg.classList.remove('hidden')
        setTimeout(()=> location.href='/app/products', 600)
      } else {
        // demo: store locally
        const key='demo-products'
        const arr = JSON.parse(localStorage.getItem(key)||'[]')
        arr.push({ id:'d'+Date.now(), ...payload })
        localStorage.setItem(key, JSON.stringify(arr))
        msg.textContent='Saved (demo) ✓'; msg.className='text-sm font-semibold text-emerald-600'; msg.classList.remove('hidden')
        setTimeout(()=> location.href='/app/products', 600)
      }
    }catch(err:any){
      msg.textContent = err.message || 'Failed'; msg.className='text-sm font-semibold text-red-600'; msg.classList.remove('hidden')
      btn.disabled = false; btn.textContent = 'Save Product'
    }
  })
}
