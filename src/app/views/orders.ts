import { supabase, isSupabaseConfigured } from '../../core/db/supabase'
import { showPrompt } from '../../core/components/modal'

export function ordersView(): string {
  return `
  <div class="max-w-[1280px] mx-auto w-full px-4 lg:px-6 py-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-[18px] font-black dark:text-white">Orders</h1>
        <p class="text-xs text-slate-500 dark:text-slate-400">Receipts • Mushak 6.3 reprint • Returns</p>
      </div>
      <a href="/app/pos" data-link class="inline-flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2.5 rounded-full text-sm font-bold"><span class="material-symbols-rounded text-[18px]">point_of_sale</span> New Sale</a>
    </div>

    <!-- stats -->
    <div class="mt-4 grid grid-cols-3 gap-3">
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 text-center">
        <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">ORDERS TODAY</div>
        <div id="ord-count" class="font-black text-lg dark:text-white">0</div>
      </div>
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 text-center">
        <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">TOTAL SALES</div>
        <div id="ord-total" class="font-black text-lg dark:text-white">৳0.00</div>
      </div>
      <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-3 text-center">
        <div class="text-xs font-bold tracking-widest text-amber-700 dark:text-amber-300">DUE ORDERS</div>
        <div id="ord-due" class="font-black text-lg text-amber-700 dark:text-amber-300">0</div>
      </div>
    </div>

    <!-- filters -->
    <div class="mt-4 flex flex-wrap gap-2 items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-3">
      <div class="relative flex-1 min-w-[180px]">
        <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
        <input id="ord-search" placeholder="Receipt / customer phone" class="w-full pl-9 pr-3 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm dark:text-white outline-none" />
      </div>
      <select id="ord-filter-pay" class="px-3 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white">
        <option value="">All payments</option><option value="cash">Cash</option><option value="bkash">bKash</option><option value="card">Card</option><option value="due">Due</option><option value="split">Split</option>
      </select>
      <button id="ord-export" class="px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold dark:text-white hover:bg-slate-50">Export CSV</button>
    </div>

    <!-- list -->
    <div class="mt-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] overflow-hidden">
      <div class="hidden sm:grid grid-cols-[1.2fr_0.7fr_0.7fr_0.6fr_0.5fr_0.4fr] gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">
        <div>RECEIPT</div><div>TOTAL</div><div>PAYMENT</div><div>DUE</div><div>DATE</div><div></div>
      </div>
      <div id="ord-list" class="divide-y divide-slate-100 dark:divide-slate-800"></div>
      <div id="ord-empty" class="hidden text-center py-10 text-sm text-slate-500">No orders yet — sell from POS</div>
    </div>
  </div>

  <!-- detail modal -->
  <div id="ord-modal" class="fixed inset-0 z-50 hidden">
    <div id="ord-backdrop" class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"></div>
    <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(640px,92vw)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] shadow-xl max-h-[85vh] overflow-auto p-5">
      <div class="flex items-start justify-between gap-3">
        <div><div id="ord-d-receipt" class="font-mono font-black dark:text-white"></div><div id="ord-d-date" class="text-xs text-slate-500"></div></div>
        <button id="ord-close" class="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 grid place-items-center dark:text-white">×</button>
      </div>
      <div id="ord-d-items" class="mt-4 divide-y divide-slate-100 dark:divide-slate-800"></div>
      <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div class="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3"><div class="text-xs text-slate-500">Subtotal</div><div id="ord-d-sub" class="font-black dark:text-white"></div></div>
        <div class="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3"><div class="text-xs text-slate-500">Total</div><div id="ord-d-total" class="font-black dark:text-white"></div></div>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button id="ord-reprint" class="flex-1 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black"><span class="material-symbols-rounded text-[16px]">print</span> Reprint Mushak 6.3</button>
        <button id="ord-return" class="flex-1 py-2.5 rounded-full border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm font-bold">Return / Refund</button>
      </div>
      <div id="ord-d-msg" class="hidden mt-3 text-xs font-semibold"></div>
    </div>
  </div>
  `
}

type Ord = { id:string; receipt_number:string; total_amount:number; subtotal:number; payment_method:string; is_due:boolean; due_amount:number; created_at:string; customer_id?:string }

