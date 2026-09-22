import { supabase, isSupabaseConfigured } from '../../core/db/supabase'

export function expenseNewView(): string {
  return `
  <div class="max-w-[560px] mx-auto w-full px-4 lg:px-6 py-6">
    <div class="flex items-center gap-3">
      <a href="/app/expenses" data-link class="w-9 h-9 rounded-full border border-slate-200 bg-white grid place-items-center hover:bg-slate-50"><span class="material-symbols-rounded">arrow_back</span></a>
      <h1 class="text-[18px] font-black">Add Expense</h1>
    </div>
    <form id="exp-form" class="mt-5 bg-white border border-slate-200 rounded-[18px] p-5 sm:p-6 space-y-4">
      <label class="text-sm font-bold">Category *
        <select name="category" required class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm">
          <option value="rent">Rent</option><option value="electricity">Electricity</option><option value="staff">Staff</option><option value="transport">Transport</option><option value="other" selected>Other</option>
        </select>
      </label>
      <label class="text-sm font-bold">Amount (৳) *
        <input name="amount" required type="number" step="0.01" min="0.01" placeholder="500" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-slate-900 text-sm bg-white" />
      </label>
      <label class="text-sm font-bold">Date
        <input name="expense_date" type="date" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm bg-white" />
      </label>
      <label class="text-sm font-bold">Note
        <input name="note" placeholder="e.g. Delivery charge" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 outline-none text-sm bg-white" />
      </label>
      <div class="pt-2 flex gap-3">
        <a href="/app/expenses" data-link class="flex-1 py-3 rounded-full border border-slate-200 bg-white text-sm font-bold text-center hover:bg-slate-50">Cancel</a>
        <button type="submit" class="flex-1 py-3 rounded-full bg-slate-900 text-white text-sm font-black hover:bg-black">Save</button>
      </div>
      <div id="exp-msg" class="hidden text-sm font-semibold"></div>
    </form>
  </div>
  `
}

export function initExpenseNew(){
  const form = document.getElementById('exp-form') as HTMLFormElement
  const msg = document.getElementById('exp-msg')!
  const dateInput = form.querySelector('input[name="expense_date"]') as HTMLInputElement
  if(dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0,10)
  form.addEventListener('submit', async (e)=>{
    e.preventDefault()
    const fd = new FormData(form)
    const payload:any = {
      category: String(fd.get('category')||'other'),
      amount: parseFloat(String(fd.get('amount')||'0')),
      expense_date: String(fd.get('expense_date')||new Date().toISOString().slice(0,10)),
      note: String(fd.get('note')||'').trim() || null,
    }
    if(!payload.amount){ msg.textContent='Amount required'; msg.className='text-sm font-semibold text-red-600'; msg.classList.remove('hidden'); return }
    const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement
    btn.disabled = true; btn.textContent='Saving…'
    try{
      if(isSupabaseConfigured){
        const { data:{ user } } = await supabase.auth.getUser()
        if(!user) throw new Error('Please log in')
        const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
        const sid = prof?.store_id
        if(!sid) throw new Error('No store')
        const { error } = await supabase.from('expenses').insert({ store_id: sid, ...payload } as any)
        if(error) throw error
        msg.textContent='Saved ✓'; msg.className='text-sm font-semibold text-emerald-600'; msg.classList.remove('hidden')
        setTimeout(()=> location.href='/app/expenses', 600)
      } else {
        const arr = JSON.parse(localStorage.getItem('demo-expenses')||'[]')
        arr.unshift({ id:'d'+Date.now(), ...payload })
        localStorage.setItem('demo-expenses', JSON.stringify(arr))
        msg.textContent='Saved (demo) ✓'; msg.className='text-sm font-semibold text-emerald-600'; msg.classList.remove('hidden')
        setTimeout(()=> location.href='/app/expenses', 600)
      }
    }catch(err:any){
      msg.textContent = err.message; msg.className='text-sm font-semibold text-red-600'; msg.classList.remove('hidden')
      btn.disabled=false; btn.textContent='Save'
    }
  })
}
