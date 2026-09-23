import { supabase, isSupabaseConfigured } from '../../core/db/supabase'
import { bindImgbbDropZone } from '../../core/services/imgbb'
import { withBase } from '../../core/utils/base'

export function productNewView(): string {
  return `
  <div class="max-w-[760px] mx-auto w-full px-4 lg:px-6 py-6">
    <div class="flex items-center gap-3">
      <a href="/app/products" data-link class="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 grid place-items-center hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-white"><span class="material-symbols-rounded">arrow_back</span></a>
      <div>
        <h1 class="text-[18px] font-black dark:text-white">Add Product</h1>
        <p class="text-xs text-slate-500 dark:text-slate-400">Rich inventory: variant, batch, expiry, supplier, VAT • imgbb drag-drop</p>
      </div>
    </div>

    <form id="prod-form" class="mt-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5 sm:p-6 space-y-5">
      <!-- Core -->
      <div class="grid sm:grid-cols-2 gap-4">
        <label class="text-sm font-bold dark:text-white">Name *
          <input name="name" required placeholder="e.g. Miniket Rice 1kg" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none focus:border-slate-900 dark:focus:border-slate-500 text-sm bg-white dark:bg-slate-800 dark:text-white" />
        </label>
        <label class="text-sm font-bold dark:text-white">Category
          <input name="category" placeholder="Grocery / Electronics" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
        </label>
      </div>

      <div class="grid sm:grid-cols-3 gap-4">
        <label class="text-sm font-bold dark:text-white">Price (৳) *
          <input name="price" required type="number" step="0.01" min="0" placeholder="78" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
        </label>
        <label class="text-sm font-bold dark:text-white">Cost (৳)
          <input name="cost_price" type="number" step="0.01" min="0" placeholder="65" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
        </label>
        <label class="text-sm font-bold dark:text-white">Wholesale (৳)
          <input name="wholesale_price" type="number" step="0.01" min="0" placeholder="70" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
        </label>
      </div>

      <div class="grid sm:grid-cols-3 gap-4">
        <label class="text-sm font-bold dark:text-white">Stock *
          <input name="stock_quantity" required type="number" min="0" value="10" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
        </label>
        <label class="text-sm font-bold dark:text-white">Low alert
          <input name="low_stock_alert" type="number" min="1" value="5" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
        </label>
        <label class="text-sm font-bold dark:text-white">Unit
          <select name="unit" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white">
            <option value="pcs">pcs</option><option value="kg">kg</option><option value="gm">gm</option><option value="ltr">ltr</option><option value="ml">ml</option><option value="mtr">mtr</option><option value="dozen">dozen</option><option value="box">box</option>
          </select>
        </label>
      </div>

      <div class="grid sm:grid-cols-2 gap-4">
        <label class="text-sm font-bold dark:text-white">Barcode
          <input name="barcode" placeholder="8901..." class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white font-mono" />
        </label>
        <label class="text-sm font-bold dark:text-white">SKU
          <input name="sku" placeholder="RICE-MIN-1" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white font-mono" />
        </label>
      </div>

      <div class="grid sm:grid-cols-3 gap-4">
        <label class="text-sm font-bold dark:text-white">Variant
          <input name="variant" placeholder="Red / 500g" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
        </label>
        <label class="text-sm font-bold dark:text-white">Batch / Serial
          <input name="batch" placeholder="B-2026-01 / IMEI" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white font-mono" />
        </label>
        <label class="text-sm font-bold dark:text-white">Expiry
          <input name="expiry" type="date" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
        </label>
      </div>

      <div class="grid sm:grid-cols-3 gap-4">
        <label class="text-sm font-bold dark:text-white">VAT %
          <select name="vat_rate" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white">
            <option value="0">0%</option><option value="5">5%</option><option value="7.5">7.5%</option><option value="10">10%</option><option value="15" selected>15%</option>
          </select>
        </label>
        <label class="text-sm font-bold dark:text-white">Supplier
          <input name="supplier" placeholder="M/S Rahman Traders" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
        </label>
        <label class="text-sm font-bold flex items-center gap-2 mt-6 dark:text-white">
          <input name="is_loose" type="checkbox" class="w-4 h-4 rounded border-slate-300 dark:bg-slate-800" /> Loose / weight
        </label>
      </div>

      <!-- Image upload — imgbb drag & drop -->
      <div>
        <div class="text-sm font-bold dark:text-white flex items-center gap-2"><span class="material-symbols-rounded text-[18px]">image</span> Product image <span class="text-xs font-normal text-slate-500">• drag & drop, paste, or click • imgbb</span></div>
        <div id="prod-drop" tabindex="0" class="mt-2 group border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-[18px] bg-slate-50 dark:bg-slate-800/50 p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-800 transition outline-none focus:border-slate-900 dark:focus:border-white focus:ring-2 focus:ring-slate-900/10">
          <div id="prod-drop-icon" class="w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 grid place-items-center shadow-sm">
            <span class="material-symbols-rounded text-slate-600 dark:text-slate-300">cloud_upload</span>
          </div>
          <div class="mt-2 text-sm font-bold dark:text-white">Drop image here or click to browse</div>
          <div class="text-xs text-slate-500 dark:text-slate-400">PNG, JPG, WEBP up to 32 MB • auto-uploads to imgbb</div>
          <div id="prod-progress" class="hidden mt-3 w-full max-w-[320px] h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div id="prod-bar" class="h-full bg-slate-900 dark:bg-white w-0 transition-all"></div></div>
          <div id="prod-status" class="hidden mt-2 text-xs font-semibold"></div>
          <input id="prod-file" type="file" accept="image/*" class="hidden" />
        </div>
        <div id="prod-preview-wrap" class="hidden mt-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex items-center gap-3">
          <img id="prod-preview" src="" alt="preview" class="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-bold text-slate-500">Uploaded URL</div>
            <a id="prod-url-link" href="#" target="_blank" class="text-xs font-mono text-sky-600 dark:text-sky-400 break-all hover:underline">—</a>
            <div class="mt-1 flex gap-2">
              <button type="button" id="prod-copy" class="text-xs font-bold px-3 py-1 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900">Copy link</button>
              <button type="button" id="prod-clear-img" class="text-xs font-bold px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white">Remove</button>
            </div>
          </div>
        </div>
        <label class="block mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">Image URL (auto-filled, you can also paste)
          <input name="image_url" id="prod-image-url" placeholder="https://i.ibb.co/..." class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white font-mono" />
        </label>
      </div>

      <div class="pt-2 flex gap-3">
        <a href="/app/products" data-link class="flex-1 py-3 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-center hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white">Cancel</a>
        <button type="submit" class="flex-1 py-3 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black hover:bg-black dark:hover:bg-slate-100">Save Product</button>
      </div>
      <div id="prod-msg" class="hidden text-sm font-semibold"></div>
    </form>
  </div>
  `
}

