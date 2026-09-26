# 16 — Language (English / বাংলা)

The Language select in Settings used to write a column and change nothing on
screen. There was no translation layer behind it: choosing বাংলা stored `bn` in
`organizations.locale` and the UI carried on in English. This document
describes the layer that now sits behind that select.

## Shape

```
src/shared/i18n/strings.ts   the catalogue — English source + Bangla
src/shared/i18n/index.ts     t(), setLocale(), onLocaleChange(), Intl helpers
```

No dependency, no ICU, no async bundles. Two plain objects and a lookup. The
whole catalogue is a few kilobytes and ships in the main chunk, because a shop
switching language should not wait for a network request to read its own
sidebar.

```ts
t('nav.stock')                                  // "Stock" / "স্টক"
t('settings.partialFailure', { message })       // {placeholders} are filled
formatNumber(1250)                              // "1,250" / "১,২৫০"
```

## Rules

| Rule | Reason |
|---|---|
| English is the source; Bangla is a `Partial` of it | A missing translation falls back to English, never to `settings.taxRate`. A half-translated screen is usable; a screen of keys is not. |
| Lookups happen at **render** time, never at module load | A label captured in a constant is a label frozen in whatever language was active at import. |
| `setLocale()` persists, then announces | A listener redrawing the UI must never read the previous value back out of storage. |
| Core nav labels are translated by id, plugin labels are not | A plugin owns its own strings (spec §51). Core ids map to keys in `navigation.ts`; anything else passes through untouched. |
| `NavItem.label` stays English in the model | It is also the route title and the command-palette text. `navLabel(item)` is what the sidebar draws. |
| `<html lang>` follows the locale | Screen readers, `:lang()` and Android font selection all read it — Bangla under `lang="en"` picks the wrong font on several builds. |

## Switching is a redraw, not a reload

`onLocaleChange` is subscribed once, in `src/main.ts`. It rebuilds the shell and
calls `router.refresh()`, so the sidebar, section headers and the current screen
all come back in the new language with the URL unchanged and no sign-out.

The Settings select applies the change **on `change`**, before any save — waiting
for a database round trip to see your own language is most of what made the
control feel broken. Saving then makes it the shop's default: `load()` calls
`setLocale(settings.locale)`, so a borrowed tablet signing into the shop adopts
the shop's language, while a device that has chosen one keeps it in
`localStorage` under `mekholi.locale`.

## Coverage today

Translated: the whole sidebar (items and section headers), the shell's search,
sign-out and empty-role message, the image picker, and every string on the
Settings screen including the tax dialog.

Not yet translated: POS, Products, Stock, Reports and the other feature screens.
They are plain English strings today; converting one is mechanical — wrap the
literal in `t()` and add the pair to `strings.ts`. The test in
`src/shared/i18n/i18n.test.ts` fails if a `nav.*`, `shell.*` or `settings.*` key
is added to English without a Bangla partner, so the translated surface cannot
quietly rot as it grows.

Numbers inside `formatNumber`/`formatDate` follow the locale (Bengali numerals
under `bn-BD`). Money still formats through `shared/domain/money.ts` with its own
`en-BD` default — moving that onto the active locale is a separate change,
because receipts and CSV exports read the same formatter and a receipt's digits
are a decision a shop should make deliberately.

## Adding a language

1. Add the tag to `LOCALES`, `LOCALE_NAMES` and `LOCALE_TAGS` in `strings.ts`.
2. Add a dictionary object and register it in `DICTIONARIES`.
3. Add the option to the Settings select.

Nothing else knows the list.
