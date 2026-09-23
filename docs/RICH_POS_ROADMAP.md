# Mekholi Rich POS — Comprehensive Enhancement Roadmap

User request: **Make system more rich — everything enhanced.**
Strategy: 5 sprints, each shippable, vanilla TS + Supabase contract preserved.

## Sprint 1 — POS Billing Rich (NOW — in progress)
**Goal:** Cashier can sell in <10s with any payment mix, with printer + drawer.
- [ ] Numpad touch + keyboard shortcuts (F2 New, F4 Hold, F8 Pay, F9 Customer, Esc Clear, +/- qty)
- [ ] Per-item edit: discount %/৳, VAT override, price override, note
- [ ] Global quick discounts 5%/10%/15% + coupon
- [ ] Multiple holds (named, timestamped list, up to 10, localStorage + IndexedDB)
- [ ] Split payment UI (cash + bKash + card + due mix, auto due calc)
- [ ] Cash drawer kick (WebUSB ESC/POS 0x1B 0x70) + open drawer log
- [ ] Receipt 2.0: logo, BIN, Mushak 6.3 footer, Marathi? Bangla bitmap, ESC/POS preview + print + PDF
- [ ] Barcode: beep sound, continuous scan, manual entry fallback
- [ ] Customer due guard: show due before sale, credit limit warning, block if > limit
- [ ] Return/exchange entry point from POS

## Sprint 2 — Inventory & Purchase
- [ ] Variants (size/color), batch/serial/IMEI, expiry date, warranty
- [ ] Suppliers CRUD + due ledger (linked to khata_entries)
- [ ] Purchase Orders: GRN, cost_price auto-update, stock + on purchase_items trigger
- [ ] Stock ops: adjustment (damage/lost), transfer between stores (future multi-store), count sheet
- [ ] Low-stock automation: badge ≤ threshold (per product low_stock_alert), reorder suggestion, purchase draft
- [ ] Barcode label print 30×20mm

## Sprint 3 — Khata & CRM Rich
- [ ] Customer ledger: timeline Dolam/Pelam, balance graph, due aging (0-30/30-60/60+)
- [ ] Collection dashboard: due by customer, total due, overdue, quick SMS/WhatsApp bulk Tagada
- [ ] Auto SMS schedule (Edge Function) + SMS sent log
- [ ] Loyalty points (optional) + credit limit per customer
- [ ] Supplier Khata same

## Sprint 4 — Reports & Compliance
- [ ] Daily/Monthly sales, profit (sales-cost-expenses), payment mix, hourly heatmap
- [ ] VAT: profiles per category, Mushak 6.3 print, 6.1/6.2/9.1 & 6.10 >2L export
- [ ] Staff performance: sales per cashier
- [ ] Export: PDF (jsPDF) + Excel (xlsx) + print
- [ ] Cash drawer logs: open/close/expected/actual/difference

## Sprint 5 — Roles, Settings, Offline
- [ ] Roles: owner (all), manager (no settings/users), cashier (POS only) — RLS + UI guard
- [ ] Settings: receipt template (header/footer/QR), printer (58/80mm, WebUSB/WebBluetooth), tax profiles, language ৳
- [ ] Backup: IndexedDB → Supabase sync status, conflict resolution (client_uuid), retry queue
- [ ] PWA install, offline banner, outbox count

---

## Implementation notes
- Keep `History API`, `Tailwind + FA6 Pro + Material`, `Vanilla TS`, `Supabase RLS = current_store_id()`
- Every POS change queues to `idb.outbox` if offline → `trySync()` auto
- Dark/white: every card `dark:bg-slate-900 dark:border-slate-800`
- Guard: `requireAuth()` on /app/*, `redirectIfAuthed()` on /login

**Current sprint branch:** `main` — first PR is POS Billing Rich.
