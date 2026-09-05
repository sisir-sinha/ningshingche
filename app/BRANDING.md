# Ningshing Che Android identity

The owner confirmed that the app is still in development before this identity change.

| Setting | Value |
| --- | --- |
| Application ID / Android package name | `com.ningshingche.app` |
| Generated `R` / `BuildConfig` namespace | `com.ningshingche.app` |
| Kotlin root package | `com.ningshingche.app` |
| Android display name | `নিংশিং চে` |
| English project/product name | `Ningshing Che` |
| FileProvider authority | `com.ningshingche.app.provider` |

## What changed in the repository

- `app/build.gradle.kts` declares the branded application ID and namespace.
- Main, unit-test and instrumentation-test Kotlin packages, imports and folders now use `com/ningshingche/app/`.
- Relative manifest component names resolve to `com.ningshingche.app.NinghsingCheApp` and `com.ningshingche.app.MainActivity`.
- FileProvider remains non-exported and uses `${applicationId}.provider`. PDF/APK sharing code uses `${context.packageName}.provider`; there is no stale hard-coded authority to update.
- The existing Bengali launcher label is preserved. The English Gradle project name and project metadata use the correctly spelled brand.
- Documentation/source paths and comment-test commands use the new namespace.
- The comment fix, local commenter-detail cache, backend data, website domain, signing configuration and web-dashboard backup feature are unchanged.

## Development-install implications

Changing the application ID creates a **different Android app identity**. A build with this ID will not update an installation made with the old development ID; the two can coexist. Existing local preferences, bookmarks and commenter details are not automatically migrated between those app sandboxes. Rebuild/install the branded app and remove the old development build manually only when you are ready.

If a previous ID has already been published, it cannot be renamed into this one in Google Play. Publishing this ID would require its own listing. The owner selected the pre-publication development migration for this repository.

## External configuration to update before release

These are owner-managed registrations, not source-code replacements. No external project or production registration was changed automatically.

1. **Firebase:** if used, register an Android app with package `com.ningshingche.app` in the intended Firebase project and download its `google-services.json` into `app/`. Do not merely edit a JSON downloaded for another registered package. No `google-services.json` is currently tracked in this repository.
2. **Google sign-in/OAuth or other package-restricted services:** update the Android package registration and the appropriate signing-certificate fingerprints. Do not change keys or expose private credentials just to rename the app.
3. **Verified App Links:** update `https://ningshingche.com/.well-known/assetlinks.json` to target `com.ningshingche.app` and the actual release app-signing certificate's SHA-256 fingerprint. With Play App Signing, use the app-signing certificate, not just the upload certificate. The website association file is not in this repository and has not been deployed by this change.
4. **Signing/distribution:** retain your intended signing configuration and use the branded ID when creating the development app's eventual Play listing. No keystore or certificate was generated, replaced or committed for this rename.

The Supabase endpoint and publishable key are unchanged. Anonymous commenting does not require a Firebase account or a dashboard login.

## Verification

Use JDK 17+, Gradle 9.3.1 and Android SDK platform 36.1. After changing packages in an existing checkout, start with a clean build to discard stale generated classes:

```sh
gradle clean :app:testDebugUnitTest \
  --tests 'com.ningshingche.app.BrandIdentityTest' \
  --tests 'com.ningshingche.app.comments.*' \
  :app:compileDebugAndroidTestKotlin
```

`BrandIdentityTest` checks the generated namespace/application ID, Bengali launcher label, launcher component and FileProvider resolution against the merged Android manifest. The existing comment tests cover API submission, cached details and the Compose form under the new namespace. Instrumentation sources are compiled; executing device tests still requires a device/emulator.

Validated on **2026-09-05**: all **17** selected regression tests passed, main and instrumentation Kotlin sources compiled, and the merged debug manifest resolved the branded package, Application, launcher and private FileProvider correctly. No device/emulator run or external service-registration change is claimed.
