# 15 — Image uploads (ImgBB)

Mekholi stores no image bytes of its own. A product photo or a shop logo goes
to [ImgBB](https://imgbb.com) straight from the browser, and only the returned
URL is written to Postgres.

## Why an external host

| Option | Why not |
|---|---|
| Supabase Storage | Quota'd on the free tier, and every read then costs the project's bandwidth — a shop browsing its own catalogue would spend it. |
| Bytes in Postgres | `bytea` in a row that POS queries read on every product list. The worst place to put a megabyte. |
| ImgBB | Free, CDN-backed, one POST, no server of ours in the path. The URL is the only thing we own, and it is the only thing a receipt or a product grid needs. |

The trade is stated plainly: images live somewhere we do not control, and a
deleted ImgBB image becomes a broken link. Nothing operational depends on the
picture — a sale, a stock movement and a receipt total are all unaffected.

## The key is public, and that is by design

`VITE_IMGBB_API_KEY` is an ImgBB **public** key. Every `VITE_`-prefixed value is
compiled into the bundle and is therefore readable by anyone (spec §44). ImgBB
issues these keys for browser uploads; the key can upload, and nothing else. It
cannot read an account, delete other images, or bill anything.

Leave it blank and uploads switch off cleanly: the picker renders disabled with
an explanation, and every other part of the product form still works. No screen
crashes for want of a key.

```bash
# .env
VITE_IMGBB_API_KEY=your_public_imgbb_key
```

Get one at <https://api.imgbb.com>.

## Shape of the code

```
src/shared/images/imgbb.ts       pure client — validation, transport, parsing
src/app/images.ts                binds the key from env; the app's one uploader
src/components/ui/image-upload.ts  the picker widget (business-ignorant)
```

Three layers, three reasons:

- **`shared/images/imgbb.ts`** knows ImgBB's wire format and nothing about this
  app. It takes its key as an argument and its transport as an option, which is
  why it can be tested in Node with no network and no browser.
- **`src/app/images.ts`** is the only place the key is read. A feature calls
  `uploadImage()`; no feature constructs a client.
- **`imagePicker()`** is a UI-kit control, so it may not import the app layer
  (docs/03 §3). The uploader arrives as a function. Swapping ImgBB for anything
  else touches `src/app/images.ts` and nothing else.

## Rules the client enforces

| Rule | Reason |
|---|---|
| PNG, JPG, WEBP, GIF, BMP only | What ImgBB accepts, checked before sending. |
| 10 MB ceiling (ImgBB allows 32) | A 30 MB photo on a shop's phone tether is a five-minute upload nobody waits through. |
| Validation happens on the device | A refusal that costs zero bytes. |
| Retry **once**, and only on a transport error | A dropped packet is worth repeating. A rejected key is not — the answer will not change. |
| Upload on `commit()`, not on file choice | A form abandoned half-filled spends no data. The bytes leave only when the save is otherwise going to succeed. |
| `AbortSignal` honoured | Closing the dialog stops the upload. |
| Progress over XMLHttpRequest | `fetch` still cannot report bytes sent; a frozen dialog on a slow line reads as a crash. |

## What is stored

Only `data.url` — a direct CDN link. The client also returns `thumbUrl`,
`displayUrl`, `deleteUrl` and the dimensions, so a future screen can show a
grid thumbnail or offer an undo without a second upload. `products.image_url`
and `organizations.logo_url` hold plain text URLs; nothing else changes in the
schema.

## Where it appears

| Screen | Field |
|---|---|
| Products → full form | Product image |
| Settings → Shop details | Shop logo (printed on receipts when "Show the shop logo" is on) |

Both use the same picker: click, drag-and-drop, or a phone camera through the
native file dialog.

## Tests

`src/shared/images/imgbb.test.ts` covers validation, URL building, expiry
clamping, response parsing (including a 200 carrying no URL), the retry policy
and abort. `src/components/ui/image-upload.test.ts` covers the picker's
promise: nothing uploads before `commit()`, a rejected file never reaches the
network, and a failed upload keeps the file pending so a retry needs no second
file dialog.
