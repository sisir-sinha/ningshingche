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
- **a write belongs to a shop** — every write records its organization, and
  every read, every drain, and both human actions are scoped to one. A queue
  that held a sale with no owner would be a sale nobody may send
- nothing is deleted except by success, `retry` or an explicit `discard`

`SyncEngine` publishes status to the shell, re-arms exactly **one** timer
(a `setInterval` racing a slow upload is how a queue sends the same sale
twice), and exposes `retry`/`discard` for the panel a shopkeeper resolves
failures from.

### Sign-out keeps the queue

A till is shared. When the shift ends — or the session expires, or somebody
signs in to a *different* shop — the catalogue goes (the next cashier must not
be shown the previous shop's products) and the queue **stays**. Those sales are
money customers already paid: throwing them away to tidy up a session is the one
thing a shop would never forgive.

What keeps that safe is the tenancy on each write:

| on a shared till | what happens |
|---|---|
| the morning's sales, still queued | untouched, and not sent under the next session's token |
| `sales.get` for one of them | falls through to the server, which answers with whatever RLS allows — a 404 for a stranger, the row for a colleague |
| the queue panel | says how many belong to another shop, and that they will be sent when that shop signs in again |
| the sync indicator | counts them separately: `1 for another shop`, never as this shop's backlog |

The alternative — discarding on sign-out — was what the first version did, and
`offline.test.ts` now asserts the opposite: another shop's session sends only
its own sale, and the earlier one is still waiting for its own.

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
| the receipt carries money as text, so a strict client can decode it | the validator (045), `tools/e2e-http.mjs` §7 |
| queue order, offline stop, refusal handling, retry/discard | `src/shared/repositories/offline/offline.test.ts` |
| cache fallback, three-valued answers, offline paging | same file |
| drafts resume with quantities in the server's own notation | same file |
| one live timer, no re-arm after sign-out | same file |
| a sale queued by one shop is not sent by another, and its slip is not served to one | same file |
| a queued sale is announced as `sale.queued`, never as `sale.completed` | `src/features/pos/sale-service.test.ts` |
| one sale credits loyalty once, though the echo and the Realtime row carry different ids | `src/plugins/loyalty-lite/loyalty-lite.test.ts` |
| the Kotlin core's own rules: queue order, offline stop, refusal parking, retry, discard, duplicate reference = success, single-flight drain, one live timer | `npm run test:android` — 32 checks against the built jar |
| the Android client against the live project: sign-in, catalogue, sale, resend, offline queue, restart, refusal, retry | `npm run e2e:android` — 29 checks, one JVM per command |
| both clients speak the generated contract | `npm run check:clients` (offline, in `npm run check`) |

## 8. The contract the clients are written against

`contracts/api-contract.json` is generated, not written:

```
npm run contract:pull     # read the live database, rewrite the artifact
npm run contract:check    # fail if the live surface has drifted from it
npm run check:clients     # fail if either client names something it lacks
```

Every RPC with its parameter names, types and whether each may be omitted;
every relation the clients read with its columns and types. Three guards keep
it honest, and they catch different mistakes:

- **the migration validator** fails when a migration defines or changes a
  function the artifact does not describe — so the artifact cannot quietly fall
  behind the schema in the same commit that changes it
- **`contract:check`** fails on drift between the artifact and the live database
- **`check:clients`** fails when the TypeScript or the Kotlin names an RPC
  parameter or a column that is not there

It is read from the **catalogue** rather than from PostgREST's OpenAPI document
for two reasons. The `/rest/v1/` OpenAPI endpoint on this project requires a
secret API key, which build tooling must not hold (§44) — and the catalogue is
the same truth one step earlier. Reading it that way also proves something the
OpenAPI document would not: a function appears in the contract only if
`authenticated` may **execute** it, so an accidental revoke or an accidental
grant shows up as a contract change instead of as a 403 in a shop.

Plugin functions are excluded by name: they arrive with `plugin_enable` and are
reached through `public.plugin_rpc`, so they are not client API.

## 9. The Android reference

```
android/
  core/  Kotlin/JVM — no Android APIs at all
    Transport.kt  the network seam; "could not ask" vs "the server said no"
    Wire.kt       the @Serializable mirror of the contract
    Api.kt        the RPC surface, typed
    Outbox.kt     the queue, same rules as the browser's WriteQueue
    Sync.kt       connectivity, one re-armed timer, single-flight drain
    cli/Main.kt   pos | offline | sync | retry — the client, runnable
  app/   Compose shell: LoginScreen, PosScreen, PosViewModel, SQLite outbox
```

The split is the point. The risk in an Android client is the data layer, and
the data layer is plain Kotlin, so it compiles and runs anywhere a JDK does:

```
npm run android:build     # download kotlinc once, build android/core/build/mekholi-core.jar
npm run test:android      # 32 checks, about a second
npm run e2e:android       # the CLI against the live project (needs .env, .env.db)
```

`android/app` is **source-only** here because it needs the Android SDK and an
emulator, neither of which exists in this environment. It is a thin shell: the
ViewModel reads `listBranches` → `salesFloor` → `pos_catalog`, calls
`complete_sale`, and hands the receipts to a Compose screen — all of which the
core already does, which is why the core is what runs in the harness.

Two rules the Kotlin client inherits and that its tests pin: the reference is
minted **before** the first attempt, and the outbox never deletes a sale except
on success, on `retry`, or on an explicit `discard`.

## 10. What is not covered

Stated rather than implied:

- **`android/app` is not compiled by CI.** No Android SDK here. The core it
  wraps is compiled, tested and executed against the live project on every run.
- **The IndexedDB adapter has no test of its own.** `offline.test.ts` exercises
  the layer above it against the in-memory store; `indexeddb-store.ts` is
  written to the same interface and is used only from `src/app/offline.ts`.
  A browser-level test (load the built app, cut the connection with CDP, take a
  sale, restore, watch it land) would close this, and is the obvious next step
  for the offline story.
- **No emulator run.** The Kotlin client is executed as a JVM program, not on a
  device, so nothing here proves Android-specific behaviour (SQLite, the
  connectivity callback, the UI).
