// imgbb — single API key for all image uploads
export const IMGBB_KEY = '1478e7888494d01f984a0f1f541b3214'
export const IMGBB_ENDPOINT = 'https://api.imgbb.com/1/upload'

/**
 * Upload a File to imgbb, returns direct URL (display_url)
 * Accepts image/* , max 32 MB (imgbb limit)
 */
export async function uploadToImgbb(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Only images allowed')
  if (file.size > 32 * 1024 * 1024) throw new Error('Image too large (max 32 MB)')
  const fd = new FormData()
  fd.append('image', file)
  // expiration optional: fd.append('expiration', '600')
  const res = await fetch(`${IMGBB_ENDPOINT}?key=${IMGBB_KEY}`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`Upload failed ${res.status}`)
  const j = await res.json().catch(() => null)
  if (!j?.success) throw new Error(j?.error?.message || 'imgbb error')
  return (j.data?.display_url || j.data?.url || j.data?.image?.url) as string
}

/**
 * Bind drag & drop + click-to-browse to a zone.
 * opts: zone = drop element, input = hidden file input, onUrl = called with uploaded url
 */
export function bindImgbbDropZone(opts: {
  zone: HTMLElement
  input: HTMLInputElement
  onFile?: (file: File) => void
  onUrl: (url: string) => void
  onProgress?: (p: 'idle'|'uploading'|'done'|'error', msg?: string) => void
}) {
  const { zone, input, onUrl, onProgress } = opts

  function setDrag(on: boolean) {
    if (on) zone.classList.add('!border-slate-900', 'dark:!border-white', '!bg-slate-50', 'dark:!bg-slate-800')
    else zone.classList.remove('!border-slate-900', 'dark:!border-white', '!bg-slate-50', 'dark:!bg-slate-800')
  }

  zone.addEventListener('click', () => input.click())
  zone.addEventListener('dragover', e => { e.preventDefault(); setDrag(true) })
  zone.addEventListener('dragenter', e => { e.preventDefault(); setDrag(true) })
  zone.addEventListener('dragleave', () => setDrag(false))
  zone.addEventListener('drop', async e => {
    e.preventDefault(); setDrag(false)
    const f = (e.dataTransfer?.files?.[0]) as File | undefined
    if (!f) return
    await handleFile(f)
  })
  input.addEventListener('change', async () => {
    const f = input.files?.[0]; if (!f) return
    await handleFile(f); input.value = ''
  })

  // paste support
  zone.addEventListener('paste', async (e: any) => {
    const f = e.clipboardData?.files?.[0]; if (f) await handleFile(f)
  })

  async function handleFile(file: File) {
    opts.onFile?.(file)
    onProgress?.('uploading', file.name)
    try {
      const url = await uploadToImgbb(file)
      onUrl(url)
      onProgress?.('done', url)
      // @ts-ignore
      window.toast?.('Image uploaded ✓')
    } catch (err: any) {
      onProgress?.('error', err?.message || 'Upload failed')
      // @ts-ignore
      window.toast?.(err?.message || 'Upload failed')
    }
  }
}
