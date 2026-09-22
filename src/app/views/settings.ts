import { supabase, isSupabaseConfigured } from '../../core/db/supabase'
import { getTheme, setTheme } from '../../core/utils/theme'

export function settingsView(): string {
  const theme = getTheme()
  return `
  <div class="max-w-[960px] mx-auto w-full px-4 lg:px-6 py-6 space-y-5">
    <!-- Profile -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black">ME</div>
        <div>
          <div id="set-name" class="font-black dark:text-white">Loading…</div>
          <div id="set-email" class="text-xs text-slate-500">—</div>
          <div class="mt-1 flex items-center gap-2">
            <span id="set-role" class="text-xs font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-2 py-0.5 rounded-full">owner</span>
            <span id="set-trial" class="text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded-full">Trial: —</span>
          </div>
        </div>
        <button id="set-logout" class="ml-auto px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold hover:bg-red-50 hover:text-red-600">Log out</button>
      </div>
      <div class="mt-4 grid sm:grid-cols-2 gap-3">
        <label class="text-sm font-bold dark:text-slate-200">Full name
          <input id="set-fullname" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm" placeholder="Your name" />
        </label>
        <label class="text-sm font-bold dark:text-slate-200">Phone
          <input id="set-phone" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm" placeholder="01XXXXXXXXX" />
        </label>
      </div>
      <button id="set-save-profile" class="mt-3 w-full sm:w-auto px-5 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black">Save profile</button>
      <div id="set-profile-msg" class="mt-2 text-xs font-semibold hidden"></div>
    </div>

    <!-- Store -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5">
      <div class="font-bold dark:text-white flex items-center gap-2"><span class="material-symbols-rounded text-[18px]">store</span> Store settings</div>
      <p class="text-xs text-slate-500 mt-1">Per spec: stores.name, BIN, address, phone, currency, VAT</p>
      <div class="mt-4 grid sm:grid-cols-2 gap-4">
        <label class="text-sm font-bold dark:text-slate-200">Store name *
          <input id="store-name" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm" />
        </label>
        <label class="text-sm font-bold dark:text-slate-200">Phone
          <input id="store-phone" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm" />
        </label>
        <label class="text-sm font-bold dark:text-slate-200">Address
          <input id="store-address" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm" placeholder="Zindabazar, Sylhet" />
        </label>
        <label class="text-sm font-bold dark:text-slate-200">BIN (NBR)
          <input id="store-bin" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm font-mono" placeholder="1234567890123" />
        </label>
        <label class="text-sm font-bold dark:text-slate-200">Currency
          <select id="store-currency" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"><option value="BDT">BDT (৳)</option><option value="USD">USD ($)</option></select>
        </label>
        <label class="text-sm font-bold dark:text-slate-200">VAT enabled
          <select id="store-vat" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"><option value="false">No</option><option value="true">Yes</option></select>
        </label>
      </div>
      <button id="store-save" class="mt-4 px-5 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black">Save store</button>
      <div id="store-msg" class="mt-2 text-xs font-semibold hidden"></div>
    </div>

    <!-- Preferences -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5">
      <div class="font-bold dark:text-white">Preferences</div>
      <div class="mt-3 flex items-center justify-between">
        <div>
          <div class="text-sm font-bold dark:text-slate-200">Dark mode</div>
          <div class="text-xs text-slate-500">Toggle white / dark theme</div>
        </div>
        <button id="pref-theme" class="w-12 h-7 rounded-full p-1 transition ${getTheme()==='dark'?'bg-slate-900':'bg-slate-200'} flex ${getTheme()==='dark'?'justify-end':'justify-start'}">
          <span class="w-5 h-5 rounded-full bg-white shadow grid place-items-center"><span class="material-symbols-rounded text-[14px]">${getTheme()==='dark'?'dark_mode':'light_mode'}</span></span>
        </button>
      </div>
      <div class="mt-4 flex items-center justify-between">
        <div>
          <div class="text-sm font-bold dark:text-slate-200">Notifications</div>
          <div class="text-xs text-slate-500">Low stock, new order, trial expiry (Realtime)</div>
        </div>
        <span class="text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full">Enabled</span>
      </div>
    </div>

    <!-- Hardware per spec -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5">
      <div class="font-bold dark:text-white flex items-center gap-2"><span class="material-symbols-rounded text-[18px]">print</span> Hardware — per spec 5A/5B</div>
      <p class="text-xs text-slate-500 mt-1">WebUSB / WebBluetooth ESC/POS + Barcode HID burst (<50ms → Enter)</p>
      <div class="mt-3 grid sm:grid-cols-2 gap-3">
        <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <div class="text-xs font-bold dark:text-slate-200">Thermal printer</div>
          <div class="text-xs text-slate-500">Bluetooth / USB</div>
          <button id="test-print" class="mt-2 w-full py-2 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold">Test print</button>
        </div>
        <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <div class="text-xs font-bold dark:text-slate-200">Barcode scanner</div>
          <div class="text-xs text-slate-500">HID • 58/80mm</div>
          <div class="mt-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5">Last scan: <span id="last-scan">—</span></div>
        </div>
      </div>
    </div>
  </div>
  `
}

