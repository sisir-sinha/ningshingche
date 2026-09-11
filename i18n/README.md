# Interface language files

The app's interface is written in Bengali, hard-coded in Kotlin. Bengali is therefore the source
text and needs no work; **English** and **Bishnupriya Manipuri** are translation jobs layered on top,
and the wording has to come from a speaker — a machine-guessed interface is worse than a Bengali
one. One CSV per language carries those layers, the dashboard edits them, and the app downloads the
one its reader picked.

## What is here

| File | Purpose |
| --- | --- |
| `strings_inventory.csv` | Every user-visible string in `app/src/main/java`, one row per **distinct** string, with how often it is used, which screens use it, and how many `{1}` slots it takes. This is the work queue. |
| `refresh_inventory.py` | Regenerates the inventory from the sources (`python3 i18n/refresh_inventory.py`). `--check` fails if it has gone stale. |
| `build_language_templates.py` | Writes the per-language templates the dashboard offers: `backend/assets/lang/{bn,en,bpy}.csv` (`--check` fails if they are stale). |

Both scripts run without a JVM. `bn.csv` maps every key to itself, so it doubles as the key list;
`en.csv` and `bpy.csv` ship with empty values for a translator to fill.

## How it lands in the app

1. An editor opens **Dashboard → Languages**, picks a language tab, presses **Load template** and
   fills the `value` column (or pastes a CSV from a spreadsheet), then **Save**. One CSV per
   language is stored in `public.app_language_files` (migration 023).
2. The reader picks the language. On a fresh install that is the first screen
   (`LanguageSetupScreen`, before anything else, remembered by the `language_chosen` preference);
   afterwards it is **Settings → ভাষা**. Either way the set is the same (`ContentLanguage`:
   `BENGALI`, `ENGLISH`, `BISHNUPRIYA`): `TranslationRepository` fetches that language's row,
   caches the CSV under `filesDir/i18n/`, and provides the parsed table app-wide through
   `LocalTranslations`.
3. Screens call `t("বাংলা লেখা")`; `t` returns the translation, or the Bengali original when the
   file has no entry for that key. Bengali is never fetched — it is the compiled-in source text.

So:

- an empty or missing file means the app reads exactly as it always did;
- a half-filled CSV means half the interface switches, which is a valid intermediate state;
- nothing is guessed — a wrong translation is a CSV edit and Save, never an app release;
- changing the language refetches, and Settings has an "অনুবাদ হালনাগাদ করুন" button to pull the
  current file without waiting for the next launch.

Strings with values use numbered slots so a translation can reorder them:

```kotlin
t("গান {1}টি", toBengaliNumeral(count))
```

The inventory already normalises every interpolation this way, so a CSV key is exactly what the
call site passes, and the `slots` column says how many `{1}` values a key takes — keep every slot in
the translation, it may be moved but not dropped.

## Size of the job

- **965 distinct strings**: **734 interface** strings and **231 publication-content** strings —
  author bios, category names, standing copy in `NinghsingCheContentData.kt`, `AuthorProfiles.kt`,
  `SiteContact.kt`. Content rows are listed for completeness; they are what the magazine publishes,
  so they normally stay as authored and are marked `content` in the inventory. The templates carry
  the interface rows only.
- The `uses` column matters: translating the 100 most-used strings covers a little over a quarter of
  the interface occurrences.

## How a pass works

1. Open **Dashboard → Languages**, pick the language, press **Load template**. The page reports how
   many rows are translated, how many values are still empty, and which Bengali keys the file does
   not carry yet.
2. Fill the wording in. The default view is a table — one row per string, Bengali on the left and
   your translation on the right, with a search box and "empty only" / "translated only" filters for
   working through 700+ rows. **Whole file (CSV)** shows the raw text for pasting from a spreadsheet,
   and **Download CSV** gives you the file to edit offline. Either way, press **Save**. Leave a value
   empty if you are unsure: it keeps its Bengali text.
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
