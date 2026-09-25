#!/usr/bin/env node
/**
 * Both clients, checked against the generated contract — offline.
 *
 * `contracts/api-contract.json` describes what the server will accept. This
 * script asks whether the two clients actually speak that language: every RPC
 * name they call exists, every parameter name they send exists, and every wire
 * field the Kotlin data classes are annotated with exists on the function or
 * view it is annotated for.
 *
 * It runs in `npm run check`, with no network and no database, so a typo in a
 * parameter name fails in the same second it is typed rather than in front of a
 * customer. What it cannot check is the *values*: that is what
 * `npm run validate:migrations` and `npm run e2e` are for.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACT = join(ROOT, 'contracts', 'api-contract.json')

/**
 * Which Kotlin classes describe which part of the contract.
 *
 * A class is listed here only when the server has a *shape* to check it
 * against. Classes that carry a `jsonb` body — the session payload, the sale
 * receipt — are deliberately absent: their fields are agreed by the function
 * that builds the JSON, and the place to assert them is a live call
 * (`npm run e2e`, `npm run e2e:android`), not a static list.
 */
const KOTLIN_SHAPES = [
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'CompleteSaleRequest', rpc: 'complete_sale' },
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'OpenRegisterRequest', rpc: 'open_register' },
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'CatalogRow', relation: 'pos_catalog' },
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'BranchRow', relation: 'branches' },
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'BranchListRow', relation: 'branches' },
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'WarehouseRow', relation: 'warehouses' },
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'RegisterRow', relation: 'registers' },
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'RegisterSessionRow', relation: 'register_sessions' },
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'PaymentMethodRow', relation: 'payment_methods' },
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'SaleItemPayload', rpcPayload: 'complete_sale' },
  { file: 'core/src/main/kotlin/dev/mekholi/core/Wire.kt', className: 'SalePaymentPayload', rpcPayload: 'complete_sale' },
]

const problems = []
const note = (message) => problems.push(message)

if (!existsSync(CONTRACT)) {
  console.error('contracts/api-contract.json is missing — run `npm run contract:pull`')
  process.exit(1)
}
const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'))
const rpcNames = new Set(Object.keys(contract.rpc))
const allParamNames = new Set(
  Object.values(contract.rpc).flatMap((entry) => entry.params.map((param) => param.name))
)

// ── The TypeScript client ─────────────────────────────────────────────────

function walk(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(path))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

const tsFiles = walk(join(ROOT, 'src'))
let rpcCalls = 0
let pluginRpcCalls = 0
const calledNames = new Set()
const parameterUses = new Set()

for (const file of tsFiles) {
  const source = readFileSync(file, 'utf8')
  const where = relative(ROOT, file)
  // A plugin's `db.rpc('name', args)` is *not* a contract call: the plugin host
  // dispatches it by name (`public.plugin_rpc` → the plugin's own SQL), and the
  // plugin's functions are checked where they are defined, by
  // `npm run validate:migrations` against a real Postgres.
  const isPlugin = where.startsWith('src/plugins/')

  // `.rpc('name')` and `.rpc('name', args)` — the only way the web client
  // reaches a function.
  for (const match of source.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)) {
    if (isPlugin) {
      pluginRpcCalls += 1
      continue
    }
    rpcCalls += 1
    calledNames.add(match[1])
    if (!rpcNames.has(match[1])) {
      note(`${where}: calls rpc '${match[1]}', which the contract does not describe`)
    }
  }

  // Parameter names, wherever they are written: `args.p_branch_id = …`,
  // `p_items:` in a payload literal, `rpc('x', { p_y })`.
  for (const match of source.matchAll(/\b(p_[a-z0-9_]+)\b/g)) {
    parameterUses.add(match[1])
  }
}

if (pluginRpcCalls > 0 && !rpcNames.has('plugin_rpc')) {
  note("plugins call the host dispatcher, but the contract has no 'plugin_rpc' function")
}

for (const parameter of [...parameterUses].sort()) {
  if (!allParamNames.has(parameter)) {
    note(`src/: sends '${parameter}', which no RPC in the contract accepts`)
  }
}

// ── The Kotlin client ─────────────────────────────────────────────────────

