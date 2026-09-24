/**
 * Onboarding (spec §40): the account exists, the shop does not.
 *
 * Every path that can land a user here — a signup whose provisioning step
 * failed, an OAuth sign-in for a brand-new Google account, an invite created
 * before its shop — gets the same recovery: name the shop, pick what it
 * sells, and `provision_organization` builds branch, stock location,
 * register, roles, units and payment methods in one server-side step.
 *
 * This screen used to be a dead end ("sign out and start again"), which
 * meant an account with no organization could never get one without
 * database surgery.
 */

import { h } from '../../components/ui/h'
import { button } from '../../components/ui/button'
import { input, select, field } from '../../components/ui/input'
import { provisionShop } from '../../app/platform/auth'
import { bindDrafts, clearDraft } from '../../app/state/drafts'
import taxonomy from '../../../data/shop_categories.json'

interface ShopType {
  id: string
  name: string
  name_bn: string
  parentId: string
}

interface ShopGroup {
  id: string
  name: string
  name_bn: string
  parentId: null
  children: ShopType[]
}

const GROUPS = (taxonomy as { categories: ShopGroup[] }).categories

export interface OnboardingViewOptions {
  /** Called after the shop exists and the session payload has refreshed. */
  onDone: () => void
}

export function onboardingView(options: OnboardingViewOptions): HTMLElement {
  const shopName = input({ id: 'onboard-shop', placeholder: 'Rahim Store', autofocus: true })
  const shopType = select({
    id: 'onboard-type',
    options: GROUPS.flatMap((group) =>
      group.children.map((type) => ({ value: type.id, label: `${type.name_bn} · ${type.name}` }))
    ),
    placeholder: 'Choose what you sell…',
  })
  const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
  const submit = button('Create my shop', { variant: 'primary', fullWidth: true, size: 'lg' })

  const showError = (message: string): void => {
    errorSlot.textContent = message
    errorSlot.classList.remove('hidden')
  }

  const go = async (): Promise<void> => {
    errorSlot.classList.add('hidden')
    if (!shopName.value.trim()) {
      showError('Your shop needs a name.')
      return
    }
    if (!shopType.value) {
      showError('Choose the type of shop you run.')
      return
    }
    submit.disabled = true
    submit.textContent = 'Setting up your shop…'

    const result = await provisionShop({
      shopName: shopName.value,
      shopType: shopType.value,
    })
    if (result.ok) {
      clearDraft('onboarding.shop')
      options.onDone()
      return
    }
    submit.disabled = false
    submit.textContent = 'Create my shop'
    showError(result.error)
  }

  submit.addEventListener('click', () => void go())
  shopName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void go()
  })

  const el = h(
    'div',
    {
      // Centred in the space under the topbar rather than pinned to the top:
      // on a 6" phone a short form floating above half a screen of nothing
      // reads as a broken page. dvh, not vh — mobile browser chrome moves.
      class:
        'mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-md ' +
        'items-center justify-center p-4 sm:p-6',
    },
    h(
      'div',
      { class: 'rounded-xl border border-border bg-surface p-6 shadow-sm' },
      h('h1', { class: 'text-xl font-semibold text-content', text: 'Create your shop' }),
      h('p', {
        class: 'mt-1 text-sm text-content-muted',
        text:
          'Your account is ready but has no shop yet. This creates your branch, ' +
          'stock location, register and staff roles in one step.',
      }),
      h(
        'div',
        { class: 'mt-5 space-y-4' },
        field('Shop name', shopName, { required: true }),
        field('What do you sell?', shopType, {
          required: true,
          hint: 'This decides which features are recommended for you.',
        }),
      ),
      errorSlot,
      h('div', { class: 'mt-5' }, submit)
    )
  )

  bindDrafts(el, 'onboarding.shop')
  return el
}