export async function initOrders(){
  const list=document.getElementById('ord-list')!
  const empty=document.getElementById('ord-empty')!
  const search=document.getElementById('ord-search') as HTMLInputElement
  const pay=document.getElementById('ord-filter-pay') as HTMLSelectElement
  let all:Ord[]=[]
  let selected:Ord|null=null

  async function load(){
    list.innerHTML=`<div class="text-sm text-slate-500 py-6 text-center">Loading…</div>`
    let rows:Ord[]=[]
    if(isSupabaseConfigured){
      try{
        const { data:{ user } }=await supabase.auth.getUser()
        if(user){
          const { data:prof }=await supabase.from('profiles').select('store_id').eq('id',user.id).maybeSingle() as any
          const sid=prof?.store_id
          if(sid){
            const { data }=await supabase.from('orders').select('id,receipt_number,subtotal,total_amount,payment_method,is_due,due_amount,created_at').eq('store_id',sid).order('created_at',{ascending:false}).limit(60) as any
            if(data) rows=data
          }
        }
      }catch{}
    }
    if(!rows.length){
      rows=JSON.parse(localStorage.getItem('demo-orders')||'null') || [
        { id:'o1', receipt_number:'MK-20260923-001', subtotal:380, total_amount:399, payment_method:'cash', is_due:false, due_amount:0, created_at:new Date().toISOString() },
        { id:'o2', receipt_number:'MK-20260923-002', subtotal:550, total_amount:578, payment_method:'bkash', is_due:true, due_amount:200, created_at:new Date(Date.now()-3600000*5).toISOString() },
        { id:'o3', receipt_number:'MK-20260922-009', subtotal:120, total_amount:126, payment_method:'due', is_due:true, due_amount:126, created_at:new Date(Date.now()-86400000).toISOString() },
      ]
    }
    all=rows
    render()
  }

  function render(){
    let rows=[...all]
    const q=search.value.trim().toLowerCase()
    if(q) rows=rows.filter(r=> r.receipt_number.toLowerCase().includes(q))
    if(pay.value) rows=rows.filter(r=> r.payment_method===pay.value)
    // stats today
    const todayStart=new Date(); todayStart.setHours(0,0,0,0)
    const today=rows.filter(r=> new Date(r.created_at)>=todayStart)
    document.getElementById('ord-count')!.textContent=String(today.length)
    document.getElementById('ord-total')!.textContent=`৳${today.reduce((s,r)=>s+Number(r.total_amount||0),0).toFixed(2)}`
    document.getElementById('ord-due')!.textContent=String(rows.filter(r=> r.is_due).length)

    if(!rows.length){ list.innerHTML=''; empty.classList.remove('hidden'); return }
    empty.classList.add('hidden')
    list.innerHTML=rows.map(r=>`
      <div data-ord="${r.id}" class="grid sm:grid-cols-[1.2fr_0.7fr_0.7fr_0.6fr_0.5fr_0.4fr] gap-2 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
        <div><div class="font-mono font-bold text-sm dark:text-white">${r.receipt_number}</div><div class="text-xs text-slate-500">${r.customer_id||'Walk-in'}</div></div>
        <div class="font-black text-sm dark:text-white">৳${Number(r.total_amount).toFixed(2)}</div>
        <div><span class="px-2 py-1 rounded-full text-xs font-bold border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-white">${r.payment_method}</span></div>
        <div>${r.is_due?`<span class="px-2 py-1 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700">৳${Number(r.due_amount).toFixed(0)}</span>`:`<span class="text-xs text-emerald-600 font-bold">Paid</span>`}</div>
        <div class="text-xs text-slate-500">${new Date(r.created_at).toLocaleDateString('en-GB')} ${new Date(r.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
        <div class="flex justify-end"><span class="material-symbols-rounded text-[18px] text-slate-400">chevron_right</span></div>
      </div>
    `).join('')
    list.querySelectorAll('[data-ord]').forEach(el=> el.addEventListener('click', ()=> open((el as HTMLElement).dataset.ord!)))
  }

  async function open(id:string){
    const o=all.find(x=>x.id===id); if(!o) return
    selected=o
    const modal=document.getElementById('ord-modal')!
    document.getElementById('ord-d-receipt')!.textContent=o.receipt_number
    document.getElementById('ord-d-date')!.textContent=new Date(o.created_at).toLocaleString('en-GB') + ` • ${o.payment_method} • ${o.is_due?'Due ৳'+o.due_amount:'Paid'}`
    document.getElementById('ord-d-sub')!.textContent=`৳${Number(o.subtotal).toFixed(2)}`
    document.getElementById('ord-d-total')!.textContent=`৳${Number(o.total_amount).toFixed(2)}`
    const itemsEl=document.getElementById('ord-d-items')!
    itemsEl.innerHTML=`<div class="py-3 text-sm text-slate-500">Loading items…</div>`
    let items:any[]=[]
    if(isSupabaseConfigured){
      try{
        const { data }=await supabase.from('order_items').select('quantity,unit_price,vat_rate,product_id,products(name)').eq('order_id',o.id) as any
        if(data) items=data.map((it:any)=> ({ name: it.products?.name || it.product_id, qty: it.quantity, price: it.unit_price, vat: it.vat_rate }))
      }catch{}
    }
    if(!items.length){
      try{
        const di=JSON.parse(localStorage.getItem('demo-order-items')||'{}')
        if(di[o.id]) items=di[o.id]
      }catch{}
    }
    if(!items.length) items=[{ name:'Miniket Rice 1kg', qty:2, price:78 }, { name:'Parachute Oil', qty:1, price:180 }]
    itemsEl.innerHTML=items.map((it:any)=>`
      <div class="flex justify-between py-2 text-sm"><div><span class="font-bold dark:text-white">${it.name}</span> <span class="text-slate-500">× ${it.qty}</span></div><div class="font-bold dark:text-white">৳${(it.qty*it.price).toFixed(2)}</div></div>
    `).join('')
    modal.classList.remove('hidden'); document.body.style.overflow='hidden'
  }

  function close(){ document.getElementById('ord-modal')!.classList.add('hidden'); document.body.style.overflow='' }
  document.getElementById('ord-close')!.addEventListener('click', close)
  document.getElementById('ord-backdrop')!.addEventListener('click', close)

  document.getElementById('ord-reprint')!.addEventListener('click', ()=>{
    if(!selected) return
    // reuse pos receipt print if available, fallback window.print with Mushak 6.3
    const w=window.open('','_blank','width=320,height=640')
    if(!w) return (window as any).toast?.('Popup blocked')
    w.document.write(`<html><head><title>${selected.receipt_number} — Mushak 6.3</title><style>body{font-family:monospace;font-size:12px;padding:12px} .c{text-align:center} .r{text-align:right} hr{border:none;border-top:1px dashed #000;margin:6px 0}</style></head><body>
      <div class="c"><b>Mekholi Store</b><br>BIN: 1234567890123<br>Mushak 6.3 — Tax Invoice</div><hr>
      <div>Receipt: ${selected.receipt_number}<br>Date: ${new Date(selected.created_at).toLocaleString('en-GB')}<br>Payment: ${selected.payment_method}</div><hr>
      <div id="items"></div><hr>
      <div class="r">Total: ৳${Number(selected.total_amount).toFixed(2)}${selected.is_due?`<br>Due: ৳${selected.due_amount}`:''}</div>
      <div class="c" style="margin-top:8px">Thank you — visit again</div>
      <script>window.print();<\/script>
    </body></html>`)
    w.document.close()
    ;(window as any).toast?.('Reprint opened')
  })

  document.getElementById('ord-return')!.addEventListener('click', async ()=>{
    if(!selected) return
    const cur = selected
    const amtStr=await showPrompt({ title:'Refund amount', message:`Refund for ${cur.receipt_number} (max ৳${cur.total_amount})`, placeholder:String(cur.total_amount), defaultValue:String(cur.total_amount), inputType:'number', required:true, validator: vv=> { const n=parseFloat(vv); if(!n||n<=0) return 'Enter valid amount'; if(n> Number(cur.total_amount)) return `Max is ৳${cur.total_amount}`; return null } })
    if(!amtStr) return
    const amt=parseFloat(amtStr); if(!amt || amt<=0) return
    try{
      if(isSupabaseConfigured){
        const { data:{ user } }=await supabase.auth.getUser()
        let sid=null; if(user){ const { data:p }=await supabase.from('profiles').select('store_id').eq('id',user.id).maybeSingle() as any; sid=p?.store_id }
        await supabase.from('returns').insert({ store_id:sid, order_id:cur.id, refund_amount:amt, reason:'POS return', refund_method:'cash' } as any)
      } else {
        const arr=JSON.parse(localStorage.getItem('demo-returns')||'[]')
        arr.push({ id:'r'+Date.now(), order_id:cur.id, refund_amount:amt, created_at:new Date().toISOString() })
        localStorage.setItem('demo-returns', JSON.stringify(arr))
      }
      document.getElementById('ord-d-msg')!.textContent=`Refund ৳${amt.toFixed(2)} saved ✓`
      document.getElementById('ord-d-msg')!.className='mt-3 text-xs font-bold text-emerald-600'
      document.getElementById('ord-d-msg')!.classList.remove('hidden')
      ;(window as any).toast?.(`Refunded ৳${amt.toFixed(2)}`)
    }catch(e:any){
      document.getElementById('ord-d-msg')!.textContent=e.message
      document.getElementById('ord-d-msg')!.className='mt-3 text-xs font-bold text-red-600'
      document.getElementById('ord-d-msg')!.classList.remove('hidden')
    }
  })

  search.addEventListener('input', render)
  pay.addEventListener('change', render)
  document.getElementById('ord-export')!.addEventListener('click', ()=>{
    let rows=[...all]
    const q=search.value.trim().toLowerCase()
    if(q) rows=rows.filter(r=> r.receipt_number.toLowerCase().includes(q))
    if(pay.value) rows=rows.filter(r=> r.payment_method===pay.value)
    const csv=['receipt,total,payment,due,date', ...rows.map(r=> `${r.receipt_number},${r.total_amount},${r.payment_method},${r.due_amount||0},"${new Date(r.created_at).toLocaleString('en-GB')}"`)].join('\n')
    const blob=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`orders-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  })

  await load()
}
