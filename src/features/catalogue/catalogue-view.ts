/**
 * Catalogue management: categories and brands.
 *
 * The product form has a searchable inline creator for speed at the till. This
 * screen is the slower, deliberate place to review the catalogue vocabulary,
 * add defaults that were not seeded, and keep brand names consistent.
 */

import { h, mount } from '../../components/ui/h'
import { button, spinner } from '../../components/ui/button'
import { emptyState } from '../../components/ui/card'
import { field, input, select } from '../../components/ui/input'
import { modal } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { getRepositories } from '../../app/data'
import { can } from '../../app/state/session'
import { translateError } from '../../app/platform/errors'
import type { Brand, Category } from '../../shared/types/records'

type CatalogueMode = 'categories' | 'brands'

export function catalogueView(): HTMLElement {
  const repos = getRepositories()
  let mode: CatalogueMode = 'categories'
  let search = ''
  let categories: Category[] = []
  let brands: Brand[] = []
  let loading = false

  const root = h('div', { class: 'flex h-full min-h-0 flex-col p-4' })
  const listSlot = h('div', { class: 'min-h-0 flex-1 overflow-y-auto' })
  const searchInput = input({
    type: 'search',
    placeholder: 'Search…',
    onInput: (value) => {
      search = value
      renderList()
    },
  })
  const categoriesButton = button('Categories', {
    variant: 'primary',
    onClick: () => {
      mode = 'categories'
      searchInput.value = ''
      search = ''
      render()
    },
  })
  const brandsButton = button('Brands', {
    variant: 'outline',
    onClick: () => {
      mode = 'brands'
      searchInput.value = ''
      search = ''
      render()
    },
  })
  const addButton = button('Add category', {
    variant: 'primary',
    icon: 'add',
    onClick: () => openAdd(),
  })

  function render(): void {
    categoriesButton.className = categoriesButton.className
      .replace(/bg-primary|text-white|border-primary/g, '')
      .replace(/bg-surface|text-content|border-border/g, '')
    brandsButton.className = brandsButton.className
      .replace(/bg-primary|text-white|border-primary/g, '')
      .replace(/bg-surface|text-content|border-border/g, '')
    // Keep the shared button styling and only change the visual emphasis by
    // using the button variants through a small label class toggle.
    categoriesButton.classList.toggle('bg-primary', mode === 'categories')
    categoriesButton.classList.toggle('text-white', mode === 'categories')
    brandsButton.classList.toggle('bg-primary', mode === 'brands')
    brandsButton.classList.toggle('text-white', mode === 'brands')
    addButton.textContent = mode === 'categories' ? 'Add category' : 'Add brand'
    renderList()
  }

  function renderList(): void {
    if (loading) {
      mount(listSlot, h('div', { class: 'flex justify-center p-8' }, spinner()))
      return
    }
    const needle = search.trim().toLowerCase()
    if (mode === 'categories') {
      const rows = categories.filter((item) => item.name.toLowerCase().includes(needle))
      mount(
        listSlot,
        rows.length > 0
          ? h(
              'div',
              { class: 'divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface' },
              ...rows.map((item) =>
                h(
                  'div',
                  { class: 'flex min-h-14 items-center justify-between gap-3 px-4 py-3' },
                  h('div', {}, h('p', { class: 'font-medium text-content', text: item.name }), h('p', { class: 'text-xs text-content-muted', text: item.slug })),
                  h('span', { class: 'text-xs text-content-subtle', text: item.parent_id ? 'Nested' : 'Top level' })
                )
              )
            )
          : emptyState(needle ? 'No categories match' : 'No categories yet', {
              description: 'Add a category here or create one directly from the Add Product form.',
              iconName: 'category',
            })
      )
      return
    }

    const rows = brands.filter((item) => item.name.toLowerCase().includes(needle))
    mount(
      listSlot,
      rows.length > 0
        ? h(
            'div',
            { class: 'divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface' },
            ...rows.map((item) => h('div', { class: 'px-4 py-3 font-medium text-content', text: item.name }))
          )
        : emptyState(needle ? 'No brands match' : 'No brands yet', {
            description: 'Add a brand here or create one directly from the Add Product form.',
            iconName: 'sell',
          })
    )
  }

  function openAdd(): void {
    const name = input({ autofocus: true, placeholder: mode === 'categories' ? 'Beverages' : 'Samsung' })
    const parent = select({
      options: categories.map((item) => ({ value: item.id, label: item.name })),
      placeholder: 'Top-level category',
    })
    const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
    const submit = button(mode === 'categories' ? 'Add category' : 'Add brand', { variant: 'primary', fullWidth: true, size: 'lg' })
    const dialog = modal({
      title: mode === 'categories' ? 'Add category' : 'Add brand',
      subtitle: mode === 'categories' ? 'Keep your product search easy to scan.' : 'Use the name customers recognize.',
      iconName: mode === 'categories' ? 'category' : 'sell',
      size: 'sm',
      footer: [h('div', { class: 'w-full' }, submit)],
    })

    async function save(): Promise<void> {
      const clean = name.value.trim()
      if (!clean) {
        errorSlot.textContent = `${mode === 'categories' ? 'A category' : 'A brand'} needs a name.`
        errorSlot.classList.remove('hidden')
        return
      }
      submit.disabled = true
      try {
        if (mode === 'categories') {
          const created = await repos.catalog.createCategory(clean, parent.value || null)
          categories = [...categories, created].sort((a, b) => a.name.localeCompare(b.name))
          toastSuccess(`Category “${created.name}” added`)
        } else {
          const created = await repos.catalog.createBrand(clean)
          brands = [...brands, created].sort((a, b) => a.name.localeCompare(b.name))
          toastSuccess(`Brand “${created.name}” added`)
        }
        dialog.close()
        renderList()
      } catch (error) {
        errorSlot.textContent = translateError(error).message
        errorSlot.classList.remove('hidden')
        submit.disabled = false
      }
    }

    submit.addEventListener('click', () => void save())
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        void save()
      }
    })
    dialog.body.replaceChildren(
      h('div', { class: 'space-y-4' },
        field('Name', name, { required: true }),
        mode === 'categories' ? field('Parent', parent) : null,
        errorSlot
      )
    )
  }

  async function load(): Promise<void> {
    loading = true
    renderList()
    try {
      ;[categories, brands] = await Promise.all([
        repos.catalog.listCategories(),
        repos.catalog.listBrands(),
      ])
    } catch (error) {
      toastError(translateError(error).message)
    } finally {
      loading = false
      render()
    }
  }

  mount(
    root,
    h('div', { class: 'mb-4 flex flex-wrap items-end justify-between gap-3' },
      h('div', {},
        h('h1', { class: 'text-lg font-semibold text-content', text: 'Catalogue' }),
        h('p', { class: 'mt-1 text-sm text-content-muted', text: 'Manage the categories and brands used by your products.' })
      ),
      can('products.create') ? addButton : null
    ),
    h('div', { class: 'mb-3 flex flex-wrap items-center gap-2' },
      categoriesButton,
      brandsButton,
      h('div', { class: 'ml-auto w-full sm:w-64' }, searchInput)
    ),
    listSlot
  )
  void load()
  return root
}

export default catalogueView
