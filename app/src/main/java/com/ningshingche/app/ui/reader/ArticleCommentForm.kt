package com.ningshingche.app.ui.reader

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Comment
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.theme.Kalpurush

/** Stateless fields: drafts live only in the article ViewModel, never in saved instance state. */
@Composable
internal fun ArticleCommentForm(
    form: CommentFormState,
    status: String?,
    isPosting: Boolean,
    onFormChange: (CommentFormState) -> Unit,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier
) {
    val tokens = LocalEditorialTokens.current
    val editable = form.detailsLoaded && !isPosting
    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = tokens.accent,
        unfocusedBorderColor = tokens.rule
    )
    val fieldStyle = TextStyle(fontFamily = Kalpurush, fontSize = 15.sp)

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        border = BorderStroke(1.2.dp, tokens.accent.copy(alpha = 0.35f)),
        modifier = modifier.fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.md)
            .testTag("article_comment_form")
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.Comment, contentDescription = null, tint = tokens.accent, modifier = Modifier.size(22.dp))
                Text("মন্তব্য করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold,
                    fontSize = 16.5.sp, color = MaterialTheme.colorScheme.onSurface)
            }
            Text(
                text = "লগইন লাগবে না। নাম ও মন্তব্য আবশ্যক; ইমেইল ও ফোন ঐচ্ছিক।",
                fontFamily = Kalpurush, fontSize = 13.sp, color = tokens.inkMuted
            )
            if (!form.detailsLoaded) {
                Text("সংরক্ষিত তথ্য লোড হচ্ছে...", fontFamily = Kalpurush, fontSize = 13.sp, color = tokens.inkMuted)
            }
            OutlinedTextField(
                value = form.name,
                onValueChange = { onFormChange(form.copy(name = it)) },
                label = { Text("আপনার নাম *", fontFamily = Kalpurush) },
                singleLine = true, enabled = editable, textStyle = fieldStyle,
                shape = RoundedCornerShape(10.dp), colors = fieldColors,
                modifier = Modifier.fillMaxWidth().testTag("comment_name")
            )
            OutlinedTextField(
                value = form.email,
                onValueChange = { onFormChange(form.copy(email = it)) },
                label = { Text("ইমেইল (ঐচ্ছিক)", fontFamily = Kalpurush) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                singleLine = true, enabled = editable, textStyle = fieldStyle,
                shape = RoundedCornerShape(10.dp), colors = fieldColors,
                modifier = Modifier.fillMaxWidth().testTag("comment_email")
            )
            OutlinedTextField(
                value = form.phone,
                onValueChange = { onFormChange(form.copy(phone = it)) },
                label = { Text("ফোন (ঐচ্ছিক)", fontFamily = Kalpurush) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true, enabled = editable, textStyle = fieldStyle,
                shape = RoundedCornerShape(10.dp), colors = fieldColors,
                modifier = Modifier.fillMaxWidth().testTag("comment_phone")
            )
            OutlinedTextField(
                value = form.content,
                onValueChange = { onFormChange(form.copy(content = it)) },
                label = { Text("আপনার মূল্যবান মন্তব্য *", fontFamily = Kalpurush) },
                minLines = 3, maxLines = 8, enabled = editable, textStyle = fieldStyle,
                shape = RoundedCornerShape(10.dp), colors = fieldColors,
                modifier = Modifier.fillMaxWidth().testTag("comment_content")
            )
            Text(
                text = "সফলভাবে পাঠানোর পর নাম, ইমেইল ও ফোন শুধু এই ডিভাইসে মনে রাখা হবে। মন্তব্যের লেখা মনে রাখা হবে না।",
                fontFamily = Kalpurush, fontSize = 12.sp, color = tokens.inkMuted
            )
            Spacer(Modifier.height(2.dp))
            Button(
                onClick = onSubmit,
                enabled = editable && form.name.isNotBlank() && form.content.isNotBlank(),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = tokens.accent, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth().testTag("comment_submit")
            ) {
                if (isPosting) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                } else {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null, modifier = Modifier.size(16.dp))
                }
                Spacer(Modifier.width(8.dp))
                Text("মন্তব্য জমা দিন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }
            if (!status.isNullOrBlank()) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = if (form.isError) MaterialTheme.colorScheme.errorContainer else tokens.accentSoft,
                    modifier = Modifier.fillMaxWidth().testTag("comment_status")
                ) {
                    Text(status, fontFamily = Kalpurush, fontSize = 13.sp,
                        color = if (form.isError) MaterialTheme.colorScheme.onErrorContainer else tokens.accent,
                        modifier = Modifier.padding(10.dp))
                }
            }
        }
    }
}
