import { supabase, isSupabaseConfigured } from '../../core/db/supabase'
import { enqueue, getOutboxCount } from '../../core/db/idb'
import { calcTotals, type CartItem } from '../../core/services/billing'
import { showConfirm, showPrompt } from '../../core/components/modal'
import { getLang, setLang, t, tPay } from '../../core/i18n'

type Product = { id:string; name:string; barcode:string|null; sku:string|null; price:number; cost_price:number|null; stock_quantity:number; unit:string; vat_rate:number; is_loose:boolean }

const DEMO_PRODUCTS: Product[] = [
  { id:'demo-1', name:'Miniket Rice 1kg', barcode:'890100001', sku:'RICE-MIN-1', price:78, cost_price:65, stock_quantity: 40, unit:'kg', vat_rate:0, is_loose:true },
  { id:'demo-2', name:'Parachute Oil 200ml', barcode:'890103002', sku:'OIL-PAR-200', price:180, cost_price:150, stock_quantity: 18, unit:'pcs', vat_rate:5, is_loose:false },
  { id:'demo-3', name:'Fresh Sugar 1kg', barcode:'890100003', sku:'SUG-1', price:120, cost_price:105, stock_quantity: 25, unit:'kg', vat_rate:0, is_loose:true },
  { id:'demo-4', name:'Lux Soap', barcode:'890103004', sku:'LUX-1', price:55, cost_price:40, stock_quantity: 60, unit:'pcs', vat_rate:5, is_loose:false },
  { id:'demo-5', name:'Potato 1kg', barcode:null, sku:null, price:45, cost_price:35, stock_quantity: 100, unit:'kg', vat_rate:0, is_loose:true },
  { id:'demo-6', name:'Dettol Handwash', barcode:'890101005', sku:'DETTOL-250', price:95, cost_price:75, stock_quantity: 22, unit:'pcs', vat_rate:15, is_loose:false },
  { id:'demo-7', name:'Coca Cola 1L', barcode:'890101006', sku:'COKE-1L', price:60, cost_price:50, stock_quantity: 48, unit:'pcs', vat_rate:15, is_loose:false },
  { id:'demo-8', name:'Onion 1kg', barcode:null, sku:null, price:65, cost_price:50, stock_quantity: 30, unit:'kg', vat_rate:0, is_loose:true },
]

