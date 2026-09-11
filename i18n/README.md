# Bishnupriya Manipuri translation

The app's interface is written in Bengali, hard-coded in Kotlin. Moving it to Bishnupriya
Manipuri is a translation job first and a code job second, and the translation has to be
reviewed by a speaker — a machine-guessed interface is worse than a Bengali one. This folder
holds the work queue and the vocabulary so the two halves can happen without guesswork.

## What is here

| File | Purpose |
| --- | --- |
| `strings_inventory.csv` | Every user-visible string in `app/src/main/java`, one row per **distinct** string, with how often it is used and which screens use it. Fill the `bishnupriya` column. |
| `refresh_inventory.py` | Regenerates the CSV from the sources (`python3 i18n/refresh_inventory.py`). `--check` fails if the file has gone stale. |
| `build_language_templates.py` | Writes the per-language templates the dashboard serves: `backend/assets/lang/{bn,en,bpy}.csv` (`--check` fails if they are stale). |

Both scripts run without a JVM. The templates are only a starting point: the files the app actually
reads live in Supabase (`app_language_files`, migration 023) and are edited from the dashboard's
**Languages** page.

## How it lands in the app

1. An editor opens **Dashboard → Languages**, picks a language tab, presses **Load template** and
   fills the `value` column (or pastes a CSV from a spreadsheet), then **Save**. One CSV per
   language is stored in `public.app_language_files`.
2. The reader picks the language in **Settings → ভাষা** (`ContentLanguage`: `BENGALI`, `ENGLISH`,
   `BISHNUPRIYA`). `TranslationRepository` fetches that language's row, caches the CSV under
   `filesDir/i18n/`, and provides the parsed table app-wide through `LocalTranslations`.
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
call site passes.

## Size of the job

- **958 distinct strings**: **727 interface** strings (982 places in the code) and **231
  publication-content** strings (376 places) — author bios, category names, standing copy in
  `NinghsingCheContentData.kt`, `AuthorProfiles.kt`, `SiteContact.kt`. Content rows are listed
  for completeness; they are what the magazine publishes, so they normally stay as authored and
  are marked `content` in the CSV.
- The `uses` column matters: translating the 100 most-used strings covers a little over a
  quarter of the 982 interface occurrences.

## How a pass works

1. Open `strings_inventory.csv` in a spreadsheet and fill the `bishnupriya` column. Leave a row
   empty if you are unsure — it keeps its Bengali text. The `slots` column says how many `{1}`
   values a string takes; keep every slot in the translation.
2. Run `python3 i18n/generate_strings.py`. The app now switches that much of its interface.
3. Anything that reads wrong goes back into the CSV and step 2 is repeated.

The `screens` column tells you where a string appears, so the most visible ones can be done first.
Screens that already call `t(...)` are listed below; the rest still print their Bengali literals
directly and need the call-site wrap (a mechanical change, done screen by screen, no translation
required for it to be safe).

| Wrapped with `t(...)` | Screens |
| --- | --- |
| ✅ | `NewMusicScreen.kt` (Add Song), the language row in `SettingsScreen.kt` |
| ⏳ | everything else — 65 files, listed by frequency in the CSV |

## Vocabulary (started; confirm or correct each one)

| Bengali | Bishnupriya Manipuri | Source |
| --- | --- | --- |
| এমপি৩ নির্বাচন | এলাহান বরিক | Provided by the project owner; already applied in `NewSong` (`NewMusicScreen.kt`) |
| অনুসন্ধান / খোঁজ | বিসারা | Attested on `bpy.wikipedia.org` ("বিসারিয়া চা", "লগ বিসারা") |
| পাতা | পাতা | Same form in use on `bpy.wikipedia.org` ("মূল পাতা") |
| ফিরে যাওয়া / পিছনে | … | needs a speaker |
| দেখুন | চা | Attested ("বিসারিয়া চা"); careful: also "look for" |

Numerals need no work: the app already renders digits through `toBengaliNumeral`, and
Bishnupriya Manipuri uses the same Bengali script and digits.

## Why not Android string resources

`values-bpy/` needs a resource-qualifier language code that AAPT accepts, and there is no
`gradlew` or SDK in this environment to verify it against — a wrong qualifier breaks the build
rather than a screen. The inventory-first route keeps every change reviewable in the diff, and
it can be lifted into resources later once a build pipeline exists.
