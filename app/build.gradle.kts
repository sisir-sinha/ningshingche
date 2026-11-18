import com.google.gms.googleservices.GoogleServicesPlugin.MissingGoogleServicesStrategy
import java.io.FileInputStream
import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.google.devtools.ksp)
  alias(libs.plugins.roborazzi)
  alias(libs.plugins.secrets)
  alias(libs.plugins.google.services)
}

/**
 * The Play upload key: where it is, and why it is not in this file.
 *
 * A keystore and its passwords are a publishing credential — whoever holds them can
 * sign an APK that Google Play accepts as the next update to com.ningshingche.app.
 * They belong in exactly two places, neither of them git:
 *
 *   1. `key.properties` at the **root of the repository** (this file's sibling two
 *      directories up), git-ignored; copy `key.properties.example` to start one.
 *   2. the environment — KEYSTORE_PATH, STORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD —
 *      which is what a CI runner should use instead of a file on disk.
 *
 * ## Two path traps, both of which produced the "file not found" and the
 * ## "unresolved reference" errors this build hit
 *
 * `rootDir` is the **root project** directory — the one holding `settings.gradle.kts`
 * — even when it is read from this module's build script. It is *not* `app/`.
 * `projectDir` is `app/`. So `rootDir.resolve("key.properties")` is
 * `/workspaces/ningshingche/key.properties`, which is where the file is, and
 * `rootDir.parentFile.resolve(...)` is `/workspaces/key.properties`, which does not
 * exist. That `parentFile` was the bug: the properties file was silently skipped,
 * every value came back null, and the failure surfaced much later inside
 * BundleToolRunnable as a signing exception rather than as "the file is missing".
 *
 * `file(...)` and `rootProject.file(...)` resolve relative paths against the
 * *module* directory, so `file("my-upload-key.jks")` means `app/my-upload-key.jks`.
 * Anything read here is resolved against `rootDir` explicitly instead.
 *
 * `rootProject` is not referenced at all: it is the same object as `rootDir`'s
 * project, and avoiding one receiver keeps the script free of the scope problem
 * that produced "Unresolved reference 'rootProject'" in the earlier attempt. Every
 * declaration below sits *after* the `plugins { }` block for the same reason — in
 * Kotlin DSL, the plugin block has to be the first thing in the file apart from
 * imports.
 */
val keyPropertiesFile = rootDir.resolve("key.properties")

val keystoreProperties = Properties().apply {
  if (keyPropertiesFile.exists()) {
    keyPropertiesFile.inputStream().use { load(it) }
  }
}

/**
 * A value from `key.properties`, or from the environment for CI.
 *
 * The file wins on a workstation so that a stale `STORE_PASSWORD` in a shell cannot
 * quietly sign with the wrong key; the environment is the fallback a pipeline uses
 * because it has no file to keep.
 */
fun signingValue(propertyKey: String, environmentVariable: String): String? =
  keystoreProperties.getProperty(propertyKey)?.takeIf { it.isNotBlank() }
    ?: System.getenv(environmentVariable)?.takeIf { it.isNotBlank() }

val releaseStorePath: String? = signingValue("storeFile", "KEYSTORE_PATH")
val releaseStoreFile = releaseStorePath?.let { rootDir.resolve(it) }
val releaseStorePassword: String? = signingValue("storePassword", "STORE_PASSWORD")
val releaseKeyAlias: String? = signingValue("keyAlias", "KEY_ALIAS")
val releaseKeyPassword: String? = signingValue("keyPassword", "KEY_PASSWORD")

/**
 * What is missing, named by key and never by value.
 *
 * Read once, so the message can list everything that needs fixing in one run
 * instead of one build per key. Passwords are never printed, not even their length.
 */
val missingSigningValues: List<String> = buildList {
  if (releaseStorePath == null) add("storeFile")
  if (releaseStorePassword == null) add("storePassword")
  if (releaseKeyAlias == null) add("keyAlias")
  if (releaseKeyPassword == null) add("keyPassword")
}

val keystoreFileMissing: Boolean = releaseStoreFile != null && !releaseStoreFile.exists()

/** True only when a release build could actually be signed. */
val releaseSigningReady: Boolean =
  missingSigningValues.isEmpty() && !keystoreFileMissing && releaseStoreFile != null

