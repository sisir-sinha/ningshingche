/**
 * Sign in / create shop (spec §41).
 *
 * One screen, two modes. The sign-up path collects the shop type up front
 * because it decides which plugins are recommended at provisioning — asking
 * later would mean a second onboarding pass.
 */

import { h, icon } from '../../components/ui/h'
import { button } from '../../components/ui/button'
import { input, field, select } from '../../components/ui/input'
import { signIn, signUp, type SignUpInput } from '../../app/platform/auth'
import { isConfigured } from '../../app/platform/supabase'
import taxonomy from '../../../data/shop_categories.json'

type Mode = 'signin' | 'signup'

/**
 * Mirrors data/shop_categories.json. Groups carry the bilingual label and an
 * icon; leaves carry the recommendation bundle used at provisioning.
 */
interface ShopType {
  id: string
  name: string
  name_bn: string
  parentId: string
  icon: string
  recommends?: {
    plugins?: string[]
    units?: string[]
    categories?: string[]
    paymentMethods?: string[]
    posLayout?: string
  }
}

interface ShopGroup {
  id: string
  name: string
  name_bn: string
  parentId: null
  icon: string
  children: ShopType[]
}

const GROUPS = (taxonomy as { categories: ShopGroup[] }).categories

export function loginView(options: { onAuthenticated: () => void }): HTMLElement {
  const { onAuthenticated } = options
  let mode: Mode = 'signin'

  const root = h('div', {
    class:
      'flex min-h-screen items-center justify-center bg-surface-muted p-4',
  })

  const render = (): void => {
    root.replaceChildren(mode === 'signin' ? signInCard() : signUpCard())
  }

  // ── Sign in ───────────────────────────────────────────────────────────

  function signInCard(): HTMLElement {
    const email = input({
      id: 'signin-email',
      type: 'email',
      autocomplete: 'email',
      placeholder: 'you@shop.com',
      autofocus: true,
    })
    const password = input({
      id: 'signin-password',
      type: 'password',
      autocomplete: 'current-password',
      placeholder: '••••••••',
    })
    const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
    const submit = button('Sign in', { variant: 'primary', fullWidth: true, size: 'lg' })

    const go = async (): Promise<void> => {
      if (!email.value || !password.value) {
        showError('Enter your email and password.')
        return
      }
      submit.disabled = true
      submit.textContent = 'Signing in…'
      const result = await signIn(email.value, password.value)
      if (result.ok) {
        onAuthenticated()
        return
      }
      submit.disabled = false
      submit.textContent = 'Sign in'
      showError(result.error)
    }

    const showError = (message: string): void => {
      errorSlot.textContent = message
      errorSlot.classList.remove('hidden')
    }

    submit.addEventListener('click', () => void go())
    password.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void go()
    })

    return card(
      h('h1', { class: 'text-xl font-semibold text-content', text: 'Sign in' }),
      h('p', { class: 'mt-1 text-sm text-content-muted', text: 'Welcome back to your shop.' }),
      h('div', { class: 'mt-5 space-y-4' }, field('Email', email, { required: true }), field('Password', password, { required: true })),
      errorSlot,
      h('div', { class: 'mt-5' }, submit),
      footer(() => {
        mode = 'signup'
        render()
      }, 'New here?', 'Create your shop')
    )
  }

  // ── Sign up ───────────────────────────────────────────────────────────

  function signUpCard(): HTMLElement {
    const name = input({ id: 'signup-name', autocomplete: 'name', placeholder: 'Rahim Uddin' })
    const shopName = input({ id: 'signup-shop', placeholder: 'Rahim Store' })
    const email = input({ id: 'signup-email', type: 'email', autocomplete: 'email', placeholder: 'you@shop.com' })
    const password = input({
      id: 'signup-password',
      type: 'password',
      autocomplete: 'new-password',
      placeholder: 'At least 8 characters',
    })

    const typeOptions = GROUPS.flatMap((group) =>
      group.children.map((type) => ({
        value: type.id,
        label: `${type.name_bn} · ${type.name}`,
      }))
    )
    const shopType = select({
      id: 'signup-type',
      options: typeOptions,
      placeholder: 'Choose what you sell…',
    })

    const errorSlot = h('p', { class: 'hidden text-sm text-danger', role: 'alert' })
    const submit = button('Create my shop', { variant: 'primary', fullWidth: true, size: 'lg' })

    const showError = (message: string): void => {
      errorSlot.textContent = message
      errorSlot.classList.remove('hidden')
    }

    const go = async (): Promise<void> => {
      if (password.value.length < 8) {
        showError('Password must be at least 8 characters.')
        return
      }
      if (!shopType.value) {
        showError('Choose the type of shop you run.')
        return
      }
      submit.disabled = true
      submit.textContent = 'Setting up your shop…'

      const payload: SignUpInput = {
        name: name.value,
        email: email.value,
        password: password.value,
        shopName: shopName.value,
        shopType: shopType.value,
      }
      const result = await signUp(payload)
      if (result.ok) {
        onAuthenticated()
        return
      }
      submit.disabled = false
      submit.textContent = 'Create my shop'
      showError(result.error)
    }

    submit.addEventListener('click', () => void go())

    return card(
      h('h1', { class: 'text-xl font-semibold text-content', text: 'Set up your shop' }),
      h('p', {
        class: 'mt-1 text-sm text-content-muted',
        text: 'Takes about a minute. Your stock location, register and staff roles are created for you.',
      }),
      h(
        'div',
        { class: 'mt-5 space-y-4' },
        field('Your name', name),
        field('Shop name', shopName, { required: true }),
        field('What do you sell?', shopType, {
          required: true,
          hint: 'This decides which features are recommended for you.',
        }),
        field('Email', email, { required: true }),
        field('Password', password, { required: true })
      ),
      errorSlot,
      h('div', { class: 'mt-5' }, submit),
      footer(() => {
        mode = 'signin'
        render()
      }, 'Already have a shop?', 'Sign in')
    )
  }

  render()
  return root
}

function card(...children: HTMLElement[]): HTMLElement {
  return h(
    'div',
    {
      class: 'w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm',
    },
    ...children
  )
}

function footer(switchMode: () => void, prompt: string, linkLabel: string): HTMLElement {
  return h(
    'p',
    { class: 'mt-5 text-center text-sm text-content-muted' },
    prompt,
    ' ',
    h('button', {
      type: 'button',
      class: 'font-medium text-primary hover:underline',
      text: linkLabel,
      onclick: switchMode,
    })
  )
}

/** Shown when VITE_SUPABASE_URL is absent, so the failure is legible. */
export function notConfiguredView(): HTMLElement {
  return h(
    'div',
    { class: 'flex min-h-screen items-center justify-center bg-surface-muted p-6' },
    h(
      'div',
      { class: 'max-w-md rounded-xl border border-border bg-surface p-6 text-center' },
      icon('cloud_off', 'text-4xl text-content-subtle'),
      h('h1', { class: 'mt-3 text-lg font-semibold text-content', text: 'Not connected to a server' }),
      h('p', {
        class: 'mt-2 text-sm text-content-muted',
        text:
          'Mekholi needs a Supabase project. Copy .env.example to .env, fill in ' +
          'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then run `supabase db reset` ' +
          'to create the schema.',
      }),
      h('p', {
        class: 'mt-3 text-xs text-content-subtle',
        text: isConfigured() ? '' : 'Status: no credentials found at build time.',
      })
    )
  )
}
