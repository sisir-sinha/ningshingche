package dev.mekholi.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.mekholi.android.ui.LoginScreen
import dev.mekholi.android.ui.PosScreen

/**
 * The reference app's entry point.
 *
 * Two screens, because that is what the roadmap asked the reference to prove:
 * **login** (a real GoTrue password grant, the same one the browser makes) and
 * **POS** (the same `pos_catalog` read and the same `complete_sale` call, with a
 * client reference so a sale taken without a connection is not sold twice).
 *
 * Everything else in Mekholi — inventory, purchases, reports, the plugin
 * sidebar — is deliberately absent: the *shared* part is what needed proving,
 * and a reference that reimplemented the app would prove the opposite of what
 * it claims.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MekholiApp()
                }
            }
        }
    }
}

@Composable
private fun MekholiApp() {
    val viewModel: PosViewModel = viewModel()

    // A restored session means this till was already signed in — the normal
    // case for a shop tablet that is switched off every night.
    if (viewModel.session != null) {
        PosScreen(viewModel, onSignOut = { viewModel.signOut() })
    } else {
        LoginScreen(viewModel)
    }
}
