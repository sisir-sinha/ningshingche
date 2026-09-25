# The plugins this bundle ships

Four plugins live here. Between them they use every part of the SDK, which is
why they are also its worked example — `docs/11-plugin-sdk.md` is the guide, and
these are what it looks like when someone follows it.

| Plugin | What it adds | Plugin surface |
| --- | --- | --- |
| [`variants`](variants/) | Options and the combinations built from them — Colour: Red, Blue × Size: S, M, L — with per-variant price, cost, SKU and stock | 2 permissions, nav + screen, dashboard widget, product-form section, a generator and an options screen the plugin owns |
| [`batch-expiry`](batch-expiry/) | Batch numbers and expiry dates on products, with a screen listing what is about to expire | 2 product fields (shown on the till and printed on receipts), 1 permission, nav + screen, dashboard widget, product-form section |
| [`loyalty-lite`](loyalty-lite/) | Points per taka spent, a balance on the sale, and who has earned what | 2 permissions, nav + screen, dashboard widget, POS panel, sale tab, an event listener that awards points automatically |
| [`serial-numbers`](serial-numbers/) | The unit, not the product: which handset left on which invoice, and which one came back | 2 permissions, nav + screen (badge), dashboard widget, POS panel, sale tab, product-form section, `sale.completed` and `sale.refunded` listeners |

None of them imports another, and none imports anything from `src/features/` —
`tools/check-boundaries.mjs` fails the build if that changes. Loyalty needs
batch-expiry? It says so in `dependencies`, and the host loads the dependency
first. That is the whole point: **adding a plugin never means editing a feature**
(spec §51).

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

## Testing a plugin

A plugin is tested through the public `PluginAPI`, never by reaching into the
host: see `batch-expiry/batch-expiry.test.ts`,
`loyalty-lite/loyalty-lite.test.ts` and
`serial-numbers/serial-numbers.test.ts`. They build a `PluginRegistry` with a
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
