import { supabase, isSupabaseConfigured } from '../../core/db/supabase'
import { enqueue, getOutboxCount } from '../../core/db/idb'
import { calcTotals, type CartItem } from '../../core/services/billing'

type Product = { id:string; name:string; barcode:string|null; sku:string|null; price:number; cost_price:number|null; stock_quantity:number; unit:string; vat_rate:number; is_loose:boolean }

const DEMO_PRODUCTS: Product[] = [
  { id:'demo-1', name:'Miniket Rice 1kg', barcode:'890100001', sku:'RICE-MIN-1', price:78, cost_price:65, stock_quantity: 40, unit:'kg', vat_rate:0, is_loose:true },
  { id:'demo-2', name:'Parachute Oil 200ml', barcode:'890103002', sku:'OIL-PAR-200', price:180, cost_price:150, stock_quantity: 18, unit:'pcs', vat_rate:5, is_loose:false },
  { id:'demo-3', name:'Fresh Sugar 1kg', barcode:'890100003', sku:'SUG-1', price:120, cost_price:105, stock_quantity: 25, unit:'kg', vat_rate:0, is_loose:true },
  { id:'demo-4', name:'Lux Soap', barcode:'890103004', sku:'LUX-1', price:55, cost_price:40, stock_quantity: 60, unit:'pcs', vat_rate:5, is_loose:false },
  { id:'demo-5', name:'Potato 1kg', barcode:null, sku:null, price:45, cost_price:35, stock_quantity: 100, unit:'kg', vat_rate:0, is_loose:true },
]

