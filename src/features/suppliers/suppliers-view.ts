/**
 * Suppliers (spec §20).
 *
 * A supplier screen is really two things at once: an address book, and a
 * running account. The balance is shown as prominently as the name because it
 * is the number that decides whether the next delivery is collected or
 * refused — and because it is derived from the purchase ledger rather than
 * typed in, it can be trusted without opening a single order.
 *
 * Payment is recorded against the supplier, not the order, because that is how
 * a delivery works: the van arrives with three invoices and the shop pays once.
 * `apply_payment` allocates it oldest-first on the server; the screen only
 * asks for the amount.
 */

import { h, mount } from '../../components/ui/h'
import { button, spinner } from '../../components/ui/button'
import { badge, card, emptyState } from '../../components/ui/card'
import { input, field, searchInput, select } from '../../components/ui/input'
import { modal } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { getRepositories } from '../../app/data'
import { activeOrganization, can } from '../../app/state/session'
import { formatMoney, minorToNumber, parseMinor, type Minor } from '../../shared/domain/money'
import { translateError } from '../../app/platform/errors'
import type { PaymentMethod } from '../../shared/types/records'
import type { PurchaseRow, SupplierRow } from '../../shared/repositories/contracts'

export interface SuppliersViewOptions {
  /** Used for "raise an order", which belongs to the purchases screen. */
  onNavigate?: (path: string) => void
}