export async function initSettings(){
  const nameEl = document.getElementById('set-name')!
  const emailEl = document.getElementById('set-email')!
  const roleEl = document.getElementById('set-role')!
  const trialEl = document.getElementById('set-trial')!
  const fullEl = document.getElementById('set-fullname') as HTMLInputElement
  const phoneEl = document.getElementById('set-phone') as HTMLInputElement
  const sName = document.getElementById('store-name') as HTMLInputElement
  const sPhone = document.getElementById('store-phone') as HTMLInputElement
  const sAddr = document.getElementById('store-address') as HTMLInputElement
  const sBin = document.getElementById('store-bin') as HTMLInputElement
  const sCurr = document.getElementById('store-currency') as HTMLSelectElement
  const sVat = document.getElementById('store-vat') as HTMLSelectElement

  // theme toggle in settings
  document.getElementById('pref-theme')?.addEventListener('click', async ()=>{
    const { toggleTheme, getTheme } = await import('../../core/utils/theme')
    toggleTheme()
    const t = getTheme()
    const btn = document.getElementById('pref-theme')!
    btn.className = `w-12 h-7 rounded-full p-1 transition ${t==='dark'?'bg-slate-900':'bg-slate-200'} flex ${t==='dark'?'justify-end':'justify-start'}`
  })

  document.getElementById('test-print')?.addEventListener('click', ()=> (window as any).toast?.('Test print — connect Bluetooth printer in browser'))

  // load user/store
  if(!isSupabaseConfigured){
    nameEl.textContent = 'Demo User'
    emailEl.textContent = 'demo@mekholi.local'
    sName.value = 'My Mekholi Store'
    return
  }
  try{
    const { data:{ user } } = await supabase.auth.getUser()
    if(!user){ nameEl.textContent='Not logged in'; return }
    emailEl.textContent = user.email || user.phone || '—'
    const { data: prof } = await supabase.from('profiles').select('full_name,role,store_id').eq('id', user.id).maybeSingle() as any
    if(prof){
      nameEl.textContent = prof.full_name || user.email || 'User'
      fullEl.value = prof.full_name || ''
      roleEl.textContent = prof.role || 'owner'
      const { data: store } = await supabase.from('stores').select('name,phone,address,bin,currency,vat_enabled,trial_ends_at,subscription_status').eq('id', prof.store_id).maybeSingle() as any
      if(store){
        sName.value = store.name || ''
        sPhone.value = store.phone || ''
        sAddr.value = store.address || ''
        sBin.value = store.bin || ''
        sCurr.value = store.currency || 'BDT'
        sVat.value = String(!!store.vat_enabled)
        // trial
        if(store.trial_ends_at){
          const days = Math.ceil((new Date(store.trial_ends_at).getTime() - Date.now())/86400000)
          trialEl.textContent = store.subscription_status==='trialing' ? `Trial: ${days} days left` : store.subscription_status
          trialEl.className = `text-xs font-bold px-2 py-0.5 rounded-full border ${days<=3?'bg-amber-50 border-amber-200 text-amber-700':'bg-emerald-50 border-emerald-200 text-emerald-700'}`
        }
      }
    }
  }catch(e){ console.warn(e) }

  // save profile
  document.getElementById('set-save-profile')?.addEventListener('click', async ()=>{
    const btn = document.getElementById('set-save-profile') as HTMLButtonElement
    const msg = document.getElementById('set-profile-msg')!
    btn.disabled = true; btn.textContent='Saving…'
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user) throw new Error('Not logged in')
      const { error } = await supabase.from('profiles').update({ full_name: fullEl.value.trim() } as any).eq('id', user.id)
      if(error) throw error
      msg.textContent='Profile saved ✓'; msg.className='mt-2 text-xs font-semibold text-emerald-600'; msg.classList.remove('hidden')
      nameEl.textContent = fullEl.value.trim() || 'User'
    }catch(err:any){ msg.textContent=err.message; msg.className='mt-2 text-xs font-semibold text-red-600'; msg.classList.remove('hidden') }
    btn.disabled=false; btn.textContent='Save profile'
  })

  document.getElementById('store-save')?.addEventListener('click', async ()=>{
    const btn = document.getElementById('store-save') as HTMLButtonElement
    const msg = document.getElementById('store-msg')!
    btn.disabled=true; btn.textContent='Saving…'
    try{
      const { data:{ user } } = await supabase.auth.getUser()
      if(!user) throw new Error('Not logged in')
      const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
      const sid = prof?.store_id
      if(!sid) throw new Error('No store')
      const { error } = await supabase.from('stores').update({
        name: sName.value.trim(),
        phone: sPhone.value.trim() || null,
        address: sAddr.value.trim() || null,
        bin: sBin.value.trim() || null,
        currency: sCurr.value,
        vat_enabled: sVat.value==='true'
      } as any).eq('id', sid)
      if(error) throw error
      msg.textContent='Store saved ✓'; msg.className='mt-2 text-xs font-semibold text-emerald-600'; msg.classList.remove('hidden')
    }catch(err:any){ msg.textContent=err.message; msg.className='mt-2 text-xs font-semibold text-red-600'; msg.classList.remove('hidden') }
    btn.disabled=false; btn.textContent='Save store'
  })

  document.getElementById('set-logout')?.addEventListener('click', async ()=>{
    await supabase.auth.signOut()
    location.href='/login'
  })

  // last scan demo
  window.addEventListener('keydown', (e)=>{
    const el = document.getElementById('last-scan')
    if(el && e.key==='Enter') el.textContent = new Date().toLocaleTimeString()
  })
}
