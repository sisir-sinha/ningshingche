# The Android reference

A client that is not the web client, speaking the same API — and the reason it
is a reference rather than a rewrite.

The requirement behind it (§43) is that business logic must not live in a
client, because a second client would have to re-implement it and the two would
drift. So pricing, tax, stock, invoice numbering and permission checks are all
in Postgres, and a client is only a way to *ask*. This directory proves that was
true: the Kotlin client contains no pricing arithmetic, no stock logic and no
rules about who may sell.

```
core/          Kotlin/JVM — no Android APIs, no dependencies but the stdlib
  Transport.kt   the network seam; `NetworkUnavailableException` = couldn't ask
  Wire.kt        @Serializable mirror of contracts/api-contract.json
  Api.kt         the RPC surface, typed; failure classification in words
  Outbox.kt      the queue, same rules and same order as the browser's
  Sync.kt        connectivity, one re-armed timer, single-flight drain
  cli/Main.kt    pos | offline | sync | retry — the whole client, runnable
app/           Compose shell around the core
  PosViewModel   branch -> floor -> catalogue -> sale, with the outbox
  ui/            LoginScreen, PosScreen
  data/          SQLite outbox, connectivity, scheduler, session store
```

## Why it is split this way

The risk in a mobile client is the data layer: the wire shapes, exactly-once
writes, what to do when the uplink disappears. That layer is plain Kotlin, so it
compiles and runs anywhere a JDK does — no SDK, no emulator, no Gradle:

```bash
npm run android:build     # kotlinc (once) + android/core/build/mekholi-core.jar
npm run test:android      # 32 checks, ~1s, runs the jar
npm run e2e:android       # against the live project; needs .env and .env.db
```

`npm run e2e:android` runs the CLI as a **separate process per command**, which
is the only way to prove the property a shop actually needs: the till was closed
at closing time, the sale was still queued in the morning, and the next process
sent it. It also refuses one whose server refused it, then sends it after a
person retries.

The `app` module needs the Android SDK and an emulator, so it is **source-only**
in this repository: it is not compiled by CI, and it is a thin shell over
`core`, which is. `app/build.gradle.kts` reads `mekholi.supabaseUrl` and
`mekholi.supabaseAnonKey` from `gradle.properties` — the **publishable** key
only. There is no service-role key anywhere in this directory, and there will
not be one (spec §44).

## The rules the tests pin

| rule | why |
|---|---|
| the reference is minted **before** the first attempt | a timeout after the server committed must not become a second sale |
| a connection failure keeps the write **and stops the drain** | one sale cannot be overtaken by a later one; invoice order is not negotiable |
| a refusal keeps the write **and parks it** | the server said no, so a person has to look; retrying it forever hides why |
| a duplicate reference (`23505`) counts as **success** | the sale is already in the shop's books; chasing it is the bug |
| the drain is single-flight | two drains racing is how one sale is sent twice |
| one timer, re-armed | a `setInterval` racing a slow upload is the same mistake |
| the receipt's money is **text** | a strict client refuses to *guess* a precision; migration 045 made the server agree |

## Pointing the app at your own project

```bash
# android/gradle.properties
mekholi.supabaseUrl=https://<ref>.supabase.co
mekholi.supabaseAnonKey=<publishable key>
```

Then `cd android && ./gradlew :app:assembleDebug` (needs the SDK; set
`ANDROID_HOME` or `local.properties`). The CLI takes the same values as
environment variables — see the list in `cli/Main.kt`.
