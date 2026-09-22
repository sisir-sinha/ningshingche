export default function login(): string {
  return `
  <section class="min-h-[70vh] grid place-items-center px-4 py-10 bg-slate-50">
    <div class="w-full max-w-[420px] bg-white border border-slate-200 rounded-[24px] p-6 sm:p-7 shadow-sm">
      <a href="/" data-link class="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"><span class="material-symbols-rounded text-[18px]">arrow_back</span> Back</a>
      <div class="mt-4 flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-slate-900 text-white grid place-items-center font-black text-xs">MK</div>
        <div class="font-extrabold">Mekholi</div>
        <span class="ml-auto text-[11px] font-bold tracking-widest bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full">LITE</span>
      </div>
      <h1 class="mt-5 text-2xl font-black tracking-tight">Welcome back</h1>
      <p class="text-sm text-slate-600">Log in with phone OTP (recommended) or email.</p>

      <div class="mt-6">
        <label class="text-xs font-bold tracking-widest text-slate-500">PHONE • ফোন</label>
        <div class="mt-1.5 flex gap-2">
          <div class="flex items-center border border-slate-200 rounded-full px-3 bg-white">
            <span class="text-sm font-bold">+88</span><span class="mx-2 w-px h-5 bg-slate-200"></span>
            <input id="login-phone" placeholder="017XX XXXXXX" class="py-2.5 outline-none text-sm w-[160px]" inputmode="numeric" />
          </div>
          <button id="otp-send" class="flex-1 bg-slate-900 text-white rounded-full font-bold text-sm hover:bg-black">Send OTP</button>
        </div>
        <div class="mt-3 flex gap-2">
          <input id="otp-code" placeholder="6-digit OTP" class="flex-1 border border-slate-200 rounded-full px-4 py-2.5 text-sm outline-none" maxlength="6" />
          <button id="otp-verify" class="px-5 bg-emerald-600 text-white rounded-full font-bold text-sm hover:bg-emerald-700">Verify</button>
        </div>
        <div id="login-msg" class="mt-3 text-xs font-semibold hidden"></div>
        <div class="mt-4 text-center text-xs text-slate-500">— or —</div>
        <button class="mt-3 w-full border border-slate-200 rounded-full py-2.5 font-semibold text-sm flex items-center justify-center gap-2"><img src="https://www.svgrepo.com/show/475656/google-color.svg" class="w-4 h-4"/> Continue with Google</button>
        <div class="mt-4 text-xs text-slate-500 text-center">By continuing you agree to Terms & Privacy.</div>
      </div>
    </div>
  </section>`
}