export default function posView(): string {
  return `
  <div class="max-w-[1420px] mx-auto w-full px-3 lg:px-4 py-3">
    <!-- Shortcuts bar — rich POS -->
    <div class="hidden lg:flex items-center gap-2 text-[11px] font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full px-3 py-2 mb-3 shadow-sm">
      <span class="hidden xl:inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><span class="w-5 h-5 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center text-[10px]">F2</span> ${t('pos.new')}</span>
      <span class="hidden xl:inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><span class="w-5 h-5 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center text-[10px]">F4</span> ${t('pos.hold')}</span>
      <span class="hidden xl:inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><span class="w-5 h-5 rounded bg-emerald-600 text-white grid place-items-center text-[10px]">F8</span> ${t('pos.pay')}</span>
      <span class="hidden xl:inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><span class="w-5 h-5 rounded bg-sky-600 text-white grid place-items-center text-[10px]">F9</span> ${t('pos.customer')}</span>
      <span class="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">• <span class="material-symbols-rounded text-[14px]">keyboard</span> ${t('pos.shortcutsHint')}</span>
      <div class="ml-auto flex items-center gap-2">
        <span id="outbox-badge" class="hidden text-xs font-bold bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-full"></span>
        <button id="pos-lang" class="hidden sm:inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white"><span class="material-symbols-rounded text-[14px]">language</span> <span id="pos-lang-label">${getLang()==='bn'?'EN':'বাংলা'}</span></button>
        <span id="pos-store" class="text-xs text-slate-500 dark:text-slate-400"></span>
        <button id="pos-clear" class="text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-full hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white">${t('pos.clear')} (Esc)</button>
        <button id="pos-drawer-btn" class="text-xs font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-full hover:bg-black dark:hover:bg-slate-100"><span class="material-symbols-rounded text-[14px]">point_of_sale</span> ${t('pos.drawer')}</button>
      </div>
    </div>

    <div class="grid lg:grid-cols-[1.15fr_0.85fr] gap-3 items-start">
      <!-- LEFT -->
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-3 sm:p-4">
        <div class="flex gap-2">
          <div class="flex-1 relative">
            <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
            <input id="pos-search" placeholder="${t('pos.searchPlaceholder')}" class="w-full pl-9 pr-10 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 outline-none text-sm dark:text-white focus:border-slate-900 dark:focus:border-slate-600" autocomplete="off" />
            <button id="pos-scan" class="absolute right-1 top-1 bottom-1 w-9 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center hover:bg-black dark:hover:bg-slate-100"><span class="material-symbols-rounded text-[18px]">barcode_scanner</span></button>
          </div>
          <select id="pos-cat" class="hidden sm:block px-3 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white">
            <option value="">${t('pos.all')}</option><option value="grocery">${t('pos.grocery')}</option><option value="pcs">${t('pos.pcs')}</option><option value="loose">${t('pos.loose')}</option>
          </select>
        </div>

        <!-- quick discounts -->
        <div class="mt-3 flex flex-wrap gap-2">
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400 py-1.5">${t('pos.quick')}</span>
          ${[5,10,15].map(p=>`<button data-qd="${p}" class="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold dark:text-white hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-slate-900">${p}%</button>`).join('')}
          <button id="qd-clear" class="px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold dark:text-white">${t('pos.clearShort')}</button>
          <span class="ml-auto hidden sm:inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><span class="material-symbols-rounded text-[14px]">info</span> ${t('pos.lowHint')}</span>
        </div>

        <div id="pos-products" class="mt-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 max-h-[52vh] lg:max-h-[62vh] overflow-auto pr-1"></div>

        <!-- Numpad -->
        <div class="mt-4 lg:hidden grid grid-cols-4 gap-2">
          ${[7,8,9,'⌫',4,5,6,'C',1,2,3,'00',0,'.','+','-'].map(k=>`<button data-numpad="${k}" class="py-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold dark:text-white">${k}</button>`).join('')}
        </div>
      </div>

      <!-- RIGHT -->
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-3 sm:p-4 flex flex-col lg:sticky lg:top-[12px] max-h-[calc(100vh-16px)] lg:overflow-auto">
        <!-- Customer -->
        <div class="flex gap-2">
          <div class="flex-1 relative">
            <span class="material-symbols-rounded absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">person</span>
            <input id="pos-customer" placeholder="${t('pos.customerPlaceholder')}" class="w-full pl-9 pr-3 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white focus:border-slate-900" inputmode="numeric" />
            <div id="pos-customer-list" class="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl hidden max-h-48 overflow-auto z-20"></div>
          </div>
          <button id="pos-add-customer" class="shrink-0 w-10 h-10 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 grid place-items-center hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white"><span class="material-symbols-rounded text-[18px]">person_add</span></button>
        </div>
        <div id="pos-customer-chip" class="hidden mt-2 inline-flex items-center gap-2 text-xs font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-full w-fit"></div>
        <div id="pos-due-warning" class="hidden mt-2 text-xs font-bold bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 rounded-xl"></div>

        <!-- Cart header + holds -->
        <div class="mt-4 flex items-center justify-between">
          <div class="text-xs font-extrabold tracking-widest text-slate-500 dark:text-slate-400">${t('pos.cart')} • <span id="cart-count">0</span></div>
          <div class="flex items-center gap-2">
            <button id="pos-hold" class="text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-full hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white">${t('pos.hold')} (F4)</button>
            <button id="pos-held-view" class="hidden text-xs font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-full">Held <span id="pos-held-badge">0</span></button>
          </div>
        </div>
        <div id="pos-held-list" class="hidden mt-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-2 max-h-32 overflow-auto space-y-1"></div>

        <div id="pos-cart" class="mt-2 space-y-2 min-h-[140px] max-h-[28vh] overflow-auto pr-1">
          <div class="text-sm text-slate-500 dark:text-slate-400 py-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">Cart empty — scan or tap • +/- qty • per-item discount</div>
        </div>

        <!-- Per-item tip -->
        <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">${t('pos.cartHint')}</div>

        <!-- Discount / VAT / Numpad desktop -->
        <div class="mt-3 grid grid-cols-2 gap-2">
          <label class="text-xs font-bold text-slate-600 dark:text-slate-400">${t('pos.discount')}
            <div class="mt-1 flex">
              <input id="pos-discount" type="number" value="0" min="0" step="0.01" class="flex-1 px-3 py-2 rounded-l-full border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
              <select id="pos-discount-type" class="px-3 py-2 rounded-r-full border-y border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold dark:text-white">
                <option value="amount">৳</option><option value="percent">%</option>
              </select>
            </div>
          </label>
          <label class="text-xs font-bold text-slate-600 dark:text-slate-400">${t('pos.vatProfile')}
            <select id="pos-vat-profile" class="mt-1 w-full px-3 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white">
              <option value="0">0%</option><option value="5">5%</option><option value="7.5">7.5%</option><option value="10">10%</option><option value="15" selected>15%</option>
            </select>
          </label>
        </div>

        <!-- Desktop numpad -->
        <div class="hidden lg:grid mt-3 grid-cols-4 gap-1.5">
          ${[7,8,9,'⌫',4,5,6,'C',1,2,3,'00',0,'.','+','-'].map(k=>`<button data-numpad="${k}" class="py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-sm dark:text-white hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-slate-900">${k}</button>`).join('')}
        </div>

        <!-- Totals -->
        <div class="mt-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-3">
          <div class="flex justify-between text-sm dark:text-white"><span class="text-slate-500 dark:text-slate-400">${t('pos.subtotal')}</span><span id="pos-sub" class="font-bold">৳0.00</span></div>
          <div class="flex justify-between text-sm dark:text-white"><span class="text-slate-500 dark:text-slate-400">${t('pos.discountLabel')}</span><span id="pos-disc" class="font-bold text-emerald-600">-৳0.00</span></div>
          <div class="flex justify-between text-sm dark:text-white"><span class="text-slate-500 dark:text-slate-400">${t('pos.vatLabel')}</span><span id="pos-vat" class="font-bold">৳0.00</span></div>
          <div class="flex justify-between font-black text-[18px] mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 dark:text-white"><span>${t('pos.total')}</span><span id="pos-total">৳0.00</span></div>
          <div id="pos-due-row" class="hidden mt-2 flex justify-between text-sm font-black text-red-600 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 rounded-full px-3 py-1.5"><span>${t('pos.due')}</span><span id="pos-due">৳0.00</span></div>
        </div>

        <!-- Split payment -->
        <div class="mt-3">
          <div class="flex items-center justify-between">
            <div class="text-xs font-extrabold tracking-widest text-slate-500 dark:text-slate-400">${t('pos.splitAllowed')}</div>
            <button id="pos-split-toggle" class="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900">Split: OFF</button>
          </div>
          <div id="pos-pay-grid" class="mt-2 grid grid-cols-4 gap-2">
            ${['cash','bkash','nagad','rocket','upay','bangla_qr','card','due'].map(m=>`<button data-pay="${m}" class="pay-btn px-2 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold capitalize hover:border-slate-900 dark:hover:border-white dark:text-white ${m==='cash'?'!bg-slate-900 !text-white !border-slate-900 dark:!bg-white dark:!text-slate-900':''}">${tPay(m)}</button>`).join('')}
          </div>
          <div id="pos-split-panel" class="hidden mt-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-2xl p-3 space-y-2">
            <div class="text-xs font-bold text-amber-700 dark:text-amber-300">Split — enter amounts (must sum to total)</div>
            <div id="pos-split-rows" class="space-y-2"></div>
            <div class="flex gap-2">
              <select id="pos-split-method" class="px-3 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs dark:text-white"><option value="cash">Cash</option><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="card">Card</option><option value="due">Due</option></select>
              <input id="pos-split-amount" type="number" placeholder="Amount" class="flex-1 px-3 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white" />
              <button id="pos-split-add" class="px-4 py-2 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold">Add</button>
            </div>
            <div class="text-xs font-bold">Sum: <span id="pos-split-sum">৳0.00</span> / <span id="pos-split-total">৳0.00</span> <span id="pos-split-status" class="ml-2 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">Need ৳0.00</span></div>
          </div>
          <div id="pos-mfs-row" class="hidden mt-3">
            <label class="text-xs font-bold text-slate-600 dark:text-slate-400">${t('pos.mfsTrx')}</label>
            <input id="pos-trxid" placeholder="${t('pos.mfsTrxPh')}" class="mt-1 w-full px-3 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" maxlength="12" />
          </div>
          <div id="pos-paid-row" class="hidden mt-3">
            <label class="text-xs font-bold text-slate-600 dark:text-slate-400">${t('pos.paidNow')}</label>
            <input id="pos-paid" type="number" value="0" min="0" placeholder="${t('pos.paidNowPh')}" class="mt-1 w-full px-3 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
          </div>
        </div>

        <button id="pos-pay" class="mt-4 w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-full py-3.5 font-black text-[15px] flex items-center justify-center gap-2 hover:bg-black dark:hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
          <span class="material-symbols-rounded">print</span><span data-i18n-pay>${t('pos.payBtn')}</span> <span id="pos-pay-total">৳0.00</span>
        </button>
        <div class="mt-2 flex gap-2">
          <button id="pos-return-btn" class="flex-1 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold dark:text-white hover:bg-amber-50 dark:hover:bg-amber-900/20">${t('pos.return')}</button>
          <button id="pos-print-last" class="flex-1 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold dark:text-white">${t('pos.printLast')}</button>
        </div>
        <div id="pos-receipt" class="hidden mt-4"></div>
      </div>
    </div>
  </div>

  <!-- Item edit modal -->
  <div id="pos-item-modal" class="hidden fixed inset-0 z-50">
    <div id="pos-item-backdrop" class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"></div>
    <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[380px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[20px] p-5 shadow-xl">
      <h3 class="font-black dark:text-white">${t('pos.editItem')}</h3>
      <p id="pos-item-name" class="text-sm text-slate-500 dark:text-slate-400"></p>
      <div class="mt-4 space-y-3">
        <label class="text-xs font-bold dark:text-slate-300">${t('pos.price')} <input id="pos-item-price" type="number" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white" /></label>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-xs font-bold dark:text-slate-300">${t('pos.qty')} <input id="pos-item-qty" type="number" step="0.5" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white" /></label>
          <label class="text-xs font-bold dark:text-slate-300">${t('pos.vat')} <input id="pos-item-vat" type="number" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white" /></label>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-xs font-bold dark:text-slate-300">${t('pos.discAmt')} <input id="pos-item-disc-amt" type="number" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white" /></label>
          <label class="text-xs font-bold dark:text-slate-300">${t('pos.discPct')} <input id="pos-item-disc-pct" type="number" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white" /></label>
        </div>
      </div>
      <div class="mt-5 flex gap-2">
        <button id="pos-item-cancel" class="flex-1 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold dark:text-white">${t('pos.cancel')}</button>
        <button id="pos-item-save" class="flex-1 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold">${t('pos.save')}</button>
      </div>
    </div>
  </div>
  `
}

