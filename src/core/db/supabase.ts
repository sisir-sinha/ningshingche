import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// fallback to dummy so site builds without env (site still renders)
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anon || 'placeholder-anon-key'
)

export const isSupabaseConfigured = Boolean(url && anon)
