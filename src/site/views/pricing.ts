export default function pricing(): string {
  return `
  <section class="max-w-[1120px] mx-auto px-4 sm:px-6 py-10">
    <a href="/" data-link class="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"><span class="material-symbols-rounded text-[18px]">arrow_back</span> Back Home</a>
    <div class="mt-6 text-center max-w-2xl mx-auto">
      <h1 class="text-3xl font-black tracking-tight">Simple BDT pricing</h1>
      <p class="mt-2 text-slate-600">Pay with bKash / Nagad / Rocket. No USD, no Stripe.</p>
    </div>
    <div class="mt-8 grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">
      <div class="bg-white border border-slate-200 rounded-[24px] p-7">
        <div class="text-xs font-extrabold tracking-widest text-slate-500">FREE</div>
        <div class="mt-2 text-4xl font-black">৳0</div>
        <ul class="mt-4 space-y-2 text-sm text-slate-700 leading-6">
          <li>• 1 store, 1 user, 200 products</li>
          <li>• Unlimited Khata, offline, 58mm</li>
          <li>• Community support</li>
        </ul>
        <a href="/app" data-link class="mt-6 block text-center border-2 border-slate-900 rounded-full py-3 font-bold">Start Free</a>
      </div>
      <div class="bg-slate-900 text-white rounded-[24px] p-7 border border-slate-800">
        <div class="text-xs font-extrabold tracking-widest text-emerald-300">LITE — MOST POPULAR</div>
        <div class="mt-2 text-4xl font-black">৳499<span class="text-base font-semibold text-slate-400">/mo</span></div>
        <div class="text-sm text-slate-400">or ৳4,999 / year (save 17%)</div>
        <ul class="mt-4 space-y-2 text-sm leading-6">
          <li>• Unlimited products, 3 users</li>
          <li>• Mushak 6.1/6.2/6.3/9.1, bulk SMS, 80mm, exports</li>
          <li>• Priority BN support</li>
        </ul>
        <a href="/app" data-link class="mt-6 block text-center bg-white text-slate-900 rounded-full py-3 font-black">Start 7-Day Trial</a>
      </div>
    </div>
  </section>`
}
