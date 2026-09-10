# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

-keepattributes SourceFile,LineNumberTable
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepattributes AnnotationDefault
-renamesourcefileattribute SourceFile

# AndroidPdfViewer / Pdfium (JNI)
-keep class com.shockwave.** { *; }
-keep class com.github.barteksc.** { *; }
-dontwarn com.shockwave.**
-dontwarn com.github.barteksc.**

# WebView JavaScript bridge (article editor)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.ningshingche.app.ui.components.HtmlBridge { *; }

# Moshi (KSP adapters + annotated DTOs)
-keep class com.squareup.moshi.** { *; }
-keep class **JsonAdapter { *; }
-keep @com.squareup.moshi.JsonClass class * { *; }
-keepclassmembers class * {
    @com.squareup.moshi.FromJson *;
    @com.squareup.moshi.ToJson *;
}
-dontwarn com.squareup.moshi.**

# Retrofit / OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}

# Kotlin / coroutines
-keep class kotlin.Metadata { *; }
-dontwarn kotlinx.coroutines.**

# Media3 playback (music player + notification)
-keep class androidx.media3.** { *; }

# Credential Manager / Google Sign-In
-keep class androidx.credentials.** { *; }
-keep class com.google.android.libraries.identity.googleid.** { *; }

# Compose (navigation args, rememberSaveable)
-dontwarn androidx.compose.**
