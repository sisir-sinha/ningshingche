/**
 * The generated plugin cover.
 *
 * It replaces a folder of PNGs, so the properties that matter are: the same
 * plugin always gets the same picture, two plugins do not get the same one,
 * and it renders with nothing to fetch — the in-app preview is a sandboxed
 * iframe with no network, where a linked image is a broken-image icon.
 */

import { describe, it, expect } from 'vitest'
import { pluginCover, coverInitials } from './plugin-cover'

describe('plugin covers', () => {
  it('is the same picture for the same plugin, every time', () => {
    expect(pluginCover({ id: 'warranty', name: 'Warranty' })).toBe(
      pluginCover({ id: 'warranty', name: 'Warranty' })
    )
  })

  it('gives different plugins different pictures', () => {
    const a = pluginCover({ id: 'warranty', name: 'Warranty' })
    const b = pluginCover({ id: 'loyalty', name: 'Loyalty' })
    expect(a).not.toBe(b)
  })

  it('carries its own pixels — nothing to fetch', () => {
    const cover = pluginCover({ id: 'loyalty', name: 'Loyalty' })
    expect(cover.startsWith('data:image/svg+xml,')).toBe(true)
    // The only URL in it is the SVG namespace, which is an identifier and not
    // something a browser goes and gets.
    const decoded = decodeURIComponent(cover.slice('data:image/svg+xml,'.length))
    expect(decoded).not.toContain('<image')
    expect(decoded.replace('http://www.w3.org/2000/svg', '')).not.toContain('http')
  })

  it('reads as the plugin it belongs to', () => {
    expect(coverInitials('Batch & Expiry')).toBe('BE')
    expect(coverInitials('Warranty')).toBe('WA')
    expect(coverInitials('')).toBe('??')
  })
})
