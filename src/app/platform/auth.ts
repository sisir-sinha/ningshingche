/**
 * Authentication and session bootstrap (spec §41, §42).
 *
 * Two steps, deliberately separate:
 *   1. Supabase Auth establishes *who* the caller is.
 *   2. `app.session_payload()` establishes *what they may do*.
 *
 * Permissions are never inferred on the client from an email or a role label —
 * they are read from the database, where RLS enforces them anyway.
 */

import { getSupabase, isConfigured } from './supabase'
import { translateError } from './errors'
import { sessionStore, EMPTY_SESSION, type OrganizationMembership } from '../state/session'
import { eventBus } from '../../shared/bus'

export type AuthResult = { ok: true } | { ok: false; error: string; retryable: boolean }

/** The shape returned by `app.session_payload()`. */
interface SessionPayload {
  user_id: string | null
  organizations: OrganizationMembership[]
}

/**
 * GoTrue errors carry an HTTP status and a string code, not a Postgres code,
 * so they get their own translation. The rate-limit case deserves special
 * treatment because the raw message ("For security purposes…") never tells a
 * shopkeeper that the real fix is a setting on the server.
 */
function translateAuthError(error: unknown): string | null {
  const record = error as { code?: string; message?: string; status?: number; name?: string }
  const raw = typeof record?.message === 'string' ? record.message : ''

  if (record?.status === 429 || record?.code === 'over_email_send_rate_limit') {
    return (
      'Supabase is rate-limiting confirmation emails right now. ' +
      'Disable "Confirm email" under Authentication → Sign In / Providers → Email ' +
      'in the Supabase dashboard, then try again.'
    )
  }
  if (record?.code === 'email_address_invalid') {
    return 'That email address was rejected by the auth server. Use a real, deliverable address.'
  }
  if (record?.code === 'user_already_exists' || /already registered/i.test(raw)) {
    return 'An account with that email already exists. Sign in instead, or use a different email.'
  }
  if (record?.code === 'email_not_confirmed' || /email not confirmed/i.test(raw)) {
    return 'That email is not confirmed yet. Open the confirmation link we sent, or ask to resend it.'
  }
  return null
}

function fail(error: unknown): AuthResult {
  const specific = translateAuthError(error)
  const translated = translateError(error)
  console.error('[auth]', translated.code, error)
  return {
    ok: false,
    error: specific ?? translated.message,
    retryable: translated.retryable,
  }
}

/**
 * Restore a persisted session on load, or fall to `anonymous`.
 * Also subscribes to Supabase's auth events so a token refresh or a sign-out
 * in another tab updates the shell without a reload.
 */
export async function bootstrapSession(): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) {
    sessionStore.set({ ...EMPTY_SESSION, status: 'anonymous', error: 'not-configured' })
    return
  }

  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || session === null) {
        sessionStore.reset({ ...EMPTY_SESSION, status: 'anonymous' })
        return
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void loadSessionPayload()
      }
    })

    if (!data.session) {
      sessionStore.set({ ...EMPTY_SESSION, status: 'anonymous' })
      return
    }
    await loadSessionPayload()
  } catch (error) {
    sessionStore.set({ ...EMPTY_SESSION, status: 'error', error: translateError(error).message })
  }
}

/**
 * Read organizations and permissions for the signed-in user and publish them.
 * Safe to call repeatedly; the store no-ops when nothing changed.
 */
export async function loadSessionPayload(): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) {
    sessionStore.set({ ...EMPTY_SESSION, status: 'anonymous' })
    return
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) {
    sessionStore.set({ ...EMPTY_SESSION, status: 'anonymous' })
    return
  }

  const { data, error } = await supabase.rpc('session_payload')
  if (error) throw error

  const payload = normalizePayload(data)
  const activeId = chooseActiveOrganization(payload.organizations)

  sessionStore.set({
    status: 'authenticated',
    userId: user.id,
    email: user.email ?? null,
    organizations: payload.organizations,
    activeOrganizationId: activeId,
    permissions: permissionsFor(payload.organizations, activeId),
    error: null,
  })

  if (activeId) {
    eventBus.emit('session.changed', { type: 'session.changed', data: { organization_id: activeId } })
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase()
  if (!supabase) return { ok: false, error: 'Mekholi is not connected to a server yet.', retryable: false }

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) return fail(error)
    await loadSessionPayload()
    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}

/**
 * Sign in with Google.
 *
 * The browser navigates away to finish the OAuth round trip, so there is no
 * result to return: `bootstrapSession` picks the session up when Google
 * redirects back. The app's URL must be listed under Supabase →
 * Authentication → URL Configuration → Redirect URLs, or GoTrue sends the
 * user back to the project's site URL instead.
 */
export async function signInWithGoogle(): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  })
  if (error) {
    console.error('[auth] google sign-in failed', error)
  }
}

export interface ProvisionInput {
  shopName: string
  shopType: string
}

/**
 * Provision a shop for the *signed-in* user.
 *
 * This is the recovery path for an account that exists but has no
 * organization — a signup whose provisioning step failed, a user invited
 * before their shop existed, or an OAuth sign-in for a brand-new account.
 * The database only allows provisioning for oneself (`p_owner_user_id` must
 * equal `auth.uid()`), so there is no way to call this for another user.
 */
