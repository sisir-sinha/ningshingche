/**
 * Expenses (spec §24).
 *
 * Two things make this screen worth having rather than a spreadsheet: an
 * expense paid in cash from the drawer moves the register's expected cash
 * figure (the RPC does that, not the UI), and the categories are the shop's
 * own — a tailoring shop has "thread and buttons", a pharmacy has "cold chain",
 * and neither should be forced into a fixed list.
 *
 * The day's total sits at the top because it is the number the owner checks
 * before closing the drawer.
 */

import { h, mount } from '../../components/ui/h'
import { button, iconButton, spinner } from '../../components/ui/button'
import { badge, emptyState } from '../../components/ui/card'
import { input, field, searchInput, select } from '../../components/ui/input'
import { modal, confirm } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { getRepositories } from '../../app/data'
import { activeOrganization, can } from '../../app/state/session'
import { salesFloor, refreshSalesFloor } from '../../app/state/sales-floor'
import { formatMoney, minorToNumber, parseMinor, toMinor, type Minor } from '../../shared/domain/money'
import { translateError } from '../../app/platform/errors'
import type { PaymentMethod } from '../../shared/types/records'
import type { ExpenseCategoryRow, ExpenseRow } from '../../shared/repositories/contracts'

export function expensesView(): HTMLElement {
  const repos = getRepositories()
  const currency = activeOrganization()?.currency ?? 'BDT'

  const today = new Date().toISOString().slice(0, 10)
  let from = `${today.slice(0, 8)}01`
  let to = today
  let categoryId = ''
  let search = ''
  let rows: ExpenseRow[] = []
  let categories: ExpenseCategoryRow[] = []
  let dayTotal: Minor = toMinor(0)
  let loading = false

  const root = h('div', { class: 'flex h-full min-h-0 flex-col' })
  const headSlot = h('div', { class: 'space-y-3 border-b border-border p-3' })
  const listSlot = h('div', { class: 'min-h-0 flex-1 overflow-y-auto p-3' })

  async function reload(): Promise<void> {
    if (loading) return
    loading = true
    mount(listSlot, h('div', { class: 'flex justify-center p-6' }, spinner()))
    try {
      const [page, total, cats] = await Promise.all([
        repos.expenses.list({
          limit: 50,
          from,
          to,
          ...(categoryId ? { categoryId } : {}),
          ...(search.trim() ? { search } : {}),
        }),
        repos.expenses.totalForDay(to),
        repos.expenses.categories(),
      ])
      rows = page.items
      dayTotal = total
      categories = cats
      renderHead()
      render()
    } catch (error) {
      mount(listSlot, emptyState('Expenses could not be loaded', { description: translateError(error).message, iconName: 'error' }))
    } finally {
      loading = false
    }
  }

  function renderHead(): void {
    const fromInput = input({ id: 'expenses-from', type: 'date', value: from })
    const toInput = input({ id: 'expenses-to', type: 'date', value: to })
    const categorySelect = select({
      id: 'expenses-category-filter',
      options: [{ value: '', label: 'All categories' }, ...categories.map((category) => ({ value: category.id, label: category.name }))],
      value: categoryId,
      onChange: (value) => {
        categoryId = value
        void reload()
      },
    })
    const searchBox = searchInput('Search a description…', (value) => {
      search = value
      void reload()
    })

    const applyDates = (): void => {
      from = fromInput.value || from
      to = toInput.value || to
      void reload()
    }
    fromInput.addEventListener('change', applyDates)
    toInput.addEventListener('change', applyDates)

    mount(
      headSlot,
      h(
        'div',
        { class: 'flex flex-wrap items-center justify-between gap-3' },
        h(
          'div',
          null,
          h('p', { class: 'text-xs font-medium text-content-muted', text: 'Spent today' }),
          h('p', { class: 'text-xl font-semibold tabular-nums text-content', text: formatMoney(dayTotal, { currency }) })
        ),
        h(
          'div',
          { class: 'flex gap-2' },
          can('expenses.create') ? button('Record', { variant: 'primary', icon: 'add', onClick: () => openForm() }) : null,
          can('expenses.edit') ? button('Categories', { variant: 'outline', icon: 'sell', onClick: openCategories }) : null
        )
      ),
      h('div', { class: 'grid gap-2 sm:grid-cols-2' }, fromInput, toInput),
      h('div', { class: 'grid gap-2 sm:grid-cols-2' }, categorySelect, searchBox)
    )
  }

  function render(): void {
    if (rows.length === 0) {
      mount(
        listSlot,
        emptyState('Nothing spent in this period', {
          description: 'Record rent, electricity, transport, tea for the staff — anything that leaves the till without being stock.',
          iconName: 'payments',
          ...(can('expenses.create') ? { action: button('Record an expense', { variant: 'primary', icon: 'add', onClick: () => openForm() }) } : {}),
        })
      )
      return
    }

    const total = rows.reduce((sum, row) => sum + minorToNumber(row.amount), 0)

    mount(
      listSlot,
      h(
        'div',
        { class: 'space-y-3' },
        h(
          'div',
          { class: 'flex items-center justify-between rounded-xl border border-border bg-surface p-3' },
          h('span', { class: 'text-sm text-content-muted', text: `${rows.length} expense${rows.length === 1 ? '' : 's'} in view` }),
          h('span', { class: 'text-sm font-semibold tabular-nums text-content', text: formatMoney(toMinor(total), { currency }) })
        ),
        h(
          'div',
          { class: 'overflow-hidden rounded-xl border border-border bg-surface' },
          ...rows.map((row) =>
            h(
              'div',
              { class: 'flex items-start justify-between gap-3 border-b border-border p-3 last:border-b-0' },
              h(
                'div',
                { class: 'min-w-0' },
                h(
                  'div',
                  { class: 'flex flex-wrap items-center gap-2' },
                  h('span', { class: 'text-sm font-medium text-content', text: row.categoryName ?? 'Uncategorised' }),
                  row.sessionId ? badge('register', { tone: 'info' }) : null
                ),
                h('p', {
                  class: 'truncate text-xs text-content-muted',
                  text: [row.description, new Date(row.expenseDate).toLocaleDateString(), row.methodName].filter(Boolean).join(' · '),
                }),
                row.attachmentUrl
                  ? h('a', {
                      class: 'text-xs text-primary hover:underline',
                      href: row.attachmentUrl,
                      target: '_blank',
                      rel: 'noreferrer',
                      text: 'Attachment',
                    })
                  : null
              ),
              h(
                'div',
                { class: 'shrink-0 text-right' },
                h('p', { class: 'text-sm font-semibold tabular-nums text-content', text: formatMoney(row.amount, { currency }) }),
                can('expenses.delete')
                  ? iconButton('delete', `Delete ${row.categoryName ?? 'expense'}`, {
                      variant: 'ghost',
                      onClick: () => void remove(row),
                    })
                  : null
              )
            )
          )
        )
      )
    )
  }

  async function remove(row: ExpenseRow): Promise<void> {
    const ok = await confirm('Delete this expense?', {
      message: 'It stays in the audit trail but stops counting towards the register and the reports.',
      confirmLabel: 'Delete',
      tone: 'danger',
      iconName: 'delete',
    })
    if (!ok) return
    try {
      await repos.expenses.remove(row.id)
      toastSuccess('Expense deleted')
      void reload()
    } catch (error) {
      toastError(translateError(error).message)
    }
  }

  // ── Recording ───────────────────────────────────────────────────────────

  function openForm(): void {
    void (async () => {
      const methods = await loadMethods()
      if (categories.length === 0) categories = await repos.expenses.categories()

      const amountInput = input({ id: 'expense-amount', inputmode: 'decimal', autofocus: true, placeholder: '0.00' })
      const categorySelect = select({
        id: 'expense-category',
        options: [{ value: '', label: 'Uncategorised' }, ...categories.map((category) => ({ value: category.id, label: category.name }))],
      })
      const methodSelect = select({
        id: 'expense-method',
        options: [{ value: '', label: 'Not from the drawer' }, ...methods.map((method) => ({ value: method.id, label: method.name }))],
        ...(methods.find((method) => method.is_cash) ? { value: methods.find((method) => method.is_cash)!.id } : {}),
      })
      const descriptionInput = input({ id: 'expense-description', placeholder: 'What was it for?' })
      const dateInput = input({ id: 'expense-date', type: 'date', value: today })
      const registerInput = h('input', { type: 'checkbox', class: 'h-4 w-4' }) as HTMLInputElement
      const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
      const submit = button('Record expense', { variant: 'primary', fullWidth: true, size: 'lg' })
      const addCategoryButton = button('New category', { variant: 'ghost', size: 'sm', icon: 'add', onClick: () => void addCategory(categorySelect) })

      const dialog = modal({
        title: 'Record an expense',
        subtitle: 'Paid from the drawer in cash? Tick the box and the register expects that much less.',
        iconName: 'payments',
        size: 'sm',
        footer: [h('div', { class: 'w-full' }, submit)],
      })

      mount(
        dialog.body,
        h(
          'div',
          { class: 'space-y-4' },
          field('Amount', amountInput, { required: true }),
          h('div', { class: 'space-y-1' }, field('Category', categorySelect), h('div', { class: 'flex justify-end' }, addCategoryButton)),
          field('Paid with', methodSelect),
          field('For', descriptionInput),
          field('Date', dateInput),
          h(
            'label',
            { class: 'flex min-h-[44px] items-center gap-2 text-sm text-content' },
            registerInput,
            h('span', { text: 'This came out of the open register drawer' })
          ),
          errorSlot
        )
      )

      submit.addEventListener('click', () => {
        void (async () => {
          const amount = parseMinor(amountInput.value)
          if (amount === null || minorToNumber(amount) <= 0) {
            errorSlot.textContent = 'Enter an amount greater than zero.'
            errorSlot.classList.remove('hidden')
            return
          }
          submit.disabled = true
          try {
            let sessionId: string | null = null
            if (registerInput.checked) {
              if (!salesFloor()) await refreshSalesFloor()
              sessionId = salesFloor()?.sessionId ?? null
              if (!sessionId) {
                throw new Error('No drawer is open — open the register first, or untick the box.')
              }
            } else if (!salesFloor()) {
              await refreshSalesFloor()
            }
            await repos.expenses.create({
              branchId: salesFloor()?.branchId ?? '',
              amount,
              categoryId: categorySelect.value || null,
              methodId: methodSelect.value || null,
              description: descriptionInput.value.trim() || null,
              sessionId,
              expenseDate: dateInput.value || today,
            })
            dialog.close()
            toastSuccess('Expense recorded')
            void reload()
          } catch (error) {
            errorSlot.textContent = translateError(error).message
            errorSlot.classList.remove('hidden')
          } finally {
            submit.disabled = false
          }
        })()
      })
    })()
  }

  async function addCategory(selectEl: HTMLSelectElement): Promise<void> {
    const nameInput = input({ id: 'new-category', placeholder: 'Thread and buttons', autofocus: true })
    const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
    const save = button('Add category', { variant: 'primary', fullWidth: true })
    const dialog = modal({ title: 'New expense category', iconName: 'sell', size: 'sm', footer: [h('div', { class: 'w-full' }, save)] })
    mount(dialog.body, h('div', { class: 'space-y-4' }, field('Name', nameInput, { required: true }), errorSlot))

    save.addEventListener('click', () => {
      void (async () => {
        const name = nameInput.value.trim()
        if (!name) {
          errorSlot.textContent = 'Give the category a name.'
          errorSlot.classList.remove('hidden')
          return
        }
        save.disabled = true
        try {
          const created = await repos.expenses.createCategory(name)
          categories = [...categories, created]
          const option = h('option', { value: created.id, text: created.name, selected: true }) as HTMLOptionElement
          selectEl.appendChild(option)
          dialog.close()
          toastSuccess('Category added')
        } catch (error) {
          errorSlot.textContent = translateError(error).message
          errorSlot.classList.remove('hidden')
        } finally {
          save.disabled = false
        }
      })()
    })
  }

  async function openCategories(): Promise<void> {
    const list = await repos.expenses.categories()
    const dialog = modal({ title: 'Expense categories', iconName: 'sell', size: 'sm', footer: [] })
    const body = h('div', { class: 'divide-y divide-border' })

    function renderList(): void {
      mount(
        body,
        ...list.map((category) =>
          h(
            'div',
            { class: 'flex items-center justify-between gap-3 py-2.5' },
            h('span', { class: 'text-sm text-content', text: category.name }),
            category.isSystem
              ? badge('built in', { tone: 'neutral' })
              : can('expenses.delete')
                ? iconButton('delete', `Delete ${category.name}`, {
                    variant: 'ghost',
                    onClick: () => void (async () => {
                      try {
                        await repos.expenses.removeCategory(category.id)
                        const index = list.findIndex((entry) => entry.id === category.id)
                        if (index >= 0) list.splice(index, 1)
                        categories = categories.filter((entry) => entry.id !== category.id)
                        renderList()
                        toastSuccess('Category removed')
                      } catch (error) {
                        toastError(translateError(error).message)
                      }
                    })(),
                  })
                : null
          )
        )
      )
    }

    renderList()
    mount(dialog.body, body)
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

  mount(
    root,
    h('div', { class: 'px-3 pt-3' }, h('h1', { class: 'text-lg font-semibold text-content', text: 'Expenses' })),
    headSlot,
    listSlot
  )

  void reload()
  return root
}
