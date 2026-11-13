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
 * Where the upload key lives, and why it is not in this file.
 *
 * A keystore and its passwords are a Play Console credential: whoever holds them
 * can sign an APK that Google accepts as the next update to this app. They were
 * briefly committed here, in a public repository, which meant they had to be
 * treated as stolen and replaced — so the file is gone, and the build reads the
 * values from somewhere that is not git:
 *
 *   1. `key.properties` at the repo root (git-ignored; copy the .example), or
 *   2. the environment: KEYSTORE_PATH, STORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD,
 *      which is what a CI runner should set.
 *
 * Neither present is a normal state: `assembleDebug` still works, and a release
 * build fails loudly below rather than shipping an unsigned APK that would only
 * be refused by Play much later.
 */
val keystoreProperties = Properties().apply {
  val file = rootProject.file("key.properties")
  if (file.exists()) FileInputStream(file).use { load(it) }
}

/** Environment first (CI), then key.properties (a workstation). */
fun signingValue(env: String, key: String): String? =
  System.getenv(env)?.takeIf { it.isNotBlank() } ?: keystoreProperties.getProperty(key)?.takeIf { it.isNotBlank() }

val releaseStorePath: String? = signingValue("KEYSTORE_PATH", "storeFile")
val releaseStoreFile = releaseStorePath?.let { rootProject.file(it) }?.takeIf { it.exists() }
val releaseStorePassword = signingValue("STORE_PASSWORD", "storePassword")
val releaseKeyAlias = signingValue("KEY_ALIAS", "keyAlias")
val releaseKeyPassword = signingValue("KEY_PASSWORD", "keyPassword")

android {
  namespace = "com.ningshingche.app"
  compileSdk { version = release(36) { minorApiLevel = 1 } }

  defaultConfig {
    applicationId = "com.ningshingche.app"
    minSdk = 24
    targetSdk = 36
    versionCode = 35
    versionName = "1.0"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

    // Phones only. x86/x86_64 Pdfium copies are for emulators and doubled the APK.
    ndk {
      abiFilters += listOf("armeabi-v7a", "arm64-v8a")
    }
  }

  signingConfigs {
    // Only when the key is actually on this machine, so a checkout without it
    // fails at the release task (below) instead of at configuration time, which
    // would also break `assembleDebug`.
    if (releaseStoreFile != null) {
      create("release") {
        storeFile = releaseStoreFile
        storePassword = releaseStorePassword
        keyAlias = releaseKeyAlias
        keyPassword = releaseKeyPassword
      }
    }
    val customDebugKey = file("${rootDir}/debug.keystore")
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
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      // Set below, only if the key is here; the task-graph check at the end of
      // this file makes a release build without one fail with instructions
      // rather than produce an unsigned APK.
      signingConfigs.findByName("release")?.let { signingConfig = it }
    }
    debug {
      signingConfigs.findByName("debugConfig")?.let { signingConfig = it }
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
 * A release build with no key is a build that cannot go to Play.
 *
 * Without this, `assembleRelease` happily produces an unsigned APK and the problem
 * surfaces at the upload — or worse, at install. Checked against the task graph so
 * `assembleDebug` and every other task stay untouched on a machine that has no key.
 */
gradle.taskGraph.whenReady {
  val buildingRelease = allTasks.any { task ->
    (task.name.startsWith("assemble") || task.name.startsWith("bundle")) &&
      task.name.contains("Release", ignoreCase = true)
  }
  if (buildingRelease && signingConfigs.findByName("release") == null) {
    throw GradleException(
      "This release build has no signing key. Create key.properties at the repository " +
        "root (copy key.properties.example) pointing storeFile at your .jks, or set " +
        "KEYSTORE_PATH, STORE_PASSWORD, KEY_ALIAS and KEY_PASSWORD in the environment. " +
        "The file is git-ignored on purpose: a committed keystore has to be replaced."
    )
  }
}
