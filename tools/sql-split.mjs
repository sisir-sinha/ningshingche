/**
 * Splits SQL into individual statements.
 *
 * A naive `split(';')` corrupts plpgsql: function bodies contain semicolons,
 * strings can contain them, and `--` comments can too. This walker tracks
 * dollar-quoting ($$ … $$ and $tag$ … $tag$), single-quoted strings, and
 * both comment forms, so a `CREATE FUNCTION` comes back out as one statement.
 */

/** @param {string} sql @returns {string[]} */
export function splitStatements(sql) {
  /** @type {string[]} */
  const out = []
  let cur = ''
  let i = 0

  while (i < sql.length) {
    const c = sql[i]
    const two = sql.slice(i, i + 2)

    // Line comment — runs to end of line.
    if (two === '--') {
      const nl = sql.indexOf('\n', i)
      const end = nl === -1 ? sql.length : nl
      cur += sql.slice(i, end)
      i = end
      continue
    }

    // Block comment — does not nest in Postgres.
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      cur += sql.slice(i, stop)
      i = stop
      continue
    }

    // Dollar quoting: $$ … $$ or $name$ … $name$
    if (c === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const end = sql.indexOf(tag, i + tag.length)
        const stop = end === -1 ? sql.length : end + tag.length
        cur += sql.slice(i, stop)
        i = stop
        continue
      }
    }

    // Single-quoted string, with '' as the escape for a literal quote.
    if (c === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2
            continue
          }
          break
        }
        j++
      }
      cur += sql.slice(i, j + 1)
      i = j + 1
      continue
    }

    if (c === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      i++
      continue
    }

    cur += c
    i++
  }

  if (cur.trim()) out.push(cur.trim())
  return out
}

/**
 * First non-comment line of a statement, for labelling it in output.
 * @param {string} stmt @returns {string}
 */
export function statementLabel(stmt) {
  const line = stmt
    .split('\n')
    .find((l) => l.trim() && !l.trim().startsWith('--'))
  return (line ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
}