android {
  namespace = "com.ningshingche.app"
  compileSdk { version = release(36) { minorApiLevel = 1 } }

  defaultConfig {
    applicationId = "com.ningshingche.app"
    minSdk = 24
    targetSdk = 36
    versionCode = 36
    versionName = "1.1"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

    // Phones only. x86/x86_64 Pdfium copies are for emulators and doubled the APK.
    ndk {
      abiFilters += listOf("armeabi-v7a", "arm64-v8a")
    }
  }

  signingConfigs {
    // Created only when the key is really on this machine. A checkout without one
    // must still configure and run `assembleDebug`; the release tasks report what
    // is missing (see the check at the end of this file).
    if (releaseSigningReady) {
      create("release") {
        storeFile = releaseStoreFile
        storePassword = releaseStorePassword
        keyAlias = releaseKeyAlias
        keyPassword = releaseKeyPassword
        // PKCS12 stores one key with one password; the modern default for both
        // schemes is what Play wants, so v1/v2 are left at AGP's default.
      }
    }
    val customDebugKey = rootDir.resolve("debug.keystore")
    if (customDebugKey.exists()) {
      create("debugConfig") {
        storeFile = customDebugKey
        storePassword = "android"
        keyAlias = "androiddebugkey"
        keyPassword = "android"
      }
    }
  }

  buildTypes {
    release {
        isCrunchPngs = true
        isMinifyEnabled = true
        isShrinkResources = true

        proguardFiles(
            getDefaultProguardFile("proguard-android-optimize.txt"),
            "proguard-rules.pro"
        )

        ndk {
            debugSymbolLevel = "SYMBOL_TABLE"
        }

        signingConfigs.findByName("release")?.let {
            signingConfig = it
        }
    }

    debug {
        signingConfigs.findByName("debugConfig")?.let {
            signingConfig = it
        }
    }
}

  packaging {
    jniLibs {
      // Uncompressed, which is what Play wants from here on.
      //
      // This was `true` to make the sideload APK smaller — but the app no longer
      // distributes its own APK (that was the first audit blocker), and compressed
      // libraries are the one packaging choice that can undercut the 16 KB
      // work: Play checks that native libraries are aligned for 16 KB pages, and
      // the guaranteed way to ship that is the modern layout, where AGP 8.5.1+
      // stores each .so uncompressed and aligns it. We are on AGP 9.1.1, so this
      // is the default behaviour rather than something to remember.
      useLegacyPackaging = false
    }
    resources {
      excludes += setOf(
        "META-INF/LICENSE.md",
        "META-INF/LICENSE-notice.md",
        "META-INF/NOTICE.md",
        "META-INF/DEPENDENCIES",
        "META-INF/*.version",
        "DebugProbesKt.bin"
      )
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
  }
  buildFeatures {
    compose = true
    buildConfig = true
  }
  testOptions { unitTests { isIncludeAndroidResources = true } }
  dependenciesInfo {
    includeInApk = false
    includeInBundle = true
  }

}

// Configure the Secrets Gradle Plugin to use .env and .env.example files
// to match the convention used in Web projects.
secrets {
  propertiesFileName = ".env"
  defaultPropertiesFileName = ".env.example"
  ignoreList.add("FIREBASE_APPCHECK_DEBUG_TOKEN")
}

googleServices { missingGoogleServicesStrategy = MissingGoogleServicesStrategy.WARN }

// Some unused dependencies are commented out below instead of being removed.
// This makes it easy to add them back in the future if needed.
dependencies {
  implementation(platform(libs.androidx.compose.bom))
  // implementation(libs.accompanist.permissions)
  implementation(libs.androidx.activity.compose)
  // implementation(libs.androidx.camera.camera2)
  // implementation(libs.androidx.camera.core)
  // implementation(libs.androidx.camera.lifecycle)
  // implementation(libs.androidx.camera.view)
  implementation(libs.androidx.compose.material.icons.core)
  implementation(libs.androidx.compose.material.icons.extended)
  implementation(libs.androidx.compose.foundation)
  implementation(libs.androidx.compose.material3)
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.graphics)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.datastore.preferences)
  implementation(libs.androidx.work.runtime.ktx)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.lifecycle.viewmodel.compose)
  implementation(libs.androidx.navigation.compose)
  implementation(libs.androidx.room.ktx)
  implementation(libs.androidx.room.runtime)
  implementation(libs.coil.compose)
  implementation(libs.converter.moshi)
  // Uncomment to use Firestore:
  // implementation(libs.firebase.firestore)

  // Native Google Sign-In via Credential Manager → Supabase Auth (ID token).
  // Firebase Auth is not used. Gemini is called over HTTP, not the Firebase AI SDK.
  implementation(libs.androidx.credentials)
  implementation(libs.androidx.credentials.play.services)
  implementation(libs.googleid)
  implementation(libs.kotlinx.coroutines.android)
  implementation(libs.kotlinx.coroutines.core)
  implementation(libs.logging.interceptor)
  implementation(libs.moshi.kotlin)
  implementation(libs.okhttp)
  implementation(libs.androidx.media3.exoplayer)
  implementation(libs.androidx.media3.session)
  implementation(libs.android.pdf.viewer)
  // implementation(libs.play.services.location)
  implementation(libs.retrofit)
  testImplementation(libs.androidx.compose.ui.test.junit4)
  testImplementation(libs.androidx.core)
  testImplementation(libs.androidx.junit)
  testImplementation(libs.junit)
  testImplementation(libs.mockwebserver)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.robolectric)
  testImplementation(libs.roborazzi)
  testImplementation(libs.roborazzi.compose)
  testImplementation(libs.roborazzi.junit.rule)
  androidTestImplementation(platform(libs.androidx.compose.bom))
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  androidTestImplementation(libs.androidx.espresso.core)
  androidTestImplementation(libs.androidx.junit)
  androidTestImplementation(libs.androidx.runner)
  debugImplementation(libs.androidx.compose.ui.test.manifest)
  debugImplementation(libs.androidx.compose.ui.tooling)
  "ksp"(libs.androidx.room.compiler)
  "ksp"(libs.moshi.kotlin.codegen)
}

