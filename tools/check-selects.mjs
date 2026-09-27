/**
 * Does every column the client asks PostgREST for actually exist?
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Twice in a row the same bug shipped: a `.select()` naming a column the table
 * has never had. `sale_items.created_at` broke every sale in Stock → History,
 * and `sale_payments.created_at` broke the receipt fetch *after* the money had
 * been taken — the worst possible moment, because the cashier reads "failed"
 * on a sale the database has already banked.
 *
 * Neither could be caught by TypeScript: a PostgREST select is a *string*, and
 * `'id,amount,created_at'` is a perfectly good string. Neither could be caught
 * by a test with a mocked repository, because the mock answers whatever the
 * test wants. The only thing that knows is the schema — which the migration
 * validator already has, in PGlite.
 *
 * So this module extracts every `.from('table').select('…')` in the repository
 * and checks each column name against the real catalogue. It understands
 * PostgREST's embedding syntax, because that is where both bugs were:
 *
 *     'id,total,items:sale_items(id,quantity),customer:customers(name)'
 *      ───────  ─────────────────────────────  ──────────────────────
 *      sales    sale_items                     customers
 *
 * ── Deliberately conservative ─────────────────────────────────────────────
 * It reports a column only when it is sure: the table must be known, and the
 * item must be a plain column reference. Anything it cannot parse — a JSON
 * path, a cast, an aggregate, a computed relationship — is skipped rather than
 * guessed at. A checker that cries wolf gets switched off, and then the next
 * `created_at` ships too.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Every .ts file under a directory, recursively, tests excluded. */
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/**
 * Remove comments, quote-aware.
 *
 * Needed before anything else: these selects carry long explanatory comments
 * between their chunks, and a comment can hold a backtick, an apostrophe or a
 * `//` that would derail the literal reader. Quotes are tracked so that a URL
 * inside a string survives.
 */
function stripComments(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const character = source[i]

    if (character === "'" || character === '"' || character === '`') {
      const quote = character
      out += character
      i += 1
      while (i < source.length) {
        out += source[i]
        if (source[i] === '\\') {
          i += 2
          if (i - 1 < source.length) out += source[i - 1]
          continue
        }
        if (source[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }

    if (character === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (character === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      out += ' '
      continue
    }

    out += character
    i += 1
  }
  return out
}

/**
 * The string literal a `.select(...)` call is built from.
 *
 * The repository writes long selects as several quoted chunks joined by `+`,
 * so the chunks are concatenated. A select containing a template literal or a
 * variable is returned as null and skipped — this checker only judges what it
 * can read in full.
 */
function literalArgument(source, openParenIndex) {
  let depth = 0
  let out = ''
  let sawQuote = false

  for (let i = openParenIndex; i < source.length; i += 1) {
    const character = source[i]

    if (character === '(') {
      depth += 1
      continue
    }
    if (character === ')') {
      depth -= 1
      if (depth === 0) return sawQuote ? out : null
      continue
    }

    if (character === "'" || character === '"') {
      sawQuote = true
      const quote = character
      i += 1
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1
        out += source[i]
        i += 1
      }
      continue
    }

    // A backtick or an identifier between chunks means the select is built at
    // runtime; there is nothing reliable to check.
    if (character === '`') return null
    if (/[A-Za-z_$]/.test(character)) {
      // Allow the `+` joins and whitespace only.
      const rest = source.slice(i)
      if (!/^\s*\+/.test(rest)) return null
    }
  }
  return null
}

/** Split on commas that are not inside an embed's parentheses. */
function splitTopLevel(select) {
  const parts = []
  let depth = 0
  let current = ''
  for (const character of select) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current.trim() !== '') parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

/**
 * Walk one select against one table, collecting problems.
 *
 * `columnsOf(table)` returns a Set, or undefined when the table is unknown to
 * the schema — a plugin table created at runtime, for instance — in which case
 * the whole branch is skipped.
 */
function walk(select, table, columnsOf, problems, path = table) {
  const known = columnsOf(table)
  if (!known) return

  for (const item of splitTopLevel(select)) {
    // `alias:target(...)` or `target(...)` — an embedded resource.
    const embed = /^(?:([\w]+):)?([\w]+)(?:!\w+)?\s*\(([\s\S]*)\)$/.exec(item)
    if (embed) {
      const [, alias, target, inner] = embed
      // `alias:real_table(...)` embeds `real_table`; `items:sale_items(...)`
      // is the common form. Without an alias the name is the table itself.
      walk(inner, target, columnsOf, problems, `${path} → ${alias ?? target}`)
      continue
    }

    // `alias:column`, `column`, `column.json->>path`, `column::cast`, `count()`
    const plain = /^(?:[\w]+:)?([\w]+)$/.exec(item)
    if (!plain) continue

    const column = plain[1]
    // PostgREST's own pseudo-columns.
    if (column === 'count' || column === '*') continue

    if (!known.has(column)) {
      problems.push({ table, column, path })
    }
  }
}

/**
 * Check every readable select in `roots`.
 *
 * @param roots       directories to scan
 * @param columnsOf   (table) => Set<string> | undefined
 * @returns array of { file, table, column, path }
 */
export function checkSelects(roots, columnsOf) {
  const problems = []

  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const source = stripComments(readFileSync(file, 'utf8'))

      // `.from('x')` … `.select(` — the builder is chained, and the two calls
      // are usually on adjacent lines but not always, so the window is the
      // text between this `.from(` and the next one.
      const fromPattern = /\.from\(\s*'([\w]+)'\s*\)/g
      let match
      while ((match = fromPattern.exec(source)) !== null) {
        const table = match[1]
        const nextFrom = source.indexOf('.from(', match.index + 1)
        const window = source.slice(match.index, nextFrom === -1 ? source.length : nextFrom)

        const selectAt = window.indexOf('.select(')
        if (selectAt === -1) continue

        const select = literalArgument(window, selectAt + '.select'.length)
        if (select === null) continue

        const found = []
        walk(select, table, columnsOf, found)
        for (const problem of found) problems.push({ file, ...problem })
      }
    }
  }

  return problems
}
