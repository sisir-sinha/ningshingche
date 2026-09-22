import { supabase, isSupabaseConfigured } from '../db/supabase'

export type Notif = { id:string; title:string; body:string; time:string; read:boolean; icon:string; color:string }

let notifs: Notif[] = [
  { id:'1', title:'Low stock', body:'Parachute Oil — 2 left', time:'2m ago', read:false, icon:'warning', color:'amber' },
  { id:'2', title:'New order', body:'MEK-2026-8123 • ৳335 paid', time:'12m ago', read:false, icon:'receipt_long', color:'emerald' },
  { id:'3', title:'Trial expires soon', body:'3 days left in free trial', time:'1h ago', read:true, icon:'timer', color:'sky' },
]

export function getNotifs(){ return notifs }
export function unreadCount(){ return notifs.filter(n=>!n.read).length }

export function markAllRead(){ notifs = notifs.map(n=> ({...n, read:true})) }

export function pushNotif(n: Notif){ notifs.unshift(n); if(notifs.length>20) notifs.pop(); updateBadge() }

function updateBadge(){
  const b = document.getElementById('notif-badge')
  if(!b) return
  const c = unreadCount()
  if(c>0){ b.textContent = String(c); b.classList.remove('hidden') } else b.classList.add('hidden')
  const dot = document.getElementById('notif-dot')
  if(dot) dot.classList.toggle('hidden', c===0)
}

export function renderNotifDropdown(targetId='notif-dropdown'){
  const el = document.getElementById(targetId)
  if(!el) return
  el.innerHTML = `
    <div class="w-[340px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div class="font-bold text-sm">Notifications</div>
        <button id="notif-mark" class="text-xs font-bold text-sky-600 hover:underline">Mark all read</button>
      </div>
      <div class="max-h-[360px] overflow-auto divide-y divide-slate-100 dark:divide-slate-800">
        ${notifs.map(n=>`
          <div class="px-4 py-3 flex gap-3 ${!n.read?'bg-slate-50 dark:bg-slate-800/50':''}">
            <span class="w-8 h-8 rounded-full bg-${n.color}-50 border border-${n.color}-200 text-${n.color}-600 grid place-items-center shrink-0"><span class="material-symbols-rounded text-[16px]">${n.icon}</span></span>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-bold leading-none">${n.title}</div>
              <div class="text-xs text-slate-500 mt-1">${n.body}</div>
              <div class="text-[11px] text-slate-400 mt-1">${n.time}</div>
            </div>
            ${!n.read?'<span class="w-2 h-2 bg-sky-500 rounded-full shrink-0 mt-1"></span>':''}
          </div>
        `).join('')}
      </div>
      <div class="px-4 py-2 bg-slate-50 dark:bg-slate-800 text-center">
        <a href="/app/reports" data-link class="text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900">View all →</a>
      </div>
    </div>
  `
  el.querySelector('#notif-mark')?.addEventListener('click', ()=>{ markAllRead(); renderNotifDropdown(targetId); updateBadge() })
}

export function initNotifications(){
  updateBadge()
  // Realtime: new orders -> push notif (if Supabase + logged in)
  if(!isSupabaseConfigured) return
  try{
    supabase.channel('orders-notif')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'orders' }, (payload:any)=>{
        const o = payload.new
        pushNotif({ id: o.id, title:'New order', body:`${o.receipt_number} • ৳${Number(o.total_amount).toFixed(2)}`, time:'now', read:false, icon:'receipt_long', color:'emerald' })
        renderNotifDropdown()
      })
      .subscribe()
  }catch{}
}
