package com.ningshingche.app.ui.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.leading
import com.ningshingche.app.ui.theme.textSize
import kotlinx.coroutines.delay

@Composable
fun SplashScreen(onSplashComplete: () -> Unit, modifier: Modifier = Modifier) {
    var started by remember { mutableStateOf(false) }
    // Ensure tapping to skip cannot also invoke the delayed callback.
    var completed by remember { mutableStateOf(false) }
    val progress by animateFloatAsState(
        targetValue = if (started) 1f else 0f,
        animationSpec = tween(durationMillis = 1500, easing = LinearEasing),
        label = "splash_progress"
    )
    LaunchedEffect(Unit) {
        started = true
        delay(1500L)
        if (!completed) { completed = true; onSplashComplete() }
    }
    val tokens = LocalEditorialTokens.current
    Box(
        modifier = modifier.fillMaxSize().background(tokens.paper)
            .clickable { if (!completed) { completed = true; onSplashComplete() } }
            .testTag("splash_screen"),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
            Text(t("নিংশিং চে"), fontFamily = Kalpurush, fontWeight = FontWeight.Bold,
                fontSize = textSize(36), lineHeight = leading(36),
                color = if (tokens.isDark) tokens.ink else tokens.accent, textAlign = TextAlign.Center)
            Spacer(Modifier.height(8.dp))
            Text(t("বিষ্ণুপ্রিয়া মণিপুরি ডিজিটাল কমিউনিটি"), fontFamily = Kalpurush,
                fontWeight = FontWeight.Medium, fontSize = textSize(15), lineHeight = leading(15),
                color = tokens.second, textAlign = TextAlign.Center)
            Spacer(Modifier.height(40.dp))
            Box(Modifier.width(140.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(tokens.rule)) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(progress).clip(RoundedCornerShape(2.dp))
                    .background(if (tokens.isDark) tokens.second else tokens.accent))
            }
        }
    }
}