export async function provisionShop(input: ProvisionInput): Promise<AuthResult> {
  const supabase = getSupabase()
  if (!supabase) return { ok: false, error: 'Mekholi is not connected to a server yet.', retryable: false }

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'You are not signed in.', retryable: false }

    const { error } = await supabase.rpc('provision_organization', {
      p_owner_user_id: user.id,
      p_org_name: input.shopName.trim(),
      p_slug: slugify(input.shopName),
      p_shop_type: input.shopType,
    })
    if (error) return fail(error)

    // Re-read the session payload so organizations and permissions appear
    // without a page reload; the onboarding guard re-evaluates on navigation.
    await loadSessionPayload()
    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}

export interface SignUpInput {
  name: string
  email: string
  password: string
  shopName: string
  shopType: string
}

/**
 * Create the auth user, then provision the organization.
 *
 * Provisioning is a single Postgres function so the shop arrives complete:
 * branch, stock location, register, six roles, owner membership, units and
 * payment methods. Doing it client-side would mean nine round trips and a
 * half-created shop if the connection dropped midway.
 */
export async function signUp(input: SignUpInput): Promise<AuthResult> {
  const supabase = getSupabase()
  if (!supabase) return { ok: false, error: 'Mekholi is not connected to a server yet.', retryable: false }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { data: { full_name: input.name.trim() } },
    })
    if (error) return fail(error)

    const user = data.user
    if (!user) {
      return {
        ok: false,
        error: 'Check your inbox to confirm your email, then sign in.',
        retryable: false,
      }
    }
    if (!data.session) {
      // Email confirmation is on: the account exists but is not signed in.
      return {
        ok: false,
        error: 'Account created. Confirm your email, then sign in.',
        retryable: false,
      }
    }

    // One provisioning path, shared with the onboarding screen.
    return provisionShop({ shopName: input.shopName, shopType: input.shopType })
  } catch (error) {
    return fail(error)
  }
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase()
  sessionStore.reset({ ...EMPTY_SESSION, status: 'anonymous' })
  eventBus.clear()
  if (supabase) {
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.warn('[auth] sign-out request failed; local session cleared anyway', error)
    }
  }
}

/**
 * Switch the active organization. Permissions are swapped in place; the caller
 * is responsible for re-rendering, which it does by subscribing to the store.
 */
export function selectOrganization(organizationId: string): void {
  const org = sessionStore.state.organizations.find((o) => o.organization_id === organizationId)
  if (!org) return
  sessionStore.set({
    activeOrganizationId: organizationId,
    permissions: org.permissions,
  })
  eventBus.emit('session.changed', {
    type: 'session.changed',
    data: { organization_id: organizationId },
  })
}

/**
 * A user with no organization has signed up but not provisioned — the router
 * sends them to onboarding rather than to a dashboard with nothing in it.
 */
export function needsOnboarding(): boolean {
  const s = sessionStore.state
  return s.status === 'authenticated' && s.organizations.length === 0
}

// ── Helpers ───────────────────────────────────────────────────────────────

function normalizePayload(data: unknown): SessionPayload {
  if (typeof data !== 'object' || data === null) {
    return { user_id: null, organizations: [] }
  }
  const record = data as Partial<SessionPayload>
  const organizations = Array.isArray(record.organizations) ? record.organizations : []
  return {
    user_id: record.user_id ?? null,
    organizations: organizations.map(normalizeMembership),
  }
}

function normalizeMembership(raw: Partial<OrganizationMembership>): OrganizationMembership {
  return {
    organization_id: raw.organization_id ?? '',
    name: raw.name ?? 'Unnamed shop',
    slug: raw.slug ?? '',
    currency: raw.currency ?? 'BDT',
    timezone: raw.timezone ?? 'Asia/Dhaka',
    role_names: Array.isArray(raw.role_names) ? raw.role_names : [],
    role_keys: Array.isArray(raw.role_keys) ? raw.role_keys : [],
    is_owner: raw.is_owner === true,
    permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
  }
}

function chooseActiveOrganization(organizations: OrganizationMembership[]): string | null {
  if (organizations.length === 0) return null
  const stored = storedActiveOrganization()
  if (stored && organizations.some((o) => o.organization_id === stored)) return stored
  // Owners first: the person who created the shop is usually the one signing in.
  const owner = organizations.find((o) => o.is_owner)
  return (owner ?? organizations[0])?.organization_id ?? null
}

function permissionsFor(
  organizations: OrganizationMembership[],
  activeId: string | null
): string[] {
  const org = organizations.find((o) => o.organization_id === activeId)
  return org ? [...org.permissions] : []
}

const ACTIVE_KEY = 'mekholi.activeOrganization'

function storedActiveOrganization(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

export function rememberActiveOrganization(organizationId: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, organizationId)
  } catch {
    /* storage unavailable — the choice simply will not persist */
  }
}

/** `Rahim's Corner Store` → `rahims-corner-store`. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  // A unique constraint collision is surfaced as a friendly message, so a
  // timestamp suffix is only a convenience for the common case.
  return slug === '' ? `shop-${Date.now().toString(36)}` : slug
}

export { isConfigured }
