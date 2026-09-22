import { supabase } from '../../core/db/supabase'

export default function login(): string {
  return `
  <section class="min-h-[80vh] grid place-items-center px-4 py-10 bg-slate-50 dark:bg-[#020617]">
    <div class="w-full max-w-[440px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[24px] p-6 sm:p-7 shadow-sm">
      <a href="/" data-link class="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900"><span class="material-symbols-rounded text-[18px]">arrow_back</span> Back to site</a>
      <div class="mt-4 flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black text-xs">MK</div>
        <div class="font-extrabold dark:text-white">Mekholi</div>
        <span class="ml-auto text-[11px] font-bold tracking-widest bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full">7-DAY FREE TRIAL</span>
      </div>

      <!-- Tabs -->
      <div class="mt-6 grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-full">
        <button id="tab-login" class="py-2 rounded-full bg-white dark:bg-slate-900 text-sm font-bold shadow-sm">Log in</button>
        <button id="tab-register" class="py-2 rounded-full text-sm font-semibold text-slate-600 dark:text-slate-400">Register</button>
      </div>

      <!-- Google OAuth per spec -->
      <button id="google-btn" class="mt-4 w-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-full py-2.5 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white">
        <img src="https://www.svgrepo.com/show/475656/google-color.svg" class="w-5 h-5" alt="Google" /> Continue with Google
      </button>
      <div class="mt-3 flex items-center gap-3">
        <span class="flex-1 h-px bg-slate-200 dark:bg-slate-700"></span><span class="text-xs text-slate-500">or</span><span class="flex-1 h-px bg-slate-200 dark:bg-slate-700"></span>
      </div>

      <!-- Login form -->
      <form id="login-form" class="mt-4 space-y-3">
        <label class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">EMAIL
          <input name="email" type="email" required placeholder="you@store.com" class="mt-1 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white focus:border-slate-900" />
        </label>
        <label class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">PASSWORD
          <div class="relative mt-1">
            <input id="login-pass" name="password" type="password" required placeholder="••••••••" class="w-full px-4 py-2.5 pr-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" />
            <button type="button" id="toggle-pass" class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center text-slate-500"><span class="material-symbols-rounded text-[18px]">visibility</span></button>
          </div>
        </label>
        <button type="submit" class="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-full py-3 font-black text-sm hover:bg-black dark:hover:bg-slate-100">Log in</button>
        <div id="login-msg" class="hidden text-xs font-semibold p-3 rounded-xl"></div>
        <div class="text-center text-xs text-slate-500">No account? <button type="button" id="go-register" class="font-bold text-slate-900 dark:text-white underline">Create store</button></div>
      </form>

      <!-- Register form (per spec: Google + Form with store_name) -->
      <form id="register-form" class="mt-4 space-y-3 hidden">
        <label class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">STORE NAME *
          <input name="store_name" required placeholder="My Mekholi Store" class="mt-1 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" />
        </label>
        <label class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">FULL NAME
          <input name="full_name" placeholder="Your name" class="mt-1 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" />
        </label>
        <label class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">EMAIL *
          <input name="email" type="email" required placeholder="you@store.com" class="mt-1 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" />
        </label>
        <label class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">PASSWORD *
          <input name="password" type="password" required placeholder="Min 6 chars" class="mt-1 w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none text-sm dark:text-white" />
        </label>
        <div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 flex gap-2">
          <span class="material-symbols-rounded text-emerald-600 text-[18px]">verified</span>
          <div class="text-xs leading-4 text-emerald-800 dark:text-emerald-300"><b>7-day free trial</b> — auto store creation via trigger <code class="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 px-1 rounded">handle_new_user_signup()</code>. No card needed.</div>
        </div>
        <button type="submit" class="w-full bg-emerald-600 text-white rounded-full py-3 font-black text-sm hover:bg-emerald-700">Create store & start trial</button>
        <div id="register-msg" class="hidden text-xs font-semibold p-3 rounded-xl"></div>
        <div class="text-center text-xs text-slate-500">Have account? <button type="button" id="go-login" class="font-bold text-slate-900 dark:text-white underline">Log in</button></div>
      </form>

      <div class="mt-4 text-center text-[11px] text-slate-500">By continuing you agree to Terms & Privacy. Supabase Auth + RLS.</div>
    </div>
  </section>`
}

