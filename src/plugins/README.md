# The plugins this bundle ships

Six plugins live here. Between them they use every part of the SDK, which is
why they are also its worked example — `docs/11-plugin-sdk.md` is the guide, and
these are what it looks like when someone follows it.

| Plugin | What it adds | Plugin surface |
| --- | --- | --- |
| [`variants`](variants/) | Options and the combinations built from them — Colour: Red, Blue × Size: S, M, L — with per-variant price, cost, SKU and stock | 2 permissions, nav + screen, dashboard widget, product-form section, a generator and an options screen the plugin owns |
| [`batch-expiry`](batch-expiry/) | Batch numbers and expiry dates on products, with a screen listing what is about to expire | 2 product fields (shown on the till and printed on receipts), 1 permission, nav + screen, dashboard widget, product-form section, a report in the core Reports screen |
| [`loyalty-lite`](loyalty-lite/) | Points per taka spent, a balance on the sale, and who has earned what | 2 permissions, nav + screen, dashboard widget, POS panel, sale tab, an event listener that awards points automatically |
| [`serial-numbers`](serial-numbers/) | The unit, not the product: which handset left on which invoice, and which one came back | 2 permissions, nav + screen (badge), dashboard widget, POS panel, sale tab, product-form section, 2 reports, `sale.completed` and `sale.refunded` listeners |
| [`warranty`](warranty/) | The promise a sale makes: which unit, until when, to whom — and what honouring the promises cost | 2 permissions, nav + screen (badge), dashboard widget, POS panel, sale tab, product-form section, one product field the taxonomy promotes, 2 reports, a `sale.completed` listener that writes the promises |
| [`weight-scale`](weight-scale/) | The shop's own scale labels: the till reads 1.250 kg off a barcode the catalogue has never heard of, and the shop sees which items its scale cannot ring up at all | 2 permissions, nav + screen, dashboard widget, 2 reports, one **scan resolver** — and no table and no product field: the price, the unit and the code all stay the catalogue's |

None of them imports another, and none imports anything from `src/features/` —
`tools/check-boundaries.mjs` fails the build if that changes. Loyalty needs
batch-expiry? It says so in `dependencies`, and the host loads the dependency
first. That is the whole point: **adding a plugin never means editing a feature**
(spec §51).

Reports are the clearest example of that rule. `registerReport` takes rows, not
an element, and the core Reports screen renders and exports them through the
same path as its own eleven — so a pharmacy's “Expiring stock” is a worksheet a
shopkeeper can sort, print and export, and no plugin carries a second table
implementation that drifts from the first.

## Reading order

1. `batch-expiry/manifest.ts` — the smallest complete manifest: one permission,
   one setting, one page.
2. `batch-expiry/index.ts` — `register(api)` and the fields, tile and screen it
   contributes.
3. `loyalty-lite/index.ts` — the harder case: a POS panel that must know the live
   cart total, a sale tab, and a `sale.completed` listener that awards exactly
   once per sale even though the event arrives twice (once locally, once over
   Realtime).
4. `loyalty-lite/accounts.ts` — a screen a plugin owns, drawn with the core's UI
   kit and reading only through `api.db`.
5. `variants/index.ts` — the plugin that owns its own tables and its own
   screens: option types, option values, the axes a product keeps, and a
   generator that creates combinations in one transaction.
6. `serial-numbers/index.ts` — the widest surface in the bundle: the same plugin
   registers a till panel that reads the live cart (`PanelContext.lines`), a
   badge that counts what is waiting, and two event listeners. Its
   `helpers.ts` holds the parsing and the arithmetic; `capture.ts` is the card
   the cashier meets; `serials-screen.ts` is the shop's own screen.
7. `warranty/index.ts` — the plugin whose subject is *time*: a promise starts
   when a sale completes and ends months later, so its own SQL derives what a
   promise is now (`days_left`, expiring, expired) instead of storing an expiry
   that would be wrong every night between midnight and the job. `cover-card.ts`
   is one component used twice — the sale tab and the work queue — so the two
   can never disagree about what a sale owes; `warranty-screen.ts` is the
   register, the search and the claims queue, and `helpers.ts` mirrors the
   server's claim ladder so the buttons only ever offer a move the server will
   accept.
8. `weight-scale/helpers.ts` + `weight-scale/index.ts` — the plugin that holds
   *no state of its own*: a scanner hands it digits, `helpers.ts` cuts the shop's
   own layout out of them and the resolver answers with a barcode the core
   already knows. Its layouts are a setting, not a table, because the till must
   read one on every scan without a round trip; its screen exists so a
   shopkeeper can test a label by typing it and watch the answer before the
   queue finds out. The reports are the server's: one entry point
   (`weight_scale_report`) with two types, and the codes report names every item
   the scale cannot sell, worst first — the PLU-shaped code on a piece-sold item
   ahead of everything else, because that is the one charging the wrong money.

## Testing a plugin

A plugin is tested through the public `PluginAPI`, never by reaching into the
host: see `batch-expiry/batch-expiry.test.ts`,
`loyalty-lite/loyalty-lite.test.ts`,
`serial-numbers/serial-numbers.test.ts`, `warranty/warranty.test.ts` and
`weight-scale/weight-scale.test.ts`. They build a `PluginRegistry` with a
fake host, enable the plugin, and assert on what the plugin registered and on
the calls it made — which is also the check that the plugin's files do not
depend on anything the SDK does not promise.

The server half is tested the way the core's is: `npm run validate:migrations`
applies every migration to a real Postgres and then drives each plugin's own
functions through `plugin_rpc` — installing it, refusing what it must refuse,
and leaving the shop exactly as it found it.

Whether the *shipped set* fits together — every dependency exists, no two
plugins claim one permission key — is checked where composition belongs:
`src/app/plugins.test.ts`.
