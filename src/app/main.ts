import '../styles/app.css'
import { createRouter } from '../core/router/router'
import { homeView, initHome } from './views/home'
import posView, { initPos } from './views/pos'
import { khataView, initKhata } from './views/khata'
import { productsView, initProducts } from './views/products'
import { productNewView, initProductNew } from './views/product-new'
import { expensesView, initExpenses } from './views/expenses'
import { expenseNewView, initExpenseNew } from './views/expense-new'
import { reportsView, initReports } from './views/reports'
import { appLayout, initLayout } from './components/layout'

const mount = document.getElementById('app')!

function withLayout(active: any, viewFn: () => string, title: string){
  return () => {
    const content = viewFn()
    // store name will be filled async in each view; layout gets empty for now
    return appLayout(active, content, { title })
  }
}

createRouter([
  { path: '/app', view: withLayout('home', homeView, 'Home'), title: 'Mekholi — Home' },
  { path: '/app.html', view: withLayout('home', homeView, 'Home'), title: 'Mekholi — Home' },
  { path: '/app/pos', view: withLayout('pos', posView, 'POS Billing'), title: 'Mekholi — POS' },
  { path: '/app/products', view: withLayout('products', productsView, 'Products'), title: 'Mekholi — Products' },
  { path: '/app/products/new', view: withLayout('products', productNewView, 'Add Product'), title: 'Mekholi — Add Product' },
  { path: '/app/khata', view: withLayout('khata', khataView, 'Khata'), title: 'Mekholi — Khata' },
  { path: '/app/expenses', view: withLayout('expenses', expensesView, 'Expenses'), title: 'Mekholi — Expenses' },
  { path: '/app/expenses/new', view: withLayout('expenses', expenseNewView, 'Add Expense'), title: 'Mekholi — Add Expense' },
  { path: '/app/reports', view: withLayout('reports', reportsView, 'Reports'), title: 'Mekholi — Reports' },
  { path: '/', view: () => { location.href = '/'; return '' } },
], mount)

function runInits(){
  const p = location.pathname
  initLayout()
  if (p === '/app' || p === '/app.html') initHome()
  if (p === '/app/pos') initPos()
  if (p === '/app/products') initProducts()
  if (p === '/app/products/new') initProductNew()
  if (p === '/app/khata') initKhata()
  if (p === '/app/expenses') initExpenses()
  if (p === '/app/expenses/new') initExpenseNew()
  if (p === '/app/reports') initReports()
  // fill store name in layout after
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
          const t = el.querySelector('div.text-xs.text-slate-500 + div') as HTMLElement | null
          // layout has store name in multiple places; just update all occurrences of "Your Store"
          el.innerHTML = el.innerHTML.replace(/Your Store/g, store.name)
        })
      }
    }catch{}
  }, 300)
}

window.addEventListener('mk:navigate', () => setTimeout(runInits, 0))
setTimeout(runInits, 0)
