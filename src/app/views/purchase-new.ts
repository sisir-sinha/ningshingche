import { supabase, isSupabaseConfigured } from '../../core/db/supabase'
import { withBase } from '../../core/utils/base'

export function purchaseNewView(): string {
  return `
  <div class="max-w-[760px] mx-auto w-full px-4 lg:px-6 py-6">
    <div class="flex items-center gap-3">
      <a href="/app/purchases" data-link class="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 grid place-items-center dark:text-white"><span class="material-symbols-rounded">arrow_back</span></a>
      <div><h1 class="text-[18px] font-black dark:text-white">New GRN</h1><p class="text-xs text-slate-500">Adds stock via trigger • Supplier due if not fully paid</p></div>
    </div>
    <form id="pur-form" class="mt-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5 space-y-4">
      <div class="grid sm:grid-cols-2 gap-4">
        <label class="text-sm font-bold dark:text-white">Supplier
          <select id="pur-supplier" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white text-sm"><option value="">Walk-in / None</option></select>
        </label>
        <label class="text-sm font-bold dark:text-white">Receipt No
          <input id="pur-receipt" placeholder="GRN-2026-..." class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white font-mono text-sm" />
        </label>
      </div>
      <div id="pur-items" class="space-y-2"></div>
      <button type="button" id="pur-add-row" class="w-full py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white text-sm font-bold">+ Add row</button>
      <div class="grid sm:grid-cols-3 gap-4">
        <label class="text-sm font-bold dark:text-white">Discount ৳ <input id="pur-disc" type="number" value="0" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white" /></label>
        <label class="text-sm font-bold dark:text-white">Paid ৳ <input id="pur-paid" type="number" value="0" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white" /></label>
        <div class="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
          <div class="text-xs text-slate-500">Total</div><div id="pur-total" class="font-black dark:text-white">৳0.00</div>
        </div>
      </div>
      <button type="submit" class="w-full py-3 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black">Save GRN → Stock +</button>
      <div id="pur-msg" class="hidden text-sm font-semibold"></div>
    </form>
  </div>
  `
}

