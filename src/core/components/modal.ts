// Mekholi — Better modal to replace native confirm()/alert()/prompt()
// Tailwind + Material Symbols + dark/light, vanilla TS, promise-based

type ConfirmOpts = {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  variant?: 'default'|'danger'|'success'|'warning'
  icon?: string
}
type AlertOpts = {
  title?: string
  message: string
  variant?: 'info'|'success'|'warning'|'error'
  confirmText?: string
}
type PromptOpts = {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
  inputType?: 'text'|'number'|'email'|'tel'|'password'
  required?: boolean
  validator?: (v:string)=>string|null // return error string or null ok
}

function ensureRoot(): HTMLElement {
  let root = document.getElementById('mk-modal-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'mk-modal-root'
    root.className = 'fixed inset-0 z-[100] hidden'
    document.body.appendChild(root)
  }
  return root
}

function lockScroll(lock: boolean) {
  document.body.style.overflow = lock ? 'hidden' : ''
}

function mkEsc(cb: ()=>void) {
  const h = (e: KeyboardEvent) => { if (e.key === 'Escape') cb() }
  window.addEventListener('keydown', h, { once: true })
  return () => window.removeEventListener('keydown', h)
}

function modalShell(inner: string): string {
  return `
  <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" data-close></div>
  <div class="absolute inset-0 grid place-items-center p-4">
    <div class="w-full max-w-[420px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[24px] shadow-2xl overflow-hidden animate-[mkIn_.18s_ease]">
      ${inner}
    </div>
  </div>
  <style>@keyframes mkIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}</style>
  `
}

export function showAlert(opts: AlertOpts): Promise<void> {
  return new Promise(resolve => {
    const root = ensureRoot()
    const variant = opts.variant || 'info'
    const iconMap: Record<string,string> = { info:'info', success:'check_circle', warning:'warning', error:'error' }
    const icon = iconMap[variant] || 'info'
    const color: Record<string,string> = {
      info:'bg-slate-900 dark:bg-white text-white dark:text-slate-900',
      success:'bg-emerald-600 text-white',
      warning:'bg-amber-500 text-white',
      error:'bg-red-600 text-white'
    }
    root.innerHTML = modalShell(`
      <div class="p-6">
        <div class="w-10 h-10 rounded-2xl ${variant==='info'?'bg-slate-100 dark:bg-slate-800': variant==='success'?'bg-emerald-50 dark:bg-emerald-900/20': variant==='warning'?'bg-amber-50 dark:bg-amber-900/20':'bg-red-50 dark:bg-red-900/20'} border border-slate-200 dark:border-slate-700 grid place-items-center">
          <span class="material-symbols-rounded ${variant==='success'?'text-emerald-600': variant==='warning'?'text-amber-600': variant==='error'?'text-red-600':'text-slate-600 dark:text-slate-300'}">${icon}</span>
        </div>
        ${opts.title ? `<h3 class="mt-3 text-[16px] font-black dark:text-white">${opts.title}</h3>` : ''}
        <p class="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300">${opts.message}</p>
      </div>
      <div class="px-6 pb-6 flex justify-end">
        <button data-ok class="px-5 py-2.5 rounded-full text-sm font-black ${color[variant]}">${opts.confirmText || 'OK'}</button>
      </div>
    `)
    root.classList.remove('hidden')
    lockScroll(true)
    const offEsc = mkEsc(()=> close())
    function close(){
      root.classList.add('hidden'); lockScroll(false); offEsc(); resolve()
      root.innerHTML=''
    }
    root.querySelector('[data-close]')?.addEventListener('click', close)
    root.querySelector('[data-ok]')?.addEventListener('click', close)
  })
}

