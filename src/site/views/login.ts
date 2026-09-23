import { supabase } from '../../core/db/supabase'
import { withBase } from '../../core/utils/base'

export default function login(): string {
  return `
  <section class="min-h-[80vh] grid place-items-center px-4 py-10 bg-slate-50 dark:bg-[#020617]">
    <div class="w-full max-w-[440px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[24px] p-6 sm:p-7 shadow-sm">
      <a href="/" data-link class="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900"><span class="material-symbols-rounded text-[18px]">arrow_back</span> Back to site</a>
      <div id="auth-required-banner" class="hidden mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-semibold px-3 py-2.5 rounded-xl flex items-center gap-2"><span class="material-symbols-rounded text-[18px]">lock</span> Please log in to access the app — your session expired or you’re not signed in.</div>
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
  // show “auth required” banner if redirected from guard
  const qp = new URLSearchParams(location.search)
  if(qp.get('redirect')){
    document.getElementById('auth-required-banner')?.classList.remove('hidden')
  }
  // if Supabase not configured, show demo bypass
  import('../../core/db/supabase').then(m=>{
    if(!m.isSupabaseConfigured){
      loginMsg.innerHTML = `
        <div class="font-bold">Supabase not configured — Demo mode available</div>
        <div class="mt-1 text-[11px] leading-4">Set <code class="bg-white border px-1 rounded">VITE_SUPABASE_URL</code> / <code class="bg-white border px-1 rounded">VITE_SUPABASE_ANON_KEY</code> in <code>.env</code> for real auth, or continue offline.</div>
        <button id="demo-bypass" type="button" class="mt-3 w-full py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black">Continue in Demo (offline) →</button>
        <div class="mt-1 text-[11px] text-slate-500">GitHub Pages: add secrets in Settings → Secrets → Actions → VITE_SUPABASE_* then re-deploy.</div>
      `
      loginMsg.className = 'text-xs font-semibold p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800'
      loginMsg.classList.remove('hidden')
      setTimeout(()=>{
        document.getElementById('demo-bypass')?.addEventListener('click', ()=>{
          try { localStorage.setItem('mekholi:demo','1'); localStorage.setItem('mekholi-auth','demo') } catch {}
          const redirect = new URLSearchParams(location.search).get('redirect')
          const target = redirect && (redirect.startsWith('/app') || redirect.startsWith('/dashboard')) ? redirect : '/app'
          location.href = target
        })
      }, 50)
    }
  })

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
      const redirect = new URLSearchParams(location.search).get('redirect') || '/app'
      // Google OAuth needs absolute URL — Supabase will redirect back to /dashboard or /app after OAuth; we use /app as default
      const target = redirect.startsWith('/app') || redirect.startsWith('/dashboard') ? redirect : '/app'
      const { error } = await supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: location.origin + target } })
      if(error) throw error
    }catch(e:any){
      loginMsg.textContent = e.message || 'Google OAuth not configured in Supabase (enable Google provider + redirect URL in Supabase Auth)'
      loginMsg.className = 'text-xs font-semibold p-3 rounded-xl bg-red-50 border border-red-200 text-red-700'
      loginMsg.classList.remove('hidden')
    }
  })

  // --- helper: parse 49 seconds from "after 49 seconds" / handle 429 ---
  function parseWaitSeconds(msg: string): number {
    const m = msg.match(/(\d+)\s*seconds?/i) || msg.match(/after\s+(\d+)/i)
    if(m) return parseInt(m[1], 10)
    // global hourly limit "email rate limit exceeded" has no seconds -> suggest 60s retry but note hourly
    if(/email rate limit exceeded/i.test(msg)) return 60
    return 60
  }
  function startCountdown(btn: HTMLButtonElement, msgEl: HTMLElement, baseMsg: string, secs: number, originalText: string){
    let s = secs
    btn.disabled = true
    const tick = () => {
      if(s <= 0){
        btn.disabled = false
        btn.textContent = originalText
        msgEl.innerHTML = `${baseMsg} <span class="font-bold">You can try again now.</span>`
        return
      }
      btn.textContent = `Wait ${s}s…`
      msgEl.innerHTML = `${baseMsg} <span class="font-bold">Try again in ${s}s</span> • Check inbox/spam.`
      s--
      setTimeout(tick, 1000)
    }
    tick()
  }
  function isRateLimit(err:any){
    const msg = (err?.message||'').toLowerCase()
    return err?.code === 'over_email_send_rate_limit' || err?.status === 429 || /over_email_send_rate_limit/i.test(err?.message||'') || /only request this after/i.test(msg) || /email rate limit exceeded/i.test(msg)
  }
  function isGlobalRateLimit(err:any){
    return /email rate limit exceeded/i.test(err?.message||'') && !/\d+\s*seconds/i.test(err?.message||'')
  }

  loginForm.addEventListener('submit', async (e)=>{
    e.preventDefault()
    const fd = new FormData(loginForm)
    const email = String(fd.get('email')||'').trim()
    const password = String(fd.get('password')||'')
    const btn = loginForm.querySelector('button[type="submit"]') as HTMLButtonElement
    const original = 'Log in'
    btn.disabled=true; btn.textContent='Logging in…'
    loginMsg.classList.add('hidden')
    try{
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if(error) throw error
      loginMsg.textContent='Logged in ✓ Redirecting…'
      loginMsg.className='text-xs font-semibold p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700'
      loginMsg.classList.remove('hidden')
      const redirect = new URLSearchParams(location.search).get('redirect')
      const target = redirect && (redirect.includes('/app') || redirect.includes('/dashboard')) ? redirect : withBase('/app')
      setTimeout(()=> location.href=target, 500)
    }catch(err:any){
      if(isRateLimit(err)){
        const global = isGlobalRateLimit(err)
        const secs = parseWaitSeconds(err.message||'')
        if(global){
          loginMsg.innerHTML = `🚫 <b>Hourly email limit reached</b> (free Supabase ~30/hr).<br><span class="text-[11px] leading-4">All confirmation emails paused for ~1 hour. <b>Do NOT spam</b> — check spam, or log in if already registered, or <b>Continue in Demo</b>, or ask admin: <code class="bg-white border px-1 rounded">Supabase → Auth → Rate Limits</code> → increase, or <code>Confirm email OFF</code> for dev.<br>Button re-enables in ${secs}s but limit may persist.</span>`
        } else {
          loginMsg.innerHTML = `⏳ Too many requests — Supabase limits email to 1 per ~60s.<br><span class="text-[11px]">You asked too quickly. Please wait <b>${secs}s</b> then try again. For login, email is NOT needed — use your password. If you just registered, check spam and wait.</span>`
        }
        loginMsg.className='text-xs font-semibold p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 leading-4'
        loginMsg.classList.remove('hidden')
        startCountdown(btn, loginMsg, global ? `🚫 Hourly limit — retry in` : `⏳ Email rate limited.`, secs, original)
        return
      }
      // email not confirmed etc
      const msg = err.message || 'Login failed'
      if(/email not confirmed/i.test(msg)){
        loginMsg.innerHTML = `Email not confirmed. Check inbox (and spam) for confirmation link.<br><button id="resend-confirm" class="mt-2 text-xs font-bold underline">Resend confirmation</button>`
        loginMsg.className='text-xs font-semibold p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800'
        loginMsg.classList.remove('hidden')
        setTimeout(()=>{
          document.getElementById('resend-confirm')?.addEventListener('click', async ()=>{
            const { error } = await supabase.auth.resend({ type:'signup', email })
            if(error){
              if(isRateLimit(error)){
                const secs = parseWaitSeconds(error.message||'')
                const global = isGlobalRateLimit(error)
                loginMsg.innerHTML = global ? `🚫 Hourly limit — wait ~1h or use Demo.` : `Resend limited — wait ${secs}s.`
                startCountdown(btn, loginMsg, global ? '🚫 Hourly limit' : 'Resend limited.', secs, original)
              } else {
                loginMsg.textContent = error.message
              }
            } else {
              loginMsg.textContent = 'Confirmation resent — check email.'
              loginMsg.className='text-xs font-semibold p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700'
            }
          })
        }, 50)
      } else {
        loginMsg.textContent = msg
        loginMsg.className='text-xs font-semibold p-3 rounded-xl bg-red-50 border border-red-200 text-red-700'
        loginMsg.classList.remove('hidden')
      }
      btn.disabled=false; btn.textContent=original
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
    const original = 'Create store & start trial'
    btn.disabled=true; btn.textContent='Creating…'
    registerMsg.classList.add('hidden')
    try{
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { store_name, full_name } }
      })
      if(error) throw error
      // Supabase may not error but need confirmation: data.user && !data.session means email confirmation required
      if(data?.user && !data.session){
        registerMsg.innerHTML = `Account created ✓<br>Check <b>${email}</b> (and spam) for confirmation link. After confirming, log in. Store auto-creates with 7-day trial.<br><span class="text-[11px] text-slate-600">Didn't get email? Wait 60s then</span> <button id="resend-signup" class="text-xs font-bold underline">Resend</button>`
        registerMsg.className='text-xs font-semibold p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 leading-4'
        registerMsg.classList.remove('hidden')
        btn.textContent='Check email'
        setTimeout(()=>{
          document.getElementById('resend-signup')?.addEventListener('click', async ()=>{
            const { error } = await supabase.auth.resend({ type:'signup', email })
            if(error){
              if(isRateLimit(error)){
                const secs = parseWaitSeconds(error.message||'')
                const global = isGlobalRateLimit(error)
                registerMsg.innerHTML = global ? `🚫 Hourly limit — wait ~1h or use Demo.` : `Resend limited — wait ${secs}s.`
                registerMsg.className='text-xs font-semibold p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800'
                startCountdown(btn, registerMsg, global ? '🚫 Hourly limit' : 'Resend limited.', secs, original)
              } else {
                registerMsg.textContent = error.message
                registerMsg.className='text-xs font-semibold p-3 rounded-xl bg-red-50 border border-red-200 text-red-700'
              }
            } else {
              registerMsg.textContent = 'Confirmation resent — check email & spam.'
              registerMsg.className='text-xs font-semibold p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700'
            }
          })
        }, 50)
        return
      }
      registerMsg.textContent='Account created ✓ You can now log in. Store will auto-create with 7-day trial.'
      registerMsg.className='text-xs font-semibold p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700'
      registerMsg.classList.remove('hidden')
      btn.textContent='Created — Log in'
      setTimeout(()=> showLogin(), 1200)
    }catch(err:any){
      if(isRateLimit(err)){
        const global = isGlobalRateLimit(err)
        const secs = parseWaitSeconds(err.message||'')
        if(global){
          registerMsg.innerHTML = `🚫 <b>Hourly email limit reached</b> — free project ~30 emails/hour exceeded.<br><span class="text-[11px]">Supabase blocked all emails for ~1 hour. Options: (1) wait, (2) try different email, (3) <b>Continue in Demo</b>, (4) admin → <code class="bg-white border px-1 rounded">Supabase → Auth → Configuration → Rate Limits</code> → increase, or disable <code>Confirm email</code> for dev.</span>`
        } else {
          registerMsg.innerHTML = `⏳ <b>Email rate limited</b> — Supabase allows ~1 email per 60s.<br>You hit the limit. Please wait <b>${secs}s</b> then try again. Check inbox/spam for the previous email in the meantime.`
        }
        registerMsg.className='text-xs font-semibold p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 leading-4'
        registerMsg.classList.remove('hidden')
        startCountdown(btn, registerMsg, global ? `🚫 Hourly limit — retry in` : `⏳ Email limited — wait ${secs}s.`, secs, original)
        return
      }
      registerMsg.textContent = err.message
      registerMsg.className='text-xs font-semibold p-3 rounded-xl bg-red-50 border border-red-200 text-red-700'
      registerMsg.classList.remove('hidden')
      btn.disabled=false; btn.textContent=original
    }
  })
}
