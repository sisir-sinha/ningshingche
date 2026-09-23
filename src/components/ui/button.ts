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

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
  success: 'bg-success text-success-foreground hover:bg-success/90 shadow-sm',
  danger: 'bg-danger text-danger-foreground hover:bg-danger/90 shadow-sm',
  outline: 'border border-border bg-surface text-content hover:bg-surface-muted',
  ghost: 'text-content-muted hover:bg-surface-muted hover:text-content',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1',
  md: 'h-10 px-3.5 text-sm gap-1.5',
  lg: 'h-12 px-5 text-base gap-2',
  xl: 'h-16 px-6 text-lg gap-2.5',
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
      'inline-flex items-center justify-center rounded-md font-medium',
      'transition-colors duration-100 select-none',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
      'disabled:opacity-50 disabled:pointer-events-none',
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
  const el = button('', {
    ...rest,
    size: size ?? 'md',
    class: `${dimension} !px-0 ${extraClass}`.trim(),
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
