package com.ningshingche.app.ui.screens

import android.media.MediaPlayer
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import kotlinx.coroutines.delay
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.ningshingche.app.data.music.MusicGenres
import com.ningshingche.app.data.portal.thumbnailOf
import com.ningshingche.app.ui.components.AppToasts
import com.ningshingche.app.ui.components.GenreCombobox
import com.ningshingche.app.ui.editorial.SocialEmbedPlayer
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
    var genres by remember { mutableStateOf<List<String>>(emptyList()) }
    var description by remember { mutableStateOf("") }
    var lyrics by remember { mutableStateOf("") }
    var videoLink by remember { mutableStateOf("") }
    var cover by remember { mutableStateOf<Uri?>(null) }
    var audio by remember { mutableStateOf<Uri?>(null) }

    LaunchedEffect(message) {
        val text = message ?: return@LaunchedEffect
        if (text.isBlank()) return@LaunchedEffect
        AppToasts.show(text)
        if (text.contains("জমা")) {
            title = ""; artist = ""; album = ""; genres = emptyList()
            description = ""; lyrics = ""; videoLink = ""; cover = null; audio = null
        }
        viewModel.clearMessage()
    }

    val coverPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        cover = uri
    }
    val audioPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        audio = uri
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("নতুন গান", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
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
                Text("গান আপলোড করতে আগে প্রোফাইল সম্পূর্ণ করুন।", fontFamily = Kalpurush)
                Button(onClick = onCompleteProfile) {
                    Text("প্রোফাইলে যান", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                }
                return@Column
            }

            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("শিরোনাম *", fontFamily = Kalpurush) },
                modifier = Modifier.fillMaxWidth().testTag("music_title")
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
            OutlinedButton(onClick = { coverPicker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
                Text(if (cover == null) "কভার ছবি (ঐচ্ছিক)" else "কভার ছবি বদলান", fontFamily = Kalpurush)
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
                        contentDescription = "কভার",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                    FilledTonalIconButton(
                        onClick = { cover = null },
                        modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)
                    ) {
                        Icon(Icons.Default.Close, contentDescription = "সরান")
                    }
                }
            }
            OutlinedButton(onClick = { audioPicker.launch("audio/*") }, modifier = Modifier.fillMaxWidth()) {
                Text(
                    if (audio == null) "MP3 Audio নির্বাচন *" else "অডিও বদলান",
                    fontFamily = Kalpurush
                )
            }
            audio?.let { uri ->
                Mp3Preview(uri = uri, onClear = { audio = null })
            }
            OutlinedTextField(
                value = videoLink,
                onValueChange = { videoLink = it },
                label = { Text("ভিডিও লিংক", fontFamily = Kalpurush) },
                placeholder = { Text("YouTube, Facebook, Veome Video Link Here", fontFamily = Kalpurush) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            val previewUrl = videoLink.trim()
            if (previewUrl.startsWith("http://", ignoreCase = true) ||
                previewUrl.startsWith("https://", ignoreCase = true)
            ) {
                val thumb = thumbnailOf(previewUrl)
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(16f / 9f)
                        .clip(RoundedCornerShape(12.dp))
                ) {
                    if (thumb.isNotBlank()) {
                        AsyncImage(
                            model = thumb,
                            contentDescription = "ভিডিও প্রিভিউ",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        SocialEmbedPlayer(
                            url = previewUrl,
                            modifier = Modifier.fillMaxSize(),
                            autoplay = false
                        )
                    }
                }
            }
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text("বিবরণ", fontFamily = Kalpurush) },
                minLines = 3,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = lyrics,
                onValueChange = { lyrics = it },
                label = { Text("লিরিক", fontFamily = Kalpurush) },
                minLines = 6,
                modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = {
                    viewModel.submitMusic(
                        context = context,
                        title = title,
                        artist = artist,
                        album = album,
                        genre = MusicGenres.join(genres),
                        description = description,
                        lyrics = lyrics,
                        videoLink = videoLink,
                        coverUri = cover,
                        audioUri = audio
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
private fun Mp3Preview(uri: Uri, onClear: () -> Unit) {
    val context = LocalContext.current
    val name = remember(uri) {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (cursor.moveToFirst() && idx >= 0) cursor.getString(idx) else null
            } ?: uri.lastPathSegment ?: "audio.mp3"
    }
    var player by remember(uri) { mutableStateOf<MediaPlayer?>(null) }
    var durationMs by remember(uri) { mutableIntStateOf(0) }
    var positionMs by remember(uri) { mutableIntStateOf(0) }
    var playing by remember(uri) { mutableStateOf(false) }
    var loadError by remember(uri) { mutableStateOf<String?>(null) }

    DisposableEffect(uri) {
        val mp = MediaPlayer()
        try {
            mp.setDataSource(context, uri)
            mp.setOnPreparedListener {
                durationMs = it.duration.coerceAtLeast(0)
                player = it
            }
            mp.setOnCompletionListener {
                playing = false
                positionMs = 0
                it.seekTo(0)
            }
            mp.setOnErrorListener { _, _, _ ->
                loadError = "অডিও চালানো যায়নি"
                playing = false
                true
            }
            mp.prepareAsync()
        } catch (_: Exception) {
            loadError = "অডিও খোলা যায়নি"
            mp.release()
        }
        onDispose {
            playing = false
            runCatching { mp.stop() }
            mp.release()
            player = null
        }
    }

    LaunchedEffect(playing, player) {
        while (playing) {
            positionMs = player?.currentPosition ?: 0
            delay(250)
        }
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    name,
                    modifier = Modifier.weight(1f),
                    fontFamily = Kalpurush,
                    maxLines = 1
                )
                FilledTonalIconButton(onClick = onClear, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Default.Close, contentDescription = "সরান")
                }
            }
            if (loadError != null) {
                Text(loadError!!, color = MaterialTheme.colorScheme.error, fontFamily = Kalpurush)
            } else {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilledTonalIconButton(
                        onClick = {
                            val mp = player ?: return@FilledTonalIconButton
                            if (playing) {
                                mp.pause()
                                playing = false
                            } else {
                                mp.start()
                                playing = true
                            }
                        },
                        enabled = player != null
                    ) {
                        Icon(
                            if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (playing) "বিরতি" else "চালান"
                        )
                    }
                    Slider(
                        value = if (durationMs > 0) positionMs.toFloat() / durationMs else 0f,
                        onValueChange = { fraction ->
                            val dest = ((durationMs) * fraction).toInt()
                            positionMs = dest
                            player?.seekTo(dest)
                        },
                        modifier = Modifier.weight(1f),
                        enabled = player != null && durationMs > 0
                    )
                    Text(
                        "${formatMs(positionMs)} / ${formatMs(durationMs)}",
                        style = MaterialTheme.typography.labelSmall
                    )
                }
            }
        }
    }
}

private fun formatMs(ms: Int): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val m = total / 60
    val s = total % 60
    return "%d:%02d".format(m, s)
}
