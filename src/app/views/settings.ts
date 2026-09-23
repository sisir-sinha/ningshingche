import { supabase, isSupabaseConfigured } from '../../core/db/supabase'
import { getTheme } from '../../core/utils/theme'
import { getOutboxCount } from '../../core/db/idb'
import { bindImgbbDropZone } from '../../core/services/imgbb'
import { showPrompt } from '../../core/components/modal'
import { getLang, setLang, t } from '../../core/i18n'

export function settingsView(): string {
  return `
  <div class="max-w-[960px] mx-auto w-full px-4 lg:px-6 py-6 space-y-5">
    <!-- Profile -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5">
      <div class="flex items-center gap-3">
        <div class="relative">
          <img id="prof-avatar" src="" alt="" class="hidden w-12 h-12 rounded-full object-cover border border-slate-200 dark:border-slate-700" />
          <div id="prof-avatar-fallback" class="w-12 h-12 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black text-lg">ME</div>
        </div>
        <div class="min-w-0 flex-1">
          <div id="set-name" class="font-black dark:text-white truncate">Loading…</div>
          <div id="set-email" class="text-xs text-slate-500 truncate">—</div>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <span id="set-role" class="text-xs font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-2 py-0.5 rounded-full">owner</span>
            <span id="set-trial" class="text-xs font-bold bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">Trial: —</span>
            <span id="set-store-id" class="hidden text-xs font-mono text-slate-500"></span>
          </div>
        </div>
        <button id="set-logout" class="shrink-0 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:text-white">Log out</button>
      </div>
      <!-- Profile avatar upload — imgbb drag & drop -->
      <div id="prof-drop" class="mt-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-3 flex items-center gap-3 cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-800 transition">
        <div class="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 grid place-items-center shrink-0"><span class="material-symbols-rounded text-[18px]">face</span></div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-bold dark:text-white">Profile photo — drag & drop or click</div>
          <div class="text-xs text-slate-500">Auto-uploads to imgbb • URL saved to profile</div>
          <div id="prof-status" class="hidden text-xs font-semibold mt-1"></div>
        </div>
        <span class="text-xs font-bold px-3 py-1 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900">Browse</span>
        <input id="prof-file" type="file" accept="image/*" class="hidden" />
      </div>
      <input type="hidden" id="prof-avatar-url" />
      <div class="mt-4 grid sm:grid-cols-2 gap-3">
        <label class="text-sm font-bold dark:text-slate-200">Full name
          <input id="set-fullname" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" placeholder="Your name" />
        </label>
        <label class="text-sm font-bold dark:text-slate-200">Phone
          <input id="set-phone" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" placeholder="01XXXXXXXXX" />
        </label>
      </div>
      <div class="mt-3 flex gap-2">
        <button id="set-save-profile" class="px-5 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black">Save profile</button>
        <button id="set-change-pass" class="px-5 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold dark:text-white">Change password</button>
      </div>
      <div id="set-profile-msg" class="mt-2 text-xs font-semibold hidden"></div>
    </div>

    <!-- Store -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5">
      <div class="font-bold dark:text-white flex items-center gap-2"><span class="material-symbols-rounded text-[18px]">store</span> Store & Compliance</div>
      <p class="text-xs text-slate-500 mt-1">Name, BIN, address, VAT — prints on Mushak 6.3 receipt</p>
      <div class="mt-4 grid sm:grid-cols-2 gap-4">
        <label class="text-sm font-bold dark:text-slate-200">Store name *
          <input id="store-name" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" />
        </label>
        <label class="text-sm font-bold dark:text-slate-200">Phone
          <input id="store-phone" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" />
        </label>
        <label class="text-sm font-bold dark:text-slate-200">Address
          <input id="store-address" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" placeholder="Zindabazar, Sylhet" />
        </label>
        <label class="text-sm font-bold dark:text-slate-200">BIN (NBR) *
          <input id="store-bin" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white font-mono" placeholder="1234567890123" />
        </label>
        <label class="text-sm font-bold dark:text-slate-200">Currency
          <select id="store-currency" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white"><option value="BDT">BDT (৳)</option><option value="USD">USD ($)</option></select>
        </label>
        <label class="text-sm font-bold dark:text-slate-200">VAT enabled
          <select id="store-vat" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white"><option value="false">No</option><option value="true">Yes</option></select>
        </label>
        <label class="text-sm font-bold dark:text-slate-200">Default VAT %
          <select id="store-vat-rate" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white"><option value="0">0%</option><option value="5">5%</option><option value="7.5">7.5%</option><option value="10">10%</option><option value="15">15%</option></select>
        </label>
        <label class="text-sm font-bold dark:text-slate-200">Mushak area code
          <input id="store-area" placeholder="e.g., 101" class="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white" />
        </label>
      </div>
      <!-- Store logo — imgbb drag & drop -->
      <div id="store-logo-drop" class="mt-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-3 flex items-center gap-3 cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-800 transition">
        <img id="store-logo-preview" src="" alt="" class="hidden w-12 h-12 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
        <div id="store-logo-ph" class="w-12 h-12 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 grid place-items-center"><span class="material-symbols-rounded">storefront</span></div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-bold dark:text-white">Store logo / banner — drag & drop or click</div>
          <div class="text-xs text-slate-500">PNG/JPG • imgbb • shows on receipt</div>
          <div id="store-logo-status" class="hidden text-xs font-semibold mt-1"></div>
          <a id="store-logo-link" href="#" target="_blank" class="hidden text-xs font-mono text-sky-600 dark:text-sky-400 break-all">—</a>
        </div>
        <span class="text-xs font-bold px-3 py-1 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 shrink-0">Browse</span>
        <input id="store-logo-file" type="file" accept="image/*" class="hidden" />
      </div>
      <input type="hidden" id="store-logo-url" />
      <div class="mt-4 flex gap-2">
        <button id="store-save" class="px-5 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black">Save store</button>
        <button id="store-preview-receipt" class="px-5 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold dark:text-white">Preview receipt</button>
      </div>
      <div id="store-msg" class="mt-2 text-xs font-semibold hidden"></div>
      <div id="receipt-preview" class="hidden mt-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 font-mono text-xs leading-4 dark:text-white"></div>
    </div>

    <!-- Preferences -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5">
      <div class="font-bold dark:text-white">Preferences</div>
      <div class="mt-3 flex items-center justify-between">
        <div>
          <div class="text-sm font-bold dark:text-slate-200">Dark mode</div>
          <div class="text-xs text-slate-500">White / dark theme — persists</div>
        </div>
        <button id="pref-theme" class="w-12 h-7 rounded-full p-1 transition ${getTheme()==='dark'?'bg-slate-900':'bg-slate-200'} flex ${getTheme()==='dark'?'justify-end':'justify-start'}">
          <span class="w-5 h-5 rounded-full bg-white shadow grid place-items-center"><span class="material-symbols-rounded text-[14px]">${getTheme()==='dark'?'dark_mode':'light_mode'}</span></span>
        </button>
      </div>
      <div class="mt-4 flex items-center justify-between">
        <div>
          <div class="text-sm font-bold dark:text-slate-200" id="lang-title">${t('settings.language')}</div>
          <div class="text-xs text-slate-500" id="lang-hint">${t('settings.languageHint')}</div>
        </div>
        <div class="flex items-center gap-1 p-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <button data-lang="en" class="lang-btn px-3.5 py-1.5 rounded-full text-xs font-black transition ${getLang()==='en'?'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow':'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700'}">EN</button>
          <button data-lang="bn" class="lang-btn px-3.5 py-1.5 rounded-full text-xs font-black transition ${getLang()==='bn'?'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow':'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700'}">বাংলা</button>
        </div>
      </div>
      <!-- keep legacy select hidden for compat -->
      <select id="pref-lang" class="hidden"><option value="en">EN</option><option value="bn">BN</option></select>
      <div class="mt-4 flex items-center justify-between">
        <div>
          <div class="text-sm font-bold dark:text-slate-200">Sounds</div>
          <div class="text-xs text-slate-500">Beep on scan & success</div>
        </div>
        <label class="relative inline-flex items-center cursor-pointer"><input id="pref-sound" type="checkbox" checked class="sr-only peer"><div class="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-900"></div></label>
      </div>
    </div>

    <!-- Team / Roles -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5">
      <div class="flex items-center justify-between">
        <div class="font-bold dark:text-white flex items-center gap-2"><span class="material-symbols-rounded text-[18px]">group</span> Team (RLS)</div>
        <button id="team-invite" class="px-4 py-1.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold">Invite</button>
      </div>
      <p class="text-xs text-slate-500 mt-1">Owner: all • Manager: no settings/users • Cashier: POS only — enforced by RLS + UI guard</p>
      <div id="team-list" class="mt-3 space-y-2"></div>
      <div class="mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs">
        <b>Role guard:</b> Frontend hides Settings for cashier, backend RLS <code class="bg-white dark:bg-slate-900 border px-1 rounded">role='cashier'</code> blocks store update.
      </div>
    </div>

    <!-- Hardware per spec -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5">
      <div class="font-bold dark:text-white flex items-center gap-2"><span class="material-symbols-rounded text-[18px]">print</span> Hardware — per spec 5A/5B</div>
      <p class="text-xs text-slate-500 mt-1">WebUSB / WebBluetooth ESC/POS 58/80mm + HID burst (&lt;50ms → Enter) • 32/48 chars bitmap Bangla</p>
      <div class="mt-3 grid sm:grid-cols-3 gap-3">
        <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <div class="text-xs font-bold dark:text-slate-200">Thermal printer</div>
          <select id="hw-paper" class="mt-1 w-full px-2 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs dark:text-white"><option value="58">58mm (32ch)</option><option value="80">80mm (48ch)</option></select>
          <button id="test-print" class="mt-2 w-full py-2 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold dark:text-white">Test print</button>
          <button id="test-drawer" class="mt-1 w-full py-1.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold">Kick drawer</button>
        </div>
        <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <div class="text-xs font-bold dark:text-slate-200">Barcode scanner</div>
          <div class="text-xs text-slate-500">HID burst • Continues</div>
          <div class="mt-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5 dark:text-white">Last: <span id="last-scan">—</span></div>
          <button id="hw-test-scan" class="mt-2 w-full py-1.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold dark:text-white">Simulate scan</button>
        </div>
        <div class="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <div class="text-xs font-bold dark:text-slate-200">Receipt template</div>
          <textarea id="hw-footer" placeholder="Dhonnobad! Abar ashben." class="mt-1 w-full px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs dark:text-white" rows="2"></textarea>
          <button id="hw-save-footer" class="mt-1 w-full py-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold dark:text-white">Save footer</button>
        </div>
      </div>
    </div>

    <!-- Data & Backup -->
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[18px] p-5">
      <div class="font-bold dark:text-white flex items-center gap-2"><span class="material-symbols-rounded text-[18px]">backup</span> Data</div>
      <div class="mt-3 grid sm:grid-cols-3 gap-3 text-sm">
        <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white"><div class="text-xs text-slate-500">Outbox queue</div><div id="set-outbox" class="font-black">0 pending</div></div>
        <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white"><div class="text-xs text-slate-500">Last sync</div><div id="set-sync" class="text-xs">—</div></div>
        <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white"><div class="text-xs text-slate-500">Store DB</div><div class="text-xs font-mono" id="set-store-stats">—</div></div>
      </div>
      <div class="mt-3 flex gap-2">
        <button id="set-export-all" class="flex-1 py-2 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold">Export all CSV</button>
        <button id="set-clear-cache" class="flex-1 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold dark:text-white">Clear cache</button>
      </div>
      <div class="mt-2 text-xs text-slate-500">Offline first: <code class="bg-slate-100 dark:bg-slate-800 border px-1 rounded">idb.outbox + trySync()</code> — client_uuid dedup</div>
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
  const sVatRate = document.getElementById('store-vat-rate') as HTMLSelectElement
  const sArea = document.getElementById('store-area') as HTMLInputElement

  // imgbb bindings — profile + store logo (drag & drop, click, paste)
  {
    const profDrop = document.getElementById('prof-drop') as HTMLElement
    const profFile = document.getElementById('prof-file') as HTMLInputElement
    const profUrl = document.getElementById('prof-avatar-url') as HTMLInputElement
    const profImg = document.getElementById('prof-avatar') as HTMLImageElement
    const profFallback = document.getElementById('prof-avatar-fallback') as HTMLElement
    const profStatus = document.getElementById('prof-status') as HTMLElement
    const storedProf = localStorage.getItem('mekholi:prof-avatar') || (profUrl?.value||'')
    if(storedProf){ profUrl.value = storedProf; profImg.src=storedProf; profImg.classList.remove('hidden'); profFallback.classList.add('hidden') }
    if(profDrop && profFile){
      bindImgbbDropZone({
        zone: profDrop, input: profFile,
        onUrl: (url)=>{
          profUrl.value = url; localStorage.setItem('mekholi:prof-avatar', url)
          profImg.src = url; profImg.classList.remove('hidden'); profFallback.classList.add('hidden')
          profStatus.textContent = url; profStatus.className='text-xs font-mono text-emerald-600 break-all'; profStatus.classList.remove('hidden')
        },
        onProgress: (p,m)=>{
          if(p==='uploading'){ profStatus.textContent='Uploading…'; profStatus.className='text-xs font-bold text-slate-600'; profStatus.classList.remove('hidden') }
          else if(p==='done'){ profStatus.textContent='Uploaded ✓'; profStatus.className='text-xs font-bold text-emerald-600'; }
          else if(p==='error'){ profStatus.textContent=m||'Upload failed'; profStatus.className='text-xs font-bold text-red-600'; profStatus.classList.remove('hidden') }
        }
      })
    }
    const logoDrop = document.getElementById('store-logo-drop') as HTMLElement
    const logoFile = document.getElementById('store-logo-file') as HTMLInputElement
    const logoUrl = document.getElementById('store-logo-url') as HTMLInputElement
    const logoPrev = document.getElementById('store-logo-preview') as HTMLImageElement
    const logoPh = document.getElementById('store-logo-ph') as HTMLElement
    const logoStatus = document.getElementById('store-logo-status') as HTMLElement
    const logoLink = document.getElementById('store-logo-link') as HTMLAnchorElement
    const storedLogo = localStorage.getItem('mekholi:store-logo') || (logoUrl?.value||'')
    if(storedLogo){ logoUrl.value=storedLogo; logoPrev.src=storedLogo; logoPrev.classList.remove('hidden'); logoPh.classList.add('hidden'); logoLink.href=storedLogo; logoLink.textContent=storedLogo; logoLink.classList.remove('hidden') }
    if(logoDrop && logoFile){
      bindImgbbDropZone({
        zone: logoDrop, input: logoFile,
        onUrl: (url)=>{
          logoUrl.value=url; localStorage.setItem('mekholi:store-logo', url)
          logoPrev.src=url; logoPrev.classList.remove('hidden'); logoPh.classList.add('hidden')
          logoLink.href=url; logoLink.textContent=url; logoLink.classList.remove('hidden')
          logoStatus.textContent='Uploaded ✓ — shows on receipt'; logoStatus.className='text-xs font-bold text-emerald-600'; logoStatus.classList.remove('hidden')
        },
        onProgress: (p,m)=>{
          if(p==='uploading'){ logoStatus.textContent='Uploading…'; logoStatus.className='text-xs font-bold text-slate-600'; logoStatus.classList.remove('hidden') }
          else if(p==='error'){ logoStatus.textContent=m||'Upload failed'; logoStatus.className='text-xs font-bold text-red-600'; logoStatus.classList.remove('hidden') }
        }
      })
    }
  }

  document.getElementById('pref-theme')?.addEventListener('click', async ()=>{
    const { toggleTheme, getTheme } = await import('../../core/utils/theme')
    toggleTheme()
    const t = getTheme()
    const btn = document.getElementById('pref-theme')!
    btn.className = `w-12 h-7 rounded-full p-1 transition ${t==='dark'?'bg-slate-900':'bg-slate-200'} flex ${t==='dark'?'justify-end':'justify-start'}`
  })
  // language EN/BN — instant, persists, toast
  document.querySelectorAll('.lang-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const lang = (btn as HTMLElement).dataset.lang as 'en'|'bn'
      setLang(lang)
      document.querySelectorAll('.lang-btn').forEach(b=>{
        const l=(b as HTMLElement).dataset.lang
        b.className = `lang-btn px-3.5 py-1.5 rounded-full text-xs font-black transition ${l===lang?'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow':'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700'}`
      })
      const lt=document.getElementById('lang-title'); if(lt) lt.textContent=t('settings.language')
      const lh=document.getElementById('lang-hint'); if(lh) lh.textContent=t('settings.languageHint')
      ;(window as any).toast?.(lang==='bn' ? 'ভাষা: বাংলা ✓' : 'Language: English ✓')
      // also update hidden select for legacy
      const sel=document.getElementById('pref-lang') as HTMLSelectElement|null; if(sel) sel.value=lang
    })
  })
  document.getElementById('test-print')?.addEventListener('click', async ()=>{
    try{
      if((navigator as any).bluetooth){
        (window as any).toast?.('Bluetooth printer — select device')
        await (navigator as any).bluetooth.requestDevice({acceptAllDevices:true}).catch(()=>{})
      } else (window as any).toast?.('Test print — ESC/POS 0x1B 0x40 (demo)')
    }catch{}
  })
  document.getElementById('test-drawer')?.addEventListener('click', async ()=>{
    try{ if((navigator as any).usb) await (navigator as any).usb.requestDevice({filters:[]}).catch(()=>{}) }catch{}
    ;(window as any).toast?.('Drawer kick 0x1B 0x70')
  })
  document.getElementById('hw-test-scan')?.addEventListener('click', ()=>{
    const code='890100001'
    document.getElementById('last-scan')!.textContent = `${code} • ${new Date().toLocaleTimeString()}`
    ;(window as any).toast?.('Scan: '+code)
  })
  document.getElementById('hw-save-footer')?.addEventListener('click', ()=>{
    localStorage.setItem('receipt-footer', (document.getElementById('hw-footer') as HTMLTextAreaElement).value)
    ;(window as any).toast?.('Footer saved')
  })
  const footer = localStorage.getItem('receipt-footer')
  if(footer) (document.getElementById('hw-footer') as HTMLTextAreaElement).value = footer

  if(!isSupabaseConfigured){
    nameEl.textContent = 'Demo User'
    emailEl.textContent = 'demo@mekholi.local'
    sName.value = 'My Mekholi Store'
    document.getElementById('team-list')!.innerHTML = `<div class="text-sm dark:text-white">Demo: owner@demo.local • owner</div>`
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
      phoneEl.value = (user as any).phone || ''
      roleEl.textContent = prof.role || 'owner'
      // team
      const { data: team } = await supabase.from('profiles').select('full_name,role').eq('store_id', prof.store_id) as any
      document.getElementById('team-list')!.innerHTML = (team||[]).map((m:any)=>`
        <div class="flex items-center justify-between bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
          <div class="text-sm font-bold dark:text-white">${m.full_name||'—'}</div><span class="text-xs px-2 py-1 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 dark:text-white">${m.role}</span>
        </div>
      `).join('') || `<div class="text-sm text-slate-500">No team — invite first</div>`
      document.getElementById('team-invite')?.addEventListener('click', async ()=> {
        const email=await showPrompt({ title:'Invite team member', message:'Enter email to invite', placeholder:'colleague@store.com', inputType:'email', required:true, validator: v=> /\S+@\S+\.\S+/.test(v)? null : 'Enter valid email' }); if(!email) return
        ;(window as any).toast?.('Invite sent to '+email+' (demo — add via Supabase Auth)')
      })

      const { data: store } = await supabase.from('stores').select('name,phone,address,bin,currency,vat_enabled,default_vat_rate,trial_ends_at,subscription_status').eq('id', prof.store_id).maybeSingle() as any
      if(store){
        sName.value = store.name || ''
        sPhone.value = store.phone || ''
        sAddr.value = store.address || ''
        sBin.value = store.bin || ''
        sCurr.value = store.currency || 'BDT'
        sVat.value = String(!!store.vat_enabled)
        sVatRate.value = String(store.default_vat_rate||15)
        const vatp = await supabase.from('vat_profiles').select('bin,vat_area_code').eq('store_id', prof.store_id).maybeSingle() as any
        if(vatp.data) sArea.value = vatp.data.vat_area_code||''
        if(store.trial_ends_at){
          const days = Math.ceil((new Date(store.trial_ends_at).getTime() - Date.now())/86400000)
          trialEl.textContent = store.subscription_status==='trialing' ? `Trial: ${days} days left` : store.subscription_status
          trialEl.className = `text-xs font-bold px-2 py-0.5 rounded-full border ${days<=3?'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300':'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'}`
        }
        document.getElementById('set-store-id')!.textContent = prof.store_id
        document.getElementById('set-store-id')!.classList.remove('hidden')
      }
    }
  }catch(e){ console.warn(e) }

  // stats
  try{
    const n = await getOutboxCount().catch(()=>0)
    document.getElementById('set-outbox')!.textContent = `${n} pending`
    document.getElementById('set-sync')!.textContent = navigator.onLine ? 'Online • auto' : 'Offline'
    if(isSupabaseConfigured){
      const { data:{ user } } = await supabase.auth.getUser()
      if(user){
        const { data: prof } = await supabase.from('profiles').select('store_id').eq('id', user.id).maybeSingle() as any
        const sid=prof?.store_id
        if(sid){
          const { count: pc } = await supabase.from('products').select('id',{count:'exact', head:true}).eq('store_id', sid) as any
          const { count: oc } = await supabase.from('orders').select('id',{count:'exact', head:true}).eq('store_id', sid) as any
          document.getElementById('set-store-stats')!.textContent = `Products ${pc||0} • Orders ${oc||0}`
        }
      }
    }
  }catch{}

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
  document.getElementById('set-change-pass')?.addEventListener('click', async ()=>{
    const email = await showPrompt({ title:'Reset password', message:'Enter email for reset link', placeholder:'you@store.com', inputType:'email', required:true, validator: v=> /\S+@\S+\.\S+/.test(v)? null : 'Enter valid email' })
    if(!email) return
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/login' })
    if(error) (window as any).toast?.(error.message); else (window as any).toast?.('Reset link sent')
  })
  document.getElementById('store-preview-receipt')?.addEventListener('click', ()=>{
    const preview = document.getElementById('receipt-preview')!
    preview.classList.remove('hidden')
    preview.innerHTML = `
      <div class="text-center font-black">${sName.value||'My Store'}</div>
      <div class="text-center text-[11px] text-slate-500">BIN ${sBin.value||'—'} • ${sAddr.value||'Addr'}</div>
      <div class="text-center text-[11px]">Mushak 6.3 • ${sVatRate.value}% VAT</div>
      <div class="border-t border-dashed border-slate-300 my-2"></div>
      <div>Demo receipt — ${(document.getElementById('hw-footer') as HTMLTextAreaElement).value||'Dhonnobad!'}</div>
    `
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
        vat_enabled: sVat.value==='true',
        default_vat_rate: parseFloat(sVatRate.value)||0
      } as any).eq('id', sid)
      if(error) throw error
      await supabase.from('vat_profiles').upsert({ store_id: sid, bin: sBin.value.trim(), vat_area_code: sArea.value.trim()||null, default_vat_rate: parseFloat(sVatRate.value)||15 } as any)
      msg.textContent='Store saved ✓'; msg.className='mt-2 text-xs font-semibold text-emerald-600'; msg.classList.remove('hidden')
    }catch(err:any){ msg.textContent=err.message; msg.className='mt-2 text-xs font-semibold text-red-600'; msg.classList.remove('hidden') }
    btn.disabled=false; btn.textContent='Save store'
  })
  document.getElementById('set-logout')?.addEventListener('click', async ()=>{
    await supabase.auth.signOut()
    location.href='/login'
  })
  document.getElementById('set-export-all')?.addEventListener('click', async ()=>{
    const blob=new Blob(['id,name\n demo'],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='mekholi-backup.csv'; a.click(); URL.revokeObjectURL(url)
  })
  document.getElementById('set-clear-cache')?.addEventListener('click', ()=>{
    localStorage.clear(); sessionStorage.clear(); (window as any).toast?.('Cache cleared')
  })
  window.addEventListener('keydown', (e)=>{
    const el = document.getElementById('last-scan')
    if(el && e.key==='Enter') el.textContent = new Date().toLocaleTimeString()
  })
}
