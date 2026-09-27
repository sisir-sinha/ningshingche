/**
 * A receipt to test a printer with.
 *
 * Deliberately not a real sale, and deliberately not lorem ipsum either. It
 * carries one Bangla line and one long product name, because those are the two
 * things that go wrong: Bangla proves the printer is in image mode, and a name
 * longer than the paper proves the wrapping is right. A test page that only
 * ever printed `ABC 123` would pass on a printer that cannot serve this shop.
 */

import type { ReceiptData } from '../pos'

export function sampleReceipt(shopName = 'Mekholi'): ReceiptData {
  return {
    shopName,
    invoiceNo: 'TEST-0001',
    status: 'Sample',
    soldAt: new Date().toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    cashier: 'Test',
    customer: 'Walk-in',
    currency: 'BDT',
    lines: [
      {
        name: 'মিনিকেট চাল ৫ কেজি',
        variant: null,
        notes: ['Bangla prints only in image mode'],
        quantity: '1 ea',
        unitPrice: '৳420.00',
        lineTotal: '৳420.00',
      },
      {
        name: 'Extra long product name that has to wrap onto a second line',
        variant: 'Large',
        notes: [],
        quantity: '2 ea',
        unitPrice: '৳55.00',
        lineTotal: '৳110.00',
      },
    ],
    subtotal: '৳530.00',
    discount: '৳30.00',
    tax: '৳0.00',
    total: '৳500.00',
    paid: '৳500.00',
    change: '৳0.00',
    note: 'This is a test page — not a sale.',
  }
}
