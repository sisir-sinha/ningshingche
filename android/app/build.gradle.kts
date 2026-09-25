plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "dev.mekholi.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.mekholi.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        // The shop's project address and its *publishable* key. They come from
        // gradle.properties (see android/README.md) and are empty by default, so
        // a checkout with no configuration builds and then says so on screen
        // rather than talking to the wrong shop.
        //
        // There is no service-role key here, and there must never be one: it
        // bypasses RLS, which is the only thing separating one shop's data from
        // another's (spec §44).
        buildConfigField("String", "SUPABASE_URL", "\"${project.findProperty("mekholi.supabaseUrl") ?: ""}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${project.findProperty("mekholi.supabaseAnonKey") ?: ""}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":core"))

    implementation(platform("androidx.compose:compose-bom:2024.09.02"))
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
