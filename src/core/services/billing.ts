export type CartItem = { id: string; product_id: string; name: string; unit: string; price: number; vat_rate: number; qty: number; cost_price?: number }

export function calcTotals(items: CartItem[], discount: number, discountType: 'amount'|'percent', defaultVatRate = 0) {
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0)
  let discountAmount = 0
  if (discountType === 'percent') discountAmount = Math.round((subtotal * discount) / 100 * 100) / 100
  else discountAmount = Math.min(discount, subtotal)
  const afterDiscount = Math.max(0, subtotal - discountAmount)
  // distribute discount proportionally for VAT per line
  const vat = items.reduce((sum, it) => {
    const line = it.price * it.qty
    const lineDiscount = subtotal > 0 ? (line / subtotal) * discountAmount : 0
    const taxable = Math.max(0, line - lineDiscount)
    const rate = (it.vat_rate ?? defaultVatRate) / 100
    return sum + taxable * rate
  }, 0)
  const vatRounded = Math.round(vat * 100) / 100
  const total = Math.round((afterDiscount + vatRounded) * 100) / 100
  return { subtotal: Math.round(subtotal*100)/100, discountAmount: Math.round(discountAmount*100)/100, vat: vatRounded, total }
}
