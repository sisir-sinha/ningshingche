/**
 * The Android reference.
 *
 * Two modules, and the split is the point: `:core` is plain Kotlin — the RPC
 * surface, the outbox and the sync loop, with no Android API in it — and `:app`
 * is the Compose shell around it. Everything worth testing lives in `:core`,
 * which is why it can be compiled and run against the live project by a plain
 * JDK (see `npm run e2e:android`).
 */
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Mekholi"
include(":core", ":app")
