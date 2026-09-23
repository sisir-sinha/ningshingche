// Base-aware URL helper for GitHub Pages project site (/Mekholi/) vs root (/)
export function getBase(): string {
  try{
    const b: any = (import.meta as any)?.env?.BASE_URL
    if(typeof b === 'string' && b && b !== '/') return b.endsWith('/') ? b : b + '/'
  }catch{}
  return '/'
}
export function withoutBase(path: string): string {
  const base = getBase()
  if(base === '/' ) return path
  if(path === base.slice(0,-1)) return '/'
  if(path.startsWith(base)) {
    const stripped = path.slice(base.length - 1)
    return stripped || '/'
  }
  return path
}
export function withBase(path: string): string {
  const base = getBase()
  if(base === '/' ) return path
  if(path.startsWith(base)) return path
  const cleanBase = base.replace(/\/$/, '')
  return cleanBase + (path.startsWith('/') ? path : '/' + path)
}
export function hardNavigate(path: string){
  location.href = withBase(path)
}
