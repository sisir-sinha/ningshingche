# 12 — Offline operation and Android readiness

Phase 8. The requirement is narrow and unforgiving:

> The POS completes sales with the network disabled, queues them, and replays
> without duplicates or negative stock on reconnect.

Everything below exists to make that sentence true, and every claim in it is
asserted somewhere a machine runs.

---

## 1. The seam

Features talk to repository **contracts** (`src/shared/repositories/contracts`),
never to PostgREST. That was a Phase 2 decision for the sake of Android (§43);
it is what makes offline additive rather than a second app.

```
features ──▶ Repositories ──┬─▶ createSupabaseRepositories   (network)
                            └─▶ createOfflineRepositories    (this layer)
                                     ├─ catalog-cache   read-through + warm
                                     ├─ writes queue    serial, replayable
                                     └─ drafts          held carts on device
```

`src/app/data.ts` is the only place either is constructed. It hands out
`getRepositories()`, which is the *offline-wrapped* surface once a session
exists, and `rawRepositories()` for the sync engine — the engine must send
through the unwrapped sale repository, because a queue that re-queues its own
retries never drains.

## 2. Exactly once, and why the reference exists

A request can time out **after** the server committed. The till cannot tell
that apart from "the server never saw it", so a naive retry sells twice.

So the client mints `client_ref` before its **first** attempt
(`WriteQueue.enqueue` mints it once; `id` and `ref` are the same string, and it
is never regenerated), and sends it as `p_client_ref` on every attempt.

Migration 044 makes the server honour it:

| piece | what it does |
|---|---|
| `sales.client_ref text` | the device's identity for the sale |
| partial unique index `(organization_id, client_ref) where client_ref is not null` | one sale per reference, per shop |
| `complete_sale(… , p_client_ref text default null)` | **after** `require_org` + `require_permission('sales.create')`, looks the reference up and returns the stored receipt instead of writing a second sale |

The lookup is *after* the permission checks on purpose: a replay must not be a
way to read a sale you are not allowed to read. And `23505` (the unique index
firing under a genuine race between two devices) is treated as **success** by
`createSaleSender` — the sale exists, which is exactly what the queue wanted.

`client_ref` is `null` for sales taken online. Nothing else in the schema
changes shape because of offline.

## 3. Conflict policy

Written down rather than discovered, because "last write wins" is not a policy:

| conflict | winner | why |
|---|---|---|
| stock | **server** | the till never writes stock offline; `complete_sale` locks the balance row and re-reads it, so overselling is impossible even online |
| prices, totals, invoice numbers | **server** | the till's arithmetic is for the slip and the screen; the stored sale is the priced one |
| held carts | **client** | a parked cart is one device's intention, and it survives a reload because it lives in IndexedDB |
| refusals | **server** | a sale the server refuses is kept, marked `failed`, and shown to a person — never retried in a loop |
| reads it cannot answer | **nobody** | reports, refunds and stock takes fail loudly offline (`offline/index.ts` documents the surface) |

## 4. What the cache may and may not say

`catalog-cache.ts` is read-through, and its fallback is **three-valued**:

| fallback answers | meaning |
|---|---|
| a value | the cache answers this |
| `null` | the cache's answer is *nothing here* — a barcode the shop does not stock |
| `undefined` | the cache cannot answer, so the original error is re-thrown |

That distinction is the difference between "we do not sell that" and "I cannot
tell you". An empty category list, or an empty catalogue, would be a much worse
lie than an error message. Offline paging is offsets over a stable sorted
snapshot, because a cursor is only honest if the order it walks is stable.

## 5. The queue

`WriteQueue` keeps every write in the store (`outbox` bucket) and its rules are
small enough to state completely:

- **serial, oldest first** — one send in flight, and a sale that cannot be sent
  does not let later sales overtake it (invoice order is not negotiable)
- **`offline`** — keep the write, record the attempt, stop the drain
- **`refused`** — mark it `failed` with the server's own words, keep going
- **success** — delete it; the server owns that sale now
- nothing is deleted except by success, `retry` or an explicit `discard`

`SyncEngine` publishes status to the shell, re-arms exactly **one** timer
(a `setInterval` racing a slow upload is how a queue sends the same sale
twice), and exposes `retry`/`discard` for the panel a shopkeeper resolves
failures from.

## 6. What the shop sees

`features/layout/sync-indicator.ts` replaced a chip that read
`navigator.onLine` and printed "Online" — a claim the browser cannot make (a
captive portal says online) and one that said nothing about the queue. It now
reports what is **known**: sales waiting, a send in flight, sales refused.
Refused ones open the queue panel, where each can be retried or discarded, and
discarding asks first and says in words what is being thrown away.

A sale taken offline prints a slip labelled `Not yet numbered` carrying the last
six characters of its reference. The customer keeps that; the shop matches it to
the stored sale when the connection returns. The slip's money is the cart's own
arithmetic — the same `computeTotals` that drew the total on screen — and
nothing else.

## 7. How it is proven

| claim | where it is asserted |
|---|---|
| a reference sent twice is one sale, stock moves once | `tools/validate-migrations.mjs` → real Postgres (PGlite), migration 044 |
| the same, over real HTTP with a real token | `tools/e2e-http.mjs` §9c → the live project |
| a cross-tenant replay is refused | both of the above |
| queue order, offline stop, refusal handling, retry/discard | `src/shared/repositories/offline/offline.test.ts` |
| cache fallback, three-valued answers, offline paging | same file |
| drafts resume with quantities in the server's own notation | same file |
| one live timer, no re-arm after sign-out | same file |

## 8. Still open in Phase 8

- **OpenAPI / typed contract for the RPC surface** — PostgREST publishes the
  schema; a generated, checked-in artifact would let the Android client be
  written against types rather than docs. Not built yet.
- **Android reference (login + POS against the same RPCs)** — the readiness is
  in place (contracts, no service-role key, RLS-mandatory, exactly-once
  writes), the reference app is not.