export function suppliersView(options: SuppliersViewOptions = {}): HTMLElement {
  const repos = getRepositories()
  const currency = activeOrganization()?.currency ?? 'BDT'

  let search = ''
  let rows: SupplierRow[] = []
  let cursor: string | null = null
  let loading = false

  const root = h('div', { class: 'flex h-full min-h-0 flex-col' })
  const listSlot = h('div', { class: 'min-h-0 flex-1 overflow-y-auto p-3' })
  const footerSlot = h('div', { class: 'border-t border-border p-3' })

  const searchBox = searchInput('Search name, phone or email…', (value) => {
    search = value
    void reload()
  })

  async function reload(): Promise<void> {
    if (loading) return
    loading = true
    cursor = null
    mount(listSlot, h('div', { class: 'flex justify-center p-6' }, spinner()))
    try {
      const page = await repos.suppliers.list({ limit: 30, ...(search.trim() ? { search } : {}) })
      rows = page.items
      cursor = page.nextCursor
      render()
    } catch (error) {
      mount(
        listSlot,
        emptyState('Suppliers could not be loaded', { description: translateError(error).message, iconName: 'error' })
      )
    } finally {
      loading = false
      renderFooter()
    }
  }

  async function loadMore(): Promise<void> {
    if (!cursor || loading) return
    loading = true
    try {
      const page = await repos.suppliers.list({ limit: 30, cursor, ...(search.trim() ? { search } : {}) })
      rows = [...rows, ...page.items]
      cursor = page.nextCursor
      render()
    } catch (error) {
      toastError(translateError(error).message)
    } finally {
      loading = false
      renderFooter()
    }
  }

  function render(): void {
    if (rows.length === 0) {
      mount(
        listSlot,
        emptyState('No suppliers yet', {
          description: 'Add the people you buy from. Their balance is kept from the orders you receive — nothing to type in.',
          iconName: 'handshake',
          ...(can('suppliers.create') ? { action: button('Add supplier', { variant: 'primary', icon: 'add', onClick: () => openForm(null) }) } : {}),
        })
      )
      return
    }

    const owed = rows.reduce((sum, row) => sum + minorToNumber(row.balance), 0)

    mount(
      listSlot,
      h(
        'div',
        { class: 'space-y-3' },
        owed > 0
          ? h(
              'div',
              { class: 'flex items-center justify-between rounded-xl border border-border bg-surface p-3' },
              h('span', { class: 'text-sm text-content-muted', text: 'Owed to suppliers shown' }),
              h('span', { class: 'text-sm font-semibold tabular-nums text-content', text: formatMoney(owed as Minor, { currency }) })
            )
          : null,
        h(
          'div',
          { class: 'overflow-hidden rounded-xl border border-border bg-surface' },
          ...rows.map((row) =>
            h(
              'button',
              {
                type: 'button',
                class:
                  'flex w-full min-h-[64px] items-center gap-3 border-b border-border p-3 text-left ' +
                  'last:border-b-0 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                onclick: () => void openDetail(row.id),
              },
              h(
                'div',
                { class: 'min-w-0 flex-1' },
                h('p', { class: 'truncate font-medium text-content', text: row.name }),
                h('p', {
                  class: 'truncate text-xs text-content-muted',
                  text: [row.phone, row.email].filter(Boolean).join(' · ') || 'No contact details',
                })
              ),
              minorToNumber(row.balance) > 0
                ? badge(formatMoney(row.balance, { currency }), { tone: 'warning' })
                : badge('Settled', { tone: 'success' })
            )
          )
        )
      )
    )
  }

  function renderFooter(): void {
    mount(
      footerSlot,
      h(
        'div',
        { class: 'flex items-center justify-between gap-3' },
        h('p', {
          class: 'text-xs text-content-subtle',
          text: `${rows.length} supplier${rows.length === 1 ? '' : 's'}${cursor ? ' · more' : ''}`,
        }),
        cursor ? button('Load more', { variant: 'outline', onClick: () => void loadMore() }) : null
      )
    )
  }

  // ── Create / edit ───────────────────────────────────────────────────────

  function openForm(existing: SupplierRow | null): void {
    const nameInput = input({ id: 'supplier-name', value: existing?.name ?? '', autofocus: true, placeholder: 'Karim Wholesale' })
    const phoneInput = input({ id: 'supplier-phone', value: existing?.phone ?? '', inputmode: 'tel', placeholder: '01XXXXXXXXX' })
    const emailInput = input({ id: 'supplier-email', type: 'email', value: existing?.email ?? '' })
    const addressInput = input({ id: 'supplier-address', value: existing?.address ?? '' })
    const noteInput = input({ id: 'supplier-note', value: existing?.note ?? '' })
    const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })

    const submit = button(existing ? 'Save changes' : 'Add supplier', { variant: 'primary', fullWidth: true, size: 'lg' })
    const dialog = modal({
      title: existing ? 'Edit supplier' : 'New supplier',
      subtitle: 'Only the name is required. Everything else can be filled in later.',
      iconName: 'handshake',
      size: 'sm',
      footer: [h('div', { class: 'w-full' }, submit)],
    })

    mount(
      dialog.body,
      h(
        'div',
        { class: 'space-y-4' },
        field('Name', nameInput, { required: true }),
        field('Phone', phoneInput),
        field('Email', emailInput),
        field('Address', addressInput),
        field('Note', noteInput),
        errorSlot
      )
    )

    submit.addEventListener('click', () => {
      void (async () => {
        const name = nameInput.value.trim()
        if (!name) {
          errorSlot.textContent = 'A supplier needs a name.'
          errorSlot.classList.remove('hidden')
          return
        }
        submit.disabled = true
        try {
          const draft = {
            name,
            phone: phoneInput.value.trim() || null,
            email: emailInput.value.trim() || null,
            address: addressInput.value.trim() || null,
            note: noteInput.value.trim() || null,
          }
          if (existing) await repos.suppliers.update(existing.id, draft)
          else await repos.suppliers.create(draft)
          dialog.close()
          toastSuccess(existing ? 'Supplier updated' : 'Supplier added')
          void reload()
        } catch (error) {
          errorSlot.textContent = translateError(error).message
          errorSlot.classList.remove('hidden')
        } finally {
          submit.disabled = false
        }
      })()
    })
  }

  // ── Detail: balance, history, payment ───────────────────────────────────

  async function openDetail(supplierId: string): Promise<void> {
    const dialog = modal({ title: 'Supplier', size: 'lg', iconName: 'handshake' })
    mount(dialog.body, h('div', { class: 'flex justify-center p-6' }, spinner()))

    async function render(): Promise<void> {
      const supplier = await repos.suppliers.get(supplierId)
      if (!supplier) {
        mount(dialog.body, emptyState('Supplier not found', { iconName: 'search_off' }))
        return
      }
      const history = await repos.suppliers.purchases(supplierId, { limit: 20 })

      mount(
        dialog.body,
        h(
          'div',
          { class: 'space-y-4' },
          h(
            'div',
            { class: 'flex flex-wrap items-start justify-between gap-3' },
            h(
              'div',
              { class: 'min-w-0' },
              h('p', { class: 'text-lg font-semibold text-content', text: supplier.name }),
              h('p', {
                class: 'text-xs text-content-muted',
                text: [supplier.phone, supplier.email, supplier.address].filter(Boolean).join(' · ') || 'No contact details',
              })
            ),
            h(
              'div',
              { class: 'text-right' },
              h('p', { class: 'text-xs text-content-muted', text: 'We owe' }),
              h('p', {
                class: 'text-lg font-semibold tabular-nums text-content',
                text: formatMoney(supplier.balance, { currency }),
              })
            )
          ),

          h(
            'div',
            { class: 'flex flex-wrap gap-2' },
            can('purchases.create')
              ? button('Raise an order', {
                  variant: 'primary',
                  icon: 'note_add',
                  onClick: () => {
                    dialog.close()
                    options.onNavigate?.(`/purchases?supplier=${supplier.id}`)
                  },
                })
              : null,
            can('suppliers.edit') ? button('Edit', { variant: 'outline', icon: 'edit', onClick: () => { dialog.close(); openForm(supplier) } }) : null,
            minorToNumber(supplier.balance) > 0 && can('purchases.create')
              ? button('Record payment', { variant: 'secondary', icon: 'payments', onClick: () => openPayment(supplier, render) })
              : null
          ),

          h('h3', { class: 'text-sm font-semibold text-content-muted', text: 'Purchase history' }),
          history.items.length > 0
            ? card(
                h(
                  'div',
                  { class: 'divide-y divide-border' },
                  ...history.items.map((purchase) => purchaseRow(purchase))
                )
              )
            : h('p', { class: 'text-sm text-content-subtle', text: 'Nothing bought from this supplier yet.' })
        )
      )
    }

    function purchaseRow(purchase: PurchaseRow): HTMLElement {
      return h(
        'div',
        { class: 'flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0' },
        h(
          'div',
          { class: 'min-w-0' },
          h(
            'div',
            { class: 'flex items-center gap-2' },
            h('span', { class: 'text-sm tabular-nums text-content', text: purchase.invoiceNo }),
            badge(purchase.status.replace(/_/g, ' ').toLowerCase(), { tone: purchaseTone(purchase.status) })
          ),
          h('p', {
            class: 'text-xs text-content-muted',
            text: new Date(purchase.createdAt).toLocaleDateString(),
          })
        ),
        h(
          'div',
          { class: 'shrink-0 text-right' },
          h('p', { class: 'text-sm tabular-nums text-content', text: formatMoney(purchase.total, { currency }) }),
          minorToNumber(purchase.outstanding) > 0
            ? h('p', { class: 'text-xs tabular-nums text-warning', text: `${formatMoney(purchase.outstanding, { currency })} due` })
            : null
        )
      )
    }

    try {
      await render()
    } catch (error) {
      mount(dialog.body, emptyState('Could not open the supplier', { description: translateError(error).message, iconName: 'error' }))
    }
  }

  /** Payment against the supplier as a whole; the server allocates it. */
  async function openPayment(supplier: SupplierRow, onDone: () => Promise<void>): Promise<void> {
    const methods = await loadMethods()
    const amountInput = input({ id: 'supplier-payment', inputmode: 'decimal', autofocus: true, placeholder: minorToNumber(supplier.balance).toFixed(2) })
    const methodSelect = select({
      id: 'supplier-payment-method',
      options: methods.map((method) => ({ value: method.id, label: method.name })),
      ...(methods[0] ? { value: methods[0].id } : {}),
    })
    const referenceInput = input({ id: 'supplier-payment-ref', placeholder: 'Cheque no. or note (optional)' })
    const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
    const submit = button('Record payment', { variant: 'primary', fullWidth: true, size: 'lg' })
    const dialog = modal({
      title: `Pay ${supplier.name}`,
      subtitle: `Outstanding ${formatMoney(supplier.balance, { currency })}. The oldest unpaid orders are settled first.`,
      iconName: 'payments',
      size: 'sm',
      footer: [h('div', { class: 'w-full' }, submit)],
    })

    mount(
      dialog.body,
      h('div', { class: 'space-y-4' }, field('Amount', amountInput, { required: true }), field('Paid with', methodSelect), field('Reference', referenceInput), errorSlot)
    )

    submit.addEventListener('click', () => {
      void (async () => {
        const amount = parseMinor(amountInput.value)
        if (amount === null || minorToNumber(amount) <= 0) {
          errorSlot.textContent = 'Enter an amount greater than zero.'
          errorSlot.classList.remove('hidden')
          return
        }
        if (!methodSelect.value) {
          errorSlot.textContent = 'Choose how it was paid.'
          errorSlot.classList.remove('hidden')
          return
        }
        submit.disabled = true
        try {
          const result = await repos.purchases.pay({
            supplierId: supplier.id,
            amount,
            methodId: methodSelect.value,
            reference: referenceInput.value.trim() || null,
          })
          dialog.close()
          toastSuccess(`Paid. ${formatMoney(result.supplierBalance, { currency })} still owed.`)
          await onDone()
        } catch (error) {
          errorSlot.textContent = translateError(error).message
          errorSlot.classList.remove('hidden')
        } finally {
          submit.disabled = false
        }
      })()
    })
  }

  let methodCache: PaymentMethod[] | null = null
  async function loadMethods(): Promise<PaymentMethod[]> {
    if (methodCache) return methodCache
    try {
      methodCache = (await repos.catalog.listPaymentMethods()).filter((method) => method.is_active)
    } catch {
      methodCache = []
    }
    return methodCache
  }

  const toolbar = h(
    'div',
    { class: 'flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center' },
    searchBox,
    can('suppliers.create')
      ? button('Add', { variant: 'primary', icon: 'add', onClick: () => openForm(null), class: 'shrink-0' })
      : null
  )

  mount(
    root,
    h('div', { class: 'border-b border-border px-3 pt-3 pb-3' }, h('h1', { class: 'text-lg font-semibold text-content', text: 'Suppliers' })),
    toolbar,
    listSlot,
    footerSlot
  )

  void reload()
  return root
}

function purchaseTone(status: PurchaseRow['status']): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'RECEIVED') return 'success'
  if (status === 'PARTIALLY_RECEIVED') return 'warning'
  if (status === 'CANCELLED') return 'danger'
  return 'neutral'
}
