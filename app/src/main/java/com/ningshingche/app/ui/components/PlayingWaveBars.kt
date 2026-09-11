package com.ningshingche.app.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.sin

/** The blue of the playing indicator, taken from the artwork the portal uses for it. */
val PlayingWaveBlue = Color(0xFF0005FF)

/**
 * The bar heights, tallest in the middle.
 *
 * An envelope, not a random spread: the wave in the middle of a list row reads
 * as "this one is playing" because its shape repeats, and a bar that suddenly
 * shrinks to nothing looks like a glitch.
 */
private val WaveEnvelope = listOf(
    0.18f, 0.34f, 0.46f, 0.60f, 0.82f, 0.62f, 1.00f,
    0.68f, 0.54f, 0.46f, 0.36f, 0.28f, 0.16f
)

/** One full sweep of the travelling bump, in milliseconds. */
private const val WavePeriodMs = 1300

/** Visible travel inside one period. 0.35 keeps every bar above nothing. */
private const val WaveFloor = 0.35f

/**
 * The animated "now playing" bars.
 *
 * Drawn as a single travelling wave instead of one animation per bar: a
 * per-bar `animateFloat` call inside a loop shares one `remember` slot, so all
 * the bars would move in lockstep. One phase driving a sine through the
 * [WaveEnvelope] gives each bar its own height for the same drawing cost, and
 * nothing to key.
 *
 * [animated] `false` freezes the wave mid-sweep — a paused track stays marked
 * as the loaded one without pretending to play.
 */
@Composable
fun PlayingWaveBars(
    modifier: Modifier = Modifier,
    animated: Boolean = true,
    color: Color = PlayingWaveBlue,
    barCount: Int = WaveEnvelope.size,
    barWidth: Dp = 3.dp,
    barGap: Dp = 2.dp,
    height: Dp = 22.dp
) {
    val transition = rememberInfiniteTransition(label = "playing_wave")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = WavePeriodMs, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "wave_phase"
    )
    val sweep = if (animated) phase else 0.2f

    Row(
        modifier = modifier.height(height),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(barGap)
    ) {
        repeat(barCount) { index ->
            val ceiling = WaveEnvelope[index % WaveEnvelope.size]
            // The bump travels left to right, one bar behind the next.
            val wave = sin(2.0 * PI * (sweep + index / barCount.toFloat()))
            val level = ceiling * (WaveFloor + (1f - WaveFloor) * ((wave + 1.0) / 2.0).toFloat())
            Box(
                modifier = Modifier
                    .width(barWidth)
                    .height((height * level).coerceAtLeast(2.dp))
                    .clip(WaveNeedleShape)
                    .background(color)
            )
        }
    }
}

/**
 * A slim bar with pinched ends, the shape the wave bars are drawn with.
 *
 * The tips are capped at half the width so a two-pixel bar is a needle rather
 * than an hourglass.
 */
private object WaveNeedleShape : Shape {
    override fun createOutline(
        size: Size,
        layoutDirection: LayoutDirection,
        density: Density
    ): Outline {
        val width = size.width
        val height = size.height
        if (width <= 0f || height <= 0f) return Outline.Rectangle(Rect(0f, 0f, width, height))
        val tip = (width / 2f).coerceAtMost(height / 2f)
        val path = Path().apply {
            moveTo(width / 2f, 0f)
            lineTo(width, tip)
            lineTo(width, height - tip)
            lineTo(width / 2f, height)
            lineTo(0f, height - tip)
            lineTo(0f, tip)
            close()
        }
        return Outline.Generic(path)
    }
}
