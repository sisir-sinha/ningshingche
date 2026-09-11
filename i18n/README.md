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

## Size of the job

- **958 distinct strings**: **727 interface** strings (982 places in the code) and **231
  publication-content** strings (376 places) — author bios, category names, standing copy in
  `NinghsingCheContentData.kt`, `AuthorProfiles.kt`, `SiteContact.kt`. Content rows are listed
  for completeness; they are what the magazine publishes, so they normally stay as authored and
  are marked `content` in the CSV.
- The `uses` column matters: translating the 100 most-used strings covers a little over a
  quarter of the 982 interface occurrences.

## How a pass works

1. Fill `bishnupriya` for the rows you want translated. Empty rows keep their Bengali text, so
   the app stays usable at every step — a half-filled column is a valid state.
2. Say the word and the Kotlin literals are replaced, file by file, matching the CSV. Strings
   with `…` stand for a `${…}` value that stays in the code (`গান …টি` → the count is kept).
3. Anything that reads wrong afterwards goes back into the CSV; the code is regenerated from it.

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
