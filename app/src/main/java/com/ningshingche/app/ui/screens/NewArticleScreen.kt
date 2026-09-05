package com.ningshingche.app.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.ui.components.HtmlContentEditor
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.ReaderWorkspaceViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewArticleScreen(
    viewModel: ReaderWorkspaceViewModel,
    onBackClick: () -> Unit,
    onCompleteProfile: () -> Unit
) {
    val context = LocalContext.current
    val user by viewModel.currentUser.collectAsStateWithLifecycle()
    val saving by viewModel.isSaving.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    var title by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    var thumbnail by remember { mutableStateOf<Uri?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        val text = message ?: return@LaunchedEffect
        if (text.isBlank()) return@LaunchedEffect
        snackbarHostState.showSnackbar(text)
        if (text.startsWith("লেখা জমা হয়েছে")) {
            title = ""
            content = ""
            thumbnail = null
        }
        viewModel.clearMessage()
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        thumbnail = uri
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("নতুন প্রবন্ধ", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "ফিরুন")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (user?.isProfileComplete != true) {
                Text("নতুন প্রবন্ধ জমা দিতে আগে প্রোফাইল সম্পূর্ণ করুন।", fontFamily = Kalpurush)
                Button(onClick = onCompleteProfile) {
                    Text("প্রোফাইলে যান", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                }
                return@Column
            }

            Text(
                "লেখা সম্পাদকীয় পর্যালোচনার পর প্রকাশিত হবে। মূল লেখা WYSIWYG বা HTML মোডে লিখুন।",
                fontFamily = Kalpurush,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("শিরোনাম", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth().testTag("article_title")
            )
            Text("মূল লেখা", fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold)
            HtmlContentEditor(
                value = content,
                onValueChange = { content = it },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedButton(onClick = { picker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
                Text(
                    if (thumbnail == null) "কভার ছবি নির্বাচন (ঐচ্ছিক)" else "ছবি নির্বাচিত",
                    fontFamily = Kalpurush
                )
            }
            Button(
                onClick = { viewModel.submitArticle(title, content, thumbnail, context) },
                enabled = !saving,
                modifier = Modifier.fillMaxWidth().height(48.dp).testTag("article_submit")
            ) {
                if (saving) {
                    CircularProgressIndicator(modifier = Modifier.height(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("জমা দিন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