export function initLogin(){
  const loginForm = document.getElementById('login-form') as HTMLFormElement
  const registerForm = document.getElementById('register-form') as HTMLFormElement
  const tabLogin = document.getElementById('tab-login')!
  const tabRegister = document.getElementById('tab-register')!
  const goRegister = document.getElementById('go-register')!
  const goLogin = document.getElementById('go-login')!
  const googleBtn = document.getElementById('google-btn')!
  const loginMsg = document.getElementById('login-msg')!
  const registerMsg = document.getElementById('register-msg')!

  function showLogin(){
    loginForm.classList.remove('hidden'); registerForm.classList.add('hidden')
    tabLogin.className='py-2 rounded-full bg-white dark:bg-slate-900 text-sm font-bold shadow-sm'
    tabRegister.className='py-2 rounded-full text-sm font-semibold text-slate-600 dark:text-slate-400'
  }
  function showRegister(){
    registerForm.classList.remove('hidden'); loginForm.classList.add('hidden')
    tabRegister.className='py-2 rounded-full bg-white dark:bg-slate-900 text-sm font-bold shadow-sm'
    tabLogin.className='py-2 rounded-full text-sm font-semibold text-slate-600 dark:text-slate-400'
  }
  tabLogin.addEventListener('click', showLogin)
  tabRegister.addEventListener('click', showRegister)
  goRegister?.addEventListener('click', showRegister)
  goLogin?.addEventListener('click', showLogin)

  document.getElementById('toggle-pass')?.addEventListener('click', ()=>{
    const inp = document.getElementById('login-pass') as HTMLInputElement
    inp.type = inp.type==='password' ? 'text' : 'password'
  })

  googleBtn.addEventListener('click', async ()=>{
    try{
      const { error } = await supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: location.origin + '/dashboard' } })
      if(error) throw error
    }catch(e:any){
      loginMsg.textContent = e.message || 'Google OAuth not configured in Supabase'
      loginMsg.className = 'text-xs font-semibold p-3 rounded-xl bg-red-50 border border-red-200 text-red-700'
      loginMsg.classList.remove('hidden')
    }
  })

  loginForm.addEventListener('submit', async (e)=>{
    e.preventDefault()
    const fd = new FormData(loginForm)
    const email = String(fd.get('email')||'').trim()
    const password = String(fd.get('password')||'')
    const btn = loginForm.querySelector('button[type="submit"]') as HTMLButtonElement
    btn.disabled=true; btn.textContent='Logging in…'
    loginMsg.classList.add('hidden')
    try{
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if(error) throw error
      loginMsg.textContent='Logged in ✓ Redirecting…'
      loginMsg.className='text-xs font-semibold p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700'
      loginMsg.classList.remove('hidden')
      setTimeout(()=> location.href='/dashboard', 600)
    }catch(err:any){
      loginMsg.textContent = err.message || 'Login failed'
      loginMsg.className='text-xs font-semibold p-3 rounded-xl bg-red-50 border border-red-200 text-red-700'
      loginMsg.classList.remove('hidden')
      btn.disabled=false; btn.textContent='Log in'
    }
  })

  registerForm.addEventListener('submit', async (e)=>{
    e.preventDefault()
    const fd = new FormData(registerForm)
    const email = String(fd.get('email')||'').trim()
    const password = String(fd.get('password')||'')
    const store_name = String(fd.get('store_name')||'').trim()
    const full_name = String(fd.get('full_name')||'').trim()
    const btn = registerForm.querySelector('button[type="submit"]') as HTMLButtonElement
    btn.disabled=true; btn.textContent='Creating…'
    registerMsg.classList.add('hidden')
    try{
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { store_name, full_name } }
      })
      if(error) throw error
      registerMsg.textContent='Account created ✓ Check email to confirm, then log in. Store will auto-create with 7-day trial.'
      registerMsg.className='text-xs font-semibold p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700'
      registerMsg.classList.remove('hidden')
      btn.textContent='Created'
    }catch(err:any){
      registerMsg.textContent = err.message
      registerMsg.className='text-xs font-semibold p-3 rounded-xl bg-red-50 border border-red-200 text-red-700'
      registerMsg.classList.remove('hidden')
      btn.disabled=false; btn.textContent='Create store & start trial'
    }
  })
}
