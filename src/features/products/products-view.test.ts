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
  category_id: null as string | null,
  brand_id: null as string | null,
  unit_id: null as string | null,
  tax_id: null,
  selling_price: '450.00',
  cost_price: '300.00',
  tax_inclusive: false,
  reorder_point: '5',
  track_stock: true,
  allow_negative: false,
  is_active: true,
  image_url: null as string | null,
  metadata: {},
  created_at: '2026-09-01T00:00:00Z',
}

const list = vi.fn(async () => ({ items: [product], nextCursor: null }))
const onHand = vi.fn(async () => ({ 'p-1': milli(12000) }))
const remove = vi.fn(async () => undefined)
const update = vi.fn(async () => product)
const archive = vi.fn(async () => undefined)
const duplicate = vi.fn(async () => ({ ...product, id: 'p-2', name: 'Kala Jam (copy)' }))

const quickAddRepo: Record<string, unknown> = {}

vi.mock('../../app/data', () => ({
  getRepositories: () => ({
    products: { list, onHand, remove, archive, duplicate, update, ...quickAddRepo, get: vi.fn(), getWithVariants: vi.fn(), listBarcodes: vi.fn() },
    catalog: {
      listCategories: vi.fn(async () => [{ id: 'c-1', name: 'Sweets' }]),
      listBrands: vi.fn(async () => [{ id: 'b-1', name: 'Ghoshal' }]),
      listUnits: vi.fn(async () => [{ id: 'u-1', name: 'Kilogram', symbol: 'kg' }]),
      listTaxes: vi.fn(async () => []),
    },
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

const uploadImage = vi.fn(async () => ({ url: 'https://i.ibb.co/new/photo.jpg', thumbUrl: null }))
let uploadsOn = true

vi.mock('../../app/images', () => ({
  imageUploadsEnabled: () => uploadsOn,
  uploadImage: (...args: unknown[]) => uploadImage(...(args as [])),
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
    uploadsOn = true
    for (const mock of [list, onHand, remove, archive, duplicate, update, uploadImage]) mock.mockClear()
    uploadImage.mockResolvedValue({ url: 'https://i.ibb.co/new/photo.jpg', thumbUrl: null })
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


  it('shows the product photo at the head of the row', async () => {
    list.mockResolvedValueOnce({
      items: [{ ...product, image_url: 'https://i.ibb.co/abc/kala-jam.jpg' }],
      nextCursor: null,
    })
    const root = view()
    await settle()

    const img = root.querySelector('tbody img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toBe('https://i.ibb.co/abc/kala-jam.jpg')
    // Square and cropped, so a wide label cannot change the row's height.
    expect(img.className).toContain('h-10')
    expect(img.className).toContain('w-10')
    expect(img.className).toContain('object-cover')
    // A long catalogue must not fetch every photo at once on a shop's phone.
    expect(img.getAttribute('loading')).toBe('lazy')
    // Decorative: the name is right beside it, so a screen reader must not
    // hear the product twice.
    expect(img.getAttribute('alt')).toBe('')
  })

  it('invites a photo when a product has none', async () => {
    const root = view()
    await settle()
    expect(root.querySelector('tbody img')).toBeNull()
    // Not a generic box: the glyph says what is missing and what to do.
    expect(root.querySelector('tbody .material-symbols-rounded')?.textContent).toBe('add_photo_alternate')
  })

  it('replaces a dead image link with the placeholder', async () => {
    list.mockResolvedValueOnce({
      items: [{ ...product, image_url: 'https://i.ibb.co/gone.jpg' }],
      nextCursor: null,
    })
    const root = view()
    await settle()

    const img = root.querySelector('tbody img') as HTMLImageElement
    img.dispatchEvent(new Event('error'))

    expect(root.querySelector('tbody img')).toBeNull()
    // A rotted link is a different problem from never having had a photo.
    expect(root.querySelector('tbody .material-symbols-rounded')?.textContent).toBe('broken_image')
  })

  it('turns the empty square into a one-tap photo upload', async () => {
    const root = view()
    await settle()

    const trigger = root.querySelector('[aria-label="Add photo for Kala Jam"]') as HTMLButtonElement
    expect(trigger).not.toBeNull()

    const file = root.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(file, 'files', {
      value: [new File(['x'], 'jam.jpg', { type: 'image/jpeg' })],
    })
    file.dispatchEvent(new Event('change'))
    await settle()

    expect(uploadImage).toHaveBeenCalled()
    // The link is stored on the product, and the row redraws with it.
    expect(update).toHaveBeenCalledWith('p-1', { image_url: 'https://i.ibb.co/new/photo.jpg' })
    expect((root.querySelector('tbody img') as HTMLImageElement).src).toBe('https://i.ibb.co/new/photo.jpg')
  })

  it('offers to replace a photo that is already there', async () => {
    list.mockResolvedValueOnce({
      items: [{ ...product, image_url: 'https://i.ibb.co/abc/old.jpg' }],
      nextCursor: null,
    })
    const root = view()
    await settle()
    expect(root.querySelector('[aria-label="Change photo for Kala Jam"]')).not.toBeNull()
  })

  it('leaves the square inert when uploads are switched off', async () => {
    uploadsOn = false
    const root = view()
    await settle()
    expect(root.querySelector('[aria-label="Add photo for Kala Jam"]')).toBeNull()
    expect(root.querySelector('input[type="file"]')).toBeNull()
  })

  it('says so when the upload fails, and keeps the row', async () => {
    uploadImage.mockRejectedValueOnce(new Error('ImgBB refused the file'))
    const root = view()
    await settle()

    const file = root.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(file, 'files', { value: [new File(['x'], 'jam.jpg', { type: 'image/jpeg' })] })
    file.dispatchEvent(new Event('change'))
    await settle()

    expect(update).not.toHaveBeenCalled()
    expect(root.textContent).toContain('Kala Jam')
  })

  it('shows the code the shop just got, rather than leaving it a surprise', async () => {
    // The SKU is assigned by the database (migration 054), so the only place
    // an owner can learn it at creation time is the confirmation.
    const created = { ...product, id: 'p-9', name: 'Miniket Rice 5kg', sku: 'MIN-0007' }
    const create = vi.fn(async () => created)
    quickAddRepo.create = create

    const root = view()
    await settle()
    ;([...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Quick add')) as HTMLButtonElement).click()
    await settle()

    // Scope to the dialog: the rows behind it each carry a hidden file input.
    const fields = [...document.querySelectorAll('[role="dialog"] input')].filter(
      (el) => (el as HTMLInputElement).type !== 'file'
    ) as HTMLInputElement[]
    fields[0]!.value = 'Miniket Rice 5kg'
    fields[1]!.value = '450'
    const save = [...document.querySelectorAll('[role="dialog"] button')].find((b) =>
      (b.textContent ?? '').includes('Save')
    ) as HTMLButtonElement
    save.click()
    await settle()

    expect(create).toHaveBeenCalled()
    expect(document.body.textContent).toContain('MIN-0007')
  })

  it('spends a wide screen on facts, not whitespace', async () => {
    list.mockResolvedValueOnce({
      items: [{ ...product, category_id: 'c-1', brand_id: 'b-1', unit_id: 'u-1' }],
      nextCursor: null,
    })
    const root = view()
    await settle()

    const headers = [...root.querySelectorAll('th')].map((th) => th.textContent)
    expect(headers).toEqual([
      'Product', 'SKU', 'Category', 'Brand', 'Price', 'Cost', 'Margin', 'Stock', 'Status', 'Added', '',
    ])

    // The ids in the row are shown as the words they stand for.
    expect(root.textContent).toContain('Sweets')
    expect(root.textContent).toContain('Ghoshal')
    // Price carries its unit: ৳450 and ৳450 a kilo are different offers.
    expect(root.textContent).toContain('/kg')
  })

  it('does the arithmetic the owner was doing in their head', async () => {
    // 450 selling, 300 cost → a third of the price is margin.
    const root = view()
    await settle()
    expect(root.textContent).toContain('33%')
  })

  it('keeps every column and its header in step', async () => {
    const root = view()
    await settle()
    const headers = [...root.querySelectorAll('thead th')]
    const cells = [...root.querySelectorAll('tbody tr:first-child td')]
    expect(cells.length).toBe(headers.length)
    // A header that hides at a width must hide its column at the same width.
    const breakpoint = (el: Element): string =>
      (el.className.match(/(?:hidden )?(?:sm|lg|xl|2xl):(?:table-cell|hidden)/) ?? [''])[0]
    expect(cells.map(breakpoint)).toEqual(headers.map(breakpoint))
  })

  it('still shows the SKU on a phone, under the name', async () => {
    const root = view()
    await settle()
    const inline = root.querySelector('tbody .sm\\:hidden')
    expect(inline?.textContent).toBe('KJ-1')
  })
})