export function initProductNew(){
  const form = document.getElementById('prod-form') as HTMLFormElement
  const msg = document.getElementById('prod-msg')!
  const drop = document.getElementById('prod-drop') as HTMLElement
  const fileInput = document.getElementById('prod-file') as HTMLInputElement
  const imgUrlInput = document.getElementById('prod-image-url') as HTMLInputElement
  const previewWrap = document.getElementById('prod-preview-wrap') as HTMLElement
  const previewImg = document.getElementById('prod-preview') as HTMLImageElement
  const urlLink = document.getElementById('prod-url-link') as HTMLAnchorElement
  const statusEl = document.getElementById('prod-status') as HTMLElement
  const prog = document.getElementById('prod-progress') as HTMLElement
  const bar = document.getElementById('prod-bar') as HTMLElement

  // live preview when pasting URL manually
  function showPreview(url: string){
    if(!url) return
    previewImg.src = url
    urlLink.href = url
    urlLink.textContent = url
    previewWrap.classList.remove('hidden')
  }
  function hidePreview(){
    previewWrap.classList.add('hidden')
    previewImg.src = ''
    urlLink.textContent = '—'
  }

  imgUrlInput.addEventListener('input', ()=>{
    const v = imgUrlInput.value.trim()
    if(/^https?:\/\/.+\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i.test(v) || v.includes('ibb.co')) showPreview(v)
    else if(!v) hidePreview()
  })

  document.getElementById('prod-copy')?.addEventListener('click', async ()=>{
    const v = imgUrlInput.value.trim(); if(!v) return
    await navigator.clipboard.writeText(v).catch(()=>{})
    ;(window as any).toast?.('Copied ✓')
  })
  document.getElementById('prod-clear-img')?.addEventListener('click', ()=>{
    imgUrlInput.value=''; hidePreview(); statusEl.classList.add('hidden'); prog.classList.add('hidden')
  })

  bindImgbbDropZone({
    zone: drop,
    input: fileInput,
    onUrl: (url)=>{
      imgUrlInput.value = url
      showPreview(url)
    },
    onProgress: (p, m)=>{
      if(p==='uploading'){
        statusEl.textContent = `Uploading ${m||''}…`
        statusEl.className = 'mt-2 text-xs font-bold text-slate-600 dark:text-slate-300'
        statusEl.classList.remove('hidden')
        prog.classList.remove('hidden'); bar.style.width='55%'
        // animate to 90% fake
        setTimeout(()=> bar.style.width='90%', 400)
      } else if(p==='done'){
        bar.style.width='100%'
        statusEl.textContent = 'Uploaded ✓'
        statusEl.className = 'mt-2 text-xs font-bold text-emerald-600'
        setTimeout(()=>{ prog.classList.add('hidden'); bar.style.width='0%' }, 900)
      } else if(p==='error'){
        bar.style.width='0%'; prog.classList.add('hidden')
        statusEl.textContent = m || 'Upload failed'
        statusEl.className = 'mt-2 text-xs font-bold text-red-600'
        statusEl.classList.remove('hidden')
      } else {
        prog.classList.add('hidden')
      }
    }
  })

  form.addEventListener('submit', async (e)=>{
    e.preventDefault()
    const fd = new FormData(form)
    const payload: any = {
      name: String(fd.get('name')||'').trim(),
      price: parseFloat(String(fd.get('price')||'0')),
      cost_price: fd.get('cost_price') ? parseFloat(String(fd.get('cost_price'))) : null,
      wholesale_price: fd.get('wholesale_price') ? parseFloat(String(fd.get('wholesale_price'))) : null,
      stock_quantity: parseInt(String(fd.get('stock_quantity')||'0'),10),
      low_stock_alert: parseInt(String(fd.get('low_stock_alert')||'5'),10),
      unit: String(fd.get('unit')||'pcs'),
      barcode: String(fd.get('barcode')||'').trim() || null,
      sku: String(fd.get('sku')||'').trim() || null,
      variant: String(fd.get('variant')||'').trim() || null,
      batch: String(fd.get('batch')||'').trim() || null,
      expiry: String(fd.get('expiry')||'').trim() || null,
      vat_rate: parseFloat(String(fd.get('vat_rate')||'0')),
      supplier: String(fd.get('supplier')||'').trim() || null,
      image_url: String(fd.get('image_url')||'').trim() || null,
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
        const dbPayload: any = {
          store_id,
          name: payload.name,
          price: payload.price,
          cost_price: payload.cost_price,
          stock_quantity: payload.stock_quantity,
          unit: payload.unit,
          barcode: payload.barcode,
          sku: payload.sku,
          vat_rate: payload.vat_rate,
          low_stock_alert: payload.low_stock_alert,
          is_loose: payload.is_loose,
          variant: payload.variant,
          wholesale_price: payload.wholesale_price,
          image_url: payload.image_url,
        }
        const { error } = await supabase.from('products').insert(dbPayload as any)
        if(error) throw error
        if(payload.supplier){
          try{ await supabase.from('suppliers').insert({ store_id, name: payload.supplier } as any) }catch{}
        }
        msg.textContent='Product saved ✓'; msg.className='text-sm font-semibold text-emerald-600'; msg.classList.remove('hidden')
        setTimeout(()=> location.href = withBase('/app/products'), 600)
      } else {
        const key='demo-products'
        const arr = JSON.parse(localStorage.getItem(key)||'[]')
        arr.push({ id:'d'+Date.now(), ...payload })
        localStorage.setItem(key, JSON.stringify(arr))
        msg.textContent='Saved (demo) ✓'; msg.className='text-sm font-semibold text-emerald-600'; msg.classList.remove('hidden')
        setTimeout(()=> location.href = withBase('/app/products'), 600)
      }
    }catch(err:any){
      msg.textContent = err.message || 'Failed'; msg.className='text-sm font-semibold text-red-600'; msg.classList.remove('hidden')
      btn.disabled = false; btn.textContent = 'Save Product'
    }
  })
}