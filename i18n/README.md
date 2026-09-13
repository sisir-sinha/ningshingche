# Interface language files

The app's interface is written in Bengali, hard-coded in Kotlin. Bengali is therefore the source
text, and it also works with no files at all; **English** and **Bishnupriya Manipuri** are
translation jobs layered on top, and the wording has to come from a speaker — a machine-guessed
interface is worse than a Bengali one. One CSV per language carries those layers, the dashboard
edits them, and the app downloads the one its reader picked.

Bengali has a file too, and it is editable: a row there rewrites the wording a Bengali reader sees
without touching the string the app looks up. See **Rewriting the Bengali** below.

## What is here

| File | Purpose |
| --- | --- |
| `strings_inventory.csv` | Every user-visible string in `app/src/main/java`, one row per **distinct** string, with how often it is used, which screens use it, and how many `{1}` slots it takes. This is the work queue. |
| `refresh_inventory.py` | Regenerates the inventory from the sources (`python3 i18n/refresh_inventory.py`). `--check` fails if it has gone stale. |
| `build_language_templates.py` | Writes the per-language templates the dashboard starts from: `backend/assets/lang/{bn,en,bpy}.csv` (`--check` fails if they are stale). |
| `backend/tests/languages*.test.cjs` | The grid's CSV layer and page wiring: sheet ⇄ per-language files, quoting, the filter/search behaviour, import and save. |

Both scripts run without a JVM. `bn.csv` maps every key to itself, so it doubles as the key list;
`en.csv` and `bpy.csv` ship with empty values for a translator to fill.

The templates carry the strings the **interface** shows. Publication text — article and category
copy from `NinghsingCheContentData.kt`, author biographies, the contact block — is listed in the
inventory but left out of the page: a string counts as content only when every file that mentions it
is one of those, so a section name that the drawer also shows (`লেখক`, `বার্ষিক সংখ্যা`) stays
translatable. In the current tree that is **797 strings on the page, 203 kept as content**.

Markdown scaffolding is left out too: headings (`### «{1}» — নিবন্ধ বিশ্লেষণ`), bullets
(`• **বিভাগ:** {1}`), rules, italic wrappers (`*গান*`) and regex sources
(`(20\d{2}|২০\d{2})`). Those strings are prompts and patterns, not wording a reader sees — a bullet
is not something to translate, and translating one changes a prompt or breaks a match. The page
filters them out a second time when it builds the grid (`isScaffolding` in `languages.js`), because a
language file saved by an older build can still carry them and Import can paste anything.

Value markers stay: `পৃষ্ঠা {1} / {2}` is one string with the page number spliced in, so `{1}` and
`{2}` have to survive a translation — a translation may even move them, which is the reason they are
numbered rather than named.

## How it lands in the app

1. An editor opens **Dashboard → Languages** and types into the grid: one row per string, one column
   per language — `#`, `bpy`, `bn`, `en`, the same shape as the sheet this work started in. All three
   columns are editable. **Save translations** writes one `key,value` CSV per language into
   `public.app_language_files` (migration 023) — that is what the app downloads. **Download** gives
   the grid as a CSV to fill in a spreadsheet (plus a `key` column, explained below), and **Import**
   reads it back: columns are matched by header, `#` is ignored, a key that differs from the app's
   only by a trailing `।` lands on the real key, and a Bengali cell that merely repeats the row is
   not mistaken for a rewrite.
2. The reader picks the language. On a fresh install that is the first screen
   (`LanguageSetupScreen`, before anything else, remembered by the `language_chosen` preference);
   afterwards it is **Settings → ভাষা**. Either way the set is the same (`ContentLanguage`:
   `BENGALI`, `ENGLISH`, `BISHNUPRIYA`): `TranslationRepository` fetches that language's row,
   caches the CSV under `filesDir/i18n/`, and provides the parsed table app-wide through
   `LocalTranslations`.
3. Screens call `t("বাংলা লেখা")`; `t` returns whatever the reader's language file has for that
   key, or the Bengali original when it has nothing (a blank value counts as nothing). Bengali is
   fetched like the other languages and is usually empty, so those lookups simply miss.

So:

- an empty or missing file means the app reads exactly as it always did;
- a half-filled CSV means half the interface switches, which is a valid intermediate state;
- nothing is guessed — a wrong translation is a CSV edit and Save, never an app release;
- changing the language refetches, and Settings has an "অনুবাদ হালনাগাদ করুন" button to pull the
  current file without waiting for the next launch;
- a translation is found even if its Bengali key differs from the app's by a trailing `।` or extra
  spaces — `looseKey()` in `ui/i18n/Strings.kt`, and the same fallback on the page's import.

## Rewriting the Bengali

Bengali is both the wording and the key, so a row in `bn.csv` carries two things that can differ:

| Where | What it is |
| --- | --- |
| The key — the Bengali string compiled into the app (`t("লেখক")`) | never changes; it is how the app finds the row |
| The value — what you type in the `bn` column | what a Bengali reader sees |

