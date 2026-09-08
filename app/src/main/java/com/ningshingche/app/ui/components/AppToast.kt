package com.ningshingche.app.ui.components

import android.content.Intent
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.PortalSaffron
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

data class AppToast(
    val id: Long = System.nanoTime(),
    val message: String,
    val actionLabel: String? = null,
    val onAction: (() -> Unit)? = null,
    val durationMs: Long = 4_200L
)

object AppToasts {
    private val _events = MutableSharedFlow<AppToast>(extraBufferCapacity = 8)
    val events = _events.asSharedFlow()

    fun show(
        message: String,
        actionLabel: String? = null,
        onAction: (() -> Unit)? = null,
        durationMs: Long = 4_200L
    ) {
        _events.tryEmit(
            AppToast(
                message = message,
                actionLabel = actionLabel,
                onAction = onAction,
                durationMs = durationMs
            )
        )
    }

    fun undo(message: String, onUndo: () -> Unit) {
        show(message, actionLabel = "Undo", onAction = onUndo)
    }

    fun openSettings(message: String) {
        show(message, actionLabel = "Open Settings", onAction = OpenSettingsAction)
    }
}

/** Sentinel so the host can open system settings without capturing a Context. */
object OpenSettingsAction : () -> Unit {
    override fun invoke() = Unit
}

@Composable
fun BoxScope.AppToastHost(
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var current by remember { mutableStateOf<AppToast?>(null) }

    LaunchedEffect(Unit) {
        AppToasts.events.collect { toast ->
            current = toast
        }
    }
    LaunchedEffect(current?.id) {
        val toast = current ?: return@LaunchedEffect
        delay(toast.durationMs)
        if (current?.id == toast.id) current = null
    }

    AnimatedVisibility(
        visible = current != null,
        enter = fadeIn() + slideInVertically { it / 2 },
        exit = fadeOut() + slideOutVertically { it / 2 },
        modifier = modifier
            .align(Alignment.BottomCenter)
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        val toast = current
        if (toast != null) {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = Color(0xE61A0C0A),
                shadowElevation = 8.dp
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = toast.message,
                        color = Color.White,
                        fontFamily = Kalpurush,
                        fontSize = 14.sp,
                        modifier = Modifier.weight(1f)
                    )
                    if (!toast.actionLabel.isNullOrBlank()) {
                        TextButton(
                            onClick = {
                                val action = toast.onAction
                                current = null
                                if (action === OpenSettingsAction) {
                                    runCatching {
                                        context.startActivity(
                                            Intent(Settings.ACTION_WIRELESS_SETTINGS).addFlags(
                                                Intent.FLAG_ACTIVITY_NEW_TASK
                                            )
                                        )
                                    }.onFailure {
                                        runCatching {
                                            context.startActivity(
                                                Intent(Settings.ACTION_SETTINGS).addFlags(
                                                    Intent.FLAG_ACTIVITY_NEW_TASK
                                                )
                                            )
                                        }
                                    }
                                } else {
                                    action?.invoke()
                                }
                            }
                        ) {
                            Text(
                                text = toast.actionLabel,
                                color = PortalSaffron,
                                fontFamily = Kalpurush,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            )
                        }
                    }
                }
            }
        }
    }
}