export function showConfirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise(resolve => {
    const root = ensureRoot()
    const variant = opts.variant || 'default'
    const danger = variant==='danger'
    const warn = variant==='warning'
    const succ = variant==='success'
    root.innerHTML = modalShell(`
      <div class="p-6">
        <div class="w-10 h-10 rounded-2xl ${danger?'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800': warn?'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800': succ?'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800':'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'} border grid place-items-center">
          <span class="material-symbols-rounded ${danger?'text-red-600': warn?'text-amber-600': succ?'text-emerald-600':'text-slate-700 dark:text-slate-200'}">${opts.icon || (danger?'warning': warn?'warning':'help')}</span>
        </div>
        <h3 class="mt-3 text-[16px] font-black dark:text-white">${opts.title}</h3>
        ${opts.message ? `<p class="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300 whitespace-pre-wrap">${opts.message}</p>` : ''}
      </div>
      <div class="px-6 pb-6 flex gap-3 justify-end">
        <button data-cancel class="px-5 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700">${opts.cancelText || 'Cancel'}</button>
        <button data-ok class="px-5 py-2.5 rounded-full text-sm font-black ${danger?'bg-red-600 hover:bg-red-700 text-white': warn?'bg-amber-500 hover:bg-amber-600 text-white': succ?'bg-emerald-600 hover:bg-emerald-700 text-white':'bg-slate-900 dark:bg-white hover:bg-black dark:hover:bg-slate-100 text-white dark:text-slate-900'}">${opts.confirmText || 'Confirm'}</button>
      </div>
    `)
    root.classList.remove('hidden')
    lockScroll(true)
    const offEsc = mkEsc(()=> close(false))
    function close(v:boolean){
      root.classList.add('hidden'); lockScroll(false); offEsc(); resolve(v)
      // cleanup after anim
      setTimeout(()=> { if(root.classList.contains('hidden')) root.innerHTML='' }, 200)
    }
    root.querySelector('[data-close]')?.addEventListener('click', ()=> close(false))
    root.querySelector('[data-cancel]')?.addEventListener('click', ()=> close(false))
    root.querySelector('[data-ok]')?.addEventListener('click', ()=> close(true))
  })
}

export function showPrompt(opts: PromptOpts): Promise<string|null> {
  return new Promise(resolve => {
    const root = ensureRoot()
    const inputType = opts.inputType || 'text'
    root.innerHTML = modalShell(`
      <div class="p-6">
        <h3 class="text-[16px] font-black dark:text-white">${opts.title}</h3>
        ${opts.message ? `<p class="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300">${opts.message}</p>` : ''}
        <label class="block mt-4">
          <input data-input type="${inputType}" placeholder="${(opts.placeholder||'').replace(/"/g,'&quot;')}" value="${(opts.defaultValue||'').replace(/"/g,'&quot;')}" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white focus:border-slate-900 dark:focus:border-white" ${opts.required?'required':''} />
          <div data-error class="hidden mt-2 text-xs font-bold text-red-600"></div>
        </label>
      </div>
      <div class="px-6 pb-6 flex gap-3 justify-end">
        <button data-cancel class="px-5 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700">${opts.cancelText || 'Cancel'}</button>
        <button data-ok class="px-5 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black hover:bg-black dark:hover:bg-slate-100">${opts.confirmText || 'Confirm'}</button>
      </div>
    `)
    root.classList.remove('hidden')
    lockScroll(true)
    const input = root.querySelector('[data-input]') as HTMLInputElement
    const errEl = root.querySelector('[data-error]') as HTMLElement
    setTimeout(()=> input.focus(), 50)
    input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doOk() })

    const offEsc = mkEsc(()=> close(null))
    function close(v:string|null){
      root.classList.add('hidden'); lockScroll(false); offEsc(); resolve(v)
      setTimeout(()=> { if(root.classList.contains('hidden')) root.innerHTML='' }, 200)
    }
    function doOk(){
      const v = input.value.trim()
      if (opts.required && !v) {
        errEl.textContent = 'Required'
        errEl.classList.remove('hidden')
        input.classList.add('!border-red-500')
        return
      }
      if (opts.validator) {
        const err = opts.validator(v)
        if (err) { errEl.textContent = err; errEl.classList.remove('hidden'); input.classList.add('!border-red-500'); return }
      }
      close(input.value) // keep raw (not trimmed for prompt that needs keep?)
    }
    root.querySelector('[data-close]')?.addEventListener('click', ()=> close(null))
    root.querySelector('[data-cancel]')?.addEventListener('click', ()=> close(null))
    root.querySelector('[data-ok]')?.addEventListener('click', doOk)
  })
}

// Convenience wrappers matching native but better
export const alertModal = (message:string, title?:string)=> showAlert({ message, title })
export const confirmModal = (title:string, message?:string)=> showConfirm({ title, message })
export const promptModal = (title:string, placeholder?:string, defaultValue?:string)=> showPrompt({ title, placeholder, defaultValue })