The file stays the same `key,value` CSV as every other language, and rows that still read exactly
like the app's string are left out of it — so a Bengali file is normally empty and grows only where
somebody rewrote something (`লেখক,লেখকবৃন্দ`). Nothing about the app's lookup depends on the value,
which is why the wording can be corrected at any time from the dashboard.

Because the `bn` column can no longer be assumed to *be* the key, **Download** appends a `key` column
holding the app's own string; it is left empty for rows nobody has rewritten, so an untouched sheet
still reads as the four columns above. **Import** uses it when it is there and falls back to the
Bengali column when it is not, which is what a sheet typed by hand has.

Strings with values use numbered slots so a translation can reorder them:

```kotlin
t("গান {1}টি", toBengaliNumeral(count))
```

The inventory already normalises every interpolation this way, so a CSV key is exactly what the
call site passes, and the `slots` column says how many `{1}` values a key takes — keep every slot in
the translation, it may be moved but not dropped.

## Size of the job

- **1118 distinct strings**: **914 interface** strings and **204 publication-content** strings —
  author bios, category names, standing copy in `NinghsingCheContentData.kt`, `AuthorProfiles.kt`,
  `SiteContact.kt`. Content rows are listed for completeness; they are what the magazine publishes,
  so they normally stay as authored and are marked `content` in the inventory. The templates carry
  the interface rows only.
- The `uses` column matters: the grid's template carries the 914 interface rows, and translating the
  100 most-used of them covers 33% of the interface occurrences (the top 50 cover 23%).

## How a pass works

1. Open **Dashboard → Languages**. The grid fills itself from the templates committed in
   `backend/assets/lang/` as it loads, and **Load templates** reads them again on demand — that is the
   road from a translator's CSV in the repository to the dashboard. Each language shows two numbers
   beside its name: how many rows the grid holds (`en 42/914`) and how many the app can actually read
   (`42 saved`). A language with **0 saved** has never been published, and readers who pick it still
   see Bengali; when any language is in that state the page says so above the grid, naming it.
   Press **Save translations** to publish — reading a template never writes anything on its own.
2. Work down the grid. The search box matches Bengali and both translations; **Missing** shows the
   rows that still lack a `bpy` or `en` value and **Complete** the rest, which is how you find what
   is left. Leave a cell empty if you are unsure: the app shows its own Bengali text for that string.
   Wording that reaches the dashboard from a template is never written over a cell somebody typed, so
   the two roads — a CSV committed in `backend/assets/lang/`, and the sheet on this page — can be used
   in either order. A wording already in a template is carried through
   `python3 i18n/build_language_templates.py`, so filling a template by hand and regenerating it does
   not lose the work.
3. Refresh the language in the app (Settings → অনুবাদ হালনাগাদ করুন, or just switch language) to see
   the result. No app release is involved.

The `screens` column in the inventory tells you where a string appears, so the most visible ones can
be done first. Screens that already call `t(...)` are listed below; the rest still print their
Bengali literals directly and need the call-site wrap (a mechanical change, done screen by screen,
no translation required for it to be safe).

| Wrapped with `t(...)` | Screens |
| --- | --- |
| ✅ | `NewMusicScreen.kt` (Add Song), the language row in `SettingsScreen.kt` |
| — | `LanguageSetupScreen.kt` is deliberately not translated: it is the screen that asks the question, so it shows every language in its own script |
| ⏳ | everything else — 65 files, listed by frequency in the inventory |

## Vocabulary (started; confirm or correct each one)

| Bengali | Bishnupriya Manipuri | Source |
| --- | --- | --- |
| এমপি৩ নির্বাচন | এলাহান বরিক | Provided by the project owner; already applied in `NewMusicScreen.kt` |
| অনুসন্ধান / খোঁজ | বিসারা | Attested on `bpy.wikipedia.org` ("বিসারিয়া চা", "লগ বিসারা") |
| পাতা | পাতা | Same form in use on `bpy.wikipedia.org` ("মূল পাতা") |
| ফিরে যাওয়া / পিছনে | … | needs a speaker |
| দেখুন | চা | Attested ("বিসারিয়া চা"); careful: also "look for" |

Numerals need no work: the app already renders digits through `toBengaliNumeral`, and Bishnupriya
Manipuri uses the same Bengali script and digits.

## Checks

- `python3 i18n/refresh_inventory.py --check` and `python3 i18n/build_language_templates.py --check`
  keep the inventory and the templates in step with the code.
- `node --test backend/tests/` covers the dashboard's CSV reader (`languages.test.cjs`) and, when
  jsdom is installed, the Languages page itself (`languages-page.test.cjs`, see the header of that
  file); `app/src/test/.../TranslationCsvTest.kt` covers the app's reader with the same fixtures, so
  the two implementations cannot drift.

## Why not Android string resources

`values-bpy/` needs a resource-qualifier language code that AAPT accepts, and there is no `gradlew`
or SDK in this environment to verify it against — a wrong qualifier breaks the build rather than a
screen. The CSV route keeps every change reviewable in the diff (and editable by the owner without a
build), and it can be lifted into resources later once a build pipeline exists.
