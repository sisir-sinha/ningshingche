/**
 * One way to say "take me to that page" from anywhere.
 *
 * The router lives in `main.ts` and reaches views through an `onNavigate`
 * prop, which is right for a view: it stays testable and it cannot navigate
 * behind its caller's back. But some things are not views. A toast raised from
 * a printer transport four layers down needs a "Printer setup" button on it,
 * and threading `onNavigate` from `main.ts` through the POS, the receipt
 * dialog and into a catch block would put a router argument on half the
 * codebase to serve one button.
 *
 * So the app registers its navigator once, here, and deep code asks for it.
 * Deliberately small:
 *
 *   - Nothing registers in a test, so `goTo` is a no-op there rather than a
 *     crash, and the caller can still assert the link was offered.
 *   - It returns whether it navigated, so a caller can fall back to plain
 *     text when there is no router (the Android wrapper, a print preview).
 *   - It is a *navigator*, not the router: no route table, no guards, no way
 *     to re-enter resolution. The smallest hole in the wall that does the job.
 */

type Navigator = (path: string) => void

let navigator: Navigator | null = null

/** Called once by `main.ts`, after the router exists. */
export function setNavigator(fn: Navigator | null): void {
  navigator = fn
}

/** True when a navigator is registered — i.e. when a link would work. */
export function canNavigate(): boolean {
  return navigator !== null
}

/**
 * Go to an in-app path. Returns false when there is no router to ask, so the
 * caller can degrade to telling the user where to go instead of pretending.
 */
export function goTo(path: string): boolean {
  if (!navigator) return false
  navigator(path)
  return true
}
