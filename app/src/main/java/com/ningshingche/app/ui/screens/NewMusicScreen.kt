package com.ningshingche.app.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.ReaderWorkspaceViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewMusicScreen(
    viewModel: ReaderWorkspaceViewModel,
    onBackClick: () -> Unit,
    onCompleteProfile: () -> Unit
) {
    val context = LocalContext.current
    val user by viewModel.currentUser.collectAsStateWithLifecycle()
    val saving by viewModel.isSaving.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    var title by remember { mutableStateOf("") }
    var artist by remember { mutableStateOf("") }
    var album by remember { mutableStateOf("") }
    var genre by remember { mutableStateOf("") }
    var audioUrl by remember { mutableStateOf("") }
    var cover by remember { mutableStateOf<Uri?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        val text = message ?: return@LaunchedEffect
        if (text.isBlank()) return@LaunchedEffect
        snackbarHostState.showSnackbar(text)
        if (text.startsWith("গান জমা হয়েছে")) {
            title = ""
            artist = ""
            album = ""
            genre = ""
            audioUrl = ""
            cover = null
        }
        viewModel.clearMessage()
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        cover = uri
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text("নতুন গান", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                },
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
                Text("নতুন গান জমা দিতে আগে প্রোফাইল সম্পূর্ণ করুন।", fontFamily = Kalpurush)
                Button(onClick = onCompleteProfile) {
                    Text("প্রোফাইলে যান", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                }
                return@Column
            }

            Text(
                "কভার ছবি ImgBB-তে আপলোড হয়। অডিও ফাইল সরাসরি আপলোড হয় না — একটি পাবলিক অডিও লিংক দিন।",
                fontFamily = Kalpurush,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("শিরোনাম", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth().testTag("music_title"),
                leadingIcon = { Icon(Icons.Default.LibraryMusic, contentDescription = null) }
            )
            OutlinedTextField(
                value = artist,
                onValueChange = { artist = it },
                label = { Text("শিল্পী", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = album,
                onValueChange = { album = it },
                label = { Text("অ্যালবাম", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = genre,
                onValueChange = { genre = it },
                label = { Text("ধরন", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = audioUrl,
                onValueChange = { audioUrl = it },
                label = { Text("অডিও লিংক", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth().testTag("music_audio_url")
            )
            OutlinedButton(onClick = { picker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
                Text(
                    if (cover == null) "কভার ছবি নির্বাচন (ঐচ্ছিক)" else "কভার ছবি বদলান",
                    fontFamily = Kalpurush
                )
            }
            if (cover != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp)
                        .clip(RoundedCornerShape(12.dp))
                ) {
                    AsyncImage(
                        model = cover,
                        contentDescription = "কভার ছবি",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                    FilledTonalIconButton(
                        onClick = { cover = null },
                        modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)
                    ) {
                        Icon(Icons.Default.Close, contentDescription = "কভার ছবি সরান")
                    }
                }
            }
            Button(
                onClick = {
                    viewModel.submitMusic(title, artist, album, genre, audioUrl, cover, context)
                },
                enabled = !saving,
                modifier = Modifier.fillMaxWidth().height(48.dp).testTag("music_submit")
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
