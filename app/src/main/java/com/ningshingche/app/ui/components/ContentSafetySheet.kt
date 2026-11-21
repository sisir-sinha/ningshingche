package com.ningshingche.app.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.i18n.tNow
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.leading
import com.ningshingche.app.ui.theme.textSize
import kotlinx.coroutines.launch

/**
 * Report and block — the two controls Google Play's User Generated Content policy
 * requires from an app that hosts what readers write.
 *
 * One sheet serves every surface that can be reported (a forum answer, a thread, an
 * article comment, an AI answer) because the policy is the same everywhere: the
 * reader must be able to file a complaint *from the content*, without leaving it,
 * and must be told the complaint arrived.
 *
 * What the sheet deliberately does not do:
 *
 *  - it does not hide the content the moment it is tapped. A one-tap hide is a
 *    button for silencing people; the report reaches an editor, who decides.
 *  - it does not ask for a name or an email. The database already knows who is
 *    asking, and asking a reader to identify themselves is how a report never
 *    arrives.
 *  - it does not reveal whether the item was already reported.
 */

/** The reason codes the database accepts (migration 040). */
private val REPORT_REASON_CODES = listOf(
    "harassment",
    "hate",
    "sexual",
    "violence",
    "spam",
    "copyright",
    "misinformation",
    "impersonation",
    "other"
)

/**
 * The words for those codes.
 *
 * A `when` rather than a map of pairs on purpose: every Bengali literal here sits
 * inside its own `t(…)`, which is what lets a reader in another language change
 * this sheet, and what the interface sweep checks for.
 */
private fun reasonLabel(code: String): String = when (code) {
    "harassment" -> t("হয়রানি বা বুলিং")
    "hate" -> t("ঘৃণা বা বিদ্বেষ")
    "sexual" -> t("অশ্লীল বা যৌন স্পষ্ট")
    "violence" -> t("সহিংসতা বা হুমকি")
    "spam" -> t("স্প্যাম বা বিজ্ঞাপন")
    "copyright" -> t("কপিরাইট লঙ্ঘন")
    "misinformation" -> t("মিথ্যা তথ্য")
    "impersonation" -> t("অন্যের পরিচয়ে প্রতারণা")
    else -> t("অন্যান্য")
}

/**
 * One dialog, two questions: why is this wrong, and should this person be blocked.
 *
 * @param onReport `reason` -> whether the report was filed.
 * @param onBlock  null when the author is unknown (an anonymous comment) or is the
 *                 reader themselves, which is what removes the block row.
 * @param onDismiss called after either action, or when the reader closes the sheet.
 */
