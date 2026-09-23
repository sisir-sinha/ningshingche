import '../styles/app.css'
import { createRouter } from '../core/router/router'
import { initTheme } from '../core/utils/theme'
import { requireAuth } from '../core/auth/guard'
import { homeView, initHome } from './views/home'
import posView, { initPos } from './views/pos'
import { khataView, initKhata } from './views/khata'
import { productsView, initProducts } from './views/products'
import { productNewView, initProductNew } from './views/product-new'
import { expensesView, initExpenses } from './views/expenses'
import { expenseNewView, initExpenseNew } from './views/expense-new'
import { reportsView, initReports } from './views/reports'
import { settingsView, initSettings } from './views/settings'
import { suppliersView, initSuppliers } from './views/suppliers'
import { purchasesView, initPurchases } from './views/purchases'
import { purchaseNewView, initPurchaseNew } from './views/purchase-new'
import { ordersView, initOrders } from './views/orders'
import { stockAdjustView, initStockAdjust } from './views/stock-adjust'
import { appLayout, initLayout } from './components/layout'

initTheme()

const mount = document.getElementById('app')!

function withLayout(active: any, viewFn: () => string, title: string){
  return () => {
    const content = viewFn()
    return appLayout(active, content, { title })
  }
}

const authGuard = () => requireAuth()

createRouter([
  { path: '/app', view: withLayout('home', homeView, 'Home'), title: 'Mekholi — Home', guard: authGuard },
  { path: '/app.html', view: withLayout('home', homeView, 'Home'), title: 'Mekholi — Home', guard: authGuard },
  { path: '/app/pos', view: withLayout('pos', posView, 'POS Billing'), title: 'Mekholi — POS', guard: authGuard },
  { path: '/app/products', view: withLayout('products', productsView, 'Products'), title: 'Mekholi — Products', guard: authGuard },
  { path: '/app/products/new', view: withLayout('products', productNewView, 'Add Product'), title: 'Mekholi — Add Product', guard: authGuard },
  { path: '/app/purchases', view: withLayout('purchases', purchasesView, 'Purchases'), title: 'Mekholi — Purchases', guard: authGuard },
  { path: '/app/purchases/new', view: withLayout('purchases', purchaseNewView, 'New GRN'), title: 'Mekholi — New GRN', guard: authGuard },
  { path: '/app/suppliers', view: withLayout('suppliers', suppliersView, 'Suppliers'), title: 'Mekholi — Suppliers', guard: authGuard },
  { path: '/app/orders', view: withLayout('orders', ordersView, 'Orders'), title: 'Mekholi — Orders', guard: authGuard },
  { path: '/app/stock', view: withLayout('stock', stockAdjustView, 'Stock Adjust'), title: 'Mekholi — Stock Adjust', guard: authGuard },
  { path: '/app/khata', view: withLayout('khata', khataView, 'Khata'), title: 'Mekholi — Khata', guard: authGuard },
  { path: '/app/expenses', view: withLayout('expenses', expensesView, 'Expenses'), title: 'Mekholi — Expenses', guard: authGuard },
  { path: '/app/expenses/new', view: withLayout('expenses', expenseNewView, 'Add Expense'), title: 'Mekholi — Add Expense', guard: authGuard },
  { path: '/app/reports', view: withLayout('reports', reportsView, 'Reports'), title: 'Mekholi — Reports', guard: authGuard },
  { path: '/app/settings', view: withLayout('settings', settingsView, 'Settings'), title: 'Mekholi — Settings', guard: authGuard },
  { path: '/', view: () => { location.href = '/'; return '' } },
], mount)

function runInits(){
  const p = location.pathname
  initLayout()
  if (p === '/app' || p === '/app.html') initHome()
  if (p === '/app/pos') initPos()
  if (p === '/app/products') initProducts()
  if (p === '/app/products/new') initProductNew()
  if (p === '/app/purchases') initPurchases()
  if (p === '/app/purchases/new') initPurchaseNew()
  if (p === '/app/suppliers') initSuppliers()
  if (p === '/app/orders') initOrders()
  if (p === '/app/stock') initStockAdjust()
  if (p === '/app/khata') initKhata()
  if (p === '/app/expenses') initExpenses()
  if (p === '/app/expenses/new') initExpenseNew()
  if (p === '/app/reports') initReports()
  if (p === '/app/settings') initSettings()
  setTimeout(async ()=>{
    const { supabase, isSupabaseConfigured } = await import('../core/db/supabase')
    if(!isSupabaseConfigured) return
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user) return
      const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
      const { data: store } = await supabase.from('stores').select('name').eq('id', prof?.store_id).maybeSingle() as any
      if(store?.name){
        document.querySelectorAll('aside').forEach(el=>{
          el.innerHTML = el.innerHTML.replace(/Your Store/g, store.name)
        })
        document.querySelectorAll('#store-subtitle').forEach(el=> el.textContent = store.name + ' • Bangladesh')
      }
    }catch{}
  }, 300)
}

window.addEventListener('mk:navigate', () => setTimeout(runInits, 0))
setTimeout(runInits, 0)

import('../core/db/supabase').then(({ supabase })=>{
  supabase.auth.onAuthStateChange((event)=>{
    if(event === 'SIGNED_OUT'){
      if(location.pathname.startsWith('/app')){
        location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search)
      }
    }
  })
})
