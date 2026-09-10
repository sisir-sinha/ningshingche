package com.ningshingche.app.ui.screens

import android.media.MediaPlayer
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import com.ningshingche.app.data.music.MusicGenres
import com.ningshingche.app.ui.components.GenreCombobox
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
    var genres by remember { mutableStateOf(listOf<String>()) }
    var audio by remember { mutableStateOf<Uri?>(null) }
    var audioName by remember { mutableStateOf("") }
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
            genres = emptyList()
            audio = null
            audioName = ""
            cover = null
        }
        viewModel.clearMessage()
    }

    val coverPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        cover = uri
    }
    val audioPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        audio = uri
        audioName = uri?.lastPathSegment.orEmpty().substringAfterLast('/').ifBlank { "song.mp3" }
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
            GenreCombobox(
                selected = genres,
                onSelectedChange = { genres = it }
            )
            OutlinedButton(
                onClick = { audioPicker.launch("audio/*") },
                modifier = Modifier.fillMaxWidth().testTag("music_audio_pick")
            ) {
                Text(
                    if (audio == null) "এমপি৩ নির্বাচন" else "এমপি৩ বদলান",
                    fontFamily = Kalpurush
                )
            }
            audio?.let { uri ->
                SongPreview(
                    uri = uri,
                    name = audioName,
                    onClear = {
                        audio = null
                        audioName = ""
                    }
                )
            }
            OutlinedButton(onClick = { coverPicker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
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
                    viewModel.submitMusic(
                        title = title,
                        artist = artist,
                        album = album,
                        genre = MusicGenres.join(genres),
                        audioUri = audio,
                        coverUri = cover,
                        context = context
                    )
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

@Composable
private fun SongPreview(uri: Uri, name: String, onClear: () -> Unit) {
    val context = LocalContext.current
    var playing by remember(uri) { mutableStateOf(false) }
    var durationMs by remember(uri) { mutableStateOf(0) }
    val player = remember(uri) {
        runCatching {
            MediaPlayer().apply {
                setDataSource(context, uri)
                prepare()
                setOnCompletionListener { playing = false }
            }
        }.getOrNull()
    }
    LaunchedEffect(player) {
        durationMs = player?.duration ?: 0
    }
    DisposableEffect(player) {
        onDispose {
            playing = false
            player?.release()
        }
    }
    Surface(
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            FilledTonalIconButton(
                onClick = {
                    val media = player ?: return@FilledTonalIconButton
                    if (playing) {
                        media.pause()
                        playing = false
                    } else {
                        media.start()
                        playing = true
                    }
                },
                enabled = player != null
            ) {
                Icon(
                    if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = if (playing) "থামান" else "শুনুন"
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(name.ifBlank { "গান" }, fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text(
                    if (durationMs > 0) formatDuration(durationMs) else "প্রিভিউ",
                    fontFamily = Kalpurush,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            IconButton(onClick = onClear, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.Close, contentDescription = "সরান")
            }
        }
    }
}

private fun formatDuration(ms: Int): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val m = total / 60
    val s = total % 60
    return "%d:%02d".format(m, s)
}
