/**
 * Products list — the row actions and the stock number.
 *
 * Three things were wrong on this screen and all three were about a
 * shopkeeper's expectations rather than a crash:
 *
 *   · the only way to edit was to discover that the *name* was a button;
 *   · "delete" archived the row, and Mekholi has no trash view, so the
 *     product became invisible and permanent at the same time;
 *   · the Stock column said "Tracked", which is a fact about configuration
 *     where a number was wanted.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { productsView } from './products-view'
import { PluginRegistry } from '../../shared/registry/plugin-registry'
import { EventBus } from '../../shared/bus'
import { milli } from '../../shared/domain/money'

const product = {
  id: 'p-1',
  organization_id: 'org-1',
  name: 'Kala Jam',
  sku: 'KJ-1',
  description: null,
  category_id: null,
  brand_id: null,
  unit_id: null,
  tax_id: null,
  selling_price: '450.00',
  cost_price: '300.00',
  tax_inclusive: false,
  reorder_point: '5',
  track_stock: true,
  allow_negative: false,
  is_active: true,
  image_url: null,
  metadata: {},
  created_at: '2026-09-01T00:00:00Z',
}

const list = vi.fn(async () => ({ items: [product], nextCursor: null }))
const onHand = vi.fn(async () => ({ 'p-1': milli(12000) }))
const remove = vi.fn(async () => undefined)
const archive = vi.fn(async () => undefined)
const duplicate = vi.fn(async () => ({ ...product, id: 'p-2', name: 'Kala Jam (copy)' }))

vi.mock('../../app/data', () => ({
  getRepositories: () => ({
    products: { list, onHand, remove, archive, duplicate, get: vi.fn(), getWithVariants: vi.fn(), listBarcodes: vi.fn() },
    catalog: { listCategories: vi.fn(async () => []), listBrands: vi.fn(async () => []), listUnits: vi.fn(async () => []), listTaxes: vi.fn(async () => []) },
    stock: { listWarehouses: vi.fn(async () => []), stockIn: vi.fn(), adjust: vi.fn() },
  }),
}))

vi.mock('../../app/state/session', () => ({
  activeOrganization: () => ({ organization_id: 'org-1', currency: 'BDT' }),
  can: () => true,
}))

vi.mock('../../app/state/sales-floor', () => ({
  salesFloor: () => ({ warehouseId: 'w-1' }),
}))

vi.mock('../../app/images', () => ({
  imageUploadsEnabled: () => false,
  uploadImage: vi.fn(),
  validateImageFile: () => null,
}))

vi.mock('../../app/shop-profile', () => ({
  activeShopType: () => null,
  activePromotedFields: () => [],
}))

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

function view(): HTMLElement {
  const root = productsView({ registry: new PluginRegistry(new EventBus()) })
  document.body.replaceChildren(root)
  return root
}

/** The confirm dialog renders into the body; find its button by label. */
function dialogButton(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((el) =>
    (el.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase())
  )
  if (!match) throw new Error(`no dialog button matching “${label}”`)
  return match as HTMLButtonElement
}

function action(name: string): HTMLButtonElement {
  const el = document.querySelector(`[aria-label="${name} Kala Jam"]`)
  if (!el) throw new Error(`no ${name} action`)
  return el as HTMLButtonElement
}

describe('products list', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    for (const mock of [list, onHand, remove, archive, duplicate]) mock.mockClear()
    onHand.mockResolvedValue({ 'p-1': milli(12000) })
    remove.mockResolvedValue(undefined)
  })

  it('offers edit, copy and delete on every row', async () => {
    view()
    await settle()
    expect(action('Edit')).toBeTruthy()
    expect(action('Copy')).toBeTruthy()
    expect(action('Delete')).toBeTruthy()
  })

  it('shows the quantity on hand instead of the word "Tracked"', async () => {
    const root = view()
    await settle()
    expect(root.textContent).toContain('12')
    expect(root.textContent).not.toContain('Tracked')
    expect(onHand).toHaveBeenCalledWith(['p-1'], 'w-1')
  })

  it('warns that a copy is about to be made, and does nothing until confirmed', async () => {
    view()
    await settle()

    action('Copy').click()
    await settle()
    expect(document.body.textContent).toContain('Copy “Kala Jam”?')
    expect(duplicate).not.toHaveBeenCalled()

    dialogButton('Make a copy').click()
    await settle()
    expect(duplicate).toHaveBeenCalledWith('p-1')
  })

  it('asks before deleting, in words that say it is permanent', async () => {
    view()
    await settle()

    action('Delete').click()
    await settle()
    expect(document.body.textContent).toContain('Delete “Kala Jam”?')
    expect(document.body.textContent).toContain('cannot be undone')
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes the record outright — no archive, no trash', async () => {
    view()
    await settle()
    action('Delete').click()
    await settle()

    dialogButton('Delete permanently').click()
    await settle()

    expect(remove).toHaveBeenCalledWith('p-1')
    expect(archive).not.toHaveBeenCalled()
  })

  it('leaves the product alone when the warning is dismissed', async () => {
    view()
    await settle()
    action('Delete').click()
    await settle()

    dialogButton('Cancel').click()
    await settle()
    expect(remove).not.toHaveBeenCalled()
  })

  it('offers archiving only when the database refuses the delete', async () => {
    remove.mockRejectedValueOnce(new Error('Kala Jam is on 3 sale line(s), 0 return line(s) and 0 purchase line(s).'))
    view()
    await settle()
    action('Delete').click()
    await settle()
    dialogButton('Delete permanently').click()
    await settle()

    expect(document.body.textContent).toContain('cannot be deleted')
    dialogButton('Archive instead').click()
    await settle()
    expect(archive).toHaveBeenCalledWith('p-1')
  })

  it('survives a stock table it cannot read', async () => {
    onHand.mockRejectedValueOnce(new Error('permission denied for table stock_balances'))
    const root = view()
    await settle()
    // The list is still there; only the quantity is missing.
    expect(root.textContent).toContain('Kala Jam')
  })
})
