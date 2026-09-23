/**
 * Maps Postgres error codes and prefixes to messages a shopkeeper can act on.
 *
 * The RPC layer raises structured errors — a code like `P0003` and a prefixed
 * message like `insufficient_stock: variant …`. Translating them here, once,
 * keeps that vocabulary out of every view.
 */

/** Raise codes used by the RPCs in supabase/migrations/. */
export const DB = {
  RAISE: 'P0002',
  /** `insufficient_stock`, `session_not_open`, `over_refund`, … */
  BUSINESS: 'P0003',
  INVALID_ARGUMENT: '22023',
  /** Unique violation — also used for `register already open`. */
  UNIQUE: '23505',
  /** `app.require_permission` / cross-user provisioning. */
  PERMISSION: '42501',
  NOT_FOUND: 'P0001',
  FOREIGN_KEY: '23503',
} as const

const BUSINESS_MESSAGES: Record<string, string> = {
  branch_not_found: 'That branch no longer exists.',
  no_warehouse_for_branch: 'This branch has no stock location. Set one up under Inventory first.',
  insufficient_stock: 'Not enough stock for that quantity.',
  over_receipt: 'You received more than the purchase order allows.',
  over_refund: 'That refund exceeds what was sold.',
  sale_not_refundable: 'This sale can no longer be refunded.',
  session_not_open: 'The register session is closed. Open one to continue.',
}

export interface TranslatedError {
  message: string
  /** The original code or prefix, for logging and for conditional UI. */
  code: string
  /** True when retrying the identical action could succeed. */
  retryable: boolean
}

/**
 * Accepts anything throwable: a PostgrestError, an Error, or a string.
 * Never throws.
 */
export function translateError(error: unknown): TranslatedError {
  if (error === null || error === undefined) {
    return { message: 'Something went wrong.', code: 'unknown', retryable: false }
  }

  const record = error as { code?: string; message?: string; details?: string }
  const code = typeof record.code === 'string' ? record.code : ''
  const raw = typeof record.message === 'string' ? record.message : String(error)

  switch (code) {
    case DB.PERMISSION:
      return {
        message: 'You do not have permission to do that.',
        code,
        retryable: false,
      }
    case DB.UNIQUE:
      return {
        message: friendlyUniqueViolation(raw),
        code,
        retryable: false,
      }
    case DB.INVALID_ARGUMENT:
      return { message: stripPrefix(raw) || 'That input was not accepted.', code, retryable: false }
    case DB.NOT_FOUND:
    case DB.RAISE:
      return { message: stripPrefix(raw) || 'That record no longer exists.', code, retryable: false }
    case DB.FOREIGN_KEY:
      return {
        message: 'That record is still referenced elsewhere and cannot be removed.',
        code,
        retryable: false,
      }
    case DB.BUSINESS: {
      const prefix = rawPrefix(raw)
      const known = prefix ? BUSINESS_MESSAGES[prefix] : undefined
      return {
        message: known ?? stripPrefix(raw) ?? 'That action was rejected.',
        code: prefix ?? code,
        retryable: false,
      }
    }
    default:
      break
  }

  // Supabase auth and network failures arrive without a Postgres code.
  const lower = raw.toLowerCase()
  if (lower.includes('invalid login credentials')) {
    return { message: 'Incorrect email or password.', code: 'auth.invalid', retryable: true }
  }
  if (lower.includes('email not confirmed')) {
    return { message: 'Confirm your email address, then sign in again.', code: 'auth.unconfirmed', retryable: false }
  }
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return { message: 'That email is already registered. Try signing in.', code: 'auth.exists', retryable: false }
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return { message: 'Cannot reach the server. Check your connection.', code: 'network', retryable: true }
  }
  if (lower.includes('row-level security') || lower.includes('new row violates')) {
    return { message: 'You do not have permission to do that.', code: 'rls', retryable: false }
  }

  return { message: stripPrefix(raw) || 'Something went wrong.', code: code || 'unknown', retryable: false }
}

/** `insufficient_stock: variant 123` → `insufficient_stock`. */
function rawPrefix(message: string): string | null {
  const m = /^([a-z][a-z0-9_]*):/.exec(message)
  return m ? (m[1] as string) : null
}

/** `insufficient_stock: variant 123` → `variant 123`. */
function stripPrefix(message: string): string {
  const at = message.indexOf(':')
  if (at < 0) return message
  return message.slice(at + 1).trim()
}

function friendlyUniqueViolation(message: string): string {
  if (message.includes('one_open_session_per_register')) {
    return 'A session is already open on this register. Close it first.'
  }
  if (message.includes('one_default_variant_per_product')) {
    return 'That product already has a default variant.'
  }
  if (message.includes('organizations_slug_key') || message.includes('slug')) {
    return 'That shop name is already taken.'
  }
  if (message.includes('duplicate key')) {
    return 'That record already exists.'
  }
  return stripPrefix(message) || 'That record already exists.'
}