export default function posView(): string {
  return `
  <div class="min-h-screen bg-[#f8fafc] flex flex-col">
    <header class="sticky top-0 z-30 bg-white border-b border-slate-200">
      <div class="max-w-[1280px] mx-auto px-3 sm:px-4 h-[56px] flex items-center gap-2">
        <a href="/app.html" data-link class="w-8 h-8 rounded-full border border-slate-200 grid place-items-center hover:bg-slate-50"><span class="material-symbols-rounded text-[18px]">arrow_back</span></a>
        <div class="font-bold text-[15px]">New Sale</div>
        <span id="pos-store" class="hidden sm:inline text-xs text-slate-500"></span>
        <div class="ml-auto flex items-center gap-2">
          <span id="outbox-badge" class="hidden text-xs font-bold bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-1 rounded-full">Offline</span>
          <button id="pos-clear" class="text-xs font-bold border border-slate-200 bg-white px-3 py-1.5 rounded-full hover:bg-slate-50">Clear</button>
        </div>
      </div>
    </header>

    <div class="flex-1 max-w-[1280px] mx-auto w-full px-3 sm:px-4 py-3 sm:py-4 grid lg:grid-cols-[1.15fr_0.85fr] gap-4 items-start">
      <!-- LEFT: Products -->
      <div class="bg-white border border-slate-200 rounded-[20px] p-3 sm:p-4">
        <div class="flex gap-2">
          <div class="flex-1 relative">
            <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
            <input id="pos-search" placeholder="Search product or scan barcode" class="w-full pl-9 pr-10 py-2.5 rounded-full border border-slate-200 bg-slate-50 focus:bg-white outline-none text-sm focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" autocomplete="off" />
            <button id="pos-scan" class="absolute right-1 top-1 bottom-1 w-9 rounded-full bg-slate-900 text-white grid place-items-center hover:bg-black"><span class="material-symbols-rounded text-[18px]">barcode_scanner</span></button>
          </div>
        </div>

        <div id="pos-products" class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 max-h-[56vh] lg:max-h-[68vh] overflow-auto pr-1">
        </div>
        <div class="mt-3 text-[11px] text-slate-500 flex items-center gap-1"><span class="material-symbols-rounded text-[14px]">info</span> Scanner auto-adds • Tap product to add • Low stock ≤5</div>
      </div>

      <!-- RIGHT: Cart -->
      <div class="bg-white border border-slate-200 rounded-[20px] p-3 sm:p-4 flex flex-col lg:sticky lg:top-[72px]">
        <!-- Customer -->
        <div class="flex gap-2">
          <div class="flex-1 relative">
            <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">person</span>
            <input id="pos-customer" placeholder="Customer phone (01XXXXXXXXX) — Walk-in if empty" class="w-full pl-9 pr-3 py-2.5 rounded-full border border-slate-200 bg-white outline-none text-sm focus:border-slate-900" inputmode="numeric" />
            <div id="pos-customer-list" class="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl hidden max-h-48 overflow-auto z-20"></div>
          </div>
          <button id="pos-add-customer" class="shrink-0 w-10 h-10 rounded-full border border-slate-200 bg-white grid place-items-center hover:bg-slate-50"><span class="material-symbols-rounded text-[18px]">person_add</span></button>
        </div>
        <div id="pos-customer-chip" class="hidden mt-2 inline-flex items-center gap-2 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-full w-fit"></div>

        <!-- Cart -->
        <div class="mt-4">
          <div class="flex items-center justify-between">
            <div class="text-xs font-extrabold tracking-widest text-slate-500">CART</div>
            <div class="flex items-center gap-2">
              <button id="pos-hold" class="text-xs font-bold border border-slate-200 bg-white px-2.5 py-1 rounded-full hover:bg-slate-50">Hold</button>
              <span id="pos-held-badge" class="hidden text-xs font-bold bg-slate-900 text-white px-2 py-1 rounded-full">Held 0</span>
            </div>
          </div>
          <div id="pos-cart" class="mt-2 space-y-2 min-h-[120px] max-h-[30vh] overflow-auto pr-1">
            <div class="text-sm text-slate-500 py-10 text-center border-2 border-dashed border-slate-200 rounded-2xl">Cart empty</div>
          </div>
        </div>

        <!-- Discount / VAT -->
        <div class="mt-3 grid grid-cols-2 gap-2">
          <label class="text-xs font-bold text-slate-600">Discount
            <div class="mt-1 flex">
              <input id="pos-discount" type="number" value="0" min="0" class="flex-1 px-3 py-2 rounded-l-full border border-slate-200 outline-none text-sm bg-white" />
              <select id="pos-discount-type" class="px-3 py-2 rounded-r-full border-y border-r border-slate-200 bg-slate-50 text-xs font-bold">
                <option value="amount">৳</option><option value="percent">%</option>
              </select>
            </div>
          </label>
          <label class="text-xs font-bold text-slate-600">VAT
            <select id="pos-vat-profile" class="mt-1 w-full px-3 py-2 rounded-full border border-slate-200 bg-white text-sm">
              <option value="0">0%</option><option value="5">5%</option><option value="7.5">7.5%</option><option value="10">10%</option><option value="15" selected>15%</option>
            </select>
          </label>
        </div>

        <!-- Totals -->
        <div class="mt-3 bg-slate-50 border border-slate-200 rounded-2xl p-3">
          <div class="flex justify-between text-sm"><span class="text-slate-500">Subtotal</span><span id="pos-sub" class="font-bold">৳0.00</span></div>
          <div class="flex justify-between text-sm"><span class="text-slate-500">Discount</span><span id="pos-disc" class="font-bold text-emerald-600">-৳0.00</span></div>
          <div class="flex justify-between text-sm"><span class="text-slate-500">VAT</span><span id="pos-vat" class="font-bold">৳0.00</span></div>
          <div class="flex justify-between font-black text-[17px] mt-2 pt-2 border-t border-slate-200"><span>Total</span><span id="pos-total">৳0.00</span></div>
          <div id="pos-due-row" class="hidden mt-2 flex justify-between text-sm font-black text-red-600 bg-white border border-red-200 rounded-full px-3 py-1.5"><span>Due</span><span id="pos-due">৳0.00</span></div>
        </div>

        <!-- Payments -->
        <div class="mt-3">
          <div class="text-xs font-extrabold tracking-widest text-slate-500">PAYMENT</div>
          <div id="pos-pay-grid" class="mt-2 grid grid-cols-4 gap-2">
            ${['cash','bkash','nagad','rocket','upay','bangla_qr','card','due'].map(m=>`
              <button data-pay="${m}" class="pay-btn px-2 py-2.5 rounded-2xl border border-slate-200 bg-white text-xs font-bold capitalize hover:border-slate-900 ${m==='cash'?'!bg-slate-900 !text-white !border-slate-900':''}">${m.replace('_',' ')}</button>
            `).join('')}
          </div>
          <div id="pos-mfs-row" class="hidden mt-3">
            <label class="text-xs font-bold text-slate-600">TrxID</label>
            <input id="pos-trxid" placeholder="bKash TrxID (optional)" class="mt-1 w-full px-3 py-2.5 rounded-full border border-slate-200 outline-none text-sm bg-white" maxlength="12" />
          </div>
          <div id="pos-paid-row" class="hidden mt-3">
            <label class="text-xs font-bold text-slate-600">Paid now</label>
            <input id="pos-paid" type="number" value="0" min="0" placeholder="Paid now ৳" class="mt-1 w-full px-3 py-2.5 rounded-full border border-slate-200 outline-none text-sm bg-white" />
          </div>
        </div>

        <button id="pos-pay" class="mt-4 w-full bg-slate-900 text-white rounded-full py-3.5 font-black text-[15px] flex items-center justify-center gap-2 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed">
          <span class="material-symbols-rounded">print</span> Pay — <span id="pos-pay-total">৳0.00</span>
        </button>
        <div id="pos-receipt" class="hidden mt-4 bg-white border border-slate-200 rounded-2xl p-3 font-mono text-[11px] leading-4"></div>
      </div>
    </div>
  </div>
  `
}

