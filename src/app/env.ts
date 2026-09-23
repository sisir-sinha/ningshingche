/**
 * Typed access to build-time environment variables.
 *
 * Only `VITE_`-prefixed values reach the browser, which makes them public by
 * definition. The Supabase service-role key must never appear here — it
 * belongs exclusively in `supabase/functions/*` (spec §44, docs/02 §8).
 */

export type AppEnvironment = 'development' | 'staging' | 'production'

export interface AppEnv {
  readonly supabaseUrl: string
  readonly supabaseAnonKey: string
  readonly environment: AppEnvironment
  /**
   * Build-time gate for the demo data source. Read once here and never
   * consulted again, so Vite can tree-shake DemoDataSource out of production
   * bundles entirely (docs/09 #13).
   */
  readonly enableDemo: boolean
  readonly appName: string
  /** True when Supabase is configured; false puts the app in setup mode. */
  readonly isSupabaseConfigured: boolean
}

function read(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key]
  return typeof value === 'string' ? value.trim() : ''
}

const environment = ((): AppEnvironment => {
  const raw = read('VITE_APP_ENV')
  return raw === 'production' || raw === 'staging' ? raw : 'development'
})()

export const env: AppEnv = {
  supabaseUrl: read('VITE_SUPABASE_URL'),
  supabaseAnonKey: read('VITE_SUPABASE_ANON_KEY'),
  environment,
  enableDemo: read('VITE_ENABLE_DEMO') === 'true',
  appName: read('VITE_APP_NAME') || 'Mekholi',
  isSupabaseConfigured:
    read('VITE_SUPABASE_URL').length > 0 && read('VITE_SUPABASE_ANON_KEY').length > 0,
}
