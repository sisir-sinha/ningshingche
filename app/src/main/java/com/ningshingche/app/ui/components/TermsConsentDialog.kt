package com.ningshingche.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.leading
import com.ningshingche.app.ui.theme.textSize

/** Bump in an additive migration when a material Terms update takes effect. */
const val TERMS_VERSION = "2026-11-21"

/** Public, no-login copy. The corresponding database value is migration-owned. */
const val TERMS_OF_USE_URL = "https://sisir-sinha.github.io/ningshingche/terms-of-use/"

/**
 * Explicit consent before a reader creates UGC.
 *
 * Visiting the Terms link, signing in, or tapping the primary button without
 * checking the box is not consent. The caller records acceptance on the server;
 * this component only captures the affirmative choice and remains open while that
 * request is in flight.
 */
@Composable
fun TermsConsentDialog(
    onAccept: () -> Unit,
    onDismiss: () -> Unit,
    accepting: Boolean = false
) {
    var checked by remember { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current

    AlertDialog(
        onDismissRequest = { if (!accepting) onDismiss() },
        title = {
            Text(
                text = t("ব্যবহারের শর্তাবলি"),
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = textSize(17),
                lineHeight = leading(17)
            )
        },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = t("প্রবন্ধ প্রকাশের জন্য জমা দেওয়ার আগে অনুগ্রহ করে আমাদের ব্যবহারের শর্তাবলি এবং কমিউনিটি নির্দেশিকা পড়ুন।"),
                    fontFamily = Kalpurush,
                    fontSize = textSize(13.5),
                    lineHeight = leading(13.5),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                listOf(
                    t("ঘৃণা, বর্ণবাদ, ধর্মীয় বিদ্বেষ বা কোনো গোষ্ঠীকে অপমান করা যাবে না।"),
                    t("হয়রানি, হুমকি বা কারো ব্যক্তিগত তথ্য অনুমতি ছাড়া প্রকাশ করা যাবে না।"),
                    t("যৌন স্পষ্ট বা শিশু-সংক্রান্ত যেকোনো অশ্লীলতা নিষিদ্ধ, এবং তা অবিলম্বে সরানো হবে।"),
                    t("আপনার অধিকারে নেই এমন গান, ছবি বা লেখা প্রকাশ করা যাবে না।"),
                    t("স্প্যাম, বিজ্ঞাপন, ছদ্মবেশ বা প্রতারণামূলক তথ্য ছড়ানো যাবে না।")
                ).forEach { rule ->
                    Text(
                        text = "• $rule",
                        fontFamily = Kalpurush,
                        fontSize = textSize(13),
                        lineHeight = leading(13)
                    )
                }

                TextButton(
                    onClick = { uriHandler.openUri(TERMS_OF_USE_URL) },
                    enabled = !accepting,
                    modifier = Modifier.testTag("terms_open_link")
                ) {
                    Text(
                        text = t("সম্পূর্ণ ব্যবহারের শর্তাবলি পড়ুন"),
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .toggleable(
                            value = checked,
                            enabled = !accepting,
                            role = Role.Checkbox,
                            onValueChange = { checked = it }
                        )
                        .testTag("terms_consent_row"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Checkbox(
                        checked = checked,
                        onCheckedChange = null,
                        enabled = !accepting,
                        modifier = Modifier.testTag("terms_consent_checkbox")
                    )
                    Text(
                        text = t("আমি ব্যবহারের শর্তাবলি এবং কমিউনিটি নির্দেশিকা পড়েছি এবং সম্মত হচ্ছি।"),
                        fontFamily = Kalpurush,
                        fontSize = textSize(13),
                        lineHeight = leading(13)
                    )
                }

                Text(
                    text = t("সম্মতি দিলেও প্রবন্ধটি সঙ্গে সঙ্গে প্রকাশিত হবে না; সম্পাদকীয় অনুমোদন প্রয়োজন।"),
                    fontFamily = Kalpurush,
                    fontSize = textSize(12.5),
                    lineHeight = leading(12.5),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = onAccept,
                enabled = checked && !accepting,
                modifier = Modifier.testTag("terms_accept")
            ) {
                if (accepting) {
                    CircularProgressIndicator(strokeWidth = 2.dp)
                } else {
                    Text(
                        text = t("সম্মত ও চালিয়ে যান"),
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = textSize(14),
                        lineHeight = leading(14)
                    )
                }
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                enabled = !accepting,
                modifier = Modifier.testTag("terms_decline")
            ) {
                Text(
                    text = t("বাতিল"),
                    fontFamily = Kalpurush,
                    fontSize = textSize(14),
                    lineHeight = leading(14)
                )
            }
        }
    )
}