export function initPos() {
  const grid = document.getElementById('pos-products')!
  const cartEl = document.getElementById('pos-cart')!
  const search = document.getElementById('pos-search') as HTMLInputElement
  const subEl = document.getElementById('pos-sub')!
  const discEl = document.getElementById('pos-disc')!
  const vatEl = document.getElementById('pos-vat')!
  const totalEl = document.getElementById('pos-total')!
  const dueRow = document.getElementById('pos-due-row')!
  const dueEl = document.getElementById('pos-due')!
  const payTotalEl = document.getElementById('pos-pay-total')!
  const discount = document.getElementById('pos-discount') as HTMLInputElement
  const discountType = document.getElementById('pos-discount-type') as HTMLSelectElement
  const vatProfile = document.getElementById('pos-vat-profile') as HTMLSelectElement
  const payGrid = document.getElementById('pos-pay-grid')!
  const mfsRow = document.getElementById('pos-mfs-row')!
  const paidRow = document.getElementById('pos-paid-row')!
  const trxInput = document.getElementById('pos-trxid') as HTMLInputElement
  const paidInput = document.getElementById('pos-paid') as HTMLInputElement
  const payBtn = document.getElementById('pos-pay') as HTMLButtonElement
  const customerInput = document.getElementById('pos-customer') as HTMLInputElement
  const customerList = document.getElementById('pos-customer-list')!
  const customerChip = document.getElementById('pos-customer-chip')!
  const clearBtn = document.getElementById('pos-clear') as HTMLButtonElement
  const holdBtn = document.getElementById('pos-hold') as HTMLButtonElement
  const heldBadge = document.getElementById('pos-held-badge')!
  const outboxBadge = document.getElementById('outbox-badge')!
  const storeEl = document.getElementById('pos-store')!

  let products: Product[] = [...DEMO_PRODUCTS]
  let cart: CartItem[] = []
  let selectedPay: string = 'cash'
  let selectedCustomer: { id:string|null; name:string; phone:string } | null = null
  let heldCarts: CartItem[][] = JSON.parse(localStorage.getItem('pos-held') || '[]')

  function updateHeldBadge(){ if(heldCarts.length) { heldBadge.textContent = `Held ${heldCarts.length}`; heldBadge.classList.remove('hidden')} else heldBadge.classList.add('hidden')}
  updateHeldBadge()

  async function refreshOutbox() {
    const n = await getOutboxCount().catch(()=>0)
    if(n>0){ outboxBadge.textContent = `${n} pending`; outboxBadge.classList.remove('hidden') } else outboxBadge.classList.add('hidden')
  }
  refreshOutbox(); setInterval(refreshOutbox, 3000)

  // store name
  ;(async()=>{
    if(isSupabaseConfigured){
      try{
        const { data:{ user } } = await supabase.auth.getUser()
        if(user){
          const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
          if(prof?.store_id){
            const { data: store } = await supabase.from('stores').select('name').eq('id', prof.store_id).maybeSingle() as any
            if(store?.name && storeEl) storeEl.textContent = `• ${store.name}`
          }
        }
      }catch{}
    }
  })()

  async function loadProducts(q = '') {
    if (!isSupabaseConfigured) { renderProducts(filterLocal(q)); return }
    try {
      let query = supabase.from('products').select('id,name,barcode,sku,price,cost_price,stock_quantity,unit,vat_rate,is_loose').limit(60)
      if (q) query = supabase.from('products').select('id,name,barcode,sku,price,cost_price,stock_quantity,unit,vat_rate,is_loose').ilike('name', `%${q}%`).limit(60) as any
      const { data, error } = await query as any
      if (error) throw error
      if (data && data.length) {
        products = data.map((d:any)=> ({ id:d.id, name:d.name, barcode:d.barcode, sku:d.sku, price:Number(d.price), cost_price: d.cost_price?Number(d.cost_price):null, stock_quantity: d.stock_quantity ?? 0, unit: d.unit||'pcs', vat_rate: Number(d.vat_rate||0), is_loose: !!d.is_loose }))
        renderProducts(products)
      } else renderProducts(filterLocal(q))
    } catch { renderProducts(filterLocal(q)) }
  }

  function filterLocal(q:string){ if(!q) return products; const s=q.toLowerCase(); return DEMO_PRODUCTS.filter(p=> p.name.toLowerCase().includes(s) || (p.barcode && p.barcode.includes(q)) || (p.sku && p.sku.toLowerCase().includes(s)))}

  function renderProducts(list: Product[]) {
    if (!list.length) { grid.innerHTML = `<div class="col-span-full text-sm text-slate-500 py-10 text-center border-2 border-dashed border-slate-200 rounded-2xl">No products</div>`; return }
    grid.innerHTML = list.map(p=>`
      <button data-add="${p.id}" class="text-left bg-slate-50 hover:bg-white border border-slate-200 hover:border-slate-900 rounded-2xl p-3 flex flex-col gap-2 transition">
        <div class="font-bold text-sm leading-4 line-clamp-2">${p.name}</div>
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold ${p.stock_quantity<=5?'text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full ':'text-slate-500'}">${p.stock_quantity} left</span>
          <span class="font-black text-sm">৳${Number(p.price).toFixed(0)}</span>
        </div>
        <div class="mt-auto flex items-center justify-between">
          <span class="text-[11px] text-slate-500">${p.unit} • ${p.barcode||'no barcode'}</span>
          <span class="w-7 h-7 rounded-full bg-slate-900 text-white grid place-items-center"><span class="material-symbols-rounded text-[16px]">add</span></span>
        </div>
      </button>
    `).join('')
    grid.querySelectorAll('[data-add]').forEach(b=> b.addEventListener('click', ()=> addToCart((b as HTMLElement).dataset.add!)))
  }

  function addToCart(id:string){
    const p = [...products, ...DEMO_PRODUCTS].find(x=>x.id===id) || products.find(x=>x.id===id); if(!p) return
    const existing = cart.find(c=> c.product_id===p.id)
    if(existing) existing.qty += p.is_loose ? 0.5 : 1
    else cart.push({ id: Math.random().toString(36).slice(2), product_id:p.id, name:p.name, unit:p.unit, price:p.price, vat_rate:p.vat_rate, qty: 1, cost_price: p.cost_price || undefined })
    renderCart()
  }

  function renderCart(){
    if(!cart.length){
      cartEl.innerHTML = `<div class="text-sm text-slate-500 py-10 text-center border-2 border-dashed border-slate-200 rounded-2xl">Cart empty</div>`
      payBtn.disabled = true
    } else {
      cartEl.innerHTML = cart.map(c=>`
        <div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2.5">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-bold truncate">${c.name}</div>
            <div class="text-xs text-slate-500">${c.qty} ${c.unit} × ৳${c.price.toFixed(2)}</div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button data-dec="${c.id}" class="w-7 h-7 rounded-full border border-slate-200 bg-white grid place-items-center">−</button>
            <span class="w-8 text-center text-sm font-bold">${c.qty}</span>
            <button data-inc="${c.id}" class="w-7 h-7 rounded-full bg-slate-900 text-white grid place-items-center">+</button>
          </div>
          <div class="w-14 text-right font-bold text-sm">৳${(c.price*c.qty).toFixed(2)}</div>
          <button data-del="${c.id}" class="w-7 h-7 rounded-full bg-white border border-slate-200 grid place-items-center text-slate-400"><span class="material-symbols-rounded text-[16px]">close</span></button>
        </div>
      `).join('')
      cartEl.querySelectorAll('[data-inc]').forEach(b=> b.addEventListener('click', ()=>{ const it=cart.find(x=>x.id===(b as HTMLElement).dataset.inc!)!; it.qty+=1; renderCart(); updateTotals()}))
      cartEl.querySelectorAll('[data-dec]').forEach(b=> b.addEventListener('click', ()=>{ const it=cart.find(x=>x.id===(b as HTMLElement).dataset.dec!)!; it.qty-= (it.unit==='kg'||it.unit==='ltr'?0.5:1); if(it.qty<=0) cart=cart.filter(x=>x.id!==it.id); renderCart(); updateTotals()}))
      cartEl.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', ()=>{ cart=cart.filter(x=>x.id!==(b as HTMLElement).dataset.del!); renderCart(); updateTotals()}))
      payBtn.disabled = false
    }
    updateTotals()
  }

  function updateTotals(){
    const discountVal = parseFloat(discount.value || '0')
    const dtype = discountType.value as any
    const vatDefault = parseFloat(vatProfile.value || '0')
    const { subtotal, discountAmount, vat, total } = calcTotals(cart, discountVal, dtype, vatDefault)
    subEl.textContent = `৳${subtotal.toFixed(2)}`
    discEl.textContent = `-৳${discountAmount.toFixed(2)}`
    vatEl.textContent = `৳${vat.toFixed(2)}`
    totalEl.textContent = `৳${total.toFixed(2)}`
    payTotalEl.textContent = `৳${total.toFixed(2)}`
    const isDue = selectedPay==='due'
    if(isDue){
      const paid = parseFloat(paidInput.value || '0') || 0
      const due = Math.max(0, total - paid)
      dueEl.textContent = `৳${due.toFixed(2)}`
      dueRow.classList.remove('hidden'); paidRow.classList.remove('hidden')
    } else { dueRow.classList.add('hidden'); paidRow.classList.add('hidden') }
    if(['bkash','nagad','rocket','upay','bangla_qr'].includes(selectedPay)) mfsRow.classList.remove('hidden'); else mfsRow.classList.add('hidden')
  }

  payGrid.querySelectorAll('.pay-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      payGrid.querySelectorAll('.pay-btn').forEach(x=> x.classList.remove('!bg-slate-900','!text-white','!border-slate-900'))
      b.classList.add('!bg-slate-900','!text-white','!border-slate-900')
      selectedPay = (b as HTMLElement).dataset.pay!
      updateTotals()
    })
  })
  discount.addEventListener('input', updateTotals)
  discountType.addEventListener('change', updateTotals)
  vatProfile.addEventListener('change', updateTotals)
  paidInput.addEventListener('input', updateTotals)

  let t:any
  search.addEventListener('input', ()=>{ clearTimeout(t); t=setTimeout(()=> loadProducts(search.value.trim()), 220) })
  document.getElementById('pos-scan')?.addEventListener('click', ()=> {
    const q = prompt('Barcode:', '') || ''
    if(!q) return
    const found = products.find(p=> p.barcode===q || p.sku===q)
    if(found) addToCart(found.id); else (window as any).toast?.('Not found')
  })
  let buffer='', lastTime=0
  window.addEventListener('keydown', (e)=>{
    if(e.target instanceof HTMLInputElement) return
    const now = Date.now()
    if(now - lastTime > 80) buffer = ''
    lastTime = now
    if(e.key==='Enter' && buffer.length>=3){ const code=buffer; buffer=''; const p=products.find(x=> x.barcode===code || x.sku===code); if(p){ e.preventDefault(); addToCart(p.id); (window as any).toast?.(p.name) } return }
    if(e.key.length===1) buffer+=e.key
  })

  async function searchCustomers(q:string){
    if(!q || q.length<2){ customerList.classList.add('hidden'); return }
    let list: any[] = []
    if(isSupabaseConfigured){
      try{ const { data } = await supabase.from('customers').select('id,name,phone,due_balance').ilike('phone', `%${q}%`).limit(5) as any; if(data) list=data }catch{}
    }
    if(!list.length){ const demo=[{id:null,name:'Rahim',phone:'01712345678',due_balance:1170},{id:null,name:'Karim',phone:'01787654321',due_balance:0}]; list=demo.filter(d=> d.phone.includes(q) || d.name.toLowerCase().includes(q.toLowerCase())) }
    if(!list.length){ customerList.classList.add('hidden'); return }
    customerList.innerHTML = list.map(c=> `<button data-cust='${JSON.stringify(c).replace(/'/g,"&apos;")}' class="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex items-center justify-between"><div><div class="text-sm font-bold">${c.name}</div><div class="text-xs text-slate-500">${c.phone}</div></div><div class="text-xs font-bold ${c.due_balance>0?'text-red-600':'text-emerald-600'}">৳${c.due_balance}</div></button>`).join('')
    customerList.classList.remove('hidden')
    customerList.querySelectorAll('[data-cust]').forEach(b=> b.addEventListener('click', ()=>{
      const c = JSON.parse((b as HTMLElement).dataset.cust!.replace(/&apos;/g,"'"))
      selectedCustomer = { id: c.id, name: c.name, phone: c.phone }
      customerChip.textContent = `${c.name} • ${c.phone}`
      customerChip.classList.remove('hidden'); customerList.classList.add('hidden'); customerInput.value = c.phone
    }))
  }
  customerInput.addEventListener('input', ()=> searchCustomers(customerInput.value.trim()))
  customerInput.addEventListener('focus', ()=> searchCustomers(customerInput.value.trim()))
  document.addEventListener('click', (e)=> { if(!(e.target as HTMLElement).closest('#pos-customer') && !(e.target as HTMLElement).closest('#pos-customer-list')) customerList.classList.add('hidden') })
  document.getElementById('pos-add-customer')?.addEventListener('click', ()=>{
    const phone = customerInput.value.trim()
    if(!/^01[3-9]\d{8}$/.test(phone)){ (window as any).toast?.('Enter valid 01XXXXXXXXX'); return }
    const name = prompt('Customer name:', 'Walk-in') || 'Walk-in'
    selectedCustomer = { id: null, name, phone }
    customerChip.textContent = `${name} • ${phone}`; customerChip.classList.remove('hidden'); customerList.classList.add('hidden')
  })

  holdBtn.addEventListener('click', ()=>{
    if(!cart.length){ (window as any).toast?.('Cart empty'); return }
    heldCarts.push([...cart]); localStorage.setItem('pos-held', JSON.stringify(heldCarts)); cart=[]; renderCart(); updateHeldBadge(); (window as any).toast?.('Held')
  })
  heldBadge.addEventListener('click', ()=>{
    if(!heldCarts.length) return
    const last = heldCarts.pop()!; localStorage.setItem('pos-held', JSON.stringify(heldCarts)); cart = last; renderCart(); updateHeldBadge(); (window as any).toast?.('Resumed')
  })
  clearBtn.addEventListener('click', ()=>{ cart=[]; renderCart(); selectedCustomer=null; customerChip.classList.add('hidden'); customerInput.value=''; discount.value='0'; updateTotals() })

  payBtn.addEventListener('click', async ()=>{
    if(!cart.length){ (window as any).toast?.('Cart empty'); return }
    const discountVal = parseFloat(discount.value||'0')
    const dtype = discountType.value as any
    const vatDefault = parseFloat(vatProfile.value||'0')
    const { subtotal, discountAmount, vat, total } = calcTotals(cart, discountVal, dtype, vatDefault)
    const paidNow = selectedPay==='due' ? (parseFloat(paidInput.value||'0')||0) : total
    const due = Math.max(0, total - paidNow)
    if(due>0 && !selectedCustomer){ (window as any).toast?.('Add customer for due'); customerInput.focus(); return }
    if(['bkash','nagad','rocket','upay','bangla_qr'].includes(selectedPay) && !trxInput.value.trim()){
      if(!confirm('TrxID empty — continue?')) return
    }
    payBtn.disabled = true; payBtn.textContent = `Saving…`
    const client_uuid = (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2)+Date.now()
    const receipt_number = `MEK-${new Date().getFullYear()}-${Math.floor(100000+Math.random()*900000)}`
    let store_id: string | null = null
    let cashier_id: string | null = null
    try{
      const { data: { user } } = await supabase.auth.getUser()
      cashier_id = user?.id || null
      if(user){ const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any; store_id = prof?.store_id || null }
    }catch{}
    const orderPayload: any = {
      store_id: store_id || (isSupabaseConfigured ? null : 'demo-store'),
      cashier_id, receipt_number, subtotal, tax_amount: vat, vat_amount: vat, vat_rate: vatDefault,
      discount_amount: discountAmount, discount_type: dtype, total_amount: total,
      payment_method: selectedPay, is_due: due>0, due_amount: due, mfs_trxid: trxInput.value.trim()||null,
      customer_id: selectedCustomer?.id || null, client_uuid, bin_snapshot: null,
      note: selectedCustomer ? `${selectedCustomer.name} ${selectedCustomer.phone}` : null,
    }
    const itemsPayload = cart.map(c=> ({ product_id: c.product_id, quantity: c.qty, unit_price: c.price, vat_rate: c.vat_rate, vat_amount: Math.round(c.price*c.qty*(c.vat_rate/100)*100)/100, unit_snapshot: c.unit, client_uuid: Math.random().toString(36).slice(2) }))
    let savedOnline = false
    if(isSupabaseConfigured && store_id && navigator.onLine){
      try{
        const { data: orderRow, error: oErr } = await supabase.from('orders').insert(orderPayload).select('id').single() as any
        if(oErr) throw oErr
        const orderId = (orderRow as any).id
        const itemsWithOrder = itemsPayload.map(it=> ({ ...it, order_id: orderId }))
        const { error: iErr } = await supabase.from('order_items').insert(itemsWithOrder as any) as any
        if(iErr) throw iErr
        if(due>0 && selectedCustomer?.id) await supabase.from('khata_entries').insert({ store_id, customer_id: selectedCustomer.id, order_id: orderId, type:'dilam', amount: due, note:`Sale ${receipt_number}`, client_uuid: Math.random().toString(36).slice(2) } as any)
        savedOnline = true
      }catch(e){ console.warn('online save failed, queue', e) }
    }
    if(!savedOnline){
      await enqueue('orders', orderPayload)
      for(const it of itemsPayload) await enqueue('order_items', { ...it, order_id: null, _order_client_uuid: client_uuid })
      if(due>0) await enqueue('khata_entries', { store_id: store_id||'demo-store', customer_id: selectedCustomer?.id||null, type:'dilam', amount: due, note:`Sale ${receipt_number}`, client_uuid: Math.random().toString(36).slice(2) })
      refreshOutbox()
    }
    const receiptEl = document.getElementById('pos-receipt')!
    receiptEl.classList.remove('hidden')
    receiptEl.innerHTML = `
      <div class="text-center font-black text-[13px]">MEKHOLI</div>
      <div class="text-center text-[10px] text-slate-500">${receipt_number} • ${new Date().toLocaleString('en-GB')} • ${selectedCustomer? selectedCustomer.name+' '+selectedCustomer.phone : 'Walk-in'}</div>
      <div class="border-t border-dashed border-slate-300 my-2"></div>
      ${cart.map(c=> `<div class="flex justify-between"><span>${c.name} ${c.qty}${c.unit} × ৳${c.price}</span><span>৳${(c.qty*c.price).toFixed(2)}</span></div>`).join('')}
      <div class="border-t border-dashed border-slate-300 my-2"></div>
      <div class="flex justify-between"><span>Subtotal</span><span>৳${subtotal.toFixed(2)}</span></div>
      <div class="flex justify-between"><span>Discount</span><span>-৳${discountAmount.toFixed(2)}</span></div>
      <div class="flex justify-between"><span>VAT</span><span>৳${vat.toFixed(2)}</span></div>
      <div class="flex justify-between font-black border-t border-slate-200 mt-1 pt-1"><span>TOTAL</span><span>৳${total.toFixed(2)}</span></div>
      <div class="flex justify-between text-emerald-600 font-bold"><span>Paid (${selectedPay})</span><span>৳${paidNow.toFixed(2)}</span></div>
      ${due>0?`<div class="flex justify-between text-red-600 font-black bg-red-50 rounded px-1 py-0.5 mt-1"><span>Due</span><span>৳${due.toFixed(2)}</span></div>`:''}
      <div class="text-center mt-2 text-[10px] text-slate-400">${savedOnline?'Synced':'Queued — will sync when online'}</div>
    `
    ;(window as any).toast?.(savedOnline ? `Saved ৳${total.toFixed(2)}` : `Queued ৳${total.toFixed(2)}`)
    if(due>0 && selectedCustomer && confirm(`Due ৳${due.toFixed(2)} — send SMS?`)){
      const msg = `Assalamu Alaikum, baki ৳${due.toFixed(2)} — ${receipt_number} — Mekholi.`
      window.location.href = `sms:${selectedCustomer.phone}?&body=${encodeURIComponent(msg)}`
    }
    cart=[]; renderCart(); payBtn.disabled=false; payBtn.innerHTML = `<span class="material-symbols-rounded">print</span> Pay — <span id="pos-pay-total">৳0.00</span>`
  })

  loadProducts(); renderCart(); updateTotals()
}
