plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // JSON only. No HTTP library and no Supabase SDK: the reference client uses
    // `HttpURLConnection`, so it demonstrates that the RPC surface is reachable
    // with what the platform already ships.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
}
