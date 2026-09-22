export default function landing(): string {
  return `
  <!-- NAVBAR -->
  <header id="site-header" class="sticky top-0 z-50 backdrop-blur-xl bg-white/80 dark:bg-slate-950/80 border-b border-slate-100 dark:border-slate-800">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 flex items-center justify-between h-[64px]">
      <a href="/" data-link class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black text-[13px] tracking-tight">MK</div>
        <div>
          <div class="font-extrabold leading-none tracking-tight text-slate-900 dark:text-white">Mekholi</div>
          <div class="text-[10px] font-bold tracking-[0.14em] text-emerald-600 -mt-0.5">POS • KHATA • HISAB</div>
        </div>
      </a>
      <nav class="hidden lg:flex items-center gap-1 text-[13px] font-medium">
        <a href="#architecture" class="px-3 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Architecture</a>
        <a href="#schema" class="px-3 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Database</a>
        <a href="#features" class="px-3 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Features</a>
        <a href="/pricing" data-link class="px-3 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Pricing</a>
        <a href="/help" data-link class="px-3 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Docs</a>
      </nav>
      <div class="flex items-center gap-2">
        <button id="site-theme-toggle" class="w-9 h-9 grid place-items-center rounded-full border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800" title="Toggle theme">
          <span data-theme-icon class="material-symbols-rounded text-[18px]">dark_mode</span>
        </button>
        <button id="lang-toggle" class="hidden sm:inline-flex px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-xs font-bold items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-slate-300">
          <span class="material-symbols-rounded text-[16px]">language</span> <span id="lang-label">BN / EN</span>
        </button>
        <a href="/login" data-link class="hidden sm:inline-flex text-sm font-semibold px-4 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-white">Log in</a>
        <a href="/app" data-link class="inline-flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold px-5 py-2.5 rounded-full hover:bg-black dark:hover:bg-slate-100 transition shadow-sm">
          Open App <span class="material-symbols-rounded text-[18px]">arrow_forward</span>
        </a>
        <button id="mobile-menu-btn" class="lg:hidden w-9 h-9 grid place-items-center rounded-full border border-slate-200 dark:border-slate-700 dark:text-white">
          <span class="material-symbols-rounded">menu</span>
        </button>
      </div>
    </div>
    <div id="mobile-menu" class="hidden lg:hidden border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-4 space-y-1">
      <a href="#architecture" class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 font-medium dark:text-white">Architecture</a>
      <a href="#schema" class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 font-medium dark:text-white">Database</a>
      <a href="#features" class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 font-medium dark:text-white">Features</a>
      <a href="/pricing" data-link class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 font-medium dark:text-white">Pricing</a>
      <div class="pt-2 flex gap-2">
        <button id="site-theme-toggle-mobile" class="flex-1 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 font-bold flex items-center justify-center gap-2 dark:text-white"><span data-theme-icon class="material-symbols-rounded text-[18px]">dark_mode</span> Theme</button>
        <a href="/login" data-link class="flex-1 text-center font-semibold py-2.5 rounded-full border border-slate-200 dark:border-slate-700 dark:text-white">Log in</a>
      </div>
    </div>
  </header>

  <!-- HERO — Spec Blueprint -->
  <section class="relative overflow-hidden border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
    <div class="absolute inset-0 bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950"></div>
    <div class="absolute -top-24 -right-24 w-[520px] h-[520px] bg-sky-50 dark:bg-sky-900/20 rounded-full blur-[80px] opacity-60"></div>
    <div class="relative max-w-[1120px] mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-10">
      <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold tracking-wide">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Mekholi POS • Architecture & Design Specification • v1.0 — Complete Technical Blueprint
      </div>
      <div class="grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-start mt-6">
        <div>
          <h1 class="text-[34px] sm:text-[46px] font-black leading-[0.95] tracking-tight text-slate-900 dark:text-white">
            The reliable POS<br>
            <span class="text-slate-500 dark:text-slate-400">that survives real shops</span>
          </h1>
          <p class="mt-4 text-[15.5px] leading-6 text-slate-600 dark:text-slate-400 max-w-[56ch]">
            Mekholi is a multi-tenant POS + Khata built on <b class="text-slate-900 dark:text-white">Supabase + PostgreSQL + Vanilla TypeScript</b> (lite). Offline-first, RLS tenant isolation, 7-day trial trigger, WebUSB/WebBluetooth ESC/POS & HID burst scanner — optimized for 2GB RAM Android phones in Bangladesh.
          </p>
          <div class="mt-6 flex flex-wrap gap-3">
            <a href="/app" data-link class="inline-flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-6 py-3 rounded-full font-bold hover:bg-black dark:hover:bg-slate-100 transition">
              <span class="material-symbols-rounded">bolt</span> Open Lite App — Free Trial
            </a>
            <a href="#architecture" class="inline-flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-6 py-3 rounded-full font-bold hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-white">
              <span class="material-symbols-rounded">architecture</span> View Blueprint
            </a>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span class="inline-flex items-center gap-1.5"><span class="material-symbols-rounded text-[16px] text-emerald-600">verified</span> History API — no #</span>
            <span class="inline-flex items-center gap-1.5"><span class="material-symbols-rounded text-[16px] text-emerald-600">smartphone</span> 42KB bundle • &lt;280ms tap→print</span>
            <span class="inline-flex items-center gap-1.5"><span class="material-symbols-rounded text-[16px] text-emerald-600">wifi_off</span> IndexedDB offline queue</span>
          </div>
          <div class="mt-6 flex items-center gap-2 text-xs font-mono">
            <span class="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-slate-300">vanilla TS + Vite</span>
            <span class="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-slate-300">Tailwind + FA6 Pro + Material</span>
            <span class="px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">RLS • Realtime • Edge</span>
          </div>
        </div>

        <!-- Spec card — cart + architecture preview -->
        <div class="relative">
          <div class="bg-white dark:bg-slate-900 rounded-[24px] shadow-[0_20px_60px_rgba(15,23,42,0.08)] border border-slate-200 dark:border-slate-800 p-5 overflow-hidden">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-red-400"></span><span class="w-3 h-3 rounded-full bg-amber-400"></span><span class="w-3 h-3 rounded-full bg-emerald-400"></span></div>
              <div class="text-[11px] font-bold tracking-widest text-slate-400">MEKHOLI POS • OFFLINE ✓</div>
              <div class="text-[10px] font-bold bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2 py-1 rounded-full">● RLS ON</div>
            </div>
            <div class="grid grid-cols-[1.35fr_0.85fr] gap-4 mt-4">
              <div class="bg-slate-50 dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700">
                <div class="flex items-center justify-between">
                  <div class="text-[11px] font-extrabold tracking-widest text-slate-500 dark:text-slate-400">POS — CART</div>
                  <div class="text-[10px] font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-full dark:text-white">58mm</div>
                </div>
                <div class="mt-3 space-y-2 text-[13px]">
                  <div class="flex justify-between items-center bg-white dark:bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-200 dark:border-slate-700 dark:text-white"><span>Miniket 1kg</span><span class="font-bold">2 × ৳78</span></div>
                  <div class="flex justify-between items-center bg-white dark:bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-200 dark:border-slate-700 dark:text-white"><span>Parachute Oil</span><span class="font-bold">1 × ৳180</span></div>
                </div>
                <div class="mt-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl p-3">
                  <div class="flex justify-between text-xs opacity-80"><span>VAT 5%</span><span>৳16</span></div>
                  <div class="flex justify-between font-black text-[18px] mt-1"><span>TOTAL</span><span>৳335</span></div>
                  <div class="mt-2 grid grid-cols-2 gap-2">
                    <div class="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-full py-2 text-xs font-bold text-center border border-slate-200 dark:border-slate-700">Cash</div>
                    <div class="bg-emerald-500 text-white rounded-full py-2 text-xs font-bold text-center">bKash ✓</div>
                  </div>
                </div>
              </div>
              <div class="space-y-3">
                <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 font-mono text-[11px] leading-4 shadow-sm dark:text-white">
                  <div class="text-center font-black text-[12px]">MEKHOLI — SYLHET</div>
                  <div class="text-center text-[10px] text-slate-500">BIN: 123456789 ****</div>
                  <div class="text-center text-[9px] tracking-widest text-slate-500">MUSHAK 6.3 • 22 Sep 2026</div>
                  <div class="border-t border-dashed border-slate-200 dark:border-slate-700 my-2"></div>
                  <div class="flex justify-between font-bold"><span>TOTAL</span><span>৳335</span></div>
                  <div class="flex justify-between text-emerald-600 font-bold"><span>Paid</span><span>৳200</span></div>
                  <div class="flex justify-between text-red-600 font-black bg-red-50 dark:bg-red-900/20 rounded px-1 py-0.5 mt-1"><span>BAKI</span><span>৳135</span></div>
                  <div class="mt-2 grid place-items-center"><div class="w-16 h-16 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg grid place-items-center text-[8px] font-bold">Bangla QR</div></div>
                </div>
                <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-3">
                  <div class="text-[11px] font-extrabold tracking-widest text-amber-700 dark:text-amber-300">KHATA • RAHIM</div>
                  <div class="text-xs font-bold dark:text-white">01712-345678 • Due ৳1,170</div>
                  <button class="mt-2 w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-full py-2 text-xs font-bold flex items-center justify-center gap-1.5"><span class="material-symbols-rounded text-[14px]">sms</span> Tagada SMS</button>
                </div>
              </div>
            </div>
            <div class="mt-4 grid grid-cols-3 gap-3">
              <div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-3 text-center"><div class="text-[11px] font-bold tracking-widest text-emerald-700 dark:text-emerald-300">TRIGGER</div><div class="font-black text-slate-900 dark:text-white text-xs">handle_new_user_signup()</div></div>
              <div class="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-2xl p-3 text-center"><div class="text-[11px] font-bold tracking-widest text-sky-700 dark:text-sky-300">RLS</div><div class="font-black text-slate-900 dark:text-white text-xs">store_id = current_store_id()</div></div>
              <div class="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-2xl p-3 text-center"><div class="text-[11px] font-bold tracking-widest text-violet-700 dark:text-violet-300">PERIPHERAL</div><div class="font-black text-slate-900 dark:text-white text-xs">WebUSB ESC/POS</div></div>
            </div>
          </div>
          <div class="mt-3 text-center text-[11px] font-mono text-slate-500 dark:text-slate-400">Vault secret → server-only Supabase • IndexedDB first • 280ms cached start</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ARCHITECTURE — from PDF p4-5 -->
  <section id="architecture" class="max-w-[1120px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
    <div class="max-w-3xl">
      <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full"><span class="material-symbols-rounded text-[16px]">architecture</span> ARCHITECTURAL OVERVIEW — P4</div>
      <h2 class="mt-3 text-[28px] sm:text-[34px] font-black tracking-tight leading-none text-slate-900 dark:text-white">Platform choice: why Vanilla TS (lite)</h2>
      <p class="mt-3 text-slate-600 dark:text-slate-400">Spec proposed Nuxt 3 SSR for SEO + Dashboard performance. For Bangladesh low-end phones we shipped <b class="text-slate-900 dark:text-white">Lite: Vanilla TS + Vite</b> — same Supabase contract, 90% smaller. SSR path reserved behind <code class="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded text-xs">/dashboard</code> per spec.</p>
    </div>

    <div class="mt-8 grid lg:grid-cols-[1.4fr_0.9fr] gap-6">
      <!-- Table -->
      <div class="overflow-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 dark:bg-slate-800 text-xs font-extrabold tracking-widest text-slate-500 dark:text-slate-400">
            <tr><th class="text-left p-3">CRITERION</th><th class="text-left p-3 text-emerald-700 dark:text-emerald-400">VANILLA TS (SHIPPED)</th><th class="text-left p-3">VUE 3 + NUXT (SPEC)</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800 dark:text-slate-300">
            <tr><td class="p-3 font-semibold">Bundle</td><td class="p-3 font-bold text-emerald-700 dark:text-emerald-400">~42KB gz • 2G ready</td><td class="p-3">~180KB+ • heavier</td></tr>
            <tr><td class="p-3 font-semibold">Dashboard</td><td class="p-3">SPA + Realtime channel</td><td class="p-3">SSR — spec ✓ reserved</td></tr>
            <tr><td class="p-3 font-semibold">Type Safety</td><td class="p-3">Strict TS + Supabase types</td><td class="p-3">Vue SFC + TS</td></tr>
            <tr><td class="p-3 font-semibold">Offline</td><td class="p-3 font-bold">IndexedDB queue + sync</td><td class="p-3">Same, via Nuxt PWA</td></tr>
            <tr><td class="p-3 font-semibold">Peripheral</td><td class="p-3">WebUSB/Bluetooth/HID natively</td><td class="p-3">Client-only plugin</td></tr>
            <tr><td class="p-3 font-semibold">Routing</td><td class="p-3 font-mono">History API + fallback (no #)</td><td class="p-3 font-mono">Nuxt file router</td></tr>
          </tbody>
        </table>
      </div>
      <!-- Diagram -->
      <div class="bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl p-5 border border-slate-800 dark:border-slate-200">
        <div class="text-xs font-extrabold tracking-widest opacity-70">SYSTEM DIAGRAM — P5</div>
        <div class="mt-4 space-y-2 font-mono text-xs">
          <div class="bg-white/10 dark:bg-slate-100 border border-white/10 dark:border-slate-200 rounded-xl px-3 py-2 flex justify-between">Client (Vanilla TS Vite) <span class="opacity-60">PWA</span></div>
          <div class="grid place-items-center opacity-60">↕ HTTPS + Realtime</div>
          <div class="bg-emerald-500 text-white rounded-xl px-3 py-2 font-bold text-center">Supabase — Auth • Postgres • RLS • Realtime • Edge</div>
          <div class="grid grid-cols-2 gap-2">
            <div class="bg-white/10 dark:bg-slate-100 border border-white/10 dark:border-slate-200 rounded-xl px-3 py-2">WebUSB ESC/POS<br><span class="opacity-60">generateEscPosReceipt()</span></div>
            <div class="bg-white/10 dark:bg-slate-100 border border-white/10 dark:border-slate-200 rounded-xl px-3 py-2">HID Scanner<br><span class="opacity-60">burst &lt;50ms + Enter</span></div>
          </div>
          <div class="bg-sky-500 text-white rounded-xl px-3 py-2 text-center font-bold">IndexedDB offline queue → sync</div>
        </div>
        <div class="mt-4 text-[11px] opacity-70 leading-4">Vault → server-only key. Multi-tenant: every table has store_id + tenant policy = current_store_id(). Stock trigger deducts on order insert.</div>
      </div>
    </div>

    <!-- peripheral + security strip -->
    <div class="mt-6 grid md:grid-cols-3 gap-4">
      <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div class="text-xs font-extrabold tracking-widest text-violet-700 dark:text-violet-300">5A. PERIPHERAL — ESC/POS</div>
        <pre class="mt-2 bg-slate-950 dark:bg-slate-800 text-emerald-300 text-[11px] p-3 rounded-xl overflow-auto">Uint8Array[
 0x1B,0x40, // init
 0x1B,0x61,0x01, // center
 0x1D,0x56,0x00  // cut
]</pre>
        <div class="text-xs text-slate-500 dark:text-slate-400 mt-2">WebUSB (Chrome) + WebBluetooth fallback + HID barcode. 58mm=32ch / 80mm=48ch bitmap Bangla.</div>
      </div>
      <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div class="text-xs font-extrabold tracking-widest text-emerald-700 dark:text-emerald-300">SECURITY — RLS (P5)</div>
        <pre class="mt-2 bg-slate-950 dark:bg-slate-800 text-sky-300 text-[11px] p-3 rounded-xl overflow-auto">create policy tenant on products
for all using (
 store_id = current_store_id()
);</pre>
        <div class="text-xs text-slate-500 dark:text-slate-400 mt-2">current_store_id() = SECURITY DEFINER — fixes recursion. Vault stores server-only keys.</div>
      </div>
      <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div class="text-xs font-extrabold tracking-widest text-sky-700 dark:text-sky-300">INVENTORY — STOCK TRIGGER</div>
        <pre class="mt-2 bg-slate-950 dark:bg-slate-800 text-amber-300 text-[11px] p-3 rounded-xl overflow-auto">create trigger deduct_stock_on_order
after insert on order_items
for each row execute fn deduct();</pre>
        <div class="text-xs text-slate-500 dark:text-slate-400 mt-2">Sale → stock − qty; return → restore. Never negative; low-stock badge at 5.</div>
      </div>
    </div>
  </section>

  <!-- SCHEMA — from PDF p3 -->
  <section id="schema" class="bg-slate-50 dark:bg-slate-900 border-y border-slate-100 dark:border-slate-800">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div class="max-w-3xl">
        <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full"><span class="material-symbols-rounded text-[16px]">database</span> DATABASE SCHEMA — P3 • EXACT AS SPEC</div>
        <h2 class="mt-3 text-[28px] sm:text-[34px] font-black tracking-tight leading-none text-slate-900 dark:text-white">PostgreSQL • RLS • Trial trigger</h2>
        <p class="mt-3 text-slate-600 dark:text-slate-400">stores → profiles → categories → products (barcode UNIQUE per store, indexed) → orders (MEK-YYYY-XXXXX) → order_items. No deviation.</p>
      </div>
      <div class="mt-8 grid md:grid-cols-3 gap-4">
        <div class="bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div class="text-xs font-black tracking-widest text-slate-500">STORES</div>
          <div class="mt-2 font-mono text-xs leading-5 dark:text-slate-300">id uuid pk<br>name text<br>trial_starts_at timestamptz<br>trial_ends_at timestamptz<br>subscription_status <span class="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 px-1 rounded">trialing | active | expired</span></div>
        </div>
        <div class="bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div class="text-xs font-black tracking-widest text-slate-500">PROFILES</div>
          <div class="mt-2 font-mono text-xs leading-5 dark:text-slate-300">id uuid fk auth.users<br>store_id uuid fk stores<br>full_name text<br>auth_provider <span class="bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800 px-1 rounded">google | email_password</span><br>role <span class="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-1 rounded">owner | manager | cashier</span></div>
        </div>
        <div class="bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div class="text-xs font-black tracking-widest text-slate-500">PRODUCTS • INDEXED</div>
          <div class="mt-2 font-mono text-xs leading-5 dark:text-slate-300">id uuid pk<br>store_id fk<br>barcode text <b class="text-red-600">UNIQUE per store</b><br>name text<br>price numeric • cost_price numeric<br>stock_quantity int</div>
        </div>
        <div class="bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div class="text-xs font-black tracking-widest text-slate-500">ORDERS</div>
          <div class="mt-2 font-mono text-xs leading-5 dark:text-slate-300">id uuid pk<br>receipt_number <b>MEK-YYYY-XXXXX</b><br>subtotal / tax / discount / total<br>payment_method <span class="bg-violet-50 dark:bg-violet-900/30 border px-1 rounded">cash | card | qr | split</span></div>
        </div>
        <div class="bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div class="text-xs font-black tracking-widest text-slate-500">ORDER_ITEMS</div>
          <div class="mt-2 font-mono text-xs leading-5 dark:text-slate-300">order_id fk • product_id fk<br>quantity int • unit_price numeric<br>→ trigger <b>deducts stock</b></div>
        </div>
        <div class="bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl p-4 border border-slate-800 dark:border-slate-200">
          <div class="text-xs font-black tracking-widest opacity-70">AUTH & TRIAL — P3 TRIGGER</div>
          <pre class="mt-2 bg-black/30 dark:bg-slate-100 rounded-xl p-3 text-[11px] leading-4 overflow-auto">create or replace function
 handle_new_user_signup()
returns trigger as $$
begin
  insert into stores(name,trial_ends_at)
  values(new.raw_user_meta_data->>'store_name',
         now()+interval '7 days');
  insert into profiles(id,store_id,role)
  values(new.id, new_store, 'owner');
  return new;
end; $$;</pre>
        </div>
      </div>
    </div>
  </section>

  <!-- FEATURES — Bangladesh Lite -->
  <section id="features" class="max-w-[1120px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
    <div class="max-w-2xl">
      <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-full"><span class="material-symbols-rounded text-[16px]">auto_awesome</span> BANGLADESH LITE — KHATA + POS</div>
      <h2 class="mt-3 text-[28px] sm:text-[36px] font-black tracking-tight leading-none text-slate-900 dark:text-white">TallyKhata-র খাতা, <span class="text-slate-500 dark:text-slate-400">সাথে ফুল POS</span></h2>
      <p class="mt-3 text-slate-600 dark:text-slate-400">We kept Dilam/Pelam 3-sec entry + Tagada — and added what it never had: barcode, stock, Mushak 6.3, thermal, offline.</p>
    </div>
    <div class="mt-8 grid md:grid-cols-3 gap-4 sm:gap-5">
      <div class="card-hover bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 grid place-items-center text-red-600"><span class="material-symbols-rounded">book</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">Khata — Dilam & Pelam</h3>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-5">Phone in 5 sec. Due auto-creates khata. History + <b>Tagada SMS/WhatsApp</b> one-tap.</p>
      </div>
      <div class="card-hover bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 grid place-items-center text-sky-600"><span class="material-symbols-rounded">barcode_scanner</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">Barcode POS — 58/80mm</h3>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-5">HID burst &lt;50ms + camera. Loose kg/ltr without barcode. VAT slab auto.</p>
      </div>
      <div class="card-hover bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 grid place-items-center text-emerald-600"><span class="material-symbols-rounded">inventory_2</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">Stock + Low-Stock</h3>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-5">Purchase +10, sale −1, return restore. Badge at 5, dead-stock warning.</p>
      </div>
      <div class="card-hover bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 grid place-items-center text-violet-600"><span class="material-symbols-rounded">qr_code_2</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">bKash / Nagad / Bangla QR</h3>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-5"><b>1 QR = 34 banks</b> (BB). TrxID manual V1, auto via SSLCommerz later.</p>
      </div>
      <div class="card-hover bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 grid place-items-center text-amber-600"><span class="material-symbols-rounded">receipt_long</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">Mushak 6.3 + VAT</h3>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-5">Slabs 0/5/7.5/10/15%. BIN on receipt, 6.10 over ৳2L, EFD/SDC ready.</p>
      </div>
      <div class="card-hover bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center"><span class="material-symbols-rounded">wifi_off</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">Offline + ৳ + Bangla</h3>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-5">IndexedDB queue, Bengali ৳, 58mm bitmap Bangla print.</p>
      </div>
    </div>
  </section>

  <!-- DEMO -->
  <section id="demo" class="bg-slate-50 dark:bg-slate-900 border-y border-slate-100 dark:border-slate-800">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div class="grid lg:grid-cols-[0.95fr_1.05fr] gap-8 items-center">
        <div>
          <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-3 py-1.5 rounded-full"><span class="material-symbols-rounded text-[16px]">smart_display</span> INTERACTIVE PREVIEW — NO LOGIN</div>
          <h2 class="mt-3 text-[28px] sm:text-[32px] font-black tracking-tight leading-none text-slate-900 dark:text-white">Try the POS — vanilla speed</h2>
          <p class="mt-3 text-slate-600 dark:text-slate-400 text-[15px] leading-6">Add items, change qty, toggle 58/80mm — feel &lt;280ms offline-first.</p>
          <div class="mt-6 flex gap-3">
            <button id="demo-add-rice" class="px-4 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold hover:bg-black dark:hover:bg-slate-100">+ Add Rice</button>
            <button id="demo-add-oil" class="px-4 py-2.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold hover:bg-slate-50 dark:text-white">+ Add Oil</button>
            <button id="demo-clear" class="px-4 py-2.5 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-bold">Clear</button>
          </div>
          <div class="mt-6 grid grid-cols-3 gap-3 text-center">
            <div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800"><div class="text-[11px] font-bold tracking-widest text-slate-500">BUNDLE</div><div class="font-black dark:text-white">~42KB</div><div class="text-xs text-emerald-600 font-bold">Lite</div></div>
            <div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800"><div class="text-[11px] font-bold tracking-widest text-slate-500">OFFLINE</div><div class="font-black dark:text-white">&lt;280ms</div><div class="text-xs text-sky-600 font-bold">Tap→Print</div></div>
            <div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800"><div class="text-[11px] font-bold tracking-widest text-slate-500">PAPER</div><div class="font-black dark:text-white">58 / 80mm</div><div class="text-xs text-slate-500">Toggle →</div></div>
          </div>
        </div>
        <div class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-[24px] p-4 sm:p-5">
          <div class="flex items-center justify-between">
            <div class="text-xs font-extrabold tracking-widest text-slate-500">LIVE CART</div>
            <div class="flex items-center gap-2">
              <button id="paper-toggle" class="text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full dark:text-white">Paper: 58mm</button>
              <span class="text-xs font-bold bg-emerald-500 text-white px-2.5 py-1 rounded-full">Offline ✓</span>
            </div>
          </div>
          <div id="demo-cart" class="mt-3 space-y-2"></div>
          <div id="demo-totals" class="mt-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 hidden">
            <div class="flex justify-between text-sm dark:text-white"><span class="text-slate-500">Subtotal</span><span id="demo-sub" class="font-bold">৳0.00</span></div>
            <div class="flex justify-between text-sm dark:text-white"><span class="text-slate-500">VAT 5%</span><span id="demo-vat" class="font-bold">৳0.00</span></div>
            <div class="flex justify-between font-black text-base mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 dark:text-white"><span>TOTAL</span><span id="demo-total">৳0.00</span></div>
            <button class="mt-3 w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-full py-3 font-bold flex items-center justify-center gap-2"><span class="material-symbols-rounded">print</span> Pay & Print — <span id="demo-pay">৳0.00</span></button>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 py-8">
      <div class="flex flex-col md:flex-row gap-8 justify-between">
        <div>
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black text-xs">MK</div>
            <div class="font-extrabold dark:text-white">Mekholi</div>
            <span class="text-xs font-mono bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-full dark:text-slate-300">Spec v1.0</span>
          </div>
          <div class="text-sm text-slate-500 mt-2 max-w-sm">Lite POS for Bangladeshi dokan — Vanilla TS + Supabase • RLS multi-tenant • Offline-first • Mushak 6.3</div>
          <div class="mt-3 text-xs text-slate-400">© 2026 Mekholi • Sylhet • History API (no #) • Tailwind + FA6 Pro + Material Icons</div>
        </div>
        <div class="grid grid-cols-2 gap-8 text-sm">
          <div>
            <div class="font-bold text-slate-900 dark:text-white">Product</div>
            <div class="mt-2 space-y-1.5 text-slate-600 dark:text-slate-400">
              <a href="#architecture" class="block hover:text-slate-900 dark:hover:text-white">Architecture</a>
              <a href="#schema" class="block hover:text-slate-900 dark:hover:text-white">Schema</a>
              <a href="/app" data-link class="block hover:text-slate-900 dark:hover:text-white">Lite App</a>
            </div>
          </div>
          <div>
            <div class="font-bold text-slate-900 dark:text-white">Support</div>
            <div class="mt-2 space-y-1.5 text-slate-600 dark:text-slate-400">
              <a href="/help" data-link class="block hover:text-slate-900 dark:hover:text-white">Help & Docs</a>
              <a href="mailto:hello@mekholi.com" class="block hover:text-slate-900 dark:hover:text-white">hello@mekholi.com</a>
              <span class="block text-slate-400">017XX-XXXXXX (BN)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </footer>
  `
}
