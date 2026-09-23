/**
 * Architecture boundary checker.
 *
 * ESLint's `no-restricted-imports` matches the *specifier string*, so it can
 * say "plugins may not import `**\/features`" but it cannot tell
 * `../batch-expiry` (a sibling plugin — forbidden) from `../field-helpers`
 * (inside the same plugin — fine). This tool resolves every import to a real
 * path and applies the layer rules to the destination, which is the only way
 * to check the rule that matters:
 *
 *     Adding a plugin must never require editing src/features/.
 *
 * That is only true if a plugin cannot reach into src/features/ in the first
 * place. Run by `npm run check` and by CI.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, dirname, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')

// ── Collection ────────────────────────────────────────────────────────────

/** Every .ts file under src/, as paths relative to src/. */
function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectFiles(full, out)
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Extract import specifiers. Covers static imports (including side-effect
 * `import 'x'`), re-exports, and dynamic `import()`.
 *
 * Deliberately a regex rather than a real parser: the forms TypeScript allows
 * here are few, and a parser dependency for a lint-time check is not worth it.
 */
const SPECIFIER_PATTERNS = [
  /(?:^|[\s;])(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

function specifiersOf(source) {
  const found = new Set()
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(source)) !== null) {
      const spec = match[1]
      if (spec) found.add(spec)
    }
  }
  return [...found]
}

/** Resolve a relative specifier to a path under src/, or null if external. */
function resolveSpecifier(specifier, fromFile) {
  if (!specifier.startsWith('.')) return null

  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(SRC, candidate).split(sep).join('/')
    }
  }
  // Unresolved relative import: report it, because it is still a boundary
  // intent even if the target does not exist yet.
  return relative(SRC, base).split(sep).join('/')
}

// ── Rules ─────────────────────────────────────────────────────────────────

/** First path segment → layer. */
function layerOf(path) {
  const [first] = path.split('/')
  return first ?? ''
}

/** The plugin id, for `plugins/<id>/...`. */
function pluginIdOf(path) {
  const parts = path.split('/')
  return parts[0] === 'plugins' ? (parts[1] ?? '') : null
}

/** The feature name, for `features/<name>/...`. */
function featureOf(path) {
  const parts = path.split('/')
  return parts[0] === 'features' ? (parts[1] ?? '') : null
}

const BAN_SUPABASE = '@supabase/supabase-js'

/**
 * @param source  path relative to src/
 * @param target  path relative to src/, or a bare module name
 * @returns violation message, or null
 */
function violation(source, target) {
  const sourceLayer = layerOf(source)
  const targetLayer = layerOf(target)

  // ── Plugins ────────────────────────────────────────────────────────────
  if (sourceLayer === 'plugins') {
    const sourcePlugin = pluginIdOf(source)
    const targetPlugin = pluginIdOf(target)

    if (targetLayer === 'features') {
      return (
        'a plugin may not import a feature — register a description through ' +
        'the PluginAPI instead (spec §51)'
      )
    }
    if (targetLayer === 'app') {
      return 'a plugin may not import the app layer — use the PluginAPI'
    }
    if (targetPlugin !== null && targetPlugin !== sourcePlugin) {
      return (
        `plugin "${sourcePlugin}" imports plugin "${targetPlugin}" — compose ` +
        'through `dependencies` and events, never a direct import'
      )
    }
    if (target === BAN_SUPABASE) {
      return 'a plugin may not hold a Supabase client'
    }
  }

  // ── Features ───────────────────────────────────────────────────────────
  if (sourceLayer === 'features') {
    const sourceFeature = featureOf(source)
    const targetFeature = featureOf(target)

    if (targetFeature !== null && targetFeature !== sourceFeature) {
      // docs/03 §3: a feature may consume another feature's public surface
      // only. Reaching into a sibling's internals is how spaghetti starts.
      const isPublicSurface = target === `features/${targetFeature}/index.ts`
      if (!isPublicSurface) {
        return (
          `feature "${sourceFeature}" imports "${targetFeature}" internals — ` +
          `only \`features/${targetFeature}/index.ts\` is public. Cross-feature ` +
          'needs go through shared services or events.'
        )
      }
    }
  }

  // ── UI kit ─────────────────────────────────────────────────────────────
  if (sourceLayer === 'components') {
    if (targetLayer === 'features') {
      return 'the UI kit may not import features — it must stay business-ignorant'
    }
    if (targetLayer === 'plugins') {
      return 'the UI kit may not import plugins'
    }
    if (targetLayer === 'app') {
      return 'the UI kit may not import the app layer — no stores, router or Supabase'
    }
    if (target === BAN_SUPABASE) {
      return 'the UI kit may not touch Supabase directly'
    }
  }

  // ── Domain logic ───────────────────────────────────────────────────────
  if (source.startsWith('shared/domain/')) {
    if (['app', 'components', 'features', 'plugins'].includes(targetLayer)) {
      return 'domain logic may not import UI or platform layers — it must stay pure'
    }
    if (
      target.startsWith('shared/repositories/') ||
      target.startsWith('shared/services/') ||
      target.startsWith('shared/stores/')
    ) {
      return 'domain logic may not import I/O layers — it must stay pure'
    }
    if (target === BAN_SUPABASE) {
      return 'domain logic may not touch Supabase'
    }
  }

  // ── Shared, generally ──────────────────────────────────────────────────
  if (sourceLayer === 'shared') {
    if (targetLayer === 'features') {
      return 'shared code may not import features — the dependency runs the other way'
    }
    if (targetLayer === 'plugins') {
      return 'shared code may not import plugins'
    }
  }

  return null
}

// ── Run ───────────────────────────────────────────────────────────────────

const files = collectFiles(SRC)
const failures = []
let checked = 0

for (const file of files) {
  const rel = relative(SRC, file).split(sep).join('/')
  const source = readFileSync(file, 'utf8')

  for (const specifier of specifiersOf(source)) {
    const isBare = !specifier.startsWith('.')
    const target = isBare ? specifier : resolveSpecifier(specifier, file)
    if (target === null) continue
    checked += 1

    const problem = violation(rel, target)
    if (problem) {
      failures.push({ file: rel, specifier, target, problem })
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────

console.log(`boundary check: ${files.length} files, ${checked} resolved imports`)

if (failures.length === 0) {
  console.log('no boundary violations\n')
  process.exit(0)
}

console.log(`\n${failures.length} violation(s):\n`)
for (const failure of failures) {
  console.log(`  ${failure.file}`)
  console.log(`    imports "${failure.specifier}"`)
  console.log(`    → ${failure.problem}\n`)
}
process.exit(1)
