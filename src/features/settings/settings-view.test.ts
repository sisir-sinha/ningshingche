/**
 * Settings screen — it must actually stop loading.
 *
 * This screen shipped stuck on its spinner: `render()` ran while the `loading`
 * flag was still true, and the flag was only cleared afterwards in `finally`,
 * so the one redraw the load ever performed drew the spinner and nothing
 * replaced it. Owners saw an animation and no settings.
 *
 * These tests hold the loaded state in place: the shop name reaches the form,
 * a failure in a supporting card does not take the page with it, and a failure
 * in the profile itself says so instead of spinning.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { settingsView } from './settings-view'

const settingsRow = {
  id: 'org-1',
  name: 'Sisir Store',
  slug: 'sisir-store',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  locale: 'en',
  logoUrl: null as string | null,
  settings: { receiptFooter: 'Thank you', receiptShowLogo: true },
}

const getSettings = vi.fn(async () => settingsRow)
const listAllTaxes = vi.fn(async () => [
  { id: 't-1', name: 'VAT', rate: 15, is_inclusive: false, is_active: true },
])
const listAllPaymentMethods = vi.fn(async () => [
  { id: 'm-1', name: 'Cash', type: 'cash', is_cash: true, is_active: true },
])

vi.mock('../../app/data', () => ({
  getRepositories: () => ({
    organization: { getSettings, updateSettings: vi.fn() },
    catalog: { listAllTaxes, listAllPaymentMethods, updatePaymentMethod: vi.fn(), createTax: vi.fn(), updateTax: vi.fn() },
  }),
}))

vi.mock('../../app/state/session', () => ({
  can: () => true,
}))

vi.mock('../../app/images', () => ({
  imageUploadsEnabled: () => false,
  uploadImage: vi.fn(),
  validateImageFile: () => null,
}))

/** The view loads asynchronously; let its promises settle. */
const settle = async (): Promise<void> => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

describe('settingsView', () => {
  beforeEach(() => {
    getSettings.mockClear()
    listAllTaxes.mockClear().mockResolvedValue([
      { id: 't-1', name: 'VAT', rate: 15, is_inclusive: false, is_active: true },
    ])
    listAllPaymentMethods.mockClear().mockResolvedValue([
      { id: 'm-1', name: 'Cash', type: 'cash', is_cash: true, is_active: true },
    ])
  })

  it('replaces the spinner with the shop profile once loaded', async () => {
    const root = settingsView()
    expect(root.querySelector('[data-state="loading"]')).not.toBeNull()

    await settle()

    expect(root.querySelector('[data-state="loading"]')).toBeNull()
    expect(root.textContent).toContain('Shop details')
    const nameInput = root.querySelector('input') as HTMLInputElement
    expect(nameInput.value).toBe('Sisir Store')
  })

  it('draws the taxes and payment methods it was given', async () => {
    const root = settingsView()
    await settle()
    expect(root.textContent).toContain('VAT')
    expect(root.textContent).toContain('Cash')
  })

  it('renders the shop logo field', async () => {
    const root = settingsView()
    await settle()
    expect(root.textContent).toContain('Shop logo')
  })

  it('still renders the page when a supporting card fails', async () => {
    listAllTaxes.mockRejectedValueOnce(new Error('permission denied for table taxes'))
    const root = settingsView()
    await settle()

    expect(root.querySelector('[data-state="loading"]')).toBeNull()
    expect(root.textContent).toContain('Shop details')
    expect(root.textContent).toContain('Some settings could not be loaded')
    // The payment card survived its sibling's failure.
    expect(root.textContent).toContain('Cash')
  })

  it('says so when the shop profile itself cannot be read', async () => {
    getSettings.mockRejectedValueOnce(new Error('network down'))
    const root = settingsView()
    await settle()

    expect(root.querySelector('[data-state="loading"]')).toBeNull()
    expect(root.textContent).toContain('Settings could not be loaded')
  })
})
