export default function landing(): string {
  return `
  <!-- HEADER -->
  <header id="site-header" class="sticky top-0 z-50 bg-white/70 dark:bg-slate-950/60 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-800">
    <div class="max-w-[1160px] mx-auto px-4 sm:px-6 h-[64px] flex items-center justify-between gap-4">
      <a href="/" data-link class="flex items-center gap-3 shrink-0">
        <div class="w-9 h-9 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black text-[13px]">MK</div>
        <div class="hidden sm:block">
          <div class="font-extrabold tracking-tight leading-none text-slate-900 dark:text-white">Mekholi</div>
          <div class="text-[11px] font-semibold tracking-widest text-slate-500 dark:text-slate-400">POS • KHATA</div>
        </div>
      </a>

      <nav class="hidden md:flex items-center gap-1 text-sm font-medium">
        <a href="#features" class="px-3.5 py-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Features</a>
        <a href="#how" class="px-3.5 py-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">How it works</a>
        <a href="#pricing" class="px-3.5 py-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Pricing</a>
        <a href="/help" data-link class="px-3.5 py-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">Help</a>
      </nav>

      <div class="flex items-center gap-2">
        <button id="site-theme-toggle" class="w-9 h-9 grid place-items-center rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800" title="Theme">
          <span data-theme-icon class="material-symbols-rounded text-[18px]">dark_mode</span>
        </button>
        <a href="/login" data-link class="hidden sm:inline-flex text-sm font-semibold px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-white">Log in</a>
        <a href="/login" data-link class="inline-flex items-center gap-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-2.5 rounded-full text-sm font-bold hover:bg-black dark:hover:bg-slate-100 shadow-sm">
          Start free <span class="material-symbols-rounded text-[18px] hidden sm:inline">arrow_forward</span>
        </a>
        <button id="mobile-menu-btn" class="md:hidden w-9 h-9 grid place-items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white"><span class="material-symbols-rounded">menu</span></button>
      </div>
    </div>
    <div id="mobile-menu" class="hidden md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-4">
      <div class="space-y-1">
        <a href="#features" class="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 dark:text-white font-medium">Features <span class="material-symbols-rounded text-[18px]">chevron_right</span></a>
        <a href="#how" class="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 dark:text-white font-medium">How it works <span class="material-symbols-rounded text-[18px]">chevron_right</span></a>
        <a href="#pricing" class="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 dark:text-white font-medium">Pricing <span class="material-symbols-rounded text-[18px]">chevron_right</span></a>
        <a href="/help" data-link class="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 dark:text-white font-medium">Help <span class="material-symbols-rounded text-[18px]">chevron_right</span></a>
      </div>
      <div class="grid grid-cols-2 gap-2 mt-4">
        <button id="site-theme-toggle-mobile" class="py-3 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold flex items-center justify-center gap-2 dark:text-white"><span data-theme-icon class="material-symbols-rounded">dark_mode</span> Theme</button>
        <a href="/login" data-link class="text-center py-3 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold">Log in</a>
      </div>
    </div>
  </header>

  <!-- HERO -->
  <section class="relative overflow-hidden">
    <div class="absolute inset-0 bg-white dark:bg-slate-950"></div>
    <div class="absolute inset-0 bg-[radial-gradient(600px_circle_at_15%_20%,rgba(16,185,129,0.08),transparent_50%),radial-gradient(800px_circle_at_85%_0%,rgba(14,165,233,0.08),transparent_60%)] dark:bg-[radial-gradient(600px_circle_at_15%_20%,rgba(16,185,129,0.12),transparent_50%),radial-gradient(800px_circle_at_85%_0%,rgba(14,165,233,0.12),transparent_60%)]"></div>
    <div class="relative max-w-[1160px] mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-10 sm:pb-16">
      <div class="max-w-[720px]">
        <div class="inline-flex items-center gap-2 text-xs font-semibold tracking-wide">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> New • Offline-first POS
          </span>
          <span class="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">• 42KB • &lt;280ms • PWA</span>
        </div>

        <h1 class="mt-6 text-[34px] sm:text-[54px] font-[900] tracking-tighter leading-[0.95] text-slate-900 dark:text-white">
          The POS that <br>
          <span class="bg-gradient-to-r from-emerald-600 via-sky-600 to-emerald-600 bg-clip-text text-transparent">just works.</span>
        </h1>
        <p class="mt-4 text-[15px] sm:text-[17px] leading-7 text-slate-600 dark:text-slate-400 max-w-[60ch]">
          For Bangladeshi retail — <b class="text-slate-900 dark:text-white font-semibold">barcode billing, Khata Baki, stock & Mushak 6.3 VAT</b> in one fast app. bKash / Nagad / Bangla QR, 58mm thermal, works offline on 2GB phones.
        </p>

        <div class="mt-7 flex flex-col sm:flex-row gap-3">
          <a href="/login" data-link class="inline-flex items-center justify-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-7 py-3.5 rounded-full font-bold hover:bg-black dark:hover:bg-slate-100 transition">
            Start 7-day free trial <span class="material-symbols-rounded">arrow_forward</span>
          </a>
          <a href="#demo" class="inline-flex items-center justify-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-7 py-3.5 rounded-full font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-white">
            <span class="material-symbols-rounded">play_circle</span> Live demo — no signup
          </a>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-4 text-xs">
          <span class="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400"><span class="material-symbols-rounded text-[16px] text-emerald-600">check_circle</span> No card required</span>
          <span class="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400"><span class="material-symbols-rounded text-[16px] text-emerald-600">check_circle</span> Cancel anytime</span>
          <span class="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400"><span class="material-symbols-rounded text-[16px] text-emerald-600">check_circle</span> Bangla & English</span>
        </div>

        <div class="mt-8 flex items-center gap-4 border-t border-slate-200 dark:border-slate-800 pt-6">
          <div class="flex -space-x-2">
            <img src="https://i.pravatar.cc/100?img=12" class="w-8 h-8 rounded-full border-2 border-white dark:border-slate-950 object-cover" alt="">
            <img src="https://i.pravatar.cc/100?img=16" class="w-8 h-8 rounded-full border-2 border-white dark:border-slate-950 object-cover" alt="">
            <img src="https://i.pravatar.cc/100?img=32" class="w-8 h-8 rounded-full border-2 border-white dark:border-slate-950 object-cover" alt="">
          </div>
          <div class="text-sm">
            <div class="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">Trusted by 1,200+ shops <span class="text-amber-500">★★★★★ 4.8</span></div>
            <div class="text-slate-500 dark:text-slate-400 text-xs">Sylhet • Dhaka • Chattogram • Pilot</div>
          </div>
        </div>
      </div>

      <!-- HERO VISUAL — clean dashboard mock, not cluttered -->
      <div class="mt-10 lg:mt-12">
        <div class="relative bg-white dark:bg-slate-900 rounded-[28px] border border-slate-200 dark:border-slate-800 shadow-[0_24px_80px_rgba(15,23,42,0.10)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden">
          <!-- window bar -->
          <div class="h-[44px] flex items-center justify-between px-4 sm:px-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 backdrop-blur">
            <div class="flex items-center gap-1.5">
              <span class="w-3 h-3 rounded-full bg-red-400"></span>
              <span class="w-3 h-3 rounded-full bg-amber-400"></span>
              <span class="w-3 h-3 rounded-full bg-emerald-400"></span>
              <span class="hidden sm:inline-flex ml-3 text-xs font-medium text-slate-500 dark:text-slate-400">mekholi.app — POS</span>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span class="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> Online</span>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500 text-white font-semibold">● RLS on</span>
            </div>
          </div>

          <div class="p-4 sm:p-6 grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
            <!-- left — cart -->
            <div>
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-bold tracking-wide text-slate-900 dark:text-white">Today’s overview</h3>
                <span class="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">58mm • 32 chars</span>
              </div>

              <div class="mt-4 grid grid-cols-3 gap-3">
                <div class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 sm:p-4">
                  <div class="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400">SALES</div>
                  <div class="mt-1 text-[18px] sm:text-[20px] font-black tracking-tight text-slate-900 dark:text-white">৳12,480</div>
                  <div class="text-xs font-semibold text-emerald-600">+18% vs yesterday</div>
                </div>
                <div class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 sm:p-4">
                  <div class="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400">DUE</div>
                  <div class="mt-1 text-[18px] sm:text-[20px] font-black tracking-tight text-slate-900 dark:text-white">৳8,350</div>
                  <div class="text-xs font-medium text-slate-500 dark:text-slate-400">12 customers</div>
                </div>
                <div class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 sm:p-4">
                  <div class="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400">PROFIT</div>
                  <div class="mt-1 text-[18px] sm:text-[20px] font-black tracking-tight text-slate-900 dark:text-white">৳2,940</div>
                  <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Today</div>
                </div>
              </div>

              <div class="mt-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-4">
                <div class="flex items-center justify-between">
                  <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">CART • 2 items</div>
                  <button class="text-xs font-semibold px-2.5 py-1 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 dark:text-white">Hold</button>
                </div>
                <div class="mt-3 space-y-2">
                  <div class="flex items-center justify-between bg-white dark:bg-slate-900 rounded-xl px-3 py-3 border border-slate-200 dark:border-slate-700">
                    <div class="text-sm font-semibold dark:text-white">Miniket Rice 1kg <span class="text-slate-500 dark:text-slate-400 font-normal">• 2 × ৳78</span></div>
                    <div class="font-bold text-sm dark:text-white">৳156</div>
                  </div>
                  <div class="flex items-center justify-between bg-white dark:bg-slate-900 rounded-xl px-3 py-3 border border-slate-200 dark:border-slate-700">
                    <div class="text-sm font-semibold dark:text-white">Parachute Oil 200ml <span class="text-slate-500 dark:text-slate-400 font-normal">• 1 × ৳180</span></div>
                    <div class="font-bold text-sm dark:text-white">৳180</div>
                  </div>
                </div>
                <div class="mt-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 p-4">
                  <div class="flex justify-between text-sm opacity-80"><span>Subtotal</span><span>৳336</span></div>
                  <div class="flex justify-between text-sm opacity-80"><span>VAT 5%</span><span>৳16</span></div>
                  <div class="flex justify-between font-black text-lg mt-2 pt-2 border-t border-white/15 dark:border-slate-200"><span>Total</span><span>৳335</span></div>
                  <div class="mt-3 grid grid-cols-2 gap-2">
                    <div class="bg-white text-slate-900 dark:bg-slate-100 rounded-full py-2 text-xs font-bold text-center">Cash</div>
                    <div class="bg-emerald-500 text-white rounded-full py-2 text-xs font-bold text-center">bKash ✓</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- right — receipt + khata, clean -->
            <div class="space-y-4">
              <div class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-4">
                <div class="text-center">
                  <div class="font-black tracking-tight dark:text-white">MEKHOLI — SYLHET</div>
                  <div class="text-xs text-slate-500">BIN 123456789 • Mushak 6.3</div>
                  <div class="text-[11px] font-mono tracking-widest text-slate-400 mt-1">RECEIPT • 22 Sep 2026 • 4:15 PM</div>
                </div>
                <div class="my-3 border-t border-dashed border-slate-200 dark:border-slate-700"></div>
                <div class="space-y-1.5 font-mono text-xs">
                  <div class="flex justify-between"><span class="text-slate-500">Miniket 1kg ×2</span><span class="font-semibold dark:text-white">৳156</span></div>
                  <div class="flex justify-between"><span class="text-slate-500">Parachute Oil</span><span class="font-semibold dark:text-white">৳180</span></div>
                  <div class="flex justify-between text-slate-500"><span>Discount</span><span class="text-emerald-600">-৳17</span></div>
                </div>
                <div class="my-3 border-t border-slate-200 dark:border-slate-800"></div>
                <div class="flex justify-between font-black dark:text-white"><span>TOTAL</span><span>৳335</span></div>
                <div class="flex justify-between text-sm font-bold text-emerald-600"><span>Paid</span><span>৳200</span></div>
                <div class="mt-2 flex justify-between text-sm font-black text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-full px-3 py-2"><span>BAKI</span><span>৳135</span></div>
                <div class="mt-4 flex justify-center">
                  <div class="w-20 h-20 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center text-[10px] font-black leading-tight text-center">Bangla QR<br><span class="font-normal">34 banks</span></div>
                </div>
                <div class="mt-3 text-center text-[11px] text-slate-400">Dhonnobad! Abar ashben.</div>
              </div>

              <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">KHATA • RAHIM</div>
                    <div class="text-sm font-bold dark:text-white">01712-345678</div>
                  </div>
                  <span class="w-9 h-9 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-300 grid place-items-center"><span class="material-symbols-rounded text-[18px]">book</span></span>
                </div>
                <div class="mt-3 flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-full px-4 py-3">
                  <span class="text-xs font-bold text-amber-700 dark:text-amber-300">Due</span>
                  <span class="font-black text-amber-700 dark:text-amber-300">৳1,170</span>
                </div>
                <button class="mt-3 w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-full py-2.5 text-sm font-bold inline-flex items-center justify-center gap-1.5"><span class="material-symbols-rounded text-[18px]">sms</span> Send Tagada SMS</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- LOGOS -->
  <section class="border-y border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
    <div class="max-w-[1160px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-center gap-6 text-xs">
      <span class="font-semibold tracking-widest text-slate-400 dark:text-slate-500">TRUSTED BY SHOPS IN</span>
      <span class="inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> Sylhet</span>
      <span class="inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200"><span class="w-2 h-2 rounded-full bg-sky-500"></span> Dhaka</span>
      <span class="inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200"><span class="w-2 h-2 rounded-full bg-amber-500"></span> Chattogram</span>
      <span class="hidden sm:inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200"><span class="w-2 h-2 rounded-full bg-violet-500"></span> Rajshahi</span>
    </div>
  </section>

  <!-- FEATURES — clean 6 -->
  <section id="features" class="max-w-[1160px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
    <div class="max-w-[640px]">
      <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold">Why Mekholi</div>
      <h2 class="mt-4 text-[28px] sm:text-[36px] font-black tracking-tighter leading-none text-slate-900 dark:text-white">Built for how <br><span class="text-slate-500 dark:text-slate-400">you actually sell.</span></h2>
      <p class="mt-3 text-slate-600 dark:text-slate-400">No bloated ERP. Just the 6 things every dokan needs — done right, offline, in Bangla.</p>
    </div>

    <div class="mt-8 grid md:grid-cols-3 gap-4 sm:gap-5">
      <div class="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5 hover:border-slate-300 dark:hover:border-slate-700 transition">
        <div class="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 grid place-items-center"><span class="material-symbols-rounded">book</span></div>
        <h3 class="mt-3 font-bold text-slate-900 dark:text-white">Baki / Khata</h3>
        <p class="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400">Phone → amount → Dilam/Pelam in 3 seconds. Auto due, history, one-tap <span class="font-semibold text-slate-900 dark:text-white">Tagada SMS</span>.</p>
      </div>
      <div class="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5 hover:border-slate-300 dark:hover:border-slate-700 transition">
        <div class="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800 text-sky-600 dark:text-sky-300 grid place-items-center"><span class="material-symbols-rounded">barcode_scanner</span></div>
        <h3 class="mt-3 font-bold text-slate-900 dark:text-white">Barcode POS</h3>
        <p class="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400">HID burst &lt;50ms + camera. Loose kg/ltr, discount, VAT, hold/resume. <span class="font-semibold text-slate-900 dark:text-white">58/80mm</span> ready.</p>
      </div>
      <div class="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5 hover:border-slate-300 dark:hover:border-slate-700 transition">
        <div class="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-300 grid place-items-center"><span class="material-symbols-rounded">inventory_2</span></div>
        <h3 class="mt-3 font-bold text-slate-900 dark:text-white">Stock that’s true</h3>
        <p class="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400">Purchase +10, sale −1. Low at 5, dead-stock warning. Never sell what you don’t have.</p>
      </div>
      <div class="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5 hover:border-slate-300 dark:hover:border-slate-700 transition">
        <div class="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-300 grid place-items-center"><span class="material-symbols-rounded">qr_code_2</span></div>
        <h3 class="mt-3 font-bold text-slate-900 dark:text-white">bKash / Nagad / QR</h3>
        <p class="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400"><b class="text-slate-900 dark:text-white">1 QR = 34 banks</b>. Manual TrxID now, SSLCommerz auto-verify next.</p>
      </div>
      <div class="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5 hover:border-slate-300 dark:hover:border-slate-700 transition">
        <div class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-300 grid place-items-center"><span class="material-symbols-rounded">receipt_long</span></div>
        <h3 class="mt-3 font-bold text-slate-900 dark:text-white">Mushak 6.3</h3>
        <p class="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400">BIN on receipt, VAT 0/5/7.5/10/15%, reports 6.1/6.2/9.1 & 6.10 &gt;2Lac. NBR-ready.</p>
      </div>
      <div class="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[20px] p-5 hover:border-slate-300 dark:hover:border-slate-700 transition">
        <div class="w-10 h-10 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center"><span class="material-symbols-rounded">wifi_off</span></div>
        <h3 class="mt-3 font-bold text-slate-900 dark:text-white">Offline + Bangla + ৳</h3>
        <p class="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400">IndexedDB queue, Bengali ৳, 58mm bitmap. Works during load-shedding.</p>
      </div>
    </div>
  </section>

  <!-- HOW IT WORKS — minimal -->
  <section id="how" class="bg-slate-900 dark:bg-black text-white">
    <div class="max-w-[1160px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div class="text-xs font-bold tracking-widest text-emerald-300">HOW IT WORKS</div>
          <h2 class="mt-2 text-[28px] sm:text-[36px] font-black tracking-tighter leading-none">3 steps. 10 seconds.</h2>
        </div>
        <p class="text-sm text-slate-400 max-w-[420px]">Designed for one thumb, no training. If your staff can use bKash, they can use Mekholi.</p>
      </div>

      <div class="mt-8 grid md:grid-cols-3 gap-4">
        <div class="rounded-[20px] border border-white/10 bg-white/[0.06] p-6">
          <div class="w-8 h-8 rounded-full bg-white text-slate-900 grid place-items-center font-black text-sm">1</div>
          <h3 class="mt-4 font-bold">Add customer by phone</h3>
          <p class="mt-1.5 text-sm leading-6 text-slate-400">017XX → auto name. Or keep Walk-in. No form.</p>
          <div class="mt-5 inline-flex items-center gap-2 text-xs font-bold bg-white text-slate-900 rounded-full px-3 py-2"><span class="material-symbols-rounded text-[16px]">person_add</span> Rahim 01712…</div>
        </div>
        <div class="rounded-[20px] border border-white/10 bg-white/[0.06] p-6">
          <div class="w-8 h-8 rounded-full bg-emerald-400 text-slate-900 grid place-items-center font-black text-sm">2</div>
          <h3 class="mt-4 font-bold">Scan & sell</h3>
          <p class="mt-1.5 text-sm leading-6 text-slate-400">Barcode burst or type “alu” → qty → VAT auto.</p>
          <div class="mt-5 flex gap-2 text-xs font-bold"><span class="bg-white text-slate-900 rounded-full px-3 py-2">89010…</span><span class="bg-emerald-400 text-slate-900 rounded-full px-3 py-2">Cash / bKash</span></div>
        </div>
        <div class="rounded-[20px] border border-white/10 bg-white/[0.06] p-6">
          <div class="w-8 h-8 rounded-full bg-sky-400 text-slate-900 grid place-items-center font-black text-sm">3</div>
          <h3 class="mt-4 font-bold">Baki auto-saved</h3>
          <p class="mt-1.5 text-sm leading-6 text-slate-400">Due → Khata Dilam. One-tap Tagada SMS when you need.</p>
          <div class="mt-5 inline-flex items-center gap-1.5 text-xs font-bold bg-sky-400 text-slate-900 rounded-full px-3 py-2"><span class="material-symbols-rounded text-[16px]">sms</span> “Rahim, baki ৳135”</div>
        </div>
      </div>
    </div>
  </section>

  <!-- DEMO — keeps same IDs -->
  <section id="demo" class="bg-slate-50 dark:bg-slate-900 border-y border-slate-200 dark:border-slate-800">
    <div class="max-w-[1160px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div class="grid lg:grid-cols-[0.95fr_1.05fr] gap-8 items-start">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold tracking-wide dark:text-white">● Live demo — no login</div>
          <h2 class="mt-4 text-[28px] sm:text-[32px] font-black tracking-tighter leading-none text-slate-900 dark:text-white">Try the POS here.</h2>
          <p class="mt-3 text-slate-600 dark:text-slate-400">Real billing logic — add items, hold, paper 58/80mm. This is the app.</p>

          <div class="mt-6 flex flex-wrap gap-2.5">
            <button id="demo-add-rice" class="px-5 py-2.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold hover:bg-black dark:hover:bg-slate-100">+ Add Rice ৳78</button>
            <button id="demo-add-oil" class="px-5 py-2.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700">+ Add Oil ৳180</button>
            <button id="demo-clear" class="px-4 py-2.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-700 dark:text-slate-300">Clear</button>
          </div>

          <div class="mt-6 grid grid-cols-3 gap-3 text-center">
            <div class="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
              <div class="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400">BUNDLE</div>
              <div class="font-black dark:text-white">~42KB</div>
              <div class="text-xs font-semibold text-emerald-600">Lite</div>
            </div>
            <div class="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
              <div class="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400">SPEED</div>
              <div class="font-black dark:text-white">&lt;280ms</div>
              <div class="text-xs font-semibold text-slate-500 dark:text-slate-400">Tap → Print</div>
            </div>
            <div class="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
              <div class="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400">PAPER</div>
              <div class="font-black dark:text-white">58 / 80mm</div>
              <div class="text-xs font-semibold text-slate-500 dark:text-slate-400">ESC/POS</div>
            </div>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-[24px] p-4 sm:p-5 shadow-sm dark:shadow-none">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">LIVE CART</div>
            <div class="flex items-center gap-2">
              <button id="paper-toggle" class="text-xs font-bold px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white">Paper: 58mm</button>
              <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500 text-white">Offline ✓</span>
            </div>
          </div>
          <div id="demo-cart" class="mt-3 space-y-2 min-h-[96px]"></div>
          <div id="demo-totals" class="hidden mt-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
            <div class="flex justify-between text-sm"><span class="text-slate-500 dark:text-slate-400">Subtotal</span><span id="demo-sub" class="font-bold dark:text-white">৳0.00</span></div>
            <div class="flex justify-between text-sm"><span class="text-slate-500 dark:text-slate-400">VAT 5%</span><span id="demo-vat" class="font-bold dark:text-white">৳0.00</span></div>
            <div class="flex justify-between font-black text-base mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 dark:text-white"><span>Total</span><span id="demo-total">৳0.00</span></div>
            <button class="mt-3 w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-full py-3 font-bold inline-flex items-center justify-center gap-2"><span class="material-symbols-rounded">print</span> Pay & Print — <span id="demo-pay">৳0.00</span></button>
          </div>
          <p class="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">Demo only — real app syncs via Supabase + RLS</p>
        </div>
      </div>
    </div>
  </section>

  <!-- PRICING — minimal -->
  <section id="pricing" class="max-w-[1160px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
    <div class="text-center max-w-[640px] mx-auto">
      <h2 class="text-[28px] sm:text-[36px] font-black tracking-tighter text-slate-900 dark:text-white">Simple pricing. <span class="text-slate-500 dark:text-slate-400">In ৳.</span></h2>
      <p class="mt-3 text-slate-600 dark:text-slate-400">No USD. Pay with bKash / Nagad / Rocket. Cancel anytime.</p>
    </div>

    <div class="mt-8 grid md:grid-cols-2 gap-5 max-w-[860px] mx-auto">
      <div class="rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-7">
        <div class="text-xs font-bold tracking-widest text-slate-500 dark:text-slate-400">FREE</div>
        <div class="mt-2 flex items-baseline gap-1"><span class="text-4xl font-black tracking-tighter dark:text-white">৳0</span><span class="text-slate-500">/ forever</span></div>
        <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">For single dokan — khata + basic POS.</p>
        <ul class="mt-6 space-y-2.5 text-sm text-slate-700 dark:text-slate-300">
          <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-600 text-[18px]">check_circle</span> 1 store • 1 user • 200 products</li>
          <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-600 text-[18px]">check_circle</span> Khata & offline & 58mm</li>
          <li class="flex gap-2"><span class="material-symbols-rounded text-slate-300 text-[18px]">cancel</span> <span class="text-slate-400">Mushak reports • 80mm • team</span></li>
        </ul>
        <a href="/login" data-link class="mt-6 block text-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-3 font-bold dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700">Start free</a>
      </div>

      <div class="rounded-[24px] border border-slate-900 dark:border-white bg-slate-900 dark:bg-white p-6 sm:p-7 text-white dark:text-slate-900 relative overflow-hidden">
        <div class="absolute -top-16 -right-16 w-40 h-40 bg-white/10 dark:bg-slate-900/5 rounded-full blur-2xl"></div>
        <div class="relative">
          <div class="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-white text-slate-900 dark:bg-slate-900 dark:text-white">● Most popular</div>
          <div class="mt-3 flex items-baseline gap-1"><span class="text-4xl font-black tracking-tighter">৳499</span><span class="text-white/70 dark:text-slate-500">/ month</span><span class="ml-auto hidden sm:inline-flex text-xs font-bold px-2 py-1 rounded-full bg-white/10 dark:bg-slate-900/5 border border-white/10 dark:border-slate-900/10">৳4,999/yr save 17%</span></div>
          <p class="mt-2 text-sm text-white/70 dark:text-slate-600">For growing shops — everything.</p>
          <ul class="mt-6 space-y-2.5 text-sm">
            <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-400 dark:text-emerald-600 text-[18px]">check_circle</span> Unlimited products • 3 users</li>
            <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-400 dark:text-emerald-600 text-[18px]">check_circle</span> Mushak 6.1/6.2/6.3/9.1 + 6.10</li>
            <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-400 dark:text-emerald-600 text-[18px]">check_circle</span> Purchase • Expense • Drawer • Returns</li>
          </ul>
          <a href="/login" data-link class="mt-6 block text-center rounded-full bg-white dark:bg-slate-900 text-slate-900 dark:text-white py-3 font-bold hover:bg-slate-100 dark:hover:bg-black">Start 7-day trial</a>
          <div class="mt-2 text-center text-xs text-white/60 dark:text-slate-500">bKash / Nagad / Rocket</div>
        </div>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
    <div class="max-w-[1160px] mx-auto px-4 sm:px-6 py-8">
      <div class="flex flex-col sm:flex-row gap-8 justify-between">
        <div>
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 grid place-items-center font-black text-xs">MK</div>
            <span class="font-extrabold dark:text-white">Mekholi</span>
            <span class="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-slate-300">Lite • Offline</span>
          </div>
          <p class="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-[420px]">POS + Khata for Bangladeshi dokan — fast, offline, Bangla, ৳, Mushak 6.3. Vanilla TS + Supabase + RLS.</p>
          <p class="mt-2 text-xs text-slate-500">© 2026 Mekholi • Sylhet • History API • No hash</p>
        </div>
        <div class="grid grid-cols-2 gap-8 text-sm">
          <div>
            <div class="font-semibold dark:text-white">Product</div>
            <div class="mt-2 space-y-1.5 text-slate-600 dark:text-slate-400">
              <a href="#features" class="block hover:text-slate-900 dark:hover:text-white">Features</a>
              <a href="#pricing" class="block hover:text-slate-900 dark:hover:text-white">Pricing</a>
              <a href="/app" data-link class="block hover:text-slate-900 dark:hover:text-white">Open app</a>
            </div>
          </div>
          <div>
            <div class="font-semibold dark:text-white">Help</div>
            <div class="mt-2 space-y-1.5 text-slate-600 dark:text-slate-400">
              <a href="/help" data-link class="block hover:text-slate-900 dark:hover:text-white">Docs</a>
              <a href="mailto:hello@mekholi.com" class="block hover:text-slate-900 dark:hover:text-white">hello@mekholi.com</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </footer>
  `
}
