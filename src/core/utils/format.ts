export function formatBDT(n: number): string {
  return '৳' + n.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function formatInt(n: number): string { return n.toLocaleString('en-BD') }
export function groupDigits(phone: string): string { return phone }