export async function initPurchaseNew(){
  const itemsEl=document.getElementById('pur-items')!
  const receipt=document.getElementById('pur-receipt') as HTMLInputElement
  receipt.value=`GRN-${new Date().getFullYear()}-${Math.floor(100000+Math.random()*900000)}`
  let products:any[]=[]
  let supplierId=new URLSearchParams(location.search).get('supplier')

  // load suppliers
  if(isSupabaseConfigured){
    try{
      const { data:{ user } }=await supabase.auth.getUser()
      if(user){
        const { data:prof }=await supabase.from('profiles').select('store_id').eq('id',user.id).maybeSingle() as any
        const sid=prof?.store_id
        if(sid){
          const { data: sups }=await supabase.from('suppliers').select('id,name').eq('store_id',sid) as any
          const sel=document.getElementById('pur-supplier') as HTMLSelectElement
          if(sups) sups.forEach((s:any)=> sel.innerHTML+=`<option value="${s.id}" ${s.id===supplierId?'selected':''}>${s.name}</option>`)
          const { data: prods }=await supabase.from('products').select('id,name,unit,cost_price,price').eq('store_id',sid).limit(80) as any
          if(prods) products=prods
        }
      }
    }catch{}
  }
  if(!products.length) products=[{id:'demo-1',name:'Miniket Rice 1kg',unit:'kg',cost_price:65,price:78},{id:'demo-2',name:'Parachute Oil',unit:'pcs',cost_price:150,price:180}]

  function addRow(){
    const row=document.createElement('div')
    row.className='grid grid-cols-[1.4fr_0.5fr_0.5fr_0.3fr] gap-2 items-end bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3'
    row.innerHTML=`
      <label class="text-xs font-bold dark:text-white">Product
        <select class="prod-sel mt-1 w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm dark:text-white">
          ${products.map((p:any)=>`<option value="${p.id}" data-cost="${p.cost_price||p.price}">${p.name}</option>`).join('')}
        </select>
      </label>
      <label class="text-xs font-bold dark:text-white">Qty <input type="number" class="qty mt-1 w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white" value="10" /></label>
      <label class="text-xs font-bold dark:text-white">Cost <input type="number" class="cost mt-1 w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white" value="${products[0]?.cost_price||65}" /></label>
      <button type="button" class="del-row w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 grid place-items-center">×</button>
    `
    itemsEl.appendChild(row)
    row.querySelector('.prod-sel')!.addEventListener('change', (e)=>{
      const opt=(e.target as HTMLSelectElement).selectedOptions[0] as any
      ;(row.querySelector('.cost') as HTMLInputElement).value=opt.dataset.cost
      updateTotal()
    })
    row.querySelectorAll('input').forEach(i=> i.addEventListener('input', updateTotal))
    row.querySelector('.del-row')!.addEventListener('click', ()=>{ row.remove(); updateTotal()})
    updateTotal()
  }
  function updateTotal(){
    let sub=0
    itemsEl.querySelectorAll('.qty').forEach((el,i)=>{
      const qty=parseFloat((el as HTMLInputElement).value)||0
      const costEl=itemsEl.querySelectorAll('.cost')[i] as HTMLInputElement
      const cost=parseFloat(costEl.value)||0
      sub+=qty*cost
    })
    const disc=parseFloat((document.getElementById('pur-disc') as HTMLInputElement).value)||0
    const total=Math.max(0, sub-disc)
    document.getElementById('pur-total')!.textContent=`৳${total.toFixed(2)}`
  }
  document.getElementById('pur-add-row')!.addEventListener('click', addRow)
  document.getElementById('pur-disc')!.addEventListener('input', updateTotal)
  addRow()

  document.getElementById('pur-form')!.addEventListener('submit', async (e)=>{
    e.preventDefault()
    const disc=parseFloat((document.getElementById('pur-disc') as HTMLInputElement).value)||0
    const paid=parseFloat((document.getElementById('pur-paid') as HTMLInputElement).value)||0
    const selSup=(document.getElementById('pur-supplier') as HTMLSelectElement).value||null
    const rows=Array.from(itemsEl.children).map(row=>{
      const sel=row.querySelector('.prod-sel') as HTMLSelectElement
      const qty=row.querySelector('.qty') as HTMLInputElement
      const cost=row.querySelector('.cost') as HTMLInputElement
      return { product_id:sel.value, quantity:parseFloat(qty.value)||0, unit_cost:parseFloat(cost.value)||0 }
    }).filter(r=>r.quantity>0)
    if(!rows.length) return (window as any).toast?.('Add at least one row')
    const btn=(document.querySelector('#pur-form button[type="submit"]') as HTMLButtonElement)
    btn.disabled=true; btn.textContent='Saving…'
    try{
      if(isSupabaseConfigured){
        const { data:{ user } }=await supabase.auth.getUser()
        let sid=null; if(user){ const { data:p }=await supabase.from('profiles').select('store_id').eq('id',user.id).maybeSingle() as any; sid=p?.store_id }
        const sub=rows.reduce((s,r)=>s+r.quantity*r.unit_cost,0)
        const total=sub-disc
        const { data: pur, error }=await supabase.from('purchases').insert({ store_id:sid, supplier_id:selSup, receipt_no:receipt.value, subtotal:sub, discount_amount:disc, total_amount:total, paid_amount:paid } as any).select('id').single() as any
        if(error) throw error
        const pid=(pur as any).id
        for(const r of rows) await supabase.from('purchase_items').insert({ purchase_id:pid, product_id:r.product_id, quantity:r.quantity, unit_cost:r.unit_cost } as any)
        if(total-paid>0 && selSup){
          await supabase.from('khata_entries').insert({ store_id:sid, supplier_id:selSup, type:'dilam', amount: total-paid, note:`GRN ${receipt.value}`, client_uuid:Math.random().toString(36).slice(2)} as any)
        }
      } else {
        const arr=JSON.parse(localStorage.getItem('demo-purchases')||'[]')
        const total=rows.reduce((s,r)=>s+r.quantity*r.unit_cost,0)-disc
        arr.push({id:'d'+Date.now(), receipt_no:receipt.value, subtotal:total+disc, total_amount:total, paid_amount:paid, suppliers:{name: selSup||'Walk-in'}, created_at:new Date().toISOString()})
        localStorage.setItem('demo-purchases', JSON.stringify(arr))
      }
      ;(window as any).toast?.('GRN saved — stock +'); location.href = withBase('/app/purchases')
    }catch(err:any){ (document.getElementById('pur-msg') as HTMLElement).textContent=err.message; (document.getElementById('pur-msg') as HTMLElement).classList.remove('hidden'); btn.disabled=false; btn.textContent='Save GRN → Stock +' }
  })
}