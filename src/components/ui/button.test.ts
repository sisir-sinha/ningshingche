/**
 * Buttons: colour, weight, and the states a thumb can feel.
 *
 * @vitest-environment jsdom
 *
 * Two things were wrong and both are pinned here.
 *
 * 1. Every solid variant hovered to `bg-<colour>/90` — the same colour at 90%
 *    opacity. That is translucency, not a shade: a hovered button took on the
 *    panel behind it, which on the POS's grey rail looked washed out and on
 *    white looked like nothing happened. Hover now goes to a real `-strong`
 *    token.
 * 2. Labels were `font-medium` at 13px, which next to the app's own body text
 *    read as disabled. They are `font-semibold` now.
 */

import { describe, it, expect } from 'vitest'
import { button, iconButton } from './button'

const classesOf = (el: HTMLElement): string => el.className

describe('button colour', () => {
  it('hovers to a real darker colour, never to translucency', () => {
    for (const variant of ['primary', 'success', 'danger'] as const) {
      const el = button('Pay', { variant })
      expect(classesOf(el)).toContain(`hover:bg-${variant}-strong`)
      expect(classesOf(el)).not.toContain(`hover:bg-${variant}/90`)
    }
  })

  it('presses to the darker colour as well as scaling', () => {
    const el = button('Pay', { variant: 'primary' })
    expect(classesOf(el)).toContain('active:bg-primary-strong')
    expect(classesOf(el)).toContain('active:scale-[0.98]')
  })

  it('gives every variant its own foreground, so the label is never guessed', () => {
    expect(classesOf(button('a', { variant: 'primary' }))).toContain('text-primary-foreground')
    expect(classesOf(button('a', { variant: 'success' }))).toContain('text-success-foreground')
    expect(classesOf(button('a', { variant: 'danger' }))).toContain('text-danger-foreground')
    expect(classesOf(button('a', { variant: 'outline' }))).toContain('text-content')
  })
})

describe('button text', () => {
  it('sets labels in semibold, not medium', () => {
    const el = button('Save settings')
    expect(classesOf(el)).toContain('font-semibold')
    expect(classesOf(el)).not.toContain('font-medium')
  })

  it('keeps a label on one line', () => {
    expect(classesOf(button('Add tax rule'))).toContain('whitespace-nowrap')
  })

  it('renders the label as text, with the icon before it', () => {
    const el = button('Pay', { icon: 'payments' })
    expect(el.textContent).toContain('Pay')
    expect(el.firstElementChild?.className).toContain('material-symbols-rounded')
  })
})

describe('button states', () => {
  it('shows a disabled button as unavailable, not merely faded', () => {
    const el = button('Pay', { disabled: true })
    expect(el.disabled).toBe(true)
    expect(classesOf(el)).toContain('disabled:cursor-not-allowed')
    expect(classesOf(el)).toContain('disabled:opacity-45')
    expect(classesOf(el)).toContain('disabled:shadow-none')
  })

  it('disables itself while loading, and says so to a screen reader', () => {
    const el = button('Saving', { loading: true })
    expect(el.disabled).toBe(true)
    expect(el.getAttribute('aria-busy')).toBe('true')
  })

  it('keeps a visible focus ring clear of the button edge', () => {
    expect(classesOf(button('a'))).toContain('focus-visible:ring-offset-2')
  })
})

describe('button size', () => {
  it('meets the 44px tap target at the sizes a counter uses', () => {
    expect(classesOf(button('Hold', { size: 'lg' }))).toContain('h-12')
    expect(classesOf(button('Pay', { size: 'xl' }))).toContain('h-16')
  })

  it('rounds the large sizes more than the dense ones', () => {
    expect(classesOf(button('Pay', { size: 'xl' }))).toContain('rounded-lg')
    expect(classesOf(button('Edit', { size: 'sm' }))).toContain('rounded-md')
  })
})

describe('icon buttons', () => {
  it('are circular and square-sided, with the label as their accessible name', () => {
    const el = iconButton('delete', 'Remove line', { size: 'sm' })
    expect(classesOf(el)).toContain('!rounded-full')
    expect(classesOf(el)).toContain('h-8 w-8')
    expect(el.getAttribute('aria-label')).toBe('Remove line')
    // The label is the accessible name, not visible text beside the glyph.
    expect(el.textContent).toBe('delete')
  })
})
