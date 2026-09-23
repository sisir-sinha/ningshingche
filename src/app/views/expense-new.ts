import { supabase, isSupabaseConfigured } from '../../core/db/supabase'
import { bindImgbbDropZone } from '../../core/services/imgbb'
import { withBase } from '../../core/utils/base'

export function expenseNewView(): string {
  return `
  <div class="max-w-[560px] mx-auto w-full px-4 lg:px-6 py-6">
    <div class="flex items-center gap-3">
      <a href="/app/expenses" data-link class="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 grid place-items-center hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-white"><span class="material-symbols-rounded">arrow_back</span></a>
      <div><h1 class="text-[18px] font-black dark:text-white">Add Expense</h1><p class="text-xs text-slate-500 dark:text-slate-400">Receipt photo via imgbb • drag & drop</p></div>
    </div>
    <form id="exp-form" class="mt-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5 sm:p-6 space-y-4">
      <label class="text-sm font-bold dark:text-white">Category *
        <select name="category" required class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white">
          <option value="rent">Rent</option><option value="electricity">Electricity</option><option value="staff">Staff</option><option value="transport">Transport</option><option value="other" selected>Other</option>
        </select>
      </label>
      <label class="text-sm font-bold dark:text-white">Amount (৳) *
        <input name="amount" required type="number" step="0.01" min="0.01" placeholder="500" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none focus:border-slate-900 dark:focus:border-slate-500 text-sm bg-white dark:bg-slate-800 dark:text-white" />
      </label>
      <label class="text-sm font-bold dark:text-white">Date
        <input name="expense_date" type="date" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
      </label>
      <label class="text-sm font-bold dark:text-white">Note
        <input name="note" placeholder="e.g. Delivery charge" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none text-sm bg-white dark:bg-slate-800 dark:text-white" />
      </label>

      <!-- Receipt image — imgbb drag & drop -->
      <div>
        <div class="text-sm font-bold dark:text-white flex items-center gap-2"><span class="material-symbols-rounded text-[18px]">receipt_long</span> Receipt photo <span class="text-xs font-normal text-slate-500">• drag & drop, paste, or click</span></div>
        <div id="exp-drop" class="mt-2 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4 flex flex-col items-center text-center cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-800 transition">
          <div class="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 grid place-items-center"><span class="material-symbols-rounded">upload</span></div>
          <div class="mt-2 text-sm font-bold dark:text-white">Drop receipt image here</div>
          <div class="text-xs text-slate-500">JPG/PNG up to 32 MB • imgbb</div>
          <div id="exp-status" class="hidden mt-2 text-xs font-semibold"></div>
          <input id="exp-file" type="file" accept="image/*" class="hidden" />
        </div>
        <div id="exp-preview-wrap" class="hidden mt-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-3 flex items-center gap-3">
          <img id="exp-preview" src="" alt="" class="w-14 h-14 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-white" />
          <div class="flex-1 min-w-0">
            <a id="exp-url-link" href="#" target="_blank" class="text-xs font-mono text-sky-600 dark:text-sky-400 break-all">—</a>
            <div class="mt-1 flex gap-2">
              <button type="button" id="exp-copy" class="text-xs font-bold px-3 py-1 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900">Copy</button>
              <button type="button" id="exp-clear" class="text-xs font-bold px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white">Remove</button>
            </div>
          </div>
        </div>
        <input type="hidden" name="receipt_url" id="exp-url" />
        <label class="block mt-2 text-xs font-bold text-slate-500">Receipt URL (auto-filled)
          <input id="exp-url-display" placeholder="https://i.ibb.co/..." class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-mono dark:text-white" />
        </label>
      </div>

      <div class="pt-2 flex gap-3">
        <a href="/app/expenses" data-link class="flex-1 py-3 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-center hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white">Cancel</a>
        <button type="submit" class="flex-1 py-3 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black hover:bg-black dark:hover:bg-slate-100">Save</button>
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

  // imgbb binding for receipt
  const drop = document.getElementById('exp-drop') as HTMLElement
  const file = document.getElementById('exp-file') as HTMLInputElement
  const urlInput = document.getElementById('exp-url') as HTMLInputElement
  const urlDisplay = document.getElementById('exp-url-display') as HTMLInputElement
  const previewWrap = document.getElementById('exp-preview-wrap') as HTMLElement
  const previewImg = document.getElementById('exp-preview') as HTMLImageElement
  const urlLink = document.getElementById('exp-url-link') as HTMLAnchorElement
  const statusEl = document.getElementById('exp-status') as HTMLElement

  function showPreview(url:string){
    urlInput.value = url; urlDisplay.value = url
    previewImg.src = url; urlLink.href = url; urlLink.textContent = url
    previewWrap.classList.remove('hidden')
  }
  urlDisplay.addEventListener('input', ()=>{ const v=urlDisplay.value.trim(); urlInput.value=v; if(v) showPreview(v) })
  document.getElementById('exp-copy')?.addEventListener('click', async ()=>{ const v=urlInput.value; if(!v) return; await navigator.clipboard.writeText(v).catch(()=>{}); (window as any).toast?.('Copied') })
  document.getElementById('exp-clear')?.addEventListener('click', ()=>{ urlInput.value=''; urlDisplay.value=''; previewWrap.classList.add('hidden') })

  if(drop && file){
    bindImgbbDropZone({
      zone: drop, input: file,
      onUrl: showPreview,
      onProgress: (p,m)=>{
        if(p==='uploading'){ statusEl.textContent='Uploading…'; statusEl.className='mt-2 text-xs font-bold text-slate-600 dark:text-slate-300'; statusEl.classList.remove('hidden') }
        else if(p==='done'){ statusEl.textContent='Uploaded ✓'; statusEl.className='mt-2 text-xs font-bold text-emerald-600'; }
        else if(p==='error'){ statusEl.textContent=m||'Upload failed'; statusEl.className='mt-2 text-xs font-bold text-red-600'; statusEl.classList.remove('hidden') }
      }
    })
  }

  form.addEventListener('submit', async (e)=>{
    e.preventDefault()
    const fd = new FormData(form)
    const payload:any = {
      category: String(fd.get('category')||'other'),
      amount: parseFloat(String(fd.get('amount')||'0')),
      expense_date: String(fd.get('expense_date')||new Date().toISOString().slice(0,10)),
      note: String(fd.get('note')||'').trim() || null,
      // receipt_url not in schema, store in note or try extra column, fallback to note prefix
      receipt_url: String(fd.get('receipt_url')||'').trim() || null,
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
        // try with receipt_url if column exists, else fallback to note
        let notePayload = payload.note
        if(payload.receipt_url) notePayload = (notePayload ? notePayload + ' ' : '') + `[receipt:${payload.receipt_url}]`
        const { error } = await supabase.from('expenses').insert({ store_id: sid, category: payload.category, amount: payload.amount, expense_date: payload.expense_date, note: notePayload } as any)
        if(error) throw error
        // also persist receipt_url mapping locally for UI
        if(payload.receipt_url) localStorage.setItem('mekholi:last-receipt', payload.receipt_url)
        msg.textContent='Saved ✓'; msg.className='text-sm font-semibold text-emerald-600'; msg.classList.remove('hidden')
        setTimeout(()=> location.href = withBase('/app/expenses'), 600)
      } else {
        const arr = JSON.parse(localStorage.getItem('demo-expenses')||'[]')
        arr.unshift({ id:'d'+Date.now(), ...payload })
        localStorage.setItem('demo-expenses', JSON.stringify(arr))
        msg.textContent='Saved (demo) ✓'; msg.className='text-sm font-semibold text-emerald-600'; msg.classList.remove('hidden')
        setTimeout(()=> location.href = withBase('/app/expenses'), 600)
      }
    }catch(err:any){
      msg.textContent = err.message; msg.className='text-sm font-semibold text-red-600'; msg.classList.remove('hidden')
      btn.disabled=false; btn.textContent='Save'
    }
  })
}