@Composable
fun ContentReportDialog(
    title: String,
    onReport: suspend (String) -> Result<Boolean>,
    onBlock: (suspend () -> Result<Boolean>)? = null,
    onReportWithNote: (suspend (String, String) -> Result<Boolean>)? = null,
    onDismiss: () -> Unit
) {
    var selected by remember { mutableStateOf(REPORT_REASON_CODES.first()) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }
    var blocked by remember { mutableStateOf(false) }
    var confirmBlock by remember { mutableStateOf(false) }
    // Both actions are network calls, so they run in the composition's scope rather
    // than inside an onClick, which is not a suspend context.
    val scope = rememberCoroutineScope()

    if (confirmBlock && onBlock != null) {
        AlertDialog(
            onDismissRequest = { if (!busy) confirmBlock = false },
            title = { Text(t("এই লেখককে ব্লক করুন"), fontFamily = Kalpurush) },
            text = { Text(t("ব্লক করা হলেও এখনো সব জায়গায় এই ব্যবহারকারীর কনটেন্ট লুকানো হয় না। আপনি কি নিশ্চিত?"), fontFamily = Kalpurush) },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    if (!busy) {
                        busy = true
                        error = null
                        scope.launch {
                            onBlock.invoke()
                                .onSuccess { success ->
                                    if (success) blocked = true else error = tNow("ব্লক করা যায়নি। আবার চেষ্টা করুন।")
                                }
                                .onFailure { error = tNow("ব্লক করা যায়নি। আবার চেষ্টা করুন।") }
                            busy = false
                            confirmBlock = false
                        }
                    }
                }) { Text(t("ব্লক করুন"), fontFamily = Kalpurush) }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = { confirmBlock = false }) { Text(t("বাতিল")) } }
        )
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = if (sent) Icons.Default.Check else Icons.Default.Flag,
                    contentDescription = null,
                    tint = if (sent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (sent) t("রিপোর্ট জমা হয়েছে") else title,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = textSize(16),
                    lineHeight = leading(16)
                )
            }
        },
        text = {
            if (sent) {
                Text(
                    text = t(
                        "আপনার রিপোর্টটি জমা হয়েছে। আমাদের মডারেশন টিম বিষয়টি পর্যালোচনা করবে।"
                    ),
                    fontFamily = Kalpurush,
                    fontSize = textSize(14),
                    lineHeight = leading(14),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        text = t("কী সমস্যা?"),
                        fontFamily = Kalpurush,
                        fontSize = textSize(13),
                        lineHeight = leading(13),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    REPORT_REASON_CODES.forEach { code ->
                        val isSelected = code == selected
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = if (isSelected) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surface,
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(
                                    width = if (isSelected) 1.5.dp else 1.dp,
                                    color = if (isSelected) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.outlineVariant,
                                    shape = RoundedCornerShape(10.dp)
                                )
                                .clickable(enabled = !busy) { selected = code }
                                .testTag("report_reason_$code")
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = reasonLabel(code),
                                    fontFamily = Kalpurush,
                                    fontSize = textSize(14),
                                    lineHeight = leading(14),
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    modifier = Modifier.weight(1f)
                                )
                                if (isSelected) {
                                    Icon(
                                        imageVector = Icons.Default.Check,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }
                        }
                    }
                    if (onReportWithNote != null) {
                        OutlinedTextField(
                            value = note,
                            onValueChange = { note = it.take(1000) },
                            label = { Text(t("বিস্তারিত (ঐচ্ছিক)"), fontFamily = Kalpurush) },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().testTag("report_note")
                        )
                    }
                    if (!error.isNullOrBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = error.orEmpty(),
                            fontSize = textSize(12),
                            lineHeight = leading(12),
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                    if (onBlock != null && !blocked) {
                        Spacer(Modifier.height(6.dp))
                        TextButton(
                            onClick = { confirmBlock = true },
                            modifier = Modifier.testTag("report_block_author")
                        ) {
                            Icon(
                                imageVector = Icons.Default.Block,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                text = t("এই লেখককে ব্লক করুন"),
                                fontFamily = Kalpurush,
                                fontSize = textSize(13),
                                lineHeight = leading(13)
                            )
                        }
                    }
                    if (blocked) {
                        Text(
                            text = t("ব্লক সংরক্ষিত হয়েছে।"),
                            fontFamily = Kalpurush,
                            fontSize = textSize(12),
                            lineHeight = leading(12),
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }
        },
        confirmButton = {
            if (sent) {
                TextButton(onClick = onDismiss, modifier = Modifier.testTag("report_done")) {
                    Text(
                        text = t("ঠিক আছে"),
                        fontWeight = FontWeight.Bold,
                        fontSize = textSize(14),
                        lineHeight = leading(14)
                    )
                }
            } else {
                TextButton(
                    enabled = !busy,
                    modifier = Modifier.testTag("report_submit"),
                    onClick = {
                        if (busy) return@TextButton
                        busy = true
                        error = null
                        val chosen = selected
                        scope.launch {
                            val result = if (onReportWithNote != null) onReportWithNote(chosen, note.trim()) else onReport(chosen)
                            result
                                .onSuccess { accepted ->
                                    if (accepted) sent = true else error = tNow("রিপোর্ট পাঠানো যায়নি। আবার চেষ্টা করুন।")
                                }
                                .onFailure {
                                    error = tNow("রিপোর্ট পাঠানো যায়নি। আবার চেষ্টা করুন।")
                                }
                            busy = false
                        }
                    }
                ) {
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(15.dp),
                            strokeWidth = 2.dp
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(
                        text = t("রিপোর্ট পাঠান"),
                        fontWeight = FontWeight.Bold,
                        fontSize = textSize(14),
                        lineHeight = leading(14)
                    )
                }
            }
        },
        dismissButton = {
            if (!sent) {
                TextButton(enabled = !busy, onClick = onDismiss) {
                    Text(
                        text = t("বাতিল"),
                        fontSize = textSize(14),
                        lineHeight = leading(14)
                    )
                }
            }
        }
    )
}

/**
 * The report control on a piece of content that has no long-press of its own — an
 * article comment, an AI answer — so the complaint still sits on the thing it is
 * about rather than in a menu somewhere else.
 */
@Composable
fun ContentSafetyRow(
    onReport: () -> Unit,
    modifier: Modifier = Modifier
) {
    TextButton(
        onClick = onReport,
        modifier = modifier.testTag("content_report_button")
    ) {
        Icon(
            imageVector = Icons.Default.Flag,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(13.dp)
        )
        Spacer(Modifier.width(4.dp))
        Text(
            text = t("রিপোর্ট"),
            fontFamily = Kalpurush,
            fontSize = textSize(11),
            lineHeight = leading(11),
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
