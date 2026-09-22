export default function help(): string {
  return `
  <section class="max-w-[800px] mx-auto px-4 sm:px-6 py-10">
    <a href="/" data-link class="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"><span class="material-symbols-rounded text-[18px]">arrow_back</span> Back Home</a>
    <h1 class="mt-4 text-3xl font-black tracking-tight">Help & Docs</h1>
    <p class="mt-2 text-slate-600">Bangla + English. Video + text. 2-minute guides.</p>
    <div class="mt-8 grid gap-4">
      <div class="bg-white border border-slate-200 rounded-2xl p-5">
        <div class="font-bold flex items-center gap-2"><span class="material-symbols-rounded text-sky-600">barcode_scanner</span> How to scan?</div>
        <p class="text-sm text-slate-600 mt-1">Use USB/Bluetooth scanner (HID mode) or tap camera icon in POS. For loose items (rice), type name → select → enter kg.</p>
      </div>
      <div class="bg-white border border-slate-200 rounded-2xl p-5">
        <div class="font-bold flex items-center gap-2"><span class="material-symbols-rounded text-emerald-600">receipt</span> Printer not printing?</div>
        <p class="text-sm text-slate-600 mt-1">Pair Bluetooth in phone Settings → open App → Settings → Printer → Test Print. Use 58mm default. Check paper roll direction.</p>
      </div>
      <div class="bg-white border border-slate-200 rounded-2xl p-5">
        <div class="font-bold flex items-center gap-2"><span class="material-symbols-rounded text-amber-600">book</span> Baki recovery?</div>
        <p class="text-sm text-slate-600 mt-1">Open Khata → select customer → Tap “Tagada SMS” → sends “Rahim, baki ৳X — Mekholi Store”. Or Pelam → enter paid amount.</p>
      </div>
      <div class="bg-white border border-slate-200 rounded-2xl p-5">
        <div class="font-bold flex items-center gap-2"><span class="material-symbols-rounded text-violet-600">qr_code</span> Bangla QR?</div>
        <p class="text-sm text-slate-600 mt-1">Settings → Payments → Bangla QR → paste your QR data. One QR = bKash/Nagad/cards. Print and stick on counter.</p>
      </div>
    </div>
    <div class="mt-8 p-5 bg-amber-50 border border-amber-200 rounded-2xl">
      <div class="font-bold">Need human help? • মানুষের সাহায্য লাগবে?</div>
      <p class="text-sm text-slate-700 mt-1">Call 017XX-XXXXXX (10am–8pm, BN) or email hello@mekholi.com. We reply in Bangla.</p>
    </div>
  </section>`
}
