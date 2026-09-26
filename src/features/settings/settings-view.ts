/**
 * Shop settings (Phase 4).
 *
 * Business profile, receipt/device preferences, taxes and payment methods are
 * deliberately kept together. The tables already existed; this screen is the
 * missing owner workflow that makes them changeable without SQL.
 */

import { h, mount } from '../../components/ui/h'
import { button, spinner } from '../../components/ui/button'
import { badge, card, emptyState } from '../../components/ui/card'
import { checkbox, field, input, select, textarea } from '../../components/ui/input'
import { imagePicker } from '../../components/ui/image-upload'
import { modal } from '../../components/feedback/modal'
import { toastError, toastSuccess } from '../../components/feedback/toast'
import { getRepositories } from '../../app/data'
import { can } from '../../app/state/session'
import { imageUploadsEnabled, uploadImage, validateImageFile } from '../../app/images'
import { translateError } from '../../app/platform/errors'
import type { PaymentMethod, Tax } from '../../shared/types/records'

interface SettingsBag {
  receiptFooter?: string
  receiptShowLogo?: boolean
  autoPrintReceipt?: boolean
  deviceName?: string
  [key: string]: unknown
}

export function settingsView(): HTMLElement {
  const repos = getRepositories()
  let settings: Awaited<ReturnType<typeof repos.organization.getSettings>> | null = null
  let taxes: Tax[] = []
  let paymentMethods: PaymentMethod[] = []
  let loading = true

  const root = h('div', { class: 'p-3 sm:p-6' })
  const content = h('div', { class: 'mx-auto max-w-5xl space-y-4' })

  function notice(message: string): void {
    mount(content, emptyState('Settings could not be loaded', { description: message, iconName: 'error' }))
  }

  async function load(): Promise<void> {
    try {
      ;[settings, taxes, paymentMethods] = await Promise.all([
        repos.organization.getSettings(),
        repos.catalog.listAllTaxes(),
        repos.catalog.listAllPaymentMethods(),
      ])
      render()
    } catch (error) {
      notice(translateError(error).message)
    } finally {
      loading = false
    }
  }

  function render(): void {
    if (loading || !settings) {
      mount(content, h('div', { class: 'flex justify-center p-12' }, spinner()))
      return
    }
    const bag = settings.settings as SettingsBag
    const name = input({ value: settings.name })
    const currency = input({ value: settings.currency, maxlength: 3 })
    const timezone = input({ value: settings.timezone, placeholder: 'Asia/Dhaka' })
    const locale = select({
      value: settings.locale,
      options: [
        { value: 'en', label: 'English' },
        { value: 'bn', label: 'বাংলা' },
      ],
    })
    const footer = textarea({ value: typeof bag.receiptFooter === 'string' ? bag.receiptFooter : '', rows: 2, placeholder: 'Thank you for shopping with us.' })
    const deviceName = input({ value: typeof bag.deviceName === 'string' ? bag.deviceName : '', placeholder: 'Front counter' })
    const showLogo = checkbox({ label: 'Show the shop logo on receipts', checked: bag.receiptShowLogo !== false })
    const autoPrint = checkbox({ label: 'Print receipts automatically after a sale', checked: bag.autoPrintReceipt === true })
    // The logo is uploaded to ImgBB and stored as a URL, the same way product
    // photos are. Receipts and the sidebar read `logoUrl`, so one upload here
    // changes both without a second place to keep the file.
    const shopName = settings.name
    const logo = imagePicker({
      value: settings.logoUrl,
      label: `${shopName} logo`,
      previewClass: 'h-16 w-16',
      validate: (file) => validateImageFile(file),
      ...(imageUploadsEnabled()
        ? {
            upload: async (file, onProgress) => {
              const uploaded = await uploadImage(file, { name: `${shopName} logo`, onProgress })
              return { url: uploaded.url, thumbUrl: uploaded.thumbUrl }
            },
          }
        : { disabledHint: 'Set VITE_IMGBB_API_KEY to upload a logo.' }),
    })
    const saveButton = button('Save settings', { variant: 'primary', icon: 'save', disabled: !can('settings.business') })

    saveButton.addEventListener('click', () => {
      void (async () => {
        saveButton.disabled = true
        try {
          const logoUrl = await logo.commit()
          settings = await repos.organization.updateSettings({
            name: name.value.trim(),
            logoUrl,
            currency: currency.value.trim().toUpperCase(),
            timezone: timezone.value.trim(),
            locale: locale.value,
            settings: {
              ...bag,
              receiptFooter: footer.value.trim(),
              deviceName: deviceName.value.trim(),
              receiptShowLogo: Boolean(showLogo.querySelector('input')?.checked),
              autoPrintReceipt: Boolean(autoPrint.querySelector('input')?.checked),
            },
          })
          toastSuccess('Settings saved')
          render()
        } catch (error) {
          toastError(translateError(error).message)
          saveButton.disabled = false
        }
      })()
    })

    const businessCard = card(
      'Shop details',
      h('div', { class: 'grid gap-4 sm:grid-cols-2' },
        field('Shop name', name, { required: true }),
        field('Currency', currency, { required: true, hint: 'ISO 4217 code, for example BDT' }),
        field('Timezone', timezone, { required: true }),
        field('Language', locale, { required: true })
      ),
      field('Shop logo', logo.root, {
        hint: imageUploadsEnabled()
          ? 'Shown on receipts when the option below is on. Hosted on ImgBB; only the link is stored.'
          : 'Set VITE_IMGBB_API_KEY to upload a logo.',
      }),
      h('div', { class: 'mt-4 flex justify-end' }, saveButton)
    )

    const receiptCard = card(
      'Receipt and device',
      h('div', { class: 'grid gap-4 sm:grid-cols-2' },
        field('Receipt footer', footer, { hint: 'Printed below the payment summary.' }),
        field('Device name', deviceName, { hint: 'Helps identify this counter in audit entries.' })
      ),
      h('div', { class: 'mt-4 flex flex-col gap-3' }, showLogo, autoPrint)
    )

    const taxesCard = card(
      'Taxes',
      h('div', { class: 'space-y-2' },
        ...taxes.map((tax) => taxRow(tax)),
        taxes.length === 0 ? emptyState('No tax rules', { description: 'Products will be tax-free until you add a rule.', iconName: 'percent' }) : null
      ),
      can('settings.create') ? h('div', { class: 'mt-4 flex justify-end' }, button('Add tax rule', { variant: 'outline', icon: 'add', onClick: () => openTaxForm(null) })) : null
    )

    const paymentCard = card(
      'Payment methods',
      h('div', { class: 'space-y-2' },
        ...paymentMethods.map((method) => paymentRow(method)),
        paymentMethods.length === 0 ? emptyState('No payment methods', { description: 'Add a method through provisioning or the database before taking payments.', iconName: 'payments' }) : null
      )
    )

    mount(content,
      h('div', { class: 'flex flex-wrap items-end justify-between gap-3' },
        h('div', {},
          h('h1', { class: 'text-lg font-semibold text-content', text: 'Settings' }),
          h('p', { class: 'mt-1 text-sm text-content-muted', text: 'Shop details, taxes, receipts and device preferences.' })
        ),
        settings.slug ? badge(settings.slug, { tone: 'neutral' }) : null
      ),
      businessCard,
      receiptCard,
      taxesCard,
      paymentCard
    )
  }

  function taxRow(tax: Tax): HTMLElement {
    const active = badge(tax.is_active ? 'Active' : 'Off', { tone: tax.is_active ? 'success' : 'neutral' })
    return h('div', { class: 'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3' },
      h('div', {},
        h('p', { class: 'font-medium text-content', text: tax.name }),
        h('p', { class: 'text-sm text-content-muted', text: `${tax.rate}% · ${tax.is_inclusive ? 'tax included' : 'added at checkout'}` })
      ),
      h('div', { class: 'flex items-center gap-2' }, active, can('settings.edit') ? button('Edit', { variant: 'ghost', onClick: () => openTaxForm(tax) }) : null)
    )
  }

  function paymentRow(method: PaymentMethod): HTMLElement {
    const toggle = checkbox({ label: method.is_active ? 'Active' : 'Off', checked: method.is_active })
    const control = toggle.querySelector('input') as HTMLInputElement | null
    control?.addEventListener('change', () => {
      void repos.catalog.updatePaymentMethod(method.id, { is_active: control.checked }).then((updated) => {
        paymentMethods = paymentMethods.map((item) => item.id === updated.id ? updated : item)
        render()
      }).catch((error) => {
        control.checked = method.is_active
        toastError(translateError(error).message)
      })
    })
    return h('div', { class: 'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3' },
      h('div', {},
        h('p', { class: 'font-medium text-content', text: method.name }),
        h('p', { class: 'text-sm text-content-muted', text: `${method.type}${method.is_cash ? ' · cash drawer' : ''}` })
      ),
      can('settings.edit') ? toggle : badge('Read only', { tone: 'neutral' })
    )
  }

  function openTaxForm(existing: Tax | null): void {
    const name = input({ value: existing?.name ?? '', autofocus: true, placeholder: 'VAT' })
    const rate = input({ type: 'text', inputmode: 'decimal', value: existing?.rate ?? '0', placeholder: '0' })
    const inclusive = checkbox({ label: 'Price already includes this tax', checked: existing?.is_inclusive === true })
    const active = checkbox({ label: 'Use this tax for new sales', checked: existing?.is_active !== false })
    const error = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
    const save = button(existing ? 'Save tax rule' : 'Add tax rule', { variant: 'primary', fullWidth: true, size: 'lg' })
    const dialog = modal({ title: existing ? 'Edit tax rule' : 'Add tax rule', iconName: 'percent', size: 'sm', footer: [h('div', { class: 'w-full' }, save)] })
    dialog.body.replaceChildren(h('div', { class: 'space-y-4' }, field('Name', name, { required: true }), field('Rate (%)', rate, { required: true }), inclusive, active, error))
    save.addEventListener('click', () => {
      void (async () => {
        const value = Number(rate.value)
        if (!name.value.trim() || !Number.isFinite(value) || value < 0 || value > 100) {
          error.textContent = 'Enter a name and a rate between 0 and 100.'
          error.classList.remove('hidden')
          return
        }
        save.disabled = true
        try {
          const isInclusive = Boolean(inclusive.querySelector('input')?.checked)
          const isActive = Boolean(active.querySelector('input')?.checked)
          const updated = existing
            ? await repos.catalog.updateTax(existing.id, { name: name.value.trim(), rate: value, is_inclusive: isInclusive, is_active: isActive })
            : await repos.catalog.createTax(name.value.trim(), value, isInclusive)
          taxes = existing ? taxes.map((tax) => tax.id === updated.id ? updated : tax) : [...taxes, updated]
          dialog.close()
          render()
          toastSuccess(existing ? 'Tax rule updated' : 'Tax rule added')
        } catch (err) {
          error.textContent = translateError(err).message
          error.classList.remove('hidden')
          save.disabled = false
        }
      })()
    })
  }

  mount(root, content)
  void load()
  return root
}

export default settingsView
