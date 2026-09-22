import { supabase, isSupabaseConfigured } from '../db/supabase'

// --- session cache + live sync ---
let cachedSession: import('@supabase/supabase-js').Session | null | undefined = undefined
let cacheReady = false
let pending: Promise<import('@supabase/supabase-js').Session | null> | null = null

function ensureListener(){
  supabase.auth.onAuthStateChange((_evt, session)=>{
    cachedSession = session
    cacheReady = true
  })
}
ensureListener()

async function loadSession(): Promise<import('@supabase/supabase-js').Session | null> {
  if(cacheReady && cachedSession !== undefined) return cachedSession
  if(pending) return pending
  pending = (async ()=>{
    try{
      const { data } = await supabase.auth.getSession()
      cachedSession = data.session
      cacheReady = true
      return cachedSession
    } catch {
      cachedSession = null
      cacheReady = true
      return null
    } finally {
      pending = null
    }
  })()
  return pending
}

export async function getSession() {
  return loadSession()
}

export async function isAuthenticated(): Promise<boolean> {
  const s = await loadSession()
  return !!s
}

/**
 * Guard for protected routes (/app/* , /dashboard)
 * Returns true = allow, string = redirect path
 */
export async function requireAuth(): Promise<true | string> {
  // If Supabase env missing — still enforce: try session, but show meaningful redirect
  const s = await loadSession()
  if(s) return true
  // not logged → redirect to /login with original target
  const target = location.pathname + location.search
  // avoid redirect loop when already on /login
  if(target.startsWith('/login')) return true
  return `/login?redirect=${encodeURIComponent(target)}`
}

/**
 * Guard for guest-only routes (/login)
 * If already authed → bounce to /app (or ?redirect target if valid)
 */
export async function redirectIfAuthed(): Promise<true | string> {
  const s = await loadSession()
  if(!s) return true
  // respect ?redirect if it's an /app route
  try{
    const params = new URLSearchParams(location.search)
    const r = params.get('redirect')
    if(r && r.startsWith('/app')) return r
  }catch{}
  return '/app'
}

// helpers for manual checks (optional)
export function onAuthChange(cb: (session: import('@supabase/supabase-js').Session | null)=>void){
  return supabase.auth.onAuthStateChange((_e, s)=> cb(s))
}