/** The body of `data class <name>( … )`, comments and annotations included. */
function classBody(source, className) {
  const start = source.indexOf(`data class ${className}(`)
  if (start < 0) return null
  let depth = 0
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    const character = source[index]
    if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

let kotlinFields = 0
const kotlinChecked = []

for (const shape of KOTLIN_SHAPES) {
  const path = join(ROOT, 'android', shape.file)
  if (!existsSync(path)) {
    note(`android/${shape.file} is missing (the Kotlin client is checked against the contract)`)
    continue
  }
  const source = readFileSync(path, 'utf8')
  const body = classBody(source, shape.className)
  if (!body) {
    note(`android/${shape.file}: data class ${shape.className} not found`)
    continue
  }

  // The wire name is the serial name when there is one, and the Kotlin property
  // name otherwise.
  const fields = []
  for (const match of body.matchAll(/@SerialName\("([^"]+)"\)\s*val\s+([A-Za-z0-9_]+)/g)) {
    fields.push({ wire: match[1], property: match[2] })
  }
  for (const match of body.matchAll(/(?:^|\n)\s*(?:val|var)\s+([A-Za-z0-9_]+)\s*:/g)) {
    const property = match[1]
    if (!fields.some((field) => field.property === property)) {
      fields.push({ wire: property, property })
    }
  }

  const allowed = new Set()
  if (shape.rpc) {
    for (const param of contract.rpc[shape.rpc]?.params ?? []) allowed.add(param.name)
  }
  if (shape.relation) {
    for (const column of Object.keys(contract.relations[shape.relation]?.columns ?? {})) {
      allowed.add(column)
    }
  }
  if (shape.rpcPayload) {
    // The items/payments arrays inside `p_items`/`p_payments`: their keys are
    // the jsonb contract the function parses, which the server documents in its
    // own error messages rather than in the schema.
    for (const key of ['variant_id', 'qty', 'discount_type', 'discount_value', 'method_id', 'amount', 'reference']) {
      allowed.add(key)
    }
  }

  if (allowed.size === 0) {
    note(`contracts/api-contract.json has no shape for ${shape.className} (${shape.rpc ?? shape.relation})`)
  }

  for (const field of fields) {
    kotlinFields += 1
    if (!allowed.has(field.wire)) {
      note(
        `${shape.className}.${field.property}: wire field '${field.wire}' is not part of ` +
          `${shape.rpc ?? shape.relation}`
      )
    }
  }

  kotlinChecked.push(shape.className)
}

// ── Kotlin: RPC paths, if any are written literally ───────────────────────

const kotlinSources = existsSync(join(ROOT, 'android'))
  ? walkKotlin(join(ROOT, 'android'))
  : []

function walkKotlin(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'build' || entry.name === '.gradle') continue
      found.push(...walkKotlin(path))
    } else if (entry.name.endsWith('.kt')) found.push(path)
  }
  return found
}

for (const file of kotlinSources) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/\/rest\/v1\/rpc\/([a-z0-9_]+)/g)) {
    if (!rpcNames.has(match[1])) {
      note(`${relative(ROOT, file)}: calls rpc '${match[1]}', which the contract does not describe`)
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────

const unchecked = [
  'SignInResponse',
  'SessionPayload',
  'OrganizationMembership',
  'CompletedSale',
]
  .filter((name) => !kotlinChecked.includes(name))
  .map((name) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())

console.log(
  `contract: ${rpcNames.size} RPCs, ${Object.keys(contract.relations).length} relations ` +
    `(migrations ${contract.migrations})`
)
console.log(
  `typescript client: ${rpcCalls} rpc call(s) to ${calledNames.size} function(s), ` +
    `${parameterUses.size} parameter name(s)` +
    (pluginRpcCalls > 0 ? `, ${pluginRpcCalls} plugin dispatch(es) via plugin_rpc` : '')
)
console.log(
  `kotlin client: ${kotlinFields} wire field(s) across ${kotlinChecked.length} data class(es)`
)
if (unchecked.length > 0) {
  console.log(
    `not checked statically (jsonb bodies, asserted by the live runs instead): ${unchecked.join(', ')}`
  )
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

console.log('\nboth clients speak the contract')
