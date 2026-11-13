package com.ningshingche.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.leading
import com.ningshingche.app.ui.theme.textSize

/**
 * The terms gate, shown the first time a reader tries to write something.
 *
 * Play's User Generated Content policy asks that users accept the app's terms
 * *before* they can create or upload content, so this is attached to the composer
 * and to the comment form rather than to the first launch: reading the archive
 * should never require agreeing to anything, and a reader who never posts should
 * never see this.
 *
 * It shows the rules themselves, not a link. A dialog that says "read the terms
 * elsewhere" is a dialog nobody reads, and the policy is about the reader knowing
 * what is not allowed.
 *
 * The full document is backend/terms.html, linked from the footer and from
 * Settings; this is the part that matters at the moment of writing.
 */

/** Bump when the terms change in a way a reader should be asked about again. */
const val TERMS_VERSION = "2026-10-26"

@Composable
fun TermsConsentDialog(
    onAccept: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = t("পোস্ট করার আগে"),
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = textSize(17),
                lineHeight = leading(17)
            )
        },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = t(
                        "নিংশিং চে একটি সাংস্কৃতিক সংরক্ষণাগার। এখানে লেখা, ছবি, গান বা বই জমা করলে নিচের নিয়মগুলো মেনে চলার কথা আপনি স্বীকার করছেন।"
                    ),
                    fontFamily = Kalpurush,
                    fontSize = textSize(13.5),
                    lineHeight = leading(13.5),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                // The five rules that matter at the moment of writing, each in its
                // own t(…) so the language files can carry them.
                listOf(
                    t("ঘৃণা, বর্ণবাদ, ধর্মীয় বিদ্বেষ বা কোনো গোষ্ঠীকে অপমান করা যাবে না।"),
                    t("হয়রানি, হুমকি বা কারো ব্যক্তিগত তথ্য অনুমতি ছাড়া প্রকাশ করা যাবে না।"),
                    t("যৌন স্পষ্ট বা শিশু-সংক্রান্ত যেকোনো অশ্লীলতা নিষিদ্ধ, এবং তা অবিলম্বে সরানো হবে।"),
                    t("আপনার অধিকারে নেই এমন গান, ছবি বা লেখা প্রকাশ করা যাবে না।"),
                    t("স্প্যাম, বিজ্ঞাপন বা ভুয়া তথ্য ছড়ানো যাবে না।")
                ).forEach { rule ->
                    Text(
                        text = rule,
                        fontFamily = Kalpurush,
                        fontSize = textSize(13),
                        lineHeight = leading(13)
                    )
                }
                Text(
                    text = t(
                        "কিছু ভুল মনে হলে তার পাশের ⋯ মেনু বা রিপোর্ট বোতাম দিয়ে জানাতে পারবেন। সম্পাদক তা দেখে ব্যবস্থা নেবেন।"
                    ),
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
                modifier = Modifier.testTag("terms_accept")
            ) {
                Text(
                    text = t("সম্মত আছি"),
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = textSize(14),
                    lineHeight = leading(14)
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("terms_decline")) {
                Text(
                    text = t("পরে"),
                    fontFamily = Kalpurush,
                    fontSize = textSize(14),
                    lineHeight = leading(14)
                )
            }
        }
    )
}
