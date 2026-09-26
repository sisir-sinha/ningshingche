/**
 * The OAuth return path.
 *
 * Every case here is a shape GoTrue actually produces. The one that prompted
 * these tests was a production sign-in that came back on localhost with a
 * session in the fragment — a live refresh token sitting in the address bar of
 * the wrong site (docs/14).
 */

import { describe, it, expect } from 'vitest'
import { buildRedirectUrl, stripAuthParams } from './auth-url'

describe('buildRedirectUrl', () => {
  /**
   * The build uses `base: './'`, so this is the real production case: a
   * relative base resolved against a page already under the Pages sub-path.
   * Resolving against the origin instead would answer `https://host/` and
   * post a signed-in user to the wrong site.
   */
  it('keeps the deploy sub-path when the base is relative', () => {
    expect(buildRedirectUrl('https://shop.example/Mekholi/#/pos', './')).toBe(
      'https://shop.example/Mekholi/'
    )
  })

  it('resolves a relative base to the root in development', () => {
    expect(buildRedirectUrl('http://localhost:5173/#/pos', './')).toBe('http://localhost:5173/')
  })

  it('accepts an absolute base too', () => {
    expect(buildRedirectUrl('https://shop.example/Mekholi/#/pos', '/Mekholi/')).toBe(
      'https://shop.example/Mekholi/'
    )
    expect(buildRedirectUrl('http://localhost:5173/#/pos', '/')).toBe('http://localhost:5173/')
  })
})

describe('stripAuthParams', () => {
  it('removes an implicit-flow session from the fragment', () => {
    const { href, error } = stripAuthParams(
      'https://shop.example/Mekholi/#access_token=eyJhbGci&expires_at=1790394093&expires_in=3600' +
        '&provider_token=ya29.a0&refresh_token=y3tv3sauzgwc&token_type=bearer'
    )

    expect(href).toBe('https://shop.example/Mekholi/')
    expect(error).toBeNull()
  })

  it('removes a PKCE code and keeps unrelated query parameters', () => {
    const { href } = stripAuthParams('https://shop.example/Mekholi/?code=abc-123&utm_source=qr')

    expect(href).toBe('https://shop.example/Mekholi/?utm_source=qr')
  })

  it('keeps the route when a code arrives with a hash route', () => {
    // The app routes on the fragment, so a `?code=` return must not disturb it.
    const { href } = stripAuthParams('https://shop.example/Mekholi/?code=abc-123#/pos')

    expect(href).toBe('https://shop.example/Mekholi/#/pos')
  })

  it('leaves an ordinary route fragment untouched', () => {
    const url = 'https://shop.example/Mekholi/#/products?page=2'
    const { href, error } = stripAuthParams(url)

    expect(href).toBe(url)
    expect(error).toBeNull()
  })

  it('reports why a sign-in was refused, and takes it out of the URL', () => {
    const { href, error } = stripAuthParams(
      'https://shop.example/Mekholi/#error=access_denied&error_description=The+user+denied+the+request'
    )

    expect(error).toBe('The user denied the request')
    expect(href).toBe('https://shop.example/Mekholi/')
  })

  it('falls back to the error code when there is no description', () => {
    const { error } = stripAuthParams('https://shop.example/Mekholi/#error=server_error')

    expect(error).toBe('server_error')
  })

  it('is idempotent', () => {
    const first = stripAuthParams('https://shop.example/Mekholi/#access_token=abc&refresh_token=def')
    const second = stripAuthParams(first.href)

    expect(second.href).toBe(first.href)
    expect(second.error).toBeNull()
  })

  it('survives a URL with no auth parameters at all', () => {
    const { href, error } = stripAuthParams('https://shop.example/Mekholi/')

    expect(href).toBe('https://shop.example/Mekholi/')
    expect(error).toBeNull()
  })
})
