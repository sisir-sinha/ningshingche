/**
 * Image picker (spec §38 — touch first, no surprises).
 *
 * One control, used wherever the app accepts a picture: a product photo, a
 * shop logo. It shows the current image, takes a new one by click, drag or
 * camera, validates it on the device, uploads it on demand and reports
 * progress while the bytes move.
 *
 * It is business-ignorant on purpose. The uploader is injected as a function,
 * so this file never learns that ImgBB exists — the UI kit may not reach into
 * the app layer (docs/03 §3), and a future host swap touches one adapter
 * rather than every screen.
 *
 * Upload timing is the caller's choice. `upload()` is only run when asked,
 * which lets a form validate its cheap fields first and never spend a shop's
 * data on a save that was going to fail anyway.
 */

import { h, icon } from './h'
import { spinner } from './button'
import { t } from '../../shared/i18n'

/** What the injected uploader must return: at minimum, a URL to store. */
export interface ImagePickerUploadResult {
  readonly url: string
  readonly thumbUrl?: string
}

export interface ImagePickerOptions {
  /** URL already saved for this record, drawn as the starting preview. */
  value?: string | null
  /** Alt text and the name sent to the host. Defaults to "image". */
  label?: string
  /** Uploads the chosen file. Omit to render the control disabled. */
  upload?: (file: File, onProgress: (fraction: number) => void) => Promise<ImagePickerUploadResult>
  /** Local check run before any upload. Return a message to refuse the file. */
  validate?: (file: File) => string | null
  /** Shown under the control when uploading is unavailable. */
  disabledHint?: string
  /** Fires when the stored URL changes — a new upload, or a removal. */
  onChange?: (url: string | null) => void
  /** Square preview size in Tailwind units. Default `h-20 w-20`. */
  previewClass?: string
}

