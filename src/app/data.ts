/**
 * The data composition root.
 *
 * This is the one file that knows a Supabase client exists. It hands that
 * client to the repository factory and returns the contracts; features depend
 * on the contracts and never learn which backend produced them. Swapping in an
 * IndexedDB implementation (docs/10 Phase 8) means changing this file and
 * nothing under `features/`.
 *
 * The organization id is passed as a getter so the repositories follow the
 * session when the user switches shops, rather than pinning whichever
 * organization happened to be active when the app booted.
 *
 * Phase 8 adds one line of indirection to that story: `installRepositories`
 * lets the offline layer (app/offline.ts) put *its* wrapper in front of the
 * same client, so every feature keeps calling `getRepositories()` and none of
 * them learns that a queue and a browser database are involved.
 */

import { getSupabase } from './platform/supabase'
import { createSupabaseRepositories } from '../shared/repositories/supabase'
import type { Repositories } from '../shared/repositories/contracts'
import { sessionStore } from './state/session'

let repositories: Repositories | null = null

/**
 * The offline-wrapped repositories, once they exist.
 *
 * Kept beside the raw ones rather than replacing them: the sync engine needs
 * the unwrapped sale repository to send queued writes (a wrapper would queue a
 * failure again), so both must be reachable.
 */
let installed: Repositories | null = null

/** Put the offline layer in front of everything. Called once, after sign-in. */
export function installRepositories(next: Repositories): void {
  installed = next
}

/** The repositories without the offline wrapper — for the sync engine only. */
export function rawRepositories(): Repositories {
  return getRepositories()
}

/**
 * The repositories for the current session.
 *
 * Throws rather than returning null when Supabase is not configured: every
 * caller is a screen that cannot render without data, and a screen that
 * handles "no database" by showing an empty state would hide a
 * misconfiguration as though the shop were simply empty.
 */
export function getRepositories(): Repositories {
  if (installed) return installed
  if (repositories) return repositories
  const client = getSupabase()
  if (!client) {
    throw new Error('Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
  }
  repositories = createSupabaseRepositories(client, () => sessionStore.state.activeOrganizationId)
  return repositories
}

/** Drop the cached instance. Called on sign-out so nothing outlives a session. */
export function resetRepositories(): void {
  repositories = null
  installed = null
}

export type { Repositories }
