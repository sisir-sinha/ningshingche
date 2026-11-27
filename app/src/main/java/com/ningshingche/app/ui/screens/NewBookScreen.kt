package com.ningshingche.app.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.data.remote.BookPdfUploader
import com.ningshingche.app.data.remote.SatoruUploadClient
import com.ningshingche.app.ui.components.TermsConsentDialog
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.i18n.tNow
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.ReaderWorkspaceViewModel
import com.ningshingche.app.ui.viewmodel.TermsAcceptanceState
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewBookScreen(viewModel: ReaderWorkspaceViewModel, onBackClick: () -> Unit, onCompleteProfile: () -> Unit, onSubmitted: () -> Unit) {
    val context = LocalContext.current
    val user by viewModel.currentUser.collectAsStateWithLifecycle()
    val terms by viewModel.termsAcceptance.collectAsStateWithLifecycle()
    val consentOwner by rememberUpdatedState(user?.id)
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var author by remember { mutableStateOf("") }
    var edition by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    var date by remember { mutableStateOf("") }
    var pages by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var pdf by remember { mutableStateOf<Uri?>(null) }
    var uploaded by remember(pdf, user?.id) { mutableStateOf<SatoruUploadClient.UploadedFile?>(null) }
    var requestId by remember(pdf, user?.id) { mutableStateOf(UUID.randomUUID().toString()) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showTerms by remember(user?.id) { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { pdf = it }
    LaunchedEffect(user?.id) { if (user != null) viewModel.refreshTermsAcceptance() }

    fun submit() {
        val chosen = pdf
        val uid = user?.id
        if (uid == null || user?.isProfileComplete != true) { error = tNow("প্রোফাইল সম্পূর্ণ করুন।"); return }
        if (title.isBlank() || chosen == null) { error = tNow("শিরোনাম ও PDF ফাইল নির্বাচন করুন।"); return }
        if (title.trim().length > 250 || author.trim().length > 250 || edition.trim().length > 200 ||
            category.trim().length > 200 || description.trim().length > 10_000) {
            error = tNow("তথ্যের দৈর্ঘ্য অনুমোদিত সীমার বেশি।"); return
        }
        val dateParts = date.trim().split("-")
        val validDate = date.isBlank() || (date.trim().matches(Regex("\\d{4}-\\d{2}-\\d{2}")) && runCatching {
            val year = dateParts[0].toInt()
            require(year in 1..9999)
            java.util.GregorianCalendar(year, dateParts[1].toInt() - 1, dateParts[2].toInt())
                .apply { isLenient = false }.timeInMillis
        }.isSuccess)
        if (!validDate) { error = tNow("তারিখ YYYY-MM-DD আকারে লিখুন।"); return }
        val pageCount = if (pages.isBlank()) 0 else pages.toIntOrNull()
        if (pageCount == null || pageCount !in 0..1_000_000) { error = tNow("পৃষ্ঠার সংখ্যা সঠিক নয়।"); return }
        if (sending) return
        sending = true; error = null
        scope.launch {
            try {
                viewModel.bookSubmissionReady().getOrThrow()
                if (consentOwner != uid) return@launch
                val file = uploaded ?: BookPdfUploader.upload(context, chosen).getOrThrow().also { uploaded = it }
                if (consentOwner != uid) return@launch
                val payload = JSONObject().put("p_id", requestId).put("p_title", title.trim())
                    .put("p_author", author.trim()).put("p_edition", edition.trim())
                    .put("p_category", category.trim()).put("p_date", date.trim().takeIf { it.isNotBlank() } ?: JSONObject.NULL).put("p_pages", pageCount)
                    .put("p_size_mb", kotlin.math.round(file.sizeBytes / 1_048_576.0 * 100) / 100)
                    .put("p_description", description.trim()).put("p_link", file.publicUrl)
                viewModel.submitReaderBook(payload).getOrThrow()
                if (consentOwner == uid) onSubmitted()
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: tNow("বই জমা যায়নি।") }
            finally { sending = false }
        }
    }

    Scaffold(topBar = { TopAppBar(title = { Text(t("নতুন বই"), fontFamily = Kalpurush) },
        navigationIcon = { IconButton(onClick = onBackClick) { Icon(Icons.AutoMirrored.Filled.ArrowBack, t("ফিরুন")) } }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (user?.isProfileComplete != true) {
                Text(t("প্রোফাইল সম্পূর্ণ করুন।"), fontFamily = Kalpurush)
                Button(onClick = onCompleteProfile) { Text(t("প্রোফাইলে যান")) }
            } else {
                OutlinedTextField(title, { title = it }, label = { Text(t("শিরোনাম")) }, enabled = !sending, modifier = Modifier.fillMaxWidth().testTag("book_title"))
                OutlinedTextField(author, { author = it }, label = { Text(t("লেখক / সম্পাদক")) }, enabled = !sending, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(edition, { edition = it }, label = { Text(t("সংস্করণ")) }, enabled = !sending, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(category, { category = it }, label = { Text(t("বিভাগ")) }, enabled = !sending, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(date, { date = it }, label = { Text(t("প্রকাশের তারিখ (YYYY-MM-DD)")) }, enabled = !sending, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(pages, { pages = it }, label = { Text(t("পৃষ্ঠা সংখ্যা")) }, enabled = !sending, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(description, { description = it }, label = { Text(t("বিবরণ")) }, enabled = !sending, modifier = Modifier.fillMaxWidth())
                OutlinedButton(onClick = { picker.launch("application/pdf") }, enabled = !sending, modifier = Modifier.fillMaxWidth().testTag("book_pdf_pick")) { Text(t("PDF ফাইল নির্বাচন করুন")) }
                pdf?.let { Text(SatoruUploadClient.describe(context, it, "book.pdf").displayName, fontFamily = Kalpurush) }
                Text(t("বই পর্যালোচনার পর প্রকাশিত হবে। ফাইলটি তৃতীয় পক্ষের সার্ভারে থাকবে; লিংক জানা থাকলে অন্যরাও খুলতে পারে।"), fontFamily = Kalpurush)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontFamily = Kalpurush) }
                Button(onClick = {
                    if (title.isNotBlank() && pdf != null && terms != TermsAcceptanceState.ACCEPTED) showTerms = true else submit()
                }, enabled = !sending && terms != TermsAcceptanceState.ACCEPTING, modifier = Modifier.fillMaxWidth().testTag("book_submit")) {
                    if (sending) CircularProgressIndicator(modifier = Modifier.height(18.dp), strokeWidth = 2.dp)
                    else Text(t("জমা দিন"), fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
    if (showTerms) TermsConsentDialog(accepting = terms == TermsAcceptanceState.ACCEPTING,
        onAccept = {
            val requestedFor = user?.id
            scope.launch {
                val accepted = viewModel.acceptCurrentTerms()
                if (consentOwner == requestedFor && accepted) { showTerms = false; submit() }
            }
        }, onDismiss = { showTerms = false })
}
