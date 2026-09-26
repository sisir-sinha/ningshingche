/**
 * Buttons (spec §38, §39).
 *
 * Touch targets are 44px minimum — this runs on a shop counter tablet, not a
 * laptop. The `size` scale exists so the POS keypad can be large while a
 * table row action stays compact.
 */

import { h, icon } from './h'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

/**
 * Variants.
 *
 * Every solid variant hovers to its own darker `-strong` token rather than to
 * `/90` of itself. That was the flaw in the old set: `bg-primary/90` is the
 * same colour at 90% opacity, so a hovered button blended with whatever panel
 * it sat on — grey over grey on the POS, washed out on white elsewhere — and
 * the label's contrast moved with it.
 *
 * The press state is a colour change too, not only a transform: on a
 * touchscreen the 2% scale is invisible under a thumb.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground shadow-sm hover:bg-primary-strong active:bg-primary-strong',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-secondary-strong active:bg-secondary-strong',
  success:
    'bg-success text-success-foreground shadow-sm hover:bg-success-strong active:bg-success-strong',
  danger:
    'bg-danger text-danger-foreground shadow-sm hover:bg-danger-strong active:bg-danger-strong',
  outline:
    'border border-border bg-surface text-content hover:border-ring/60 hover:bg-surface-muted active:bg-secondary-strong',
  ghost: 'text-content-muted hover:bg-secondary hover:text-content active:bg-secondary-strong',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1 rounded-md',
  md: 'h-10 px-4 text-sm gap-1.5 rounded-md',
  lg: 'h-12 px-5 text-[0.9375rem] gap-2 rounded-lg',
  // The Pay button. Big enough to hit without looking, and set in a size a
  // cashier reads from standing height.
  xl: 'h-16 px-6 text-lg gap-2.5 rounded-lg tracking-tight',
}

/**
 * Deliberately not `extends Attrs`: an index signature would widen every
 * destructured field to a union and defeat the point of naming the variants.
 */
export interface ButtonOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Material Symbols ligature. Omit for a text-only button. */
  icon?: string
  /** Trailing icon, e.g. a chevron on a split button. */
  trailingIcon?: string
  loading?: boolean
  fullWidth?: boolean
  type?: 'button' | 'submit' | 'reset'
  onClick?: (event: MouseEvent) => void
  disabled?: boolean
  class?: string
  id?: string
  title?: string
  ariaLabel?: string
}

export function button(label: string, options: ButtonOptions = {}): HTMLButtonElement {
  const {
    variant = 'secondary',
    size = 'md',
    icon: iconName,
    trailingIcon,
    loading = false,
    fullWidth = false,
    type = 'button',
    onClick,
    class: extraClass = '',
    disabled,
    id,
    title,
    ariaLabel,
  } = options

  const el = h('button', {
    type,
    id,
    title,
    'aria-label': ariaLabel,
    class: [
      // `font-semibold`, not `medium`: at 13–15px on a lit counter screen the
      // old weight read as disabled text next to the panels around it.
      'inline-flex items-center justify-center font-semibold leading-none',
      'transition-colors duration-100 select-none whitespace-nowrap',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
      'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:pointer-events-none',
      'active:scale-[0.98]',
      VARIANTS[variant],
      SIZES[size],
      fullWidth ? 'w-full' : '',
      extraClass,
    ]
      .filter(Boolean)
      .join(' '),
    disabled: disabled === true || loading,
    'aria-busy': loading ? 'true' : null,
  })

  if (onClick) el.addEventListener('click', onClick)

  if (loading) {
    el.appendChild(spinner())
  } else if (iconName) {
    el.appendChild(icon(iconName, size === 'xl' ? 'text-2xl' : size === 'sm' ? 'text-base' : 'text-lg'))
  }

  if (label) el.appendChild(h('span', { text: label }))

  if (trailingIcon) {
    el.appendChild(icon(trailingIcon, 'text-base opacity-70'))
  }

  return el
}

/** Icon-only button. `label` is used as the accessible name, not rendered. */
export function iconButton(
  iconName: string,
  label: string,
  options: Omit<ButtonOptions, 'icon' | 'trailingIcon' | 'ariaLabel'> = {}
): HTMLButtonElement {
  const { size = 'md', class: extraClass = '', ...rest } = options
  const dimension = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10'
  // Icon buttons are circles at every size: a square 32px ghost button next to
  // text reads as a broken input, a round one reads as an action.
  const el = button('', {
    ...rest,
    size: size ?? 'md',
    class: `${dimension} !rounded-full !px-0 ${extraClass}`.trim(),
    ariaLabel: label,
    title: label,
  })
  el.appendChild(icon(iconName, size === 'lg' ? 'text-2xl' : 'text-lg'))
  return el
}

export function spinner(className = 'h-4 w-4'): HTMLSpanElement {
  return h('span', {
    class: `${className} inline-block animate-spin rounded-full border-2 border-current border-t-transparent`,
    'aria-hidden': 'true',
  })
}
