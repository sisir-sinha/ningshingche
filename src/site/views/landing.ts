export default function landing(): string {
  return `
  <!-- NAVBAR -->
  <header id="site-header" class="sticky top-0 z-50 backdrop-blur-xl bg-white/75 border-b border-slate-100">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 flex items-center justify-between h-[64px]">
      <a href="/" data-link class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-slate-900 text-white grid place-items-center font-black text-[13px] tracking-tight">MK</div>
        <div>
          <div class="font-extrabold leading-none tracking-tight text-slate-900">Mekholi</div>
          <div class="text-[10px] font-bold tracking-[0.14em] text-emerald-600 -mt-0.5">POS • KHATA • HISAB</div>
        </div>
      </a>
      <nav class="hidden md:flex items-center gap-1 text-[13px] font-medium">
        <a href="#features" class="px-3 py-2 rounded-full hover:bg-slate-50 text-slate-700">Features</a>
        <a href="#how" class="px-3 py-2 rounded-full hover:bg-slate-50 text-slate-700">How it works</a>
        <a href="/pricing" data-link class="px-3 py-2 rounded-full hover:bg-slate-50 text-slate-700">Pricing</a>
        <a href="/help" data-link class="px-3 py-2 rounded-full hover:bg-slate-50 text-slate-700">Help</a>
        <span class="w-px h-5 bg-slate-200 mx-1"></span>
        <button id="lang-toggle" class="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-bold flex items-center gap-1.5 hover:bg-slate-50">
          <span class="material-symbols-rounded text-[16px]">language</span> <span id="lang-label">BN / EN</span>
        </button>
      </nav>
      <div class="flex items-center gap-2">
        <a href="/login" data-link class="hidden sm:inline-flex text-sm font-semibold px-4 py-2 rounded-full hover:bg-slate-50">Log in</a>
        <a href="/app" data-link class="inline-flex items-center gap-2 bg-slate-900 text-white text-sm font-bold px-5 py-2.5 rounded-full hover:bg-black transition shadow-sm">
          Try Free <span class="material-symbols-rounded text-[18px]">arrow_forward</span>
        </a>
        <button id="mobile-menu-btn" class="md:hidden w-9 h-9 grid place-items-center rounded-full border border-slate-200">
          <span class="material-symbols-rounded">menu</span>
        </button>
      </div>
    </div>
    <!-- mobile menu -->
    <div id="mobile-menu" class="hidden md:hidden border-t border-slate-100 bg-white px-4 py-4 space-y-1">
      <a href="#features" class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 font-medium">Features</a>
      <a href="#how" class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 font-medium">How it works</a>
      <a href="/pricing" data-link class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 font-medium">Pricing</a>
      <a href="/help" data-link class="block px-3 py-2.5 rounded-xl hover:bg-slate-50 font-medium">Help</a>
      <div class="pt-3 flex gap-2">
        <a href="/login" data-link class="flex-1 text-center font-semibold py-2.5 rounded-full border border-slate-200">Log in</a>
        <a href="/app" data-link class="flex-1 text-center bg-slate-900 text-white font-bold py-2.5 rounded-full">Try Free</a>
      </div>
    </div>
  </header>

  <!-- HERO -->
  <section class="relative overflow-hidden">
    <div class="absolute inset-0 bg-gradient-to-b from-emerald-50/70 via-white to-white"></div>
    <div class="absolute -top-32 -right-32 w-[520px] h-[520px] bg-sky-100 rounded-full blur-[80px] opacity-60"></div>
    <div class="absolute -bottom-32 -left-32 w-[520px] h-[520px] bg-emerald-100 rounded-full blur-[80px] opacity-50"></div>
    <div class="relative max-w-[1120px] mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-10">
      <div class="grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 shadow-sm text-xs font-bold">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span class="text-slate-700">Made for Bangladeshi Dokan</span>
            <span class="hidden sm:inline text-slate-400">•</span>
            <span class="hidden sm:inline text-emerald-700">Offline • Bangla • ৳</span>
          </div>
          <h1 class="mt-5 text-[32px] sm:text-[44px] font-black leading-[0.95] tracking-tight text-slate-900">
            দোকানের হিসাব,<br>
            <span class="gradient-text">এখন আরও সহজ</span>
          </h1>
          <p class="mt-3 text-[15px] sm:text-[17px] leading-6 text-slate-600 max-w-[56ch]">
            <span class="font-semibold text-slate-900">Mekholi Lite</span> — TallyKhata-র সহজ খাতা + রিয়েল POS। Barcode billing, Baki/Khata (Dilam/Pelam), bKash/Nagad/Bangla QR, stock & Mushak 6.3 — সব এক ফোনে, নেট ছাড়াও চলে।
          </p>
          <p class="mt-2 text-xs font-semibold tracking-wide text-slate-500">Mekholi Lite — TallyKhata’s simple Khata + real POS. Works offline on 2GB RAM phones.</p>

          <div class="mt-6 flex flex-wrap gap-3">
            <a href="/app" data-link class="inline-flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-full font-bold hover:bg-black transition shadow-lg shadow-slate-900/10">
              <span class="material-symbols-rounded">bolt</span> Start Free — 7 Days
            </a>
            <a href="#demo" class="inline-flex items-center gap-2 bg-white border border-slate-200 px-6 py-3 rounded-full font-bold hover:bg-slate-50 transition">
              <span class="material-symbols-rounded">play_circle</span> See 30s Demo
            </a>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span class="inline-flex items-center gap-1.5"><span class="material-symbols-rounded text-[16px] text-emerald-600">verified</span> No card needed</span>
            <span class="inline-flex items-center gap-1.5"><span class="material-symbols-rounded text-[16px] text-emerald-600">smartphone</span> PWA — Add to Home Screen</span>
            <span class="inline-flex items-center gap-1.5"><span class="material-symbols-rounded text-[16px] text-emerald-600">wifi_off</span> Works offline</span>
          </div>

          <!-- trust -->
          <div class="mt-8 flex items-center gap-4 border-t border-slate-100 pt-5">
            <div class="flex -space-x-2">
              <img src="https://i.pravatar.cc/100?img=12" class="w-8 h-8 rounded-full border-2 border-white object-cover"/>
              <img src="https://i.pravatar.cc/100?img=32" class="w-8 h-8 rounded-full border-2 border-white object-cover"/>
              <img src="https://i.pravatar.cc/100?img=16" class="w-8 h-8 rounded-full border-2 border-white object-cover"/>
            </div>
            <div class="text-xs leading-4">
              <div class="font-bold text-slate-900">1,000+ dokans in pilot waitlist</div>
              <div class="text-slate-500">Sylhet • Dhaka • Chattogram</div>
            </div>
            <div class="ml-auto hidden sm:flex items-center gap-1.5 text-xs font-bold bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-full">
              <span class="material-symbols-rounded text-[16px]">star</span> 4.9/5 pilot love
            </div>
          </div>
        </div>

        <!-- HERO VISUAL — Receipt + Khata + POS -->
        <div class="relative lg:pl-6">
          <div class="relative bg-white rounded-[24px] shadow-[0_20px_60px_rgba(15,23,42,0.12)] border border-slate-200 p-4 sm:p-5 overflow-hidden">
            <!-- window dots -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span class="w-3 h-3 rounded-full bg-red-400"></span><span class="w-3 h-3 rounded-full bg-amber-400"></span><span class="w-3 h-3 rounded-full bg-emerald-400"></span>
              </div>
              <div class="text-[11px] font-bold tracking-widest text-slate-400">MEKHOLI POS • OFFLINE ✓</div>
              <div class="text-[10px] font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full">● Live</div>
            </div>

            <div class="grid grid-cols-[1.35fr_0.85fr] gap-4 mt-4">
              <!-- POS list -->
              <div class="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div class="flex items-center justify-between">
                  <div class="text-[11px] font-extrabold tracking-widest text-slate-500">CART</div>
                  <div class="text-[10px] font-bold bg-white border border-slate-200 px-2 py-1 rounded-full">58mm</div>
                </div>
                <div class="mt-3 space-y-2 text-[13px]">
                  <div class="flex justify-between items-center bg-white rounded-xl px-3 py-2.5 border border-slate-200"><span>Miniket Rice 1kg</span><span class="font-bold">2 × ৳78</span></div>
                  <div class="flex justify-between items-center bg-white rounded-xl px-3 py-2.5 border border-slate-200"><span>Parachute Oil</span><span class="font-bold">1 × ৳180</span></div>
                  <div class="flex justify-between items-center bg-white rounded-xl px-3 py-2.5 border border-slate-200"><span class="text-slate-500">Discount 5%</span><span class="font-bold text-emerald-600">-৳17</span></div>
                </div>
                <div class="mt-3 bg-slate-900 text-white rounded-2xl p-3">
                  <div class="flex justify-between text-xs opacity-80"><span>VAT 5%</span><span>৳16</span></div>
                  <div class="flex justify-between font-black text-[18px] mt-1"><span>TOTAL</span><span>৳335</span></div>
                  <div class="mt-2 grid grid-cols-2 gap-2">
                    <div class="bg-white text-slate-900 rounded-full py-2 text-xs font-bold text-center">Cash</div>
                    <div class="bg-emerald-500 text-white rounded-full py-2 text-xs font-bold text-center">bKash ✓</div>
                  </div>
                  <div class="mt-2 text-[11px] bg-red-500/20 border border-red-500/30 rounded-full px-3 py-1.5 flex justify-between font-bold"><span>BAKI DUE</span><span>৳135</span></div>
                </div>
              </div>

              <!-- receipt + khata -->
              <div class="space-y-3">
                <div class="bg-white rounded-2xl border border-slate-200 p-3 font-mono text-[11px] leading-4 shadow-sm">
                  <div class="text-center font-black text-[12px]">MEKHOLI — SYLHET</div>
                  <div class="text-center text-[10px] text-slate-500">BIN: 123456789 ****</div>
                  <div class="text-center text-[9px] tracking-widest text-slate-500">MUSHAK 6.3 • 22 Sep 2026</div>
                  <div class="receipt-dashed my-2"></div>
                  <div class="flex justify-between"><span>Trx: 9H7K2L9P</span><span>4:15 PM</span></div>
                  <div class="receipt-dashed my-2"></div>
                  <div class="flex justify-between font-bold"><span>TOTAL</span><span>৳335</span></div>
                  <div class="flex justify-between text-emerald-600 font-bold"><span>Paid</span><span>৳200</span></div>
                  <div class="flex justify-between text-red-600 font-black bg-red-50 rounded px-1 py-0.5 mt-1"><span>BAKI</span><span>৳135</span></div>
                  <div class="text-center mt-2 text-[9px] text-slate-400">Dhonnobad! Abar ashben.</div>
                  <div class="mt-2 grid place-items-center">
                    <div class="w-16 h-16 bg-slate-900 rounded-lg grid place-items-center text-white text-[8px] font-bold">Bangla QR</div>
                  </div>
                </div>
                <div class="bg-amber-50 border border-amber-200 rounded-2xl p-3">
                  <div class="text-[11px] font-extrabold tracking-widest text-amber-700">KHATA • RAHIM</div>
                  <div class="text-xs font-bold">01712-345678</div>
                  <div class="mt-2 flex items-center justify-between bg-white rounded-full px-3 py-2 border border-amber-200">
                    <span class="text-xs font-bold text-slate-600">Due</span><span class="font-black text-red-600">৳1,170</span>
                  </div>
                  <button class="mt-2 w-full bg-slate-900 text-white rounded-full py-2 text-xs font-bold flex items-center justify-center gap-1.5"><span class="material-symbols-rounded text-[14px]">sms</span> Tagada SMS</button>
                </div>
              </div>
            </div>

            <!-- bottom stats -->
            <div class="mt-4 grid grid-cols-3 gap-3">
              <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-center"><div class="text-[11px] font-bold tracking-widest text-emerald-700">TODAY SALES</div><div class="font-black text-slate-900">৳12,480</div><div class="text-[11px] text-emerald-600 font-bold">+18%</div></div>
              <div class="bg-sky-50 border border-sky-200 rounded-2xl p-3 text-center"><div class="text-[11px] font-bold tracking-widest text-sky-700">DUE TO GET</div><div class="font-black text-slate-900">৳8,350</div><div class="text-[11px] text-sky-600 font-bold">12 customers</div></div>
              <div class="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-center"><div class="text-[11px] font-bold tracking-widest text-amber-700">PROFIT</div><div class="font-black text-slate-900">৳2,940</div><div class="text-[11px] text-amber-600 font-bold">Today</div></div>
            </div>
          </div>

          <!-- floating badge -->
          <div class="hidden sm:flex absolute -left-4 top-10 bg-white border border-slate-200 shadow-xl rounded-2xl px-3 py-2.5 items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-emerald-500 text-white grid place-items-center"><span class="material-symbols-rounded text-[18px]">wifi_off</span></div>
            <div class="text-xs"><div class="font-bold">Offline — Sold ✓</div><div class="text-slate-500">Printed even without net</div></div>
          </div>
          <div class="hidden sm:flex absolute -right-4 bottom-10 bg-slate-900 text-white shadow-xl rounded-2xl px-3 py-2.5 items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-white text-slate-900 grid place-items-center"><span class="material-symbols-rounded text-[18px]">qr_code</span></div>
            <div class="text-xs"><div class="font-bold">Bangla QR</div><div class="text-slate-400">1 QR = 34 banks/wallets</div></div>
          </div>
        </div>
      </div>

      <!-- logos -->
      <div class="mt-8 border-y border-slate-100 bg-white/60 backdrop-blur">
        <div class="max-w-[1120px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs font-bold tracking-widest text-slate-400">
          <span>TRUSTED BY SHOPS IN</span>
          <span class="flex items-center gap-2 text-slate-700"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> SYLHET</span>
          <span class="flex items-center gap-2 text-slate-700"><span class="w-2 h-2 rounded-full bg-sky-500"></span> DHAKA</span>
          <span class="flex items-center gap-2 text-slate-700"><span class="w-2 h-2 rounded-full bg-amber-500"></span> CHATTOGRAM</span>
          <span class="flex items-center gap-2 text-slate-700"><span class="w-2 h-2 rounded-full bg-violet-500"></span> RAJSHAHI</span>
        </div>
      </div>
    </div>
  </section>

  <!-- FEATURES -->
  <section id="features" class="max-w-[1120px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
    <div class="max-w-2xl">
      <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full"><span class="material-symbols-rounded text-[16px]">auto_awesome</span> EVERYTHING A DOKAN NEEDS</div>
      <h2 class="mt-3 text-[28px] sm:text-[36px] font-black tracking-tight leading-none text-slate-900">TallyKhata-র খাতা, <span class="gradient-text">সাথে ফুল POS</span></h2>
      <p class="mt-3 text-slate-600">We kept what TallyKhata got right — 3-sec Baki entry + Tagada — and added what it never had: barcode billing, stock, Mushak & real receipts. One phone, one app.</p>
    </div>

    <div class="mt-8 grid md:grid-cols-3 gap-4 sm:gap-5">
      <div class="card-hover bg-white border border-slate-200 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-red-50 border border-red-200 grid place-items-center text-red-600"><span class="material-symbols-rounded">book</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900">Baki / Khata — Dilam & Pelam</h3>
        <p class="mt-1 text-sm text-slate-600 leading-5">Add customer by phone in 5 sec. Sale on due auto-creates khata. See total due, history, and send <b>Tagada SMS/WhatsApp</b> in one tap.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">P0 • Core</div>
      </div>
      <div class="card-hover bg-white border border-slate-200 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 grid place-items-center text-sky-600"><span class="material-symbols-rounded">barcode_scanner</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900">Barcode POS — <span class="text-slate-500 font-semibold">58/80mm</span></h3>
        <p class="mt-1 text-sm text-slate-600 leading-5">HID burst scan + camera scan. Works <b>loose</b> (kg/ltr) without barcode. Discount, VAT, hold/resume, TrxID.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2.5 py-1 rounded-full">Offline first • &lt;280ms</div>
      </div>
      <div class="card-hover bg-white border border-slate-200 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 grid place-items-center text-emerald-600"><span class="material-symbols-rounded">inventory_2</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900">Stock + Purchase + Low-Stock</h3>
        <p class="mt-1 text-sm text-slate-600 leading-5">Purchase → stock +10, sale → stock −1, return → restore. Low-stock badge at 5, dead-stock warning.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">Never negative</div>
      </div>
      <div class="card-hover bg-white border border-slate-200 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-violet-50 border border-violet-200 grid place-items-center text-violet-600"><span class="material-symbols-rounded">qr_code_2</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900">bKash / Nagad / Bangla QR</h3>
        <p class="mt-1 text-sm text-slate-600 leading-5"><b>1 QR = 34 banks/wallets</b> (BB). Manual TrxID for personal bKash, auto verify via SSLCommerz later.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-violet-700 bg-violet-50 border border-violet-200 px-2.5 py-1 rounded-full">MFS done right</div>
      </div>
      <div class="card-hover bg-white border border-slate-200 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 grid place-items-center text-amber-600"><span class="material-symbols-rounded">receipt_long</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900">Mushak 6.3 + BIN + VAT</h3>
        <p class="mt-1 text-sm text-slate-600 leading-5">Per-product slabs 0/5/7.5/10/15%. Receipt is Mushak 6.3 (BIN, VAT line). Reports 6.1/6.2/9.1/6.10.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">NBR-ready</div>
      </div>
      <div class="card-hover bg-white border border-slate-200 rounded-[20px] p-5">
        <div class="w-10 h-10 rounded-xl bg-slate-900 text-white grid place-items-center"><span class="material-symbols-rounded">wifi_off</span></div>
        <h3 class="mt-3 font-extrabold text-slate-900">Offline + ৳ + Bangla</h3>
        <p class="mt-1 text-sm text-slate-600 leading-5">IndexedDB first, queue & sync. Bangla + English, ৳ formatting, 58mm bitmap Bangla print.</p>
        <div class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold bg-slate-900 text-white px-2.5 py-1 rounded-full">Survives load-shedding</div>
      </div>
    </div>
  </section>

  <!-- HOW IT WORKS -->
  <section id="how" class="bg-slate-900 text-white relative overflow-hidden">
    <div class="absolute inset-0 bg-gradient-to-br from-emerald-600/20 via-transparent to-sky-600/20"></div>
    <div class="relative max-w-[1120px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div class="max-w-2xl">
        <div class="text-xs font-extrabold tracking-widest text-emerald-300">HOW IT WORKS • 30 SECONDS</div>
        <h2 class="mt-2 text-[28px] sm:text-[36px] font-black tracking-tight leading-none">Phone → Amount → Done</h2>
        <p class="mt-3 text-slate-300">If it takes more than 10 seconds, we failed. Every flow is one-thumb, Bangla-first, no jargon.</p>
      </div>
      <div class="mt-8 grid md:grid-cols-3 gap-4 sm:gap-5">
        <div class="bg-white/10 backdrop-blur border border-white/10 rounded-[20px] p-5">
          <div class="w-8 h-8 rounded-full bg-white text-slate-900 grid place-items-center font-black text-sm">1</div>
          <h3 class="mt-3 font-bold">Add Customer by Phone</h3>
          <p class="mt-1 text-sm text-slate-300 leading-5">017XX → Name auto suggest. No address needed. Or walk-in.</p>
          <div class="mt-4 flex items-center gap-2 text-xs font-bold bg-white text-slate-900 rounded-full px-3 py-2 w-fit"><span class="material-symbols-rounded text-[16px]">person_add</span> Rahim 01712-345678</div>
        </div>
        <div class="bg-white/10 backdrop-blur border border-white/10 rounded-[20px] p-5">
          <div class="w-8 h-8 rounded-full bg-emerald-400 text-slate-900 grid place-items-center font-black text-sm">2</div>
          <h3 class="mt-3 font-bold">Scan or Type — Sell</h3>
          <p class="mt-1 text-sm text-slate-300 leading-5">Barcode burst or “alu” search → qty → VAT auto → Pay.</p>
          <div class="mt-4 grid grid-cols-2 gap-2">
            <div class="bg-white text-slate-900 rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-2"><span class="material-symbols-rounded text-[16px]">barcode</span> 8901030...</div>
            <div class="bg-emerald-400 text-slate-900 rounded-xl px-3 py-2 text-xs font-bold">Cash / bKash</div>
          </div>
        </div>
        <div class="bg-white/10 backdrop-blur border border-white/10 rounded-[20px] p-5">
          <div class="w-8 h-8 rounded-full bg-sky-400 text-slate-900 grid place-items-center font-black text-sm">3</div>
          <h3 class="mt-3 font-bold">Baki Auto-Saved + Tagada</h3>
          <p class="mt-1 text-sm text-slate-300 leading-5">Due ৳135 → khata Dilam. Later Pelam → due ↓. One tap SMS.</p>
          <div class="mt-4 flex items-center gap-2 text-xs font-bold bg-sky-400 text-slate-900 rounded-full px-3 py-2 w-fit"><span class="material-symbols-rounded text-[16px]">sms</span> “Rahim, baki ৳135…”</div>
        </div>
      </div>
    </div>
  </section>

  <!-- DEMO / PREVIEW -->
  <section id="demo" class="max-w-[1120px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
    <div class="grid lg:grid-cols-[0.95fr_1.05fr] gap-8 items-center">
      <div>
        <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-sky-700 bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-full"><span class="material-symbols-rounded text-[16px]">smart_display</span> INTERACTIVE PREVIEW</div>
        <h2 class="mt-3 text-[28px] sm:text-[32px] font-black tracking-tight leading-none text-slate-900">Try the POS — no login</h2>
        <p class="mt-3 text-slate-600 text-[15px] leading-6">Add items, set qty, switch 58/80mm, toggle Bangla/English — feel the lite speed.</p>
        <div class="mt-6 flex gap-3">
          <button id="demo-add-rice" class="px-4 py-2.5 rounded-full bg-slate-900 text-white text-sm font-bold hover:bg-black">+ Add Rice</button>
          <button id="demo-add-oil" class="px-4 py-2.5 rounded-full bg-white border border-slate-200 text-sm font-bold hover:bg-slate-50">+ Add Oil</button>
          <button id="demo-clear" class="px-4 py-2.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-sm font-bold">Clear</button>
        </div>
        <div class="mt-6 grid grid-cols-3 gap-3 text-center">
          <div class="rounded-2xl border border-slate-200 p-3"><div class="text-[11px] font-bold tracking-widest text-slate-500">BUNDLE</div><div class="font-black">~42KB</div><div class="text-xs text-emerald-600 font-bold">Lite</div></div>
          <div class="rounded-2xl border border-slate-200 p-3"><div class="text-[11px] font-bold tracking-widest text-slate-500">OFFLINE</div><div class="font-black">&lt;280ms</div><div class="text-xs text-sky-600 font-bold">Tap→Print</div></div>
          <div class="rounded-2xl border border-slate-200 p-3"><div class="text-[11px] font-bold tracking-widest text-slate-500">PAPER</div><div class="font-black">58 / 80mm</div><div class="text-xs text-slate-500">Toggle →</div></div>
        </div>
      </div>

      <div class="bg-slate-50 border border-slate-200 rounded-[24px] p-4 sm:p-5">
        <div class="flex items-center justify-between">
          <div class="text-xs font-extrabold tracking-widest text-slate-500">LIVE CART</div>
          <div class="flex items-center gap-2">
            <button id="paper-toggle" class="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full">Paper: 58mm</button>
            <span class="text-xs font-bold bg-emerald-500 text-white px-2.5 py-1 rounded-full">Offline ✓</span>
          </div>
        </div>
        <div id="demo-cart" class="mt-3 space-y-2">
          <div class="text-sm text-slate-500 py-8 text-center border-2 border-dashed border-slate-200 rounded-2xl">Cart empty — click “+ Add”</div>
        </div>
        <div id="demo-totals" class="mt-3 bg-white border border-slate-200 rounded-2xl p-3 hidden">
          <div class="flex justify-between text-sm"><span class="text-slate-500">Subtotal</span><span id="demo-sub" class="font-bold">৳0.00</span></div>
          <div class="flex justify-between text-sm"><span class="text-slate-500">VAT 5%</span><span id="demo-vat" class="font-bold">৳0.00</span></div>
          <div class="flex justify-between font-black text-base mt-2 pt-2 border-t border-slate-100"><span>TOTAL</span><span id="demo-total">৳0.00</span></div>
          <button class="mt-3 w-full bg-slate-900 text-white rounded-full py-3 font-bold flex items-center justify-center gap-2 hover:bg-black transition"><span class="material-symbols-rounded">print</span> Pay & Print — <span id="demo-pay">৳0.00</span></button>
        </div>
      </div>
    </div>
  </section>

  <!-- PRICING -->
  <section id="pricing" class="bg-gradient-to-b from-white to-slate-50 border-y border-slate-100">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div class="text-center max-w-2xl mx-auto">
        <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-slate-700 bg-white border border-slate-200 px-3 py-1.5 rounded-full"><span class="material-symbols-rounded text-[16px]">payments</span> PRICING — IN BDT VIA BKASH</div>
        <h2 class="mt-3 text-[28px] sm:text-[36px] font-black tracking-tight text-slate-900">Free to start, <span class="gradient-text">৳499 when you grow</span></h2>
        <p class="mt-3 text-slate-600">No Stripe, no USD. Pay with bKash / Nagad / Rocket — like you already do.</p>
        <div class="mt-6 inline-flex bg-slate-900 rounded-full p-1 text-sm">
          <button id="bill-monthly" class="px-5 py-2 rounded-full bg-white text-slate-900 font-bold">Monthly</button>
          <button id="bill-yearly" class="px-5 py-2 rounded-full text-white font-semibold">Yearly <span class="ml-1 bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">SAVE 17%</span></button>
        </div>
      </div>

      <div class="mt-8 grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">
        <div class="bg-white border border-slate-200 rounded-[24px] p-6 sm:p-7">
          <div class="text-xs font-extrabold tracking-widest text-slate-500">FREE • TALIYHATA STYLE</div>
          <h3 class="mt-2 text-2xl font-black">Standard</h3>
          <div class="mt-2 flex items-baseline gap-2"><span class="text-4xl font-black">৳0</span><span class="text-slate-500">/ forever</span></div>
          <p class="mt-2 text-sm text-slate-600">For single dokan — khata + basic POS.</p>
          <ul class="mt-5 space-y-2.5 text-sm">
            <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-600 text-[18px]">check_circle</span> 1 store • 1 user • 200 products</li>
            <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-600 text-[18px]">check_circle</span> Unlimited Khata + Tagada SMS intent</li>
            <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-600 text-[18px]">check_circle</span> Offline + 58mm print</li>
            <li class="flex gap-2 text-slate-400"><span class="material-symbols-rounded text-slate-300 text-[18px]">cancel</span> Mushak reports • Bulk SMS • 80mm</li>
          </ul>
          <a href="/app" data-link class="mt-6 block text-center bg-white border-2 border-slate-900 text-slate-900 font-bold py-3 rounded-full hover:bg-slate-50">Start Free</a>
        </div>

        <div class="bg-slate-900 text-white rounded-[24px] p-6 sm:p-7 relative overflow-hidden border border-slate-800">
          <div class="absolute -top-20 -right-20 w-60 h-60 bg-emerald-500/20 rounded-full blur-2xl"></div>
          <div class="relative">
            <div class="inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-emerald-300 bg-white/10 border border-white/10 px-3 py-1 rounded-full"><span class="material-symbols-rounded text-[16px]">crown</span> MOST POPULAR</div>
            <h3 class="mt-3 text-2xl font-black">Lite</h3>
            <div class="mt-2 flex items-baseline gap-2">
              <span id="price-main" class="text-4xl font-black">৳499</span><span class="text-slate-400">/ month</span>
              <span id="price-sub" class="ml-auto text-xs font-bold bg-white text-slate-900 px-2.5 py-1 rounded-full hidden">৳4,999/yr</span>
            </div>
            <p class="mt-2 text-sm text-slate-300">For serious shops — everything in Lite doc.</p>
            <ul class="mt-5 space-y-2.5 text-sm">
              <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-400 text-[18px]">check_circle</span> Unlimited products • 3 users</li>
              <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-400 text-[18px]">check_circle</span> Mushak 6.1/6.2/6.3/9.1 + 6.10</li>
              <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-400 text-[18px]">check_circle</span> Purchase + Expense + Drawer + Returns</li>
              <li class="flex gap-2"><span class="material-symbols-rounded text-emerald-400 text-[18px]">check_circle</span> Bulk Tagada + PDF export + 80mm</li>
            </ul>
            <a href="/app" data-link class="mt-6 block text-center bg-white text-slate-900 font-black py-3 rounded-full hover:bg-slate-100">Start 7-Day Trial</a>
            <div class="mt-3 text-center text-xs text-slate-400">Pay via bKash / Nagad / Rocket • Cancel anytime</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="max-w-[1120px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
    <div class="max-w-3xl mx-auto">
      <h2 class="text-2xl sm:text-3xl font-black tracking-tight text-center">প্রশ্ন আছে? • FAQ</h2>
      <div class="mt-8 space-y-3" id="faq-list">
        <details class="group bg-white border border-slate-200 rounded-2xl p-5 open:bg-slate-50" open>
          <summary class="flex items-center justify-between cursor-pointer list-none">
            <span class="font-bold">TallyKhata vs Mekholi — পার্থক্য কী?</span>
            <span class="material-symbols-rounded group-open:rotate-180 transition">expand_more</span>
          </summary>
          <p class="mt-3 text-sm text-slate-600 leading-6">TallyKhata = excellent khata, no real billing. Mekholi Lite = same easy Dilam/Pelam + <b>real barcode POS, purchase, Mushak 6.3, 58mm receipt, offline</b>. Think “TallyKhata with billing”.</p>
        </details>
        <details class="group bg-white border border-slate-200 rounded-2xl p-5">
          <summary class="flex items-center justify-between cursor-pointer list-none">
            <span class="font-bold">Does it work without internet?</span>
            <span class="material-symbols-rounded group-open:rotate-180 transition">expand_more</span>
          </summary>
          <p class="mt-3 text-sm text-slate-600 leading-6">Yes — IndexedDB first, queue & sync later. Sale → print never waits for net. Tested on 2G + load-shedding.</p>
        </details>
        <details class="group bg-white border border-slate-200 rounded-2xl p-5">
          <summary class="flex items-center justify-between cursor-pointer list-none">
            <span class="font-bold">bKash payment — need merchant account?</span>
            <span class="material-symbols-rounded group-open:rotate-180 transition">expand_more</span>
          </summary>
          <p class="mt-3 text-sm text-slate-600 leading-6">No — V1 uses <b>personal bKash + manual TrxID</b> (like PaySync). V1.1 adds SSLCommerz auto-verify. Both work.</p>
        </details>
        <details class="group bg-white border border-slate-200 rounded-2xl p-5">
          <summary class="flex items-center justify-between cursor-pointer list-none">
            <span class="font-bold">Is it NBR Mushak compliant?</span>
            <span class="material-symbols-rounded group-open:rotate-180 transition">expand_more</span>
          </summary>
          <p class="mt-3 text-sm text-slate-600 leading-6">Receipt is Mushak 6.3 (BIN, VAT line, buyer BIN if >৳25k). Reports 6.1/6.2/9.1 and 6.10 (>৳2L) + SDC-ready.</p>
        </details>
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="max-w-[1120px] mx-auto px-4 sm:px-6 pb-12">
    <div class="bg-slate-900 rounded-[24px] p-6 sm:p-8 flex flex-col lg:flex-row items-center justify-between gap-6 relative overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-r from-emerald-600/20 to-sky-600/20"></div>
      <div class="relative">
        <h3 class="text-2xl font-black text-white">Start free today — no card</h3>
        <p class="text-slate-300 mt-1">7-day trial • 1 phone • Full POS + Khata. Cancel anytime.</p>
      </div>
      <div class="relative flex gap-3 w-full lg:w-auto">
        <a href="/app" data-link class="flex-1 lg:flex-none inline-flex items-center justify-center gap-2 bg-white text-slate-900 px-7 py-3 rounded-full font-black hover:bg-slate-100"><span class="material-symbols-rounded">rocket_launch</span> Open Lite App</a>
        <a href="/login" data-link class="hidden sm:inline-flex items-center gap-2 bg-white/10 border border-white/20 text-white px-6 py-3 rounded-full font-bold hover:bg-white/15">Log in</a>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="border-t border-slate-100 bg-white">
    <div class="max-w-[1120px] mx-auto px-4 sm:px-6 py-8">
      <div class="flex flex-col md:flex-row gap-8 justify-between">
        <div>
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-xl bg-slate-900 text-white grid place-items-center font-black text-xs">MK</div>
            <div class="font-extrabold">Mekholi</div>
          </div>
          <div class="text-sm text-slate-500 mt-2 max-w-sm">Lite POS for Bangladeshi dokan — Khata, Billing, Stock & Mushak. Offline-first, Bangla-first, 58mm-first.</div>
          <div class="mt-3 text-xs text-slate-400">© 2026 Mekholi • Sylhet, Bangladesh • Built with Vanilla TS • No hash, History API</div>
        </div>
        <div class="grid grid-cols-2 gap-8 text-sm">
          <div>
            <div class="font-bold text-slate-900">Product</div>
            <div class="mt-2 space-y-1.5 text-slate-600">
              <a href="#features" class="block hover:text-slate-900">Features</a>
              <a href="/pricing" data-link class="block hover:text-slate-900">Pricing</a>
              <a href="/app" data-link class="block hover:text-slate-900">Lite App</a>
            </div>
          </div>
          <div>
            <div class="font-bold text-slate-900">Support</div>
            <div class="mt-2 space-y-1.5 text-slate-600">
              <a href="/help" data-link class="block hover:text-slate-900">Help</a>
              <a href="mailto:hello@mekholi.com" class="block hover:text-slate-900">hello@mekholi.com</a>
              <span class="block text-slate-400">017XX-XXXXXX (BN)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </footer>
  `
}