type Held = { id:string; name:string; at:number; cart: CartItem[]; customer:any }

export function initPos() {
  const grid = document.getElementById('pos-products')!
  const cartEl = document.getElementById('pos-cart')!
  const search = document.getElementById('pos-search') as HTMLInputElement
  const catSel = document.getElementById('pos-cat') as HTMLSelectElement
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
  const dueWarn = document.getElementById('pos-due-warning')!
  const clearBtn = document.getElementById('pos-clear') as HTMLButtonElement
  const holdBtn = document.getElementById('pos-hold') as HTMLButtonElement
  const heldView = document.getElementById('pos-held-view')!
  const heldBadge = document.getElementById('pos-held-badge')!
  const heldList = document.getElementById('pos-held-list')!
  const outboxBadge = document.getElementById('outbox-badge')!
  const storeEl = document.getElementById('pos-store')!
  const cartCountEl = document.getElementById('cart-count')!

  // split
  const splitToggle = document.getElementById('pos-split-toggle')!
  const splitPanel = document.getElementById('pos-split-panel')!
  const splitRows = document.getElementById('pos-split-rows')!
  const splitMethod = document.getElementById('pos-split-method') as HTMLSelectElement
  const splitAmount = document.getElementById('pos-split-amount') as HTMLInputElement
  const splitAdd = document.getElementById('pos-split-add')!
  const splitSumEl = document.getElementById('pos-split-sum')!
  const splitTotalEl = document.getElementById('pos-split-total')!
  const splitStatus = document.getElementById('pos-split-status')!

  let products: Product[] = [...DEMO_PRODUCTS]
  let cart: (CartItem & { disc_amt?:number; disc_pct?:number })[] = []
  let selectedPay: string = 'cash'
  let splitOn = false
  let splitPayments: { method:string; amount:number }[] = []
  let selectedCustomer: { id:string|null; name:string; phone:string; due_balance?:number } | null = null
  let storeInfo: { name?:string; address?:string; phone?:string; bin?:string } | null = null
  let heldCarts: Held[] = JSON.parse(localStorage.getItem('pos-held-v2') || '[]')
  // migrate old
  if(!heldCarts.length){
    try{ const old: any = JSON.parse(localStorage.getItem('pos-held')||'[]'); if(Array.isArray(old) && old.length && Array.isArray(old[0])){ heldCarts = old.map((c:any,i:number)=>({id:'h'+i,name:'Hold '+(i+1),at:Date.now(),cart:c,customer:null})); localStorage.setItem('pos-held-v2', JSON.stringify(heldCarts)) } }catch{}
  }
  let editingId: string | null = null

  function beep(ok=true){
    try{
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type='square'; o.frequency.value = ok ? 880 : 220
      o.connect(g); g.connect(ctx.destination); g.gain.value=0.15
      o.start(); setTimeout(()=>{o.stop(); ctx.close()}, ok?120:300)
    }catch{}
  }

  function updateHeldUI(){
    const n = heldCarts.length
    if(n){ heldView.classList.remove('hidden'); heldBadge.textContent=String(n) } else { heldView.classList.add('hidden'); heldList.classList.add('hidden') }
    heldList.innerHTML = heldCarts.map(h=>`
      <div class="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
        <div><div class="text-sm font-bold dark:text-white">${h.name}</div><div class="text-xs text-slate-500">${new Date(h.at).toLocaleTimeString()} • ${h.cart.length} items • ${h.customer? h.customer.name : 'Walk-in'}</div></div>
        <div class="flex gap-1">
          <button data-resume="${h.id}" class="px-2 py-1 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold">Resume</button>
          <button data-delhold="${h.id}" class="w-7 h-7 rounded-full border border-slate-200 dark:border-slate-700 grid place-items-center">×</button>
        </div>
      </div>
    `).join('')
    heldList.querySelectorAll('[data-resume]').forEach(b=> b.addEventListener('click', ()=>{
      const id=(b as HTMLElement).dataset.resume!
      const h=heldCarts.find(x=>x.id===id)!; if(cart.length){ heldCarts.push({id:'h'+Date.now(), name:'Hold '+(heldCarts.length+1), at:Date.now(), cart:[...cart], customer:selectedCustomer }); }
      cart = h.cart as any; selectedCustomer = h.customer; if(selectedCustomer){ customerChip.textContent=`${selectedCustomer.name} • ${selectedCustomer.phone}`; customerChip.classList.remove('hidden'); customerInput.value=selectedCustomer.phone } 
      heldCarts = heldCarts.filter(x=>x.id!==id); persistHeld(); renderCart(); updateHeldUI(); (window as any).toast?.('Resumed '+h.name)
    }))
    heldList.querySelectorAll('[data-delhold]').forEach(b=> b.addEventListener('click', ()=>{ heldCarts = heldCarts.filter(x=>x.id!==(b as HTMLElement).dataset.delhold!); persistHeld(); updateHeldUI() }))
  }
  function persistHeld(){ localStorage.setItem('pos-held-v2', JSON.stringify(heldCarts)); updateHeldUI() }
  updateHeldUI()
  heldView.addEventListener('click', ()=> heldList.classList.toggle('hidden'))

  async function refreshOutbox() {
    const n = await getOutboxCount().catch(()=>0)
    if(n>0){ outboxBadge.textContent = `${n} pending`; outboxBadge.classList.remove('hidden') } else outboxBadge.classList.add('hidden')
  }
  refreshOutbox(); setInterval(refreshOutbox, 3000)

  // POS language toggle — mirrors Settings, instant
  const posLangBtn = document.getElementById('pos-lang') as HTMLButtonElement | null
  const posLangLabel = document.getElementById('pos-lang-label') as HTMLElement | null
  function syncPosLangUI(){
    if(posLangLabel) posLangLabel.textContent = getLang()==='bn' ? 'EN' : 'বাংলা'
  }
  syncPosLangUI()
  posLangBtn?.addEventListener('click', ()=>{
    const next = getLang()==='bn' ? 'en' : 'bn'
    setLang(next as any)
    syncPosLangUI()
    ;(window as any).toast?.(next==='bn' ? 'ভাষা: বাংলা ✓ — পুনরায় লোড হচ্ছে' : 'Language: English ✓ — reloading')
    setTimeout(()=> location.reload(), 350)
  })
  window.addEventListener('mk:lang', ()=> syncPosLangUI())


  ;(async()=>{
    if(isSupabaseConfigured){
      try{
        const { data:{ user } } = await supabase.auth.getUser()
        if(user){
          const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
          if(prof?.store_id){
            const { data: store } = await supabase.from('stores').select('name,address,phone,bin').eq('id', prof.store_id).maybeSingle() as any
            if(store){ storeInfo = store as any; if(store?.name && storeEl) { storeEl.textContent = `• ${store.name}`; storeEl.classList.remove('hidden') } }
          }
        }
      }catch{}
    } else {
      // demo store fallback
      storeInfo = { name:'MEKHOLI Mart', address:'Sylhet Road • Sylhet, BD', phone:'01700-000000', bin:'000000000-0000' }
    }
  })()

  async function loadProducts(q = '') {
    const cat = (catSel?.value||'')
    let list = products
    if(q) list = filterLocal(q)
    else list = [...DEMO_PRODUCTS]
    if(cat==='loose') list = list.filter(p=>p.is_loose)
    if(cat==='pcs') list = list.filter(p=>!p.is_loose)
    if (!isSupabaseConfigured) { renderProducts(list); return }
    try {
      let data:any[]|null=null
      if (q) {
        const { data: d } = await supabase.from('products').select('id,name,barcode,sku,price,cost_price,stock_quantity,unit,vat_rate,is_loose').ilike('name', `%${q}%`).limit(60) as any
        data=d
      } else {
        const { data: d } = await supabase.from('products').select('id,name,barcode,sku,price,cost_price,stock_quantity,unit,vat_rate,is_loose').limit(60) as any
        data=d
      }
      if (data && data.length) {
        products = data.map((d:any)=> ({ id:d.id, name:d.name, barcode:d.barcode, sku:d.sku, price:Number(d.price), cost_price: d.cost_price?Number(d.cost_price):null, stock_quantity: d.stock_quantity ?? 0, unit: d.unit||'pcs', vat_rate: Number(d.vat_rate||0), is_loose: !!d.is_loose }))
        renderProducts(products)
      } else renderProducts(list)
    } catch { renderProducts(list) }
  }

  function filterLocal(q:string){ if(!q) return DEMO_PRODUCTS; const s=q.toLowerCase(); return DEMO_PRODUCTS.filter(p=> p.name.toLowerCase().includes(s) || (p.barcode && p.barcode.includes(q)) || (p.sku && p.sku.toLowerCase().includes(s)))}

  function renderProducts(list: Product[]) {
    if (!list.length) { grid.innerHTML = `<div class="col-span-full text-sm text-slate-500 dark:text-slate-400 py-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">${t('pos.noProducts')}</div>`; return }
    grid.innerHTML = list.map(p=>`
      <button data-add="${p.id}" class="text-left bg-slate-50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 hover:border-slate-900 dark:hover:border-white rounded-2xl p-3 flex flex-col gap-2 transition">
        <div class="font-bold text-sm leading-4 line-clamp-2 dark:text-white">${p.name}</div>
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold ${p.stock_quantity<= (p as any).low_stock_alert||5 ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded-full' : 'text-slate-500 dark:text-slate-400'}">${p.stock_quantity} ${p.unit} left</span>
          <span class="font-black text-sm dark:text-white">৳${Number(p.price).toFixed(0)}</span>
        </div>
        <div class="mt-auto flex items-center justify-between">
          <span class="text-[11px] text-slate-500 dark:text-slate-400">${p.unit} • ${p.barcode||'no barcode'}</span>
          <span class="w-7 h-7 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center"><span class="material-symbols-rounded text-[16px]">add</span></span>
        </div>
      </button>
    `).join('')
    grid.querySelectorAll('[data-add]').forEach(b=> b.addEventListener('click', async ()=> { await addToCart((b as HTMLElement).dataset.add!); beep(true) }))
  }

  async function addToCart(id:string){
    const p = [...products, ...DEMO_PRODUCTS].find(x=>x.id===id) || products.find(x=>x.id===id); if(!p) return
    if(p.stock_quantity<=0){
      const ok = await showConfirm({ title:`${p.name} — ${t('pos.outOfStock')}` , message:`${p.name} ${t('pos.outOfStock')}`, confirmText:t('pos.addAnyway'), variant:'warning', icon:'warning' })
      if(!ok) return
    }
    const existing = cart.find(c=> c.product_id===p.id)
    if(existing) existing.qty += p.is_loose ? 0.5 : 1
    else cart.push({ id: Math.random().toString(36).slice(2), product_id:p.id, name:p.name, unit:p.unit, price:p.price, vat_rate:p.vat_rate, qty: 1, cost_price: p.cost_price || undefined, disc_amt:0, disc_pct:0 } as any)
    renderCart()
  }

  function renderCart(){
    cartCountEl.textContent = String(cart.reduce((s,c)=> s+c.qty,0).toFixed(cart.some(c=>c.unit==='kg'||c.unit==='ltr') ? 1 : 0).replace(/\.0$/,''))
    if(!cart.length){
      cartEl.innerHTML = `<div class="text-sm text-slate-500 dark:text-slate-400 py-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">${t('pos.cartEmpty')}</div>`
      payBtn.disabled = true
    } else {
      cartEl.innerHTML = cart.map(c=>{
        const lineDisc = (c.disc_amt||0) + (c.price*c.qty*(c.disc_pct||0)/100)
        const net = c.price*c.qty - lineDisc
        return `
        <div class="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2.5">
          <button data-edit="${c.id}" class="flex-1 min-w-0 text-left">
            <div class="text-sm font-bold truncate dark:text-white">${c.name} ${lineDisc>0?`<span class="text-xs font-normal text-emerald-600">(-৳${lineDisc.toFixed(0)})</span>`:''}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400">${c.qty} ${c.unit} × ৳${c.price.toFixed(2)} ${c.vat_rate?`• VAT ${c.vat_rate}%`:''}</div>
          </button>
          <div class="flex items-center gap-1 shrink-0">
            <button data-dec="${c.id}" class="w-7 h-7 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 grid place-items-center dark:text-white">−</button>
            <span class="w-8 text-center text-sm font-bold dark:text-white">${c.qty}</span>
            <button data-inc="${c.id}" class="w-7 h-7 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center">+</button>
          </div>
          <div class="w-16 text-right font-bold text-sm dark:text-white">৳${net.toFixed(2)}</div>
          <button data-del="${c.id}" class="w-7 h-7 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 grid place-items-center text-slate-400"><span class="material-symbols-rounded text-[16px]">close</span></button>
        </div>`
      }).join('')
      cartEl.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', ()=> openItemModal((b as HTMLElement).dataset.edit!)))
      cartEl.querySelectorAll('[data-inc]').forEach(b=> b.addEventListener('click', ()=>{ const it=cart.find(x=>x.id===(b as HTMLElement).dataset.inc!)!; it.qty+=1; renderCart(); updateTotals(); beep(true)}))
      cartEl.querySelectorAll('[data-dec]').forEach(b=> b.addEventListener('click', ()=>{ const it=cart.find(x=>x.id===(b as HTMLElement).dataset.dec!)!; it.qty-= (it.unit==='kg'||it.unit==='ltr'?0.5:1); if(it.qty<=0) cart=cart.filter(x=>x.id!==it.id); renderCart(); updateTotals()}))
      cartEl.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', ()=>{ cart=cart.filter(x=>x.id!==(b as HTMLElement).dataset.del!); renderCart(); updateTotals()}))
      payBtn.disabled = false
    }
    updateTotals()
  }

  // item modal
  const modal = document.getElementById('pos-item-modal')!
  const modalBackdrop = document.getElementById('pos-item-backdrop')!
  const modalName = document.getElementById('pos-item-name')!
  const mPrice = document.getElementById('pos-item-price') as HTMLInputElement
  const mQty = document.getElementById('pos-item-qty') as HTMLInputElement
  const mVat = document.getElementById('pos-item-vat') as HTMLInputElement
  const mDiscAmt = document.getElementById('pos-item-disc-amt') as HTMLInputElement
  const mDiscPct = document.getElementById('pos-item-disc-pct') as HTMLInputElement
  function openItemModal(id:string){
    editingId=id; const c=cart.find(x=>x.id===id)!; modalName.textContent=`${c.name} • ${c.unit}`; mPrice.value=String(c.price); mQty.value=String(c.qty); mVat.value=String(c.vat_rate); mDiscAmt.value=String(c.disc_amt||0); mDiscPct.value=String(c.disc_pct||0); modal.classList.remove('hidden')
  }
  function closeModal(){ modal.classList.add('hidden'); editingId=null }
  modalBackdrop.addEventListener('click', closeModal)
  document.getElementById('pos-item-cancel')!.addEventListener('click', closeModal)
  document.getElementById('pos-item-save')!.addEventListener('click', ()=>{
    if(!editingId) return
    const c=cart.find(x=>x.id===editingId)!; c.price=parseFloat(mPrice.value)||c.price; c.qty=parseFloat(mQty.value)||c.qty; c.vat_rate=parseFloat(mVat.value)||0; c.disc_amt=parseFloat(mDiscAmt.value)||0; c.disc_pct=parseFloat(mDiscPct.value)||0; if(c.qty<=0) cart=cart.filter(x=>x.id!==editingId); closeModal(); renderCart()
  })

  function calcRich(){
    const vatDefault = parseFloat(vatProfile.value||'0')
    let subtotal=0, vat=0
    for(const c of cart){
      const lineGross = c.price * c.qty
      const lineDisc = (c.disc_amt||0) + (lineGross*(c.disc_pct||0)/100)
      const lineNet = Math.max(0, lineGross - lineDisc)
      subtotal += lineNet
      const rate = c.vat_rate ?? vatDefault
      vat += Math.round(lineNet * rate)/100
    }
    const discountVal = parseFloat(discount.value||'0') || 0
    const dtype = discountType.value as 'amount'|'percent'
    const globalDisc = dtype==='percent' ? Math.round(subtotal*discountVal)/100 : discountVal
    const total = Math.max(0, subtotal + vat - globalDisc)
    return { subtotal, vat, globalDisc, total }
  }

  function updateTotals(){
    const { subtotal, vat, globalDisc, total } = calcRich()
    subEl.textContent = `৳${subtotal.toFixed(2)}`
    discEl.textContent = `-৳${globalDisc.toFixed(2)}`
    vatEl.textContent = `৳${vat.toFixed(2)}`
    totalEl.textContent = `৳${total.toFixed(2)}`
    payTotalEl.textContent = `৳${total.toFixed(2)}`
    splitTotalEl.textContent = `৳${total.toFixed(2)}`
    cart.forEach(c=>{})
    if(splitOn){
      const sum = splitPayments.reduce((s,p)=>s+p.amount,0)
      splitSumEl.textContent = `৳${sum.toFixed(2)}`
      const need = Math.max(0, total - sum)
      if(Math.abs(sum-total) < 0.01){ splitStatus.textContent=t('pos.ok'); splitStatus.className='ml-2 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' }
      else { splitStatus.textContent=`${t('pos.need')} ৳${need.toFixed(2)}`; splitStatus.className='ml-2 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300' }
    }
    // due / paid
    const isDueSingle = selectedPay==='due' && !splitOn
    if(isDueSingle){
      const paid = parseFloat(paidInput.value||'0')||0
      const due = Math.max(0, total - paid)
      dueEl.textContent = `৳${due.toFixed(2)}`
      dueRow.classList.remove('hidden'); paidRow.classList.remove('hidden')
    } else if(splitOn && splitPayments.some(p=>p.method==='due')){
      const paid = splitPayments.filter(p=>p.method!=='due').reduce((s,p)=>s+p.amount,0)
      const due = Math.max(0, total - paid)
      dueEl.textContent = `৳${due.toFixed(2)}`
      dueRow.classList.remove('hidden')
    } else { dueRow.classList.add('hidden'); if(!splitOn) paidRow.classList.add('hidden') }
    if(['bkash','nagad','rocket','upay','bangla_qr'].includes(selectedPay) && !splitOn) mfsRow.classList.remove('hidden'); else if(!splitOn) mfsRow.classList.add('hidden')

    // due warning
    if(selectedCustomer && selectedCustomer.due_balance !== undefined){
      const curDue = selectedCustomer.due_balance || 0
      if(curDue>5000){
        dueWarn.textContent = `⚠ Due ৳${curDue.toLocaleString()} — high. Consider partial payment.`
        dueWarn.classList.remove('hidden')
      } else dueWarn.classList.add('hidden')
    } else dueWarn.classList.add('hidden')
  }

  // pay selection
  payGrid.querySelectorAll('.pay-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      if(splitOn) return
      payGrid.querySelectorAll('.pay-btn').forEach(x=> x.classList.remove('!bg-slate-900','!text-white','!border-slate-900','dark:!bg-white','dark:!text-slate-900'))
      b.classList.add('!bg-slate-900','!text-white','!border-slate-900','dark:!bg-white','dark:!text-slate-900')
      selectedPay = (b as HTMLElement).dataset.pay!
      updateTotals()
    })
  })
  // split
  splitToggle.addEventListener('click', ()=>{
    splitOn = !splitOn
    splitToggle.textContent = splitOn ? t('pos.splitOn') : t('pos.splitOff')
    splitPanel.classList.toggle('hidden', !splitOn)
    if(splitOn){ splitPayments=[]; renderSplit(); updateTotals() } else { renderSplit() }
  })
  function renderSplit(){
    splitRows.innerHTML = splitPayments.map((p,i)=>`
      <div class="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
        <span class="text-sm font-bold capitalize dark:text-white">${p.method.replace('_',' ')}</span>
        <span class="font-bold dark:text-white">৳${p.amount.toFixed(2)}</span>
        <button data-rm="${i}" class="w-7 h-7 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 grid place-items-center">×</button>
      </div>
    `).join('') || `<div class="text-xs text-slate-500 dark:text-slate-400 text-center py-2">${t('pos.splitEmpty')}</div>`
    splitRows.querySelectorAll('[data-rm]').forEach(b=> b.addEventListener('click', ()=>{ splitPayments.splice(Number((b as HTMLElement).dataset.rm!),1); renderSplit(); updateTotals() }))
    const sum = splitPayments.reduce((s,p)=>s+p.amount,0); splitSumEl.textContent=`৳${sum.toFixed(2)}`
  }
  splitAdd.addEventListener('click', ()=>{
    const m=splitMethod.value; const a=parseFloat(splitAmount.value)||0; if(a<=0) return; splitPayments.push({method:m, amount:a}); splitAmount.value=''; renderSplit(); updateTotals()
  })

  discount.addEventListener('input', updateTotals)
  discountType.addEventListener('change', updateTotals)
  vatProfile.addEventListener('change', updateTotals)
  paidInput.addEventListener('input', updateTotals)
  document.querySelectorAll('[data-qd]').forEach(b=> b.addEventListener('click', ()=>{
    discount.value=(b as HTMLElement).dataset.qd!; discountType.value='percent'; updateTotals()
  }))
  document.getElementById('qd-clear')!.addEventListener('click', ()=>{ discount.value='0'; updateTotals() })

  // numpad
  document.querySelectorAll('[data-numpad]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const v=(b as HTMLElement).dataset.numpad!
      const active = document.activeElement as HTMLInputElement
      if(active && active.tagName==='INPUT' && active.type!=='number'){
        // ignore
      }
      if(v==='⌫'){
        if(search.value) search.value=search.value.slice(0,-1)
        else if(customerInput.value) customerInput.value=customerInput.value.slice(0,-1)
      } else if(v==='C'){ search.value=''; customerInput.value=''; discount.value='0'; loadProducts('') }
      else if(v==='+' || v==='-'){
        if(cart.length){ const last=cart[cart.length-1]; last.qty += v==='+'?1:-1; if(last.qty<=0) cart.pop(); renderCart() }
      } else {
        if(document.activeElement===search || document.activeElement===customerInput) (document.activeElement as HTMLInputElement).value += v
        else if(cart.length){ const last=cart[cart.length-1]; const cur=String(last.qty); const next=cur+v; const num=parseFloat(next); if(!isNaN(num)) last.qty=num; renderCart() }
        else search.value+=v
      }
    })
  })

  let t:any
  search.addEventListener('input', ()=>{ clearTimeout(t); t=setTimeout(()=> loadProducts(search.value.trim()), 220) })
  catSel?.addEventListener('change', ()=> loadProducts(search.value.trim()))
  document.getElementById('pos-scan')?.addEventListener('click', async ()=> {
    const q = await showPrompt({ title:t('pos.scanBarcode'), message:t('pos.enterBarcode'), placeholder:'8901...', inputType:'text' }) || ''
    if(!q) return
    const found = products.find(p=> p.barcode===q || p.sku===q)
    if(found){ await addToCart(found.id); beep(true) } else { beep(false); (window as any).toast?.('Not found') }
  })
  let buffer='', lastTime=0
  window.addEventListener('keydown', (e)=>{
    // shortcuts
    if(e.key==='F2'){ e.preventDefault(); cart=[]; renderCart(); customerChip.classList.add('hidden'); customerInput.value=''; discount.value='0'; updateTotals(); (window as any).toast?.('New sale') }
    if(e.key==='F4'){ e.preventDefault(); holdBtn.click() }
    if(e.key==='F8'){ e.preventDefault(); payBtn.click() }
    if(e.key==='F9'){ e.preventDefault(); customerInput.focus() }
    if(e.key==='Escape'){ e.preventDefault(); if(!modal.classList.contains('hidden')) closeModal(); else { cart=[]; renderCart(); (window as any).toast?.('Cleared') } }
    if(e.target instanceof HTMLInputElement && e.key!=='Escape') return
    const now = Date.now()
    if(now - lastTime > 90) buffer = ''
    lastTime = now
    if(e.key==='Enter' && buffer.length>=3){ const code=buffer; buffer=''; const p=products.find(x=> x.barcode===code || x.sku===code); if(p){ e.preventDefault(); addToCart(p.id); beep(true); (window as any).toast?.(p.name) } return }
    if(e.key.length===1 && /[a-zA-Z0-9]/.test(e.key)) buffer+=e.key
    if(e.key==='+' || e.key==='='){ if(cart.length){ e.preventDefault(); cart[cart.length-1].qty+=1; renderCart() } }
    if(e.key==='-' || e.key==='_'){ if(cart.length){ e.preventDefault(); cart[cart.length-1].qty-=1; if(cart[cart.length-1].qty<=0) cart.pop(); renderCart() } }
  })

  async function searchCustomers(q:string){
    if(!q || q.length<2){ customerList.classList.add('hidden'); return }
    let list: any[] = []
    if(isSupabaseConfigured){
      try{ const { data } = await supabase.from('customers').select('id,name,phone,due_balance').ilike('phone', `%${q}%`).limit(5) as any; if(data) list=data }catch{}
      try{ if(!list.length){ const { data: d2 } = await supabase.from('customers').select('id,name,phone,due_balance').ilike('name', `%${q}%`).limit(5) as any; if(d2?.length) list=d2 } }catch{}
    }
    if(!list.length){ const demo=[{id:null,name:'Rahim',phone:'01712345678',due_balance:1170},{id:null,name:'Karim',phone:'01787654321',due_balance:0},{id:null,name:'Ayesha',phone:'01812345678',due_balance:320}]; list=demo.filter(d=> d.phone.includes(q) || d.name.toLowerCase().includes(q.toLowerCase())) }
    if(!list.length){ customerList.classList.add('hidden'); return }
    customerList.innerHTML = list.map(c=> `<button data-cust='${JSON.stringify(c).replace(/'/g,"&apos;")}' class="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-between"><div><div class="text-sm font-bold dark:text-white">${c.name}</div><div class="text-xs text-slate-500">${c.phone}</div></div><div class="text-xs font-bold ${c.due_balance>0?'text-red-600':'text-emerald-600'}">৳${c.due_balance}</div></button>`).join('')
    customerList.classList.remove('hidden')
    customerList.querySelectorAll('[data-cust]').forEach(b=> b.addEventListener('click', ()=>{
      const c = JSON.parse((b as HTMLElement).dataset.cust!.replace(/&apos;/g,"'"))
      selectedCustomer = { id: c.id, name: c.name, phone: c.phone, due_balance: c.due_balance }
      customerChip.textContent = `${c.name} • ${c.phone} • Due ৳${c.due_balance}`
      customerChip.classList.remove('hidden'); customerList.classList.add('hidden'); customerInput.value = c.phone; updateTotals()
    }))
  }
  customerInput.addEventListener('input', ()=> searchCustomers(customerInput.value.trim()))
  customerInput.addEventListener('focus', ()=> searchCustomers(customerInput.value.trim()))
  document.addEventListener('click', (e)=> { if(!(e.target as HTMLElement).closest('#pos-customer') && !(e.target as HTMLElement).closest('#pos-customer-list')) customerList.classList.add('hidden') })
  document.getElementById('pos-add-customer')?.addEventListener('click', async ()=>{
    const phone = customerInput.value.trim()
    if(!/^01[3-9]\d{8}$/.test(phone)){ (window as any).toast?.('Enter valid 01XXXXXXXXX'); beep(false); return }
    const name = await showPrompt({ title:t('pos.customerName'), message:`${t('pos.customer')} ${phone}`, placeholder:'Walk-in', defaultValue:'Walk-in', required:true }) || 'Walk-in'
    selectedCustomer = { id: null, name, phone, due_balance:0 }
    customerChip.textContent = `${name} • ${phone}`; customerChip.classList.remove('hidden'); customerList.classList.add('hidden'); updateTotals()
  })

  holdBtn.addEventListener('click', async ()=>{
    if(!cart.length){ (window as any).toast?.('Cart empty'); return }
    const name = await showPrompt({ title:t('pos.holdCart'), message:t('pos.holdNameHint'), placeholder:`Hold ${heldCarts.length+1}`, defaultValue:`Hold ${heldCarts.length+1}`, required:true }) || `Hold ${heldCarts.length+1}`
    heldCarts.push({id:'h'+Date.now(), name, at:Date.now(), cart:[...cart], customer:selectedCustomer}); persistHeld(); cart=[]; selectedCustomer=null; customerChip.classList.add('hidden'); customerInput.value=''; renderCart(); (window as any).toast?.('Held: '+name)
  })
  clearBtn.addEventListener('click', ()=>{ cart=[]; renderCart(); selectedCustomer=null; customerChip.classList.add('hidden'); customerInput.value=''; discount.value='0'; splitPayments=[]; splitOn=false; splitPanel.classList.add('hidden'); splitToggle.textContent='Split: OFF'; updateTotals() })

  // drawer kick mock + receipt print
  document.getElementById('pos-drawer-btn')!.addEventListener('click', async ()=>{
    try{
      // WebUSB ESC/POS drawer kick 0x1B 0x70 0x00 0x19 0xFA
      if((navigator as any).usb){
        const dev = await (navigator as any).usb.requestDevice({filters:[]}).catch(()=>null)
        if(dev) (window as any).toast?.('Drawer: USB device selected')
        else (window as any).toast?.('Drawer kick — no USB (demo)')
      } else (window as any).toast?.('Drawer kick — WebUSB not supported (demo)')
    }catch{ (window as any).toast?.('Drawer error') }
  })
  document.getElementById('pos-print-last')!.addEventListener('click', ()=>{
    const el=document.getElementById('pos-receipt')!; if(el.classList.contains('hidden')) return (window as any).toast?.('No receipt'); window.print()
  })
  document.getElementById('pos-return-btn')!.addEventListener('click', async ()=>{
    const rn = await showPrompt({ title:t('pos.returnReceipt'), message:t('pos.enterReceipt'), placeholder:'MEK-...', required:true }); if(!rn) return; (window as any).toast?.('Return for '+rn+' — will restore stock')
  })

  payBtn.addEventListener('click', async ()=>{
    if(!cart.length){ (window as any).toast?.('Cart empty'); beep(false); return }
    const { subtotal, vat, globalDisc, total } = calcRich()
    // split validation
    if(splitOn){
      const sum = splitPayments.reduce((s,p)=>s+p.amount,0)
      if(Math.abs(sum-total) > 0.01){ (window as any).toast?.(`Split sum ৳${sum.toFixed(2)} ≠ total ৳${total.toFixed(2)}`); beep(false); return }
      if(splitPayments.some(p=>p.method==='due') && !selectedCustomer){ (window as any).toast?.('Add customer for Due split'); beep(false); return }
    }
    const paidNow = splitOn ? splitPayments.filter(p=>p.method!=='due').reduce((s,p)=>s+p.amount,0) : (selectedPay==='due' ? (parseFloat(paidInput.value||'0')||0) : total)
    const due = Math.max(0, total - paidNow)
    if(due>0 && !selectedCustomer){ (window as any).toast?.('Add customer for due'); customerInput.focus(); beep(false); return }
    if(!splitOn && ['bkash','nagad','rocket','upay','bangla_qr'].includes(selectedPay) && !trxInput.value.trim()){
      const ok = await showConfirm({ title: t('pos.trxEmpty').split('—')[0]?.trim() || 'TrxID empty', message:t('pos.trxEmpty'), confirmText:t('pos.save'), variant:'warning', icon:'warning' })
      if(!ok) return
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
    const payment_method = splitOn ? 'split' : selectedPay
    const orderPayload: any = {
      store_id: store_id || (isSupabaseConfigured ? null : 'demo-store'),
      cashier_id, receipt_number, subtotal, tax_amount: vat, vat_amount: vat, vat_rate: Number(vatProfile.value||0),
      discount_amount: globalDisc, discount_type: discountType.value, total_amount: total,
      payment_method, is_due: due>0, due_amount: due, mfs_trxid: trxInput.value.trim()||null,
      customer_id: selectedCustomer?.id || null, client_uuid, bin_snapshot: null,
      note: JSON.stringify({ split: splitOn? splitPayments : null, customer: selectedCustomer }),
    }
    const itemsPayload = cart.map(c=>{
      const lineDisc = (c.disc_amt||0) + (c.price*c.qty*(c.disc_pct||0)/100)
      const net = c.price*c.qty - lineDisc
      return ({ product_id: c.product_id, quantity: c.qty, unit_price: c.price, vat_rate: c.vat_rate, vat_amount: Math.round(net*(c.vat_rate||0))/100, unit_snapshot: c.unit, client_uuid: Math.random().toString(36).slice(2) })
    })
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
        if(splitOn){
          for(const sp of splitPayments) if(sp.method!=='due' && sp.method!=='cash'){
            try{ await supabase.from('expenses').insert({ store_id, category:'other', amount:0, note:`Split ${sp.method} ${sp.amount}` } as any) }catch{}
          }
        }
        savedOnline = true
      }catch(e){ console.warn('online save failed, queue', e) }
    }
    if(!savedOnline){
      await enqueue('orders', orderPayload)
      for(const it of itemsPayload) await enqueue('order_items', { ...it, order_id: null, _order_client_uuid: client_uuid })
      if(due>0) await enqueue('khata_entries', { store_id: store_id||'demo-store', customer_id: selectedCustomer?.id||null, type:'dilam', amount: due, note:`Sale ${receipt_number}`, client_uuid: Math.random().toString(36).slice(2) })
      refreshOutbox()
      // demo fallback so Orders view shows this sale instantly even without Supabase/IDB sync
      try{
        const demo=JSON.parse(localStorage.getItem('demo-orders')||'[]')
        demo.unshift({ id: client_uuid, receipt_number, subtotal, total_amount: total, payment_method, is_due: due>0, due_amount: due, created_at:new Date().toISOString(), customer_id: selectedCustomer?.phone||null })
        localStorage.setItem('demo-orders', JSON.stringify(demo.slice(0,60)))
        const dItems=JSON.parse(localStorage.getItem('demo-order-items')||'{}')
        dItems[client_uuid]=cart.map(c=> ({ name:c.name, qty:c.qty, price:c.price }))
        localStorage.setItem('demo-order-items', JSON.stringify(dItems))
      }catch{}
    }
    // ESC/POS generate
    try{
      const escpos = new Uint8Array([0x1B,0x40, 0x1B,0x61,0x01, 0x1B,0x21,0x10])
      console.log('ESC/POS', escpos, receipt_number)
    }catch{}
    beep(true)
    try{ if((navigator as any).usb) console.log('drawer kick mock') }catch{}

    const receiptEl = document.getElementById('pos-receipt')!
    receiptEl.classList.remove('hidden')
    receiptEl.scrollIntoView({ behavior:'smooth', block:'nearest' })
    const storeName = storeInfo?.name || 'MEKHOLI Mart'
    const storeAddr = storeInfo?.address || 'Sylhet Road • Sylhet, Bangladesh'
    const storePhone = storeInfo?.phone || ''
    const storeBin = (orderPayload as any).bin_snapshot || storeInfo?.bin || '—'
    const dateStr = new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })
    const custName = selectedCustomer?.name || 'Walk-in'
    const custPhone = selectedCustomer?.phone || ''
    receiptEl.innerHTML = `
      <div class="relative">
        <style>
          @media print{
            body *{ visibility:hidden !important; }
            #pos-receipt, #pos-receipt *{ visibility:visible !important; }
            #pos-receipt{ position:absolute !important; left:0 !important; top:0 !important; width:80mm !important; margin:0 !important; padding:0 !important; border:none !important; border-radius:0 !important; box-shadow:none !important; background:white !important; }
            #pos-receipt .no-print{ display:none !important; }
            @page{ size:80mm auto; margin:3mm; }
          }
        </style>
        <div class="mx-auto w-full max-w-[360px] bg-white text-slate-900 rounded-[18px] border border-slate-200 overflow-hidden shadow-sm">
          <div class="bg-slate-900 text-white px-4 pt-4 pb-3 text-center">
            <div class="inline-flex items-center gap-2 justify-center">
              <span class="w-7 h-7 rounded-full bg-white text-slate-900 grid place-items-center font-black text-[13px]">M</span>
              <span class="font-black tracking-[0.22em] text-[12px]">MEKHOLI</span>
              <span class="text-[8px] tracking-widest bg-white/15 border border-white/20 px-1.5 py-0.5 rounded-full">MUSHAK 6.3</span>
            </div>
            <div class="font-black text-[15px] leading-none mt-2.5 tracking-tight">${storeName}</div>
            <div class="text-[10px] text-white/70 leading-tight mt-1">${storeAddr}${storePhone ? ` • ${storePhone}` : ''}</div>
            <div class="text-[9px] tracking-wide text-white/60 mt-1">BIN: ${storeBin}</div>
          </div>
          <div class="px-4 py-3">
            <div class="flex justify-between gap-3 text-[11px] leading-[1.3]">
              <div>
                <div class="text-slate-500 text-[9px] tracking-widest font-bold">${t('pos.receipt')}</div>
                <div class="font-mono font-bold tracking-widest text-slate-900">${receipt_number}</div>
                <div class="text-[10px] text-slate-600 mt-1">${dateStr}</div>
              </div>
              <div class="text-right">
                <div class="text-slate-500 text-[9px] tracking-widest font-bold">${t('pos.customerLabel')}</div>
                <div class="font-bold text-slate-900">${custName}</div>
                <div class="text-[10px] text-slate-600">${custPhone || 'Walk-in • Cash'}</div>
              </div>
            </div>
            ${selectedCustomer && (selectedCustomer as any).due_balance ? `<div class="mt-2 text-[10px] font-bold bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-3 py-1 text-center">${t('pos.previousDue')} ৳${Number((selectedCustomer as any).due_balance).toFixed(2)}</div>` : ''}
            <div class="mt-3">
              <div class="grid grid-cols-[1fr_38px_58px_68px] gap-1 text-[8px] font-bold tracking-widest text-slate-500 border-b-2 border-slate-900 pb-1">
                <div>${t('pos.item')}</div><div class="text-center">${t('pos.qty')}</div><div class="text-right">${t('pos.rate')}</div><div class="text-right">${t('pos.amount')}</div>
              </div>
              <div class="divide-y divide-dashed divide-slate-200">
                ${cart.map((c:any,i:number)=>{
                  const ld=(c.disc_amt||0)+(c.price*c.qty*(c.disc_pct||0)/100);
                  const net=(c.price*c.qty - ld);
                  const isDisc = ld>0.01;
                  return `<div class="grid grid-cols-[1fr_38px_58px_68px] gap-1 py-2 items-start text-[11px] leading-tight">
                    <div class="pr-1">
                      <div class="font-bold leading-tight text-slate-900">${i+1}. ${c.name}</div>
                      <div class="text-[9px] text-slate-500">${c.unit} ${c.vat_rate ? `• VAT ${c.vat_rate}%` : '• VAT 0%' }${isDisc ? ` • Disc ৳${ld.toFixed(0)}` : ''}</div>
                    </div>
                    <div class="text-center font-bold">${Number(c.qty).toString().replace(/\.0$/,'')} <span class="text-[9px] font-normal text-slate-500">${c.unit}</span></div>
                    <div class="text-right text-slate-600">৳${c.price.toFixed(0)}</div>
                    <div class="text-right font-black">৳${net.toFixed(2)}</div>
                  </div>`
                }).join('')}
              </div>
              <div class="text-[10px] text-slate-500 text-center border-t border-dashed border-slate-200 pt-1.5 mt-1">${cart.length} ${t('pos.itemsCount')}${cart.length>1?'':''} • ${cart.reduce((s:any,c:any)=>s+c.qty,0).toString().replace(/\.0$/,'')} ${t('pos.qtyShort')}</div>
            </div>
            <div class="mt-3 bg-slate-50 rounded-2xl p-3 border border-slate-200">
              <div class="space-y-1 text-[11px]">
                <div class="flex justify-between"><span class="text-slate-600">${t('pos.subtotal')}</span><span class="font-bold">৳${subtotal.toFixed(2)}</span></div>
                ${globalDisc>0.005 ? `<div class="flex justify-between text-emerald-700"><span>${t('pos.discountLabel')}</span><span class="font-bold">-৳${globalDisc.toFixed(2)}</span></div>` : ''}
                <div class="flex justify-between"><span class="text-slate-600">${t('pos.vatLabel')}</span><span class="font-bold">৳${vat.toFixed(2)}</span></div>
              </div>
              <div class="flex justify-between items-center bg-slate-900 text-white rounded-xl px-3.5 py-2.5 mt-2.5">
                <span class="text-[11px] font-black tracking-[0.18em]">${t('pos.total')}</span><span class="text-[18px] font-black tracking-tight">৳${total.toFixed(2)}</span>
              </div>
              <div class="mt-2.5 space-y-1.5 text-[11px]">
                ${splitOn ? splitPayments.map((p:any)=>`<div class="flex justify-between items-center ${p.method==='due' ? 'bg-red-50 border border-red-200 text-red-700 rounded-full px-3 py-1.5 font-black' : ''}"><span class="capitalize ${p.method==='due'?'':'text-slate-600'}">${tPay(p.method)} ${p.method==='due'?t('pos.due'):t('pos.paid')}</span><span class="font-bold">৳${p.amount.toFixed(2)}</span></div>`).join('') : `<div class="flex justify-between"><span class="text-slate-600">${t('pos.paid')} — <span class="capitalize font-bold text-slate-900">${tPay(selectedPay)}</span></span><span class="font-bold text-emerald-700">৳${paidNow.toFixed(2)}</span></div>`}
                ${due>0.005 ? `<div class="flex justify-between items-center bg-red-600 text-white rounded-full px-3.5 py-2 font-black"><span>${t('pos.due')}</span><span>৳${due.toFixed(2)}</span></div>` : `<div class="text-center text-[11px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full py-1">✓ ${t('pos.paid')} — ${t('pos.due')} 0</div>`}
                ${trxInput.value.trim() ? `<div class="text-center text-[9px] text-slate-500 font-mono">TrxID: ${trxInput.value.trim()}</div>` : ''}
              </div>
            </div>
            <div class="mt-3 pt-3 border-t border-dashed border-slate-200 text-center">
              <img src="https://barcodeapi.org/api/128/${receipt_number}" alt="barcode" class="mx-auto h-9 w-full max-w-[240px] object-contain" />
              <div class="font-mono text-[8px] tracking-[0.32em] font-bold text-slate-500 mt-1">${receipt_number}</div>
              <div class="text-[10px] font-bold text-slate-900 mt-3">${t('pos.thankYou')}</div>
              <div class="text-[9px] leading-tight text-slate-500 mt-1">${t('pos.exchangeNote')}<br>${t('pos.vatIncluded')}</div>
              <div class="text-[8px] tracking-wide text-slate-400 mt-2">${savedOnline ? t('pos.synced') : t('pos.queued')} • ${splitOn?t('pos.splitPay'):t('pos.singlePay')}</div>
              <div class="text-[7px] tracking-[0.2em] text-slate-400 mt-1">${t('pos.powered')}</div>
            </div>
            <div class="no-print mt-4 flex gap-2">
              <button onclick="window.print()" class="flex-1 py-2.5 rounded-full bg-slate-900 text-white text-xs font-black flex items-center justify-center gap-1.5"><span class="material-symbols-rounded text-[16px]">print</span> ${t('pos.print80')}</button>
              <button onclick="this.closest('#pos-receipt').classList.add('hidden')" class="px-5 py-2.5 rounded-full border border-slate-200 bg-white text-xs font-bold">${t('pos.close')}</button>
            </div>
          </div>
        </div>
      </div>
    `
    ;(window as any).toast?.(savedOnline ? `Saved ৳${total.toFixed(2)}` : `Queued ৳${total.toFixed(2)}`)
    if(due>0 && selectedCustomer){
      const ok = await showConfirm({ title:`${t('pos.due')} ৳${due.toFixed(2)} — ${t('pos.dueSms')}`, message:`${selectedCustomer.name} (${selectedCustomer.phone}) — ${t('pos.dueSms')}`, confirmText:'SMS', variant:'default', icon:'sms' })
      if(ok){
        const msg = `Assalamu Alaikum, baki ৳${due.toFixed(2)} — ${receipt_number} — Mekholi.`
        window.location.href = `sms:${selectedCustomer.phone}?&body=${encodeURIComponent(msg)}`
      }
    }
    cart=[]; renderCart(); splitPayments=[]; renderSplit(); payBtn.disabled=false; payBtn.innerHTML = `<span class="material-symbols-rounded">print</span><span data-i18n-pay>${t('pos.payBtn')}</span> <span id="pos-pay-total">৳0.00</span>`
  })

  loadProducts(); renderCart(); updateTotals()
}
