/**
 * A picture for every plugin, without shipping a single file.
 *
 * The brief was "each plugin must have an image, dummy is fine". A folder of
 * seven PNGs would be the obvious answer and the wrong one: it is 300KB in the
 * bundle, it needs an artist the moment an eighth plugin appears, and in the
 * in-app preview — a sandboxed iframe with no network — every one of them
 * would be a broken-image icon.
 *
 * So the cover is generated: a deterministic two-colour field derived from the
 * plugin's id, with its own Material Symbols glyph carried as a plain letter
 * mark. Same plugin, same picture, on every device and in every environment,
 * as a data URI with nothing to fetch.
 *
 * When a plugin later ships a real `cover` in its manifest, that wins.
 */

/** FNV-1a: small, stable, and no dependency. */
function hash(value: string): number {
  let out = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    out ^= value.charCodeAt(i)
    out = Math.imul(out, 0x01000193)
  }
  return out >>> 0
}

/** Two hues a fixed distance apart read as a deliberate pair, not a clash. */
function palette(seed: number): [string, string] {
  const hue = seed % 360
  return [`hsl(${hue} 72% 46%)`, `hsl(${(hue + 38) % 360} 68% 32%)`]
}

/**
 * The initials drawn on the cover. Two letters from the plugin's words, so
 * `batch-expiry` reads `BE` and `warranty` reads `WA` — recognisable at a
 * glance in a list, which is the only job this image has.
 */
export function coverInitials(name: string): string {
  const words = name
    .replace(/[^A-Za-z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '??'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase()
}

/**
 * An `<svg>` cover as a data URI, safe to use as an `img` src.
 *
 * `encodeURIComponent` rather than base64: it stays readable in devtools, and
 * the SVG contains nothing a base64 round trip would protect.
 */
export function pluginCover(options: { id: string; name: string }): string {
  const seed = hash(options.id)
  const [from, to] = palette(seed)
  const initials = coverInitials(options.name)
  // A few deterministic circles so two plugins with similar hues still differ.
  const dots = [0, 1, 2]
    .map((index) => {
      const local = hash(`${options.id}:${index}`)
      const cx = 10 + (local % 80)
      const cy = 10 + ((local >> 8) % 60)
      const r = 8 + ((local >> 16) % 22)
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" opacity="0.10"/>`
    })
    .join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80" role="img">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="100" height="80" fill="url(#g)"/>` +
    dots +
    `<text x="50" y="47" text-anchor="middle" font-family="system-ui,sans-serif" ` +
    `font-size="28" font-weight="700" fill="#fff" opacity="0.92">${initials}</text>` +
    `</svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
