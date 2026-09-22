import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anon && !url.includes('placeholder') && !anon.includes('placeholder'))

// Create client even if placeholder — so build never crashes. Calls will fail gracefully if not configured.
export const supabase: SupabaseClient = createClient(
  url || 'https://placeholder.supabase.co',
  anon || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'mekholi-auth',
    }
  }
)

export type SupabaseStatus = { configured: boolean; url?: string; error?: string }

export async function checkSupabaseConnection(): Promise<SupabaseStatus & { latencyMs?: number; authOk?: boolean }> {
  if (!isSupabaseConfigured) {
    return { configured: false, error: 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (using placeholder)' }
  }
  const t0 = performance.now()
  try {
    // Cheap health check: try to get session (no DB hit) + ping a lightweight query
    const { data: sessionData } = await supabase.auth.getSession()
    const { error } = await supabase.from('stores').select('id').limit(1)
    // If RLS blocks, error is still a successful connection (just no rows)
    const latencyMs = Math.round(performance.now() - t0)
    if (error && !error.message.includes('permission') && !error.message.includes('RLS') && error.code !== '42P01') {
      // 42P01 = undefined_table (fresh project, schema not run yet) — still counts as connected
      return { configured: true, url, latencyMs, authOk: !!sessionData.session, error: error.message }
    }
    return { configured: true, url, latencyMs, authOk: !!sessionData.session }
  } catch (e: any) {
    return { configured: true, url, error: e?.message || String(e) }
  }
}
