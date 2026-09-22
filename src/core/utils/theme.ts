// Theme: dark / light toggle — persisted, class on <html>
export type Theme = 'light' | 'dark'

export function getTheme(): Theme {
  const saved = localStorage.getItem('mekholi-theme') as Theme | null
  if (saved === 'light' || saved === 'dark') return saved
  // system preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
  // also set color-scheme for native inputs
  root.style.colorScheme = t
}

export function setTheme(t: Theme) {
  localStorage.setItem('mekholi-theme', t)
  applyTheme(t)
  window.dispatchEvent(new CustomEvent('mk:theme', { detail: t }))
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark')
}

export function initTheme() {
  applyTheme(getTheme())
  // watch system changes if no explicit choice
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('mekholi-theme')) applyTheme(e.matches ? 'dark' : 'light')
  })
}
