/**
 * The single Supabase client (spec §44).
 *
 * Only the anon key is here, which is public by design — it is safe solely
 * because RLS enforces every access. The service-role key must never appear
 * in this repository; it belongs in Supabase Edge Function secrets.
 *
 * `getSupabase()` returns null when env vars are absent so the UI can render
 * an explicit "not configured" state instead of throwing on first request.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '../env'

let client: SupabaseClient | null = null

export function isConfigured(): boolean {
  return env.isSupabaseConfigured
}

export function getSupabase(): SupabaseClient | null {
  if (!env.isSupabaseConfigured) return null
  if (client) return client

  client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'mekholi.auth',
      // PKCE, so an OAuth return carries a single-use `?code=` instead of a
      // session in the fragment. The default (implicit) puts a live
      // access *and refresh* token in the address bar, where it lands in
      // history and in whatever the user pastes next — which is exactly what
      // happened (docs/14). It is also friendlier to this app's router, which
      // routes on the fragment: `?code=` never competes with `#/pos`.
      flowType: 'pkce',
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  })
  return client
}

/** Escape hatch for tests and for sign-out teardown. */
export function resetSupabase(): void {
  client = null
}