/**
 * The same check, earlier: a release build asked for on the command line fails
 * during configuration, before twenty minutes of Kotlin and R8.
 *
 * `gradle.startParameter` is configuration-cache safe (it is an input to
 * configuration, unlike the task graph), and `key.properties` is read above, so a
 * cached configuration is invalidated the moment the file appears or changes.
 */
val requestedReleaseBuild: Boolean = gradle.startParameter.taskNames.any { raw ->
  val task = raw.substringAfterLast(':').substringBefore(' ').trim().lowercase()
  // Anything that names the release variant, plus the three bare commands that
  // assemble every variant (`build` and `assemble` include Release).
  task.contains("release") || task == "build" || task == "assemble" || task == "bundle"
}

/** The message both checks share — keys only, never values. */
fun releaseSigningProblem(): String {
  val lines = mutableListOf("This release build cannot be signed.")
  if (missingSigningValues.isNotEmpty()) {
    lines += ""
    lines += "key.properties at ${keyPropertiesFile.absolutePath} is missing: " +
      missingSigningValues.joinToString(", ")
    if (!keyPropertiesFile.exists()) {
      lines += "(that file does not exist yet - copy key.properties.example at the repository root)"
    }
  }
  if (keystoreFileMissing) {
    lines += ""
    lines += "The keystore named by storeFile is not there: ${releaseStoreFile?.absolutePath}"
    lines += "(storeFile is resolved against the repository root, not against app/)"
  }
  lines += ""
  lines += "Fix: put storeFile, storePassword, keyAlias and keyPassword in key.properties at"
  lines += "the repository root, or set KEYSTORE_PATH, STORE_PASSWORD, KEY_ALIAS and"
  lines += "KEY_PASSWORD in the environment. The file is git-ignored on purpose: a"
  lines += "committed keystore has to be replaced."
  return lines.joinToString("\n")
}

if (requestedReleaseBuild && !releaseSigningReady) {
  throw GradleException(releaseSigningProblem())
}

/*
 * And nothing else.
 *
 * The obvious next step — a `doFirst { }` on bundleRelease that repeats this check
 * when the task actually runs — cannot live in this script. The configuration cache
 * serializes task state, and a lambda declared in a build script captures the script
 * object, which is not serializable. It failed exactly so:
 *
 *   Task `:app:bundleRelease` of type `org.gradle.api.DefaultTask`:
 *   cannot serialize Gradle script object references
 *
 * `gradle.taskGraph` is no better: the task graph is not readable from a
 * configuration-cached build at all. So the check is here, where `startParameter`
 * is a supported input, and it runs before a single task.
 *
 * One gap is worth naming: a task *abbreviation* (`./gradlew bR`) is not in
 * `taskNames` in any form this can match, so such a build would sign nothing and
 * produce an unsigned .aab. That is a build Play Console refuses at upload, with a
 * message of its own — a visible failure, not a silent one. Type the task name out.
 */
