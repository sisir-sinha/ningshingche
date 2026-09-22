import { checkSupabaseConnection, isSupabaseConfigured } from '../db/supabase'

export function renderSupabaseStatus(targetId = 'supabase-status'): void {
  const el = document.getElementById(targetId)
  if (!el) return
  el.innerHTML = `
    <div class="flex items-center gap-2 text-xs font-semibold text-slate-500">
      <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span> Checking Supabase…
    </div>
  `
  checkSupabaseConnection().then(s => {
    if (!s.configured) {
      el.innerHTML = `
        <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div class="flex items-center gap-2 font-bold text-amber-800"><span class="material-symbols-rounded text-[18px]">warning</span> Supabase not configured</div>
          <div class="mt-1 text-xs text-amber-800 leading-5">VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing. App runs in <b>offline demo mode</b> (IndexedDB only). Add keys to <code class="bg-white border px-1 rounded">.env</code> then restart <code>npm run dev</code>.</div>
          <div class="mt-2 text-[11px] font-mono bg-white border border-amber-200 rounded-lg p-2 break-all">VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co<br>VITE_SUPABASE_ANON_KEY=eyJhbG...</div>
          <div class="mt-3 flex gap-2">
            <a href="https://supabase.com/dashboard" target="_blank" class="text-xs font-bold bg-amber-500 text-white px-3 py-1.5 rounded-full">Open Supabase Dashboard →</a>
            <button data-copy-env class="text-xs font-bold bg-white border border-amber-200 px-3 py-1.5 rounded-full">Copy .env template</button>
          </div>
        </div>
      `
      el.querySelector('[data-copy-env]')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(`VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJhbGci...`)
        ;(window as any).toast?.('Copied .env template')
      })
      return
    }
    if (s.error) {
      el.innerHTML = `
        <div class="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div class="flex items-center gap-2 font-bold text-red-800"><span class="material-symbols-rounded text-[18px]">error</span> Supabase reachable, but error</div>
          <div class="mt-1 text-xs text-red-700 leading-5"><code class="bg-white border border-red-200 px-1.5 py-0.5 rounded">${s.error}</code></div>
          <div class="mt-1 text-[11px] text-red-600">If “relation does not exist”, run <code>supabase/schema.sql</code> in SQL Editor.</div>
          ${s.latencyMs ? `<div class="mt-2 text-xs text-slate-500">Latency: ${s.latencyMs}ms • Auth: ${s.authOk ? 'logged in' : 'no session'}</div>` : ''}
        </div>
      `
      return
    }
    el.innerHTML = `
      <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div class="flex items-center gap-2 font-bold text-emerald-800"><span class="material-symbols-rounded text-[18px]">check_circle</span> Supabase connected</div>
        <div class="mt-1 text-xs text-emerald-700 leading-5">URL: <code class="bg-white border border-emerald-200 px-1 rounded">${s.url}</code> • Latency: ${s.latencyMs}ms • Auth: ${s.authOk ? 'session ✓' : 'no session'}</div>
        <div class="mt-2 text-[11px] text-emerald-600">Schema: run <code>supabase/schema.sql</code> if tables missing. RLS enabled per store_id.</div>
      </div>
    `
  })
}

export function mountSupabaseBanner(): void {
  if (isSupabaseConfigured) return
  if (document.getElementById('supabase-banner')) return
  const banner = document.createElement('div')
  banner.id = 'supabase-banner'
  banner.className = 'sticky top-[64px] z-30 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-semibold px-4 py-2 flex items-center justify-center gap-2'
  banner.innerHTML = `<span class="material-symbols-rounded text-[16px]">warning</span> Supabase not configured — running offline demo. Add <code class="bg-white border border-amber-200 px-1 rounded">VITE_SUPABASE_URL</code> to .env for real data.`
  document.body.prepend(banner)
}
