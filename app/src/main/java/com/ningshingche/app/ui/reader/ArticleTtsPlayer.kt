package com.ningshingche.app.ui.reader

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import com.ningshingche.app.data.portal.stripHtml
import java.util.Locale

/**
 * State for Voice Synthesis TTS Player.
 */
enum class TtsPlayState {
    IDLE,
    INITIALIZING,
    PLAYING,
    PAUSED,
    COMPLETED,
    ERROR
}

/**
 * Helper class managing Android TextToSpeech engine.
 */
class ArticleTtsController(
    private val context: Context,
    private val onStateChange: (TtsPlayState) -> Unit,
    private val onError: (String) -> Unit
) {
    private var tts: TextToSpeech? = null
    private var isInitialized = false
    private var textChunks: List<String> = emptyList()
    private var currentChunkIndex = 0
    private var speechRate = 1.0f

    init {
        tts = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                isInitialized = true
                val bnLocale = Locale("bn", "BD")
                val langResult = tts?.setLanguage(bnLocale)
                if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                    val genericBn = Locale("bn", "IN")
                    val resultGeneric = tts?.setLanguage(genericBn)
                    if (resultGeneric == TextToSpeech.LANG_MISSING_DATA || resultGeneric == TextToSpeech.LANG_NOT_SUPPORTED) {
                        val simpleBn = Locale("bn")
                        val res = tts?.setLanguage(simpleBn)
                        if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                            tts?.setLanguage(Locale.getDefault())
                        }
                    }
                }

                // Select high-quality Female Bengali voice if available on Android device
                try {
                    val voices = tts?.voices
                    if (!voices.isNullOrEmpty()) {
                        val bestFemaleVoice = voices
                            .filter { voice ->
                                val lang = voice.locale?.language.orEmpty()
                                lang.equals("bn", ignoreCase = true) ||
                                    voice.locale?.toLanguageTag()?.startsWith("bn", ignoreCase = true) == true
                            }
                            .sortedWith(
                                compareByDescending<Voice> { voice ->
                                    val name = voice.name.lowercase()
                                    var score = 0
                                    // Detect female voice signatures in Google TTS, Samsung TTS, and other engines
                                    if (name.contains("female") || name.contains("fem") ||
                                        name.contains("ban-local") || name.contains("ban-network") ||
                                        name.contains("bin-local") || name.contains("bin-network") ||
                                        name.contains("wavenet-a") || name.contains("wavenet-c") ||
                                        name.contains("neural2-a") || name.contains("neural2-c") ||
                                        name.contains("-f-") || name.contains("_f_") || name.endsWith("-f")
                                    ) {
                                        score += 60
                                    }
                                    if (voice.quality == Voice.QUALITY_VERY_HIGH) {
                                        score += 30
                                    } else if (voice.quality == Voice.QUALITY_HIGH) {
                                        score += 20
                                    } else if (voice.quality == Voice.QUALITY_NORMAL) {
                                        score += 10
                                    }
                                    if (!voice.isNetworkConnectionRequired) {
                                        score += 5
                                    }
                                    if (voice.locale?.country.equals("BD", ignoreCase = true)) {
                                        score += 5
                                    }
                                    score
                                }
                            )
                            .firstOrNull()

                        if (bestFemaleVoice != null) {
                            tts?.voice = bestFemaleVoice
                        }
                    }
                } catch (_: Throwable) {}

                tts?.setPitch(1.05f)
                tts?.setSpeechRate(speechRate)
                setupListener()
            } else {
                onStateChange(TtsPlayState.ERROR)
                onError("ভয়েস ইঞ্জিন প্রস্তুত করা যায়নি।")
            }
        }
    }

    private fun setupListener() {
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                onStateChange(TtsPlayState.PLAYING)
            }

            override fun onDone(utteranceId: String?) {
                currentChunkIndex++
                if (currentChunkIndex < textChunks.size) {
                    speakCurrentChunk()
                } else {
                    onStateChange(TtsPlayState.COMPLETED)
                }
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                onStateChange(TtsPlayState.ERROR)
                onError("পড়ে শোনানোর সময় ত্রুটি হয়েছে।")
            }
        })
    }

    fun setSpeechRate(rate: Float) {
        speechRate = rate
        tts?.setSpeechRate(rate)
    }

    fun start(title: String, htmlContent: String) {
        val cleanBody = stripHtml(htmlContent)
        val fullText = "$title. $cleanBody"

        // Break into sentences/chunks for smooth playback and responsiveness
        textChunks = fullText.split(Regex("([।?!\\n\\.]+)"))
            .map { it.trim() }
            .filter { it.length > 1 }

        if (textChunks.isEmpty()) {
            onError("পড়ার মতো কোনো লেখা পাওয়া যায়নি।")
            return
        }

        currentChunkIndex = 0
        if (!isInitialized) {
            onStateChange(TtsPlayState.INITIALIZING)
        } else {
            speakCurrentChunk()
        }
    }

    private fun speakCurrentChunk() {
        if (currentChunkIndex >= textChunks.size) {
            onStateChange(TtsPlayState.COMPLETED)
            return
        }
        val chunk = textChunks[currentChunkIndex]
        val params = Bundle().apply {
            putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "chunk_$currentChunkIndex")
        }
        tts?.speak(chunk, TextToSpeech.QUEUE_FLUSH, params, "chunk_$currentChunkIndex")
        onStateChange(TtsPlayState.PLAYING)
    }

    fun pause() {
        tts?.stop()
        onStateChange(TtsPlayState.PAUSED)
    }

    fun resume() {
        if (currentChunkIndex < textChunks.size) {
            speakCurrentChunk()
        } else {
            currentChunkIndex = 0
            speakCurrentChunk()
        }
    }

    fun stop() {
        tts?.stop()
        currentChunkIndex = 0
        onStateChange(TtsPlayState.IDLE)
    }

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
    }
}