export interface ImagePicker {
  readonly root: HTMLElement
  /** The URL to store: the uploaded one, the original, or null if removed. */
  value(): string | null
  /** True when a file is chosen but not yet uploaded. */
  isDirty(): boolean
  /**
   * Uploads the pending file, if any, and returns the URL to store. Safe to
   * call when nothing changed: it resolves to the current value immediately.
   */
  commit(): Promise<string | null>
  /** Cancels an upload in flight and drops the pending file. */
  reset(): void
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'

export function imagePicker(options: ImagePickerOptions = {}): ImagePicker {
  const previewClass = options.previewClass ?? 'h-20 w-20'
  const canUpload = typeof options.upload === 'function'

  let storedUrl: string | null = options.value ?? null
  let pending: File | null = null
  let objectUrl: string | null = null
  let uploading = false

  const fileInput = h('input', {
    type: 'file',
    accept: ACCEPT,
    class: 'sr-only',
  }) as HTMLInputElement

  const previewImage = h('img', {
    alt: options.label ?? 'Image preview',
    class: `${previewClass} rounded-md object-cover border border-border bg-surface-muted`,
  }) as HTMLImageElement

  const placeholder = h(
    'div',
    {
      class: `${previewClass} grid place-items-center rounded-md border border-dashed border-border bg-surface-muted text-content-subtle`,
    },
    icon('add_photo_alternate', 'text-2xl')
  )

  const previewSlot = h('div', { class: 'shrink-0' }, placeholder)

  const chooseButton = h(
    'button',
    {
      type: 'button',
      class:
        'inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-content hover:bg-surface-muted disabled:opacity-50',
      disabled: !canUpload,
    },
    icon('upload', 'text-lg'),
    h('span', { text: t('common.chooseImage') })
  ) as HTMLButtonElement

  const removeButton = h(
    'button',
    {
      type: 'button',
      class: 'inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-sm text-danger hover:bg-danger/10 hidden',
    },
    icon('delete', 'text-lg'),
    h('span', { text: t('common.remove') })
  ) as HTMLButtonElement

  const fileName = h('p', { class: 'text-xs text-content-subtle truncate' })
  const errorSlot = h('p', { class: 'text-xs text-danger hidden' })
  const hintSlot = h('p', {
    class: 'text-xs text-content-subtle',
    text: canUpload ? 'PNG, JPG, WEBP or GIF · up to 10 MB' : options.disabledHint ?? 'Image uploads are switched off.',
  })

  const progressBar = h('div', { class: 'h-1.5 rounded-full bg-primary transition-all', style: { width: '0%' } })
  const progressTrack = h('div', { class: 'h-1.5 w-full rounded-full bg-surface-muted hidden' }, progressBar)
  const busyLabel = h('span', { class: 'inline-flex items-center gap-1.5 text-xs text-content-muted hidden' }, spinner('h-3 w-3'), h('span', { text: t('common.uploading') }))

  const dropZone = h(
    'div',
    {
      class:
        'flex items-start gap-3 rounded-lg border border-transparent p-2 -m-2 transition-colors',
    },
    previewSlot,
    h(
      'div',
      { class: 'min-w-0 flex-1 space-y-1.5' },
      h('div', { class: 'flex flex-wrap items-center gap-1' }, chooseButton, removeButton, busyLabel),
      fileName,
      progressTrack,
      hintSlot,
      errorSlot
    ),
    fileInput
  )

  // ── Drawing ─────────────────────────────────────────────────────────────

  function showError(message: string | null): void {
    errorSlot.textContent = message ?? ''
    errorSlot.classList.toggle('hidden', !message)
  }

  function releaseObjectUrl(): void {
    if (objectUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }

  function drawPreview(src: string | null): void {
    if (!src) {
      previewSlot.replaceChildren(placeholder)
      removeButton.classList.add('hidden')
      return
    }
    previewImage.src = src
    previewSlot.replaceChildren(previewImage)
    removeButton.classList.remove('hidden')
  }

  function setProgress(fraction: number): void {
    progressTrack.classList.remove('hidden')
    progressBar.style.width = `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`
  }

  function setBusy(next: boolean): void {
    uploading = next
    chooseButton.disabled = next || !canUpload
    removeButton.disabled = next
    busyLabel.classList.toggle('hidden', !next)
    if (!next) progressTrack.classList.add('hidden')
  }

  // ── Selection ───────────────────────────────────────────────────────────

  function accept(file: File | null | undefined): void {
    if (!file || uploading) return
    const problem = options.validate?.(file) ?? null
    if (problem) {
      showError(problem)
      return
    }
    showError(null)
    releaseObjectUrl()
    pending = file
    fileName.textContent = file.name
    objectUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null
    drawPreview(objectUrl ?? storedUrl)
  }

  chooseButton.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => accept(fileInput.files?.[0]))

  removeButton.addEventListener('click', () => {
    releaseObjectUrl()
    pending = null
    storedUrl = null
    fileInput.value = ''
    fileName.textContent = ''
    showError(null)
    drawPreview(null)
    options.onChange?.(null)
  })

  // Drag and drop, because a desktop owner cataloguing fifty products should
  // not open a file dialog fifty times.
  for (const event of ['dragenter', 'dragover'] as const) {
    dropZone.addEventListener(event, (e) => {
      if (!canUpload) return
      e.preventDefault()
      dropZone.classList.add('border-primary', 'bg-primary/5')
    })
  }
  for (const event of ['dragleave', 'drop'] as const) {
    dropZone.addEventListener(event, (e) => {
      e.preventDefault()
      dropZone.classList.remove('border-primary', 'bg-primary/5')
    })
  }
  dropZone.addEventListener('drop', (e) => {
    if (!canUpload) return
    accept((e as DragEvent).dataTransfer?.files?.[0])
  })

  drawPreview(storedUrl)

  // ── Commit ──────────────────────────────────────────────────────────────

  async function commit(): Promise<string | null> {
    if (!pending || !options.upload) return storedUrl
    setBusy(true)
    setProgress(0.02)
    try {
      const result = await options.upload(pending, setProgress)
      storedUrl = result.url
      pending = null
      fileInput.value = ''
      releaseObjectUrl()
      drawPreview(storedUrl)
      options.onChange?.(storedUrl)
      return storedUrl
    } finally {
      setBusy(false)
    }
  }

  return {
    root: dropZone,
    value: () => storedUrl,
    isDirty: () => pending !== null,
    commit,
    reset(): void {
      releaseObjectUrl()
      pending = null
      fileInput.value = ''
      fileName.textContent = ''
      showError(null)
      setBusy(false)
      drawPreview(storedUrl)
    },
  }
}
