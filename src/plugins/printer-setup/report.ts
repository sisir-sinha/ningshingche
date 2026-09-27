/**
 * Reporting a print failure, from the page that fixes it.
 *
 * The core has a version of this that offers a link to Printer setup. Here
 * that link would point at the screen the shopkeeper is already standing on,
 * so this one just says what happened. A plugin may not import a feature
 * anyway (spec §51) — and the fact that the useful part of the core helper is
 * the link, which is useless here, is a decent sign the duplication is real
 * rather than laziness.
 */

import { toastError } from '../../components/feedback/toast'

export function reportPrintFailure(error: unknown, fallback = 'The printer did not answer.'): void {
  toastError(error instanceof Error ? error.message : fallback)
}
