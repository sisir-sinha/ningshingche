export default function landing(): string {
  return `
  <!-- NAVBAR -->
  <header id="site-header" class="sticky top-0 z-50 backdrop-blur-xl bg-white/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 flex items-center justify-between h-[64px]">
      <a href="/" data-link class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black text-[13px] tracking-tight">MK</div>
        <div>
          <div class="font-extrabold leading-none tracking-tight text-slate-900 dark:text-white">Mekholi</div>
          <div class="text-[10px] font-bold tracking-[0.14em] text-emerald-600 -mt-0.5">POS • KHATA • HISAB</div>
        </div>
      </a>
      <nav class="hidden lg:flex items-center gap-1 text-[13px] font-medium">
        <a href="#features" class="px-3 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Features</a>
        <a href="#how" class="px-3 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">How it works</a>
        <a href="#demo" class="px-3 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Demo</a>
        <a href="/pricing" data-link class="px-3 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Pricing</a>
        <a href="/help" data-link class="px-3 py-2 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Help</a>
      </nav>
      <div class="flex items-center gap-2">
        <button id="site-theme-toggle" class="w-9 h-9 grid place-items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700" title="Toggle theme">
          <span data-theme-icon class="material-symbols-rounded text-[18px]">dark_mode</span>
        </button>
        <button id="lang-toggle" class="hidden sm:inline-flex px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-slate-200">
          <span class="material-symbols-rounded text-[16px]">language</span> <span id="lang-label">BN / EN</span>
        </button>
        <a href="/login" data-link class="hidden sm:inline-flex text-sm font-semibold px-4 py-2 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white">Log in</a>
        <a href="/app" data-link class="inline-flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold px-5 py-2.5 rounded-full hover:bg-black dark:hover:bg-slate-100 transition shadow-sm">
          Start free <span class="material-symbols-rounded text-[18px]">arrow_forward</span>
        </a>
        <button id="mobile-menu-btn" class="lg:hidden w-9 h-9 grid place-items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white">
          <span class="material-symbols-rounded">menu</span>
        </button>
      </div>
    </div>
    <div id="mobile-menu" class="hidden lg:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-4 space-y-1">
      <a href="#features" class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 font-medium dark:text-white">Features</a>
      <a href="#how" class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 font-medium dark:text-white">How it works</a>
      <a href="#demo" class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 font-medium dark:text-white">Demo</a>
      <a href="/pricing" data-link class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 font-medium dark:text-white">Pricing</a>
      <a href="/help" data-link class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 font-medium dark:text-white">Help</a>
      <div class="pt-2 flex gap-2">
        <button id="site-theme-toggle-mobile" class="flex-1 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold flex items-center justify-center gap-2 dark:text-white"><span data-theme-icon class="material-symbols-rounded text-[18px]">dark_mode</span> Theme</button>
        <a href="/login" data-link class="flex-1 text-center font-semibold py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-white">Log in</a>
      </div>
    </div>
  </header>

  <!-- TRUST BAR -->
  <div class="bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-2 text-center text-xs font-bold">
    <div class="max-w-[1120px] mx-auto px-4 flex items-center justify-center gap-2">
      <span class="hidden sm:inline-flex items-center gap-1.5"><span class="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span> 1,200+ dokans in pilot • Sylhet-Dhaka-Chattogram</span>
      <span class="sm:hidden">✓ Works offline • Bangla • ৳</span>
      <span class="hidden sm:inline-flex items-center gap-1.5 ml-4 opacity-80"><span class="material-symbols-rounded text-[16px]">verified</span> NBR Mushak 6.3 • BIN • VAT Ready</span>
    </div>
  </div>

  <!-- HERO — User focused -->
  <section class="relative overflow-hidden bg-[#fcfcfd] dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
    <div class="absolute inset-0 bg-gradient-to-b from-white via-slate-50/50 to-white dark:from-slate-900 dark:via-slate-950 dark:to-slate-950"></div>
    <div class="absolute -top-24 -right-24 w-[520px] h-[520px] bg-emerald-50 dark:bg-emerald-900/10 rounded-full blur-[80px] opacity-60"></div>
    <div class="absolute -bottom-24 -left-24 w-[520px] h-[520px] bg-sky-50 dark:bg-sky-900/10 rounded-full blur-[80px] opacity-60"></div>
    <div class="relative max-w-[1120px] mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-10">
      <div class="grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-10 items-center">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm text-xs font-bold">
            <span class="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px]">NEW</span>
            <span class="text-slate-700 dark:text-slate-300">7-day free trial • No card • Bangla support</span>
          </div>
          <h1 class="mt-5 text-[32px] sm:text-[44px] font-black leading-[0.9] tracking-tight text-slate-900 dark:text-white">
            দোকানের হিসাব,<br>
            <span class="bg-gradient-to-r from-emerald-600 to-sky-600 bg-clip-text text-transparent">3 সেকেন্ডে</span>
          </h1>
          <p class="mt-4 text-[15.5px] leading-6 text-slate-600 dark:text-slate-400 max-w-[54ch]">
            Barcode billing + <b class="text-slate-900 dark:text-white">Khata (Baki)</b> + stock + <span class="font-mono text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded">Mushak 6.3</span> • bKash/Nagad/Bangla QR • 58mm thermal. <span class="hidden sm:inline">Works <b>offline</b> on 2GB phones — IndexedDB queue auto-syncs.</span>
          </p>
          <div class="mt-6 flex flex-wrap gap-3">
            <a href="/login" data-link class="inline-flex items-center gap-2 bg-emerald-600 text-white px-7 py-3.5 rounded-full font-black hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/20">
              <span class="material-symbols-rounded">bolt</span> Start free — open app
            </a>
            <a href="#demo" class="inline-flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-6 py-3.5 rounded-full font-bold hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-white">
              <span class="material-symbols-rounded">play_circle</span> Try demo (no login)
            </a>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-600 dark:text-slate-400">
            <span class="inline-flex items-center gap-1.5"><span class="material-symbols-rounded text-[16px] text-emerald-600">verified</span> ৳ — no USD</span>
            <span class="inline-flex items-center gap-1.5"><span class="material-symbols-rounded text-[16px] text-emerald-600">wifi_off</span> Offline-first</span>
            <span class="inline-flex items-center gap-1.5"><span class="material-symbols-rounded text-[16px] text-emerald-600">history</span> History API</span>
          </div>
          <!-- social proof -->
          <div class="mt-6 flex items-center gap-3">
            <div class="flex -space-x-2">
              <img src="https://i.pravatar.cc/100?img=11" class="w-8 h-8 rounded-full border-2 border-white dark:border-slate-900" alt="">
              <img src="https://i.pravatar.cc/100?img=22" class="w-8 h-8 rounded-full border-2 border-white dark:border-slate-900" alt="">
              <img src="https://i.pravatar.cc/100?img=33" class="w-8 h-8 rounded-full border-2 border-white dark:border-slate-900" alt="">
              <div class="w-8 h-8 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center text-[10px] font-black border-2 border-white dark:border-slate-900">+1k</div>
            </div>
            <div class="text-xs leading-4">
              <div class="font-bold text-slate-900 dark:text-white flex items-center gap-1"><span class="text-amber-500">★★★★★</span> 4.8/5</div>
              <div class="text-slate-500 dark:text-slate-400">Shop owners in pilot</div>
            </div>
            <div class="hidden sm:flex items-center gap-2 ml-auto text-xs font-mono bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-full">
              <span class="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span> Live • RLS ON • Realtime
            </div>
          </div>
        </div>

        <!-- VISUAL — POS preview card (dark fixed) -->
        <div class="relative lg:pl-2">
          <div class="bg-white dark:bg-slate-900 rounded-[24px] shadow-[0_20px_60px_rgba(15,23,42,0.12)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.4)] border border-slate-200 dark:border-slate-800 p-4 sm:p-5 overflow-hidden">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-red-400"></span><span class="w-3 h-3 rounded-full bg-amber-400"></span><span class="w-3 h-3 rounded-full bg-emerald-400"></span></div>
              <div class="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400">MEKHOLI POS • OFFLINE ✓</div>
              <div class="text-[10px] font-bold bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2 py-1 rounded-full">● RLS ON</div>
            </div>
            <div class="grid grid-cols-[1.35fr_0.85fr] gap-3 sm:gap-4 mt-4">
              <div class="bg-slate-50 dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700">
                <div class="flex items-center justify-between">
                  <div class="text-[11px] font-extrabold tracking-widest text-slate-500 dark:text-slate-400">CART • 3 ITEMS</div>
                  <div class="text-[10px] font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-full dark:text-white">58mm</div>
                </div>
                <div class="mt-3 space-y-2 text-[13px]">
                  <div class="flex justify-between items-center bg-white dark:bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-200 dark:border-slate-700 dark:text-slate-100"><span class="font-medium">Miniket 1kg</span><span class="font-bold">2 × ৳78</span></div>
                  <div class="flex justify-between items-center bg-white dark:bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-200 dark:border-slate-700 dark:text-slate-100"><span class="font-medium">Parachute Oil</span><span class="font-bold">1 × ৳180</span></div>
                  <div class="flex justify-between items-center bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-3 py-2 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold"><span>Discount 5%</span><span>-৳17</span></div>
                </div>
                <div class="mt-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl p-3">
                  <div class="flex justify-between text-xs opacity-80"><span>VAT 5%</span><span>৳16</span></div>
                  <div class="flex justify-between font-black text-[18px] mt-1"><span>TOTAL</span><span>৳335</span></div>
                  <div class="mt-2 grid grid-cols-2 gap-2">
                    <div class="bg-white/10 dark:bg-slate-100 backdrop-blur border border-white/10 dark:border-slate-200 text-white dark:text-slate-900 rounded-full py-2 text-xs font-bold text-center">Cash</div>
                    <div class="bg-emerald-500 text-white rounded-full py-2 text-xs font-bold text-center">bKash ✓</div>
                  </div>
                  <div class="mt-2 text-[11px] bg-white/10 dark:bg-red-50 border border-white/10 dark:border-red-200 rounded-full px-3 py-1.5 flex justify-between font-bold"><span>BAKI DUE</span><span>৳135</span></div>
                </div>
              </div>
              <div class="space-y-3">
                <div class="bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 font-mono text-[11px] leading-4 shadow-sm dark:text-slate-100">
                  <div class="text-center font-black text-[12px] tracking-tight">MEKHOLI — SYLHET</div>
                  <div class="text-center text-[10px] text-slate-500">BIN: 123456789 ****</div>
                  <div class="text-center text-[9px] tracking-widest text-slate-500">MUSHAK 6.3 • 22 Sep 2026</div>
                  <div class="border-t border-dashed border-slate-200 dark:border-slate-700 my-2"></div>
                  <div class="flex justify-between font-bold"><span>TOTAL</span><span>৳335</span></div>
                  <div class="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold"><span>Paid</span><span>৳200</span></div>
                  <div class="flex justify-between text-red-600 font-black bg-red-50 dark:bg-red-900/30 rounded px-1.5 py-1 mt-1"><span>BAKI</span><span>৳135</span></div>
                  <div class="mt-2 grid place-items-center"><div class="w-16 h-16 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl grid place-items-center text-[8px] font-black leading-3">Bangla QR<br>34 banks</div></div>
                </div>
                <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-3">
                  <div class="text-[11px] font-extrabold tracking-widest text-amber-700 dark:text-amber-300">KHATA • RAHIM</div>
                  <div class="text-xs font-bold text-slate-900 dark:text-white">01712-345678 • Due</div>
                  <div class="text-lg font-black text-red-600 dark:text-red-400">৳1,170</div>
                  <button class="mt-2 w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-full py-2 text-xs font-bold flex items-center justify-center gap-1.5"><span class="material-symbols-rounded text-[14px]">sms</span> Tagada SMS</button>
                </div>
              </div>
            </div>
            <div class="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
              <div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-3 text-center"><div class="text-[10px] font-bold tracking-widest text-emerald-700 dark:text-emerald-300">OFFLINE</div><div class="font-black text-slate-900 dark:text-white text-xs mt-1">IndexedDB queue</div></div>
              <div class="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-2xl p-3 text-center"><div class="text-[10px] font-bold tracking-widest text-sky-700 dark:text-sky-300">RLS</div><div class="font-black text-slate-900 dark:text-white text-xs mt-1">Tenant isolated</div></div>
              <div class="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-2xl p-3 text-center"><div class="text-[10px] font-bold tracking-widest text-violet-700 dark:text-violet-300">PRINT</div><div class="font-black text-slate-900 dark:text-white text-xs mt-1">58/80mm ESC/POS</div></div>
            </div>
          </div>
          <div class="hidden sm:flex absolute -bottom-3 -left-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl rounded-2xl px-3 py-2 items-center gap-2">
            <span class="w-8 h-8 rounded-full bg-emerald-500 text-white grid place-items-center"><span class="material-symbols-rounded text-[16px]">wifi_off</span></span>
            <div class="text-xs"><div class="font-bold text-slate-900 dark:text-white">Offline sale saved</div><div class="text-slate-500 dark:text-slate-400 text-[11px]">Printed without internet</div></div>
          </div>
        </div>
      </div>
      <!-- trust logos -->
      <div class="mt-8 border-y border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl py-3 px-4 flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-xs font-bold">
        <span class="text-slate-500 dark:text-slate-400 tracking-widest">TRUSTED IN</span>
        <span class="flex items-center gap-1.5 text-slate-900 dark:text-white"><span class="w-2 h-2 bg-emerald-500 rounded-full"></span> Sylhet</span>
        <span class="flex items-center gap-1.5 text-slate-900 dark:text-white"><span class="w-2 h-2 bg-sky-500 rounded-full"></span> Dhaka</span>
        <span class="flex items-center gap-1.5 text-slate-900 dark:text-white"><span class="w-2 h-2 bg-amber-500 rounded-full"></span> Chattogram</span>
        <span class="hidden sm:inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">• 42KB • 280ms • PWA</span>
      </div>
    </div>
  </section>

  <!-- PROBLEM -> SOLUTION -->
  <section class="max-w-[1120px] mx-auto px-4 sm:px-6 py-8">
    <div class="grid md:grid-cols-3 gap-4">
      <div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-2xl p-5">
        <div class="w-8 h-8 rounded-full bg-red-500 text-white grid place-items-center"><span class="material-symbols-rounded text-[16px]">close</span></div>
        <h3 class="mt-3 font-black text-slate-900 dark:text-white">Before: খাতা হারায়, Baki ভুলে যান</h3>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">Paper khata, phone memory, no backup. Month end mismatch.</p>
      </div>
      <div class="hidden md:grid place-items-center text-slate-300 dark:text-slate-600"><span class="material-symbols-rounded">arrow_forward</span></div>
      <div class="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-2xl p-5 md:col-span-1 col-span-1">
        <div class="w-8 h-8 rounded-full bg-emerald-500 text-white grid place-items-center"><span class="material-symbols-rounded text-[16px]">check</span></div>
        <h3 class="mt-3 font-black text-slate-900 dark:text-white">After: Mekholi auto-remembers</h3>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">Sale → Khata auto. Due SMS. Stock auto. Mushak ready.</p>
      </div>
    </div>
  </section>

  <!-- FEATURES — user benefits -->
  <section id="features" class="max-w-[1120px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-full"><span class="material-symbols-rounded text-[16px]">storefront</span> MADE FOR DOKAN</div>
        <h2 class="mt-3 text-[28px] sm:text-[32px] font-black tracking-tight leading-none text-slate-900 dark:text-white">Everything to run <span class="text-slate-500 dark:text-slate-400">your shop</span></h2>
        <p class="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">Fast billing, easy Baki collection, stock that never lies, VAT that passes NBR — all on your phone.</p>
      </div>
      <a href="/login" data-link class="hidden sm:inline-flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-full bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800">Start free <span class="material-symbols-rounded text-[18px]">arrow_forward</span></a>
    </div>
    <div class="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
      <div class="card-hover bg-white dark:bg-slate-900 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 grid place-items-center text-red-600 dark:text-red-400"><span class="material-symbols-rounded">book</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">Khata — Baki in 3 sec</h3>
        <p class="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-400">Just phone → amount → Dilam/Pelam. Due list, history, and <b class="text-slate-900 dark:text-white">Tagada SMS</b> in one tap. No more forgotten Baki.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-2.5 py-1 rounded-full">Most loved</div>
      </div>
      <div class="card-hover bg-white dark:bg-slate-900 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800 grid place-items-center text-sky-600 dark:text-sky-400"><span class="material-symbols-rounded">barcode_scanner</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">Barcode POS — 58/80mm</h3>
        <p class="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-400">HID burst scanner &lt;50ms + camera. Loose (kg/ltr) without barcode. Discount, VAT auto, hold/resume.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 px-2.5 py-1 rounded-full">Offline • &lt;280ms</div>
      </div>
      <div class="card-hover bg-white dark:bg-slate-900 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 grid place-items-center text-emerald-600 dark:text-emerald-400"><span class="material-symbols-rounded">inventory_2</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">Stock that’s true</h3>
        <p class="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-400">Purchase +10, sale −1, return restore. Low-stock at 5, dead-stock alert. Never sell what you don’t have.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-full">Never negative</div>
      </div>
      <div class="card-hover bg-white dark:bg-slate-900 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800 grid place-items-center text-violet-600 dark:text-violet-400"><span class="material-symbols-rounded">qr_code_2</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">bKash / Nagad / Bangla QR</h3>
        <p class="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-400"><b class="text-slate-900 dark:text-white">1 QR = 34 banks</b> (BB). Personal bKash TrxID now, auto verify via SSLCommerz next.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 px-2.5 py-1 rounded-full">MFS done right</div>
      </div>
      <div class="card-hover bg-white dark:bg-slate-900 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 grid place-items-center text-amber-600 dark:text-amber-400"><span class="material-symbols-rounded">receipt_long</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">Mushak 6.3 + VAT</h3>
        <p class="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-400">Slabs 0/5/7.5/10/15%. BIN on receipt. Reports 6.1/6.2/9.1 & 6.10 &gt;2Lac. SDC ready.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-full">NBR-ready</div>
      </div>
      <div class="card-hover bg-white dark:bg-slate-900 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center"><span class="material-symbols-rounded">wifi_off</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900 dark:text-white">Offline + Bangla + ৳</h3>
        <p class="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-400">IndexedDB queue → auto sync. Bangla + English, ৳ formatting, 58mm bitmap Bangla print. Survives load-shedding.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold bg-slate-900 dark:bg-slate-800 text-white px-2.5 py-1 rounded-full">Built for 2G</div>
      </div>
    </div>
  </section>

  <!-- HOW IT WORKS -->
  <section id="how" class="bg-slate-900 dark:bg-black text-white relative overflow-hidden">
    <div class="absolute inset-0 bg-gradient-to-br from-emerald-600/20 via-transparent to-sky-600/20"></div>
    <div class="relative max-w-[1120px] mx-auto px-4 sm:px-6 py-10 sm:py-12">
      <div class="max-w-2xl">
        <div class="text-xs font-extrabold tracking-widest text-emerald-300">HOW IT WORKS • 30 SECONDS</div>
        <h2 class="mt-2 text-[26px] sm:text-[30px] font-black tracking-tight leading-none">Phone → Amount → Done</h2>
        <p class="mt-2 text-sm text-slate-300">If it takes &gt;10 seconds, we failed. One thumb, Bangla-first, no training needed.</p>
      </div>
      <div class="mt-8 grid md:grid-cols-3 gap-4">
        <div class="bg-white/10 backdrop-blur border border-white/10 rounded-[20px] p-5">
          <div class="w-8 h-8 rounded-full bg-white text-slate-900 grid place-items-center font-black text-sm">1</div>
          <h3 class="mt-3 font-bold">Add Customer by Phone</h3>
          <p class="mt-1 text-sm text-slate-300">017XX → name auto. Or Walk-in. No address needed.</p>
          <div class="mt-4 inline-flex items-center gap-2 text-xs font-bold bg-white text-slate-900 rounded-full px-3 py-2"><span class="material-symbols-rounded text-[16px]">person_add</span> Rahim 01712-34…</div>
        </div>
        <div class="bg-white/10 backdrop-blur border border-white/10 rounded-[20px] p-5">
          <div class="w-8 h-8 rounded-full bg-emerald-400 text-slate-900 grid place-items-center font-black text-sm">2</div>
          <h3 class="mt-3 font-bold">Scan or Type — Sell</h3>
          <p class="mt-1 text-sm text-slate-300">Barcode burst or search “alu” → qty → VAT auto.</p>
          <div class="mt-4 grid grid-cols-2 gap-2 text-xs font-bold"><div class="bg-white text-slate-900 rounded-xl px-3 py-2 flex items-center gap-2"><span class="material-symbols-rounded text-[16px]">barcode</span> 89010…</div><div class="bg-emerald-400 text-slate-900 rounded-xl px-3 py-2 text-center">Cash / bKash</div></div>
        </div>
        <div class="bg-white/10 backdrop-blur border border-white/10 rounded-[20px] p-5">
          <div class="w-8 h-8 rounded-full bg-sky-400 text-slate-900 grid place-items-center font-black text-sm">3</div>
          <h3 class="mt-3 font-bold">Baki Auto-Saved</h3>
          <p class="mt-1 text-sm text-slate-300">Due ৳135 → Khata Dilam. One-tap Tagada SMS.</p>
          <div class="mt-4 inline-flex items-center gap-2 text-xs font-bold bg-sky-400 text-slate-900 rounded-full px-3 py-2"><span class="material-symbols-rounded text-[16px]">sms</span> “Rahim, baki ৳135…”</div>
        </div>
      </div>
    </div>
  </section>

  <!-- DEMO -->
  <section id="demo" class="bg-slate-50 dark:bg-slate-900 border-y border-slate-200 dark:border-slate-800">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 py-10 sm:py-12">
      <div class="grid lg:grid-cols-[0.95fr_1.05fr] gap-8 items-start">
        <div>
          <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-3 py-1.5 rounded-full"><span class="material-symbols-rounded text-[16px]">smart_display</span> LIVE DEMO — NO LOGIN</div>
          <h2 class="mt-3 text-[26px] sm:text-[30px] font-black tracking-tight leading-none text-slate-900 dark:text-white">Try the POS right here</h2>
          <p class="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">Add items, tweak qty, switch 58/80mm — feel the &lt;280ms speed. This is the real app.</p>
          <div class="mt-6 flex flex-wrap gap-3">
            <button id="demo-add-rice" class="px-5 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold hover:bg-black dark:hover:bg-slate-100 shadow-sm">+ Add Rice ৳78</button>
            <button id="demo-add-oil" class="px-5 py-2.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-700 dark:text-white">+ Add Oil ৳180</button>
            <button id="demo-clear" class="px-4 py-2.5 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-bold">Clear</button>
          </div>
          <div class="mt-6 grid grid-cols-3 gap-3 text-center">
            <div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800"><div class="text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400">BUNDLE</div><div class="font-black dark:text-white">~42KB</div><div class="text-xs text-emerald-600 font-bold">Lite</div></div>
            <div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800"><div class="text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400">SPEED</div><div class="font-black dark:text-white">&lt;280ms</div><div class="text-xs text-sky-600 font-bold">Tap→Print</div></div>
            <div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800"><div class="text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400">PAPER</div><div class="font-black dark:text-white">58/80mm</div><div class="text-xs text-slate-500">Toggle →</div></div>
          </div>
        </div>
        <div class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-[24px] p-4 sm:p-5 shadow-sm dark:shadow-none">
          <div class="flex items-center justify-between">
            <div class="text-xs font-extrabold tracking-widest text-slate-500 dark:text-slate-400">LIVE CART</div>
            <div class="flex items-center gap-2">
              <button id="paper-toggle" class="text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700">Paper: 58mm</button>
              <span class="text-xs font-bold bg-emerald-500 text-white px-2.5 py-1 rounded-full">Offline ✓</span>
            </div>
          </div>
          <div id="demo-cart" class="mt-3 space-y-2"></div>
          <div id="demo-totals" class="mt-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 hidden">
            <div class="flex justify-between text-sm"><span class="text-slate-500 dark:text-slate-400">Subtotal</span><span id="demo-sub" class="font-bold dark:text-white">৳0.00</span></div>
            <div class="flex justify-between text-sm"><span class="text-slate-500 dark:text-slate-400">VAT 5%</span><span id="demo-vat" class="font-bold dark:text-white">৳0.00</span></div>
            <div class="flex justify-between font-black text-base mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 dark:text-white"><span>TOTAL</span><span id="demo-total">৳0.00</span></div>
            <button class="mt-3 w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-full py-3 font-black flex items-center justify-center gap-2 hover:bg-black dark:hover:bg-slate-100"><span class="material-symbols-rounded">print</span> Pay & Print — <span id="demo-pay">৳0.00</span></button>
            <div class="text-center text-[11px] text-slate-500 dark:text-slate-400 mt-2">Demo only — real app saves to Supabase + offline queue</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- SOCIAL PROOF / TESTIMONIALS -->
  <section class="max-w-[1120px] mx-auto px-4 sm:px-6 py-10 sm:py-12">
    <div class="text-center max-w-2xl mx-auto">
      <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full">❤️ LOVED BY SHOP OWNERS</div>
      <h2 class="mt-3 text-[26px] sm:text-[30px] font-black tracking-tight text-slate-900 dark:text-white">Dokan owners don’t go back</h2>
      <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">From Sylhet to Dhaka — same story: faster billing, no Baki tension.</p>
    </div>
    <div class="mt-8 grid md:grid-cols-3 gap-4">
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
        <div class="flex items-center gap-3">
          <img src="https://i.pravatar.cc/100?img=15" class="w-9 h-9 rounded-full" alt="">
          <div><div class="font-bold text-sm dark:text-white">Rahim Uddin</div><div class="text-xs text-slate-500">Mudir dokan, Sylhet</div></div>
          <span class="ml-auto text-amber-500 text-xs">★★★★★</span>
        </div>
        <p class="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">“Age Baki khuje petam na. Ekhon phone dilei due dekhay, SMS pathai — taka collection 2x.”</p>
      </div>
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
        <div class="flex items-center gap-3">
          <img src="https://i.pravatar.cc/100?img=26" class="w-9 h-9 rounded-full" alt="">
          <div><div class="font-bold text-sm dark:text-white">Karim Store</div><div class="text-xs text-slate-500">Dhaka • Grocery</div></div>
          <span class="ml-auto text-amber-500 text-xs">★★★★★</span>
        </div>
        <p class="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">“Barcode e 1 sec e bill. Customer line komche. Stock vul hoy na.”</p>
      </div>
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
        <div class="flex items-center gap-3">
          <img src="https://i.pravatar.cc/100?img=31" class="w-9 h-9 rounded-full" alt="">
          <div><div class="font-bold text-sm dark:text-white">Ayesha Traders</div><div class="text-xs text-slate-500">Chattogram</div></div>
          <span class="ml-auto text-amber-500 text-xs">★★★★★</span>
        </div>
        <p class="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">“Offline eo chole — current gele o bill hoy. Mushak report easy.”</p>
      </div>
    </div>
  </section>

  <!-- TECH TRUST — collapsed spec for pros (dark fixed) -->
  <section class="bg-slate-50 dark:bg-slate-900 border-y border-slate-200 dark:border-slate-800">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <details class="group bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl">
        <summary class="flex items-center justify-between p-5 cursor-pointer list-none">
          <div class="flex items-center gap-3">
            <span class="w-8 h-8 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center"><span class="material-symbols-rounded text-[18px]">architecture</span></span>
            <div>
              <div class="font-black text-sm dark:text-white">Built on solid tech — Architecture & Security</div>
              <div class="text-xs text-slate-500 dark:text-slate-400">Supabase • PostgreSQL • RLS • Realtime • Vanilla TS — click to expand</div>
            </div>
          </div>
          <span class="material-symbols-rounded group-open:rotate-180 transition dark:text-white">expand_more</span>
        </summary>
        <div class="px-5 pb-5 border-t border-slate-200 dark:border-slate-800 pt-4">
          <div class="grid lg:grid-cols-3 gap-4 text-xs font-mono">
            <div class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
              <div class="font-bold tracking-widest text-violet-700 dark:text-violet-300">ESC/POS</div>
              <pre class="mt-2 bg-slate-900 dark:bg-slate-800 text-emerald-300 p-2 rounded-lg overflow-auto">Uint8Array[0x1B,0x40...0x1D,0x56]</pre>
            </div>
            <div class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
              <div class="font-bold tracking-widest text-emerald-700 dark:text-emerald-300">RLS</div>
              <pre class="mt-2 bg-slate-900 dark:bg-slate-800 text-sky-300 p-2 rounded-lg overflow-auto">store_id = current_store_id()</pre>
            </div>
            <div class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
              <div class="font-bold tracking-widest text-sky-700 dark:text-sky-300">TRIGGER</div>
              <pre class="mt-2 bg-slate-900 dark:bg-slate-800 text-amber-300 p-2 rounded-lg overflow-auto">deduct_stock_on_order</pre>
            </div>
          </div>
          <p class="mt-3 text-xs text-slate-500 dark:text-slate-400">Full spec: Vanilla TS lite (42KB) — same Supabase contract, History API, offline IndexedDB queue, 7-day trial via <code class="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1 rounded">handle_new_user_signup()</code>.</p>
        </div>
      </details>
    </div>
  </section>

  <!-- FAQ -->
  <section class="max-w-[1120px] mx-auto px-4 sm:px-6 py-10 sm:py-12">
    <div class="max-w-3xl mx-auto">
      <h2 class="text-2xl sm:text-[28px] font-black tracking-tight text-center dark:text-white">প্রশ্ন আছে? — FAQ</h2>
      <div class="mt-6 space-y-3">
        <details class="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 open:bg-slate-50 dark:open:bg-slate-800/50" open>
          <summary class="flex items-center justify-between cursor-pointer list-none"><span class="font-bold dark:text-white">Offline e ki bill hobe?</span><span class="material-symbols-rounded group-open:rotate-180 transition dark:text-white">expand_more</span></summary>
          <p class="mt-3 text-sm text-slate-600 dark:text-slate-400">Ha — sale IndexedDB te save + print. Net ashle auto sync, RLS thik thakbe.</p>
        </details>
        <details class="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5"><summary class="flex items-center justify-between cursor-pointer list-none"><span class="font-bold dark:text-white">bKash e auto verify?</span><span class="material-symbols-rounded group-open:rotate-180 transition dark:text-white">expand_more</span></summary><p class="mt-3 text-sm text-slate-600 dark:text-slate-400">V1 personal bKash TrxID, V1.1 SSLCommerz auto-verify.</p></details>
        <details class="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5"><summary class="flex items-center justify-between cursor-pointer list-none"><span class="font-bold dark:text-white">Mushak compliant?</span><span class="material-symbols-rounded group-open:rotate-180 transition dark:text-white">expand_more</span></summary><p class="mt-3 text-sm text-slate-600 dark:text-slate-400">6.3 receipt, BIN, VAT slab, 6.1/6.2/9.1 & 6.10 (>2 Lac).</p></details>
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="max-w-[1120px] mx-auto px-4 sm:px-6 pb-10">
    <div class="bg-slate-900 dark:bg-white rounded-[24px] p-6 sm:p-8 flex flex-col lg:flex-row items-center justify-between gap-6 relative overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-r from-emerald-600/20 to-sky-600/20 dark:from-emerald-100 dark:to-sky-100"></div>
      <div class="relative">
        <h3 class="text-2xl font-black text-white dark:text-slate-900">Ready to make hisab easy?</h3>
        <p class="text-slate-300 dark:text-slate-600 mt-1">7-day free trial • No card • Cancel anytime • Bangla support</p>
      </div>
      <div class="relative flex gap-3 w-full lg:w-auto">
        <a href="/login" data-link class="flex-1 lg:flex-none inline-flex items-center justify-center gap-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-7 py-3.5 rounded-full font-black hover:bg-slate-100 dark:hover:bg-slate-800">Start free <span class="material-symbols-rounded">arrow_forward</span></a>
        <a href="#demo" class="hidden sm:inline-flex items-center gap-2 bg-white/10 dark:bg-slate-900/5 border border-white/20 dark:border-slate-900/10 text-white dark:text-slate-700 px-6 py-3.5 rounded-full font-bold hover:bg-white/15">See demo</a>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 py-8">
      <div class="flex flex-col md:flex-row gap-8 justify-between">
        <div>
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black text-xs">MK</div>
            <div class="font-extrabold dark:text-white">Mekholi</div>
            <span class="text-xs font-mono bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-full dark:text-slate-300">v1.0 • Lite</span>
          </div>
          <div class="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-sm">POS + Khata for Bangladeshi dokan — barcode, Baki, stock, Mushak 6.3, bKash/Bangla QR, offline-first.</div>
          <div class="mt-3 text-xs text-slate-500">© 2026 Mekholi • Sylhet • Vanilla TS • History API • FA6 Pro + Material Icons</div>
        </div>
        <div class="grid grid-cols-2 gap-8 text-sm">
          <div>
            <div class="font-bold text-slate-900 dark:text-white">Product</div>
            <div class="mt-2 space-y-1.5 text-slate-600 dark:text-slate-400">
              <a href="#features" class="block hover:text-slate-900 dark:hover:text-white">Features</a>
              <a href="/pricing" data-link class="block hover:text-slate-900 dark:hover:text-white">Pricing</a>
              <a href="/app" data-link class="block hover:text-slate-900 dark:hover:text-white">Open App</a>
            </div>
          </div>
          <div>
            <div class="font-bold text-slate-900 dark:text-white">Help</div>
            <div class="mt-2 space-y-1.5 text-slate-600 dark:text-slate-400">
              <a href="/help" data-link class="block hover:text-slate-900 dark:hover:text-white">Docs</a>
              <a href="mailto:hello@mekholi.com" class="block hover:text-slate-900 dark:hover:text-white">hello@mekholi.com</a>
              <span class="block text-slate-500">017XX • BN/EN</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </footer>
  `
}
