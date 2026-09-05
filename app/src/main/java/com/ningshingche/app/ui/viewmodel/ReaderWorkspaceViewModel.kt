package com.ningshingche.app.ui.viewmodel

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ningshingche.app.data.auth.GoogleAuthRepository
import com.ningshingche.app.data.remote.CommentRecord
import com.ningshingche.app.data.remote.ImgBbUploader
import com.ningshingche.app.data.remote.SubmittedBlogRecord
import com.ningshingche.app.data.remote.SupabaseClient
import com.ningshingche.app.data.remote.UserProfile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class ReaderMetrics(
    val totalArticles: Int = 0,
    val pendingArticles: Int = 0,
    val publishedArticles: Int = 0,
    val rejectedArticles: Int = 0,
    val comments: Int = 0
)

class ReaderWorkspaceViewModel(
    private val googleAuthRepository: GoogleAuthRepository,
    private val supabaseClient: SupabaseClient
) : ViewModel() {

    val currentUser: StateFlow<UserProfile?> = googleAuthRepository.currentUser

    private val _articles = MutableStateFlow<List<SubmittedBlogRecord>>(emptyList())
    val articles: StateFlow<List<SubmittedBlogRecord>> = _articles.asStateFlow()

    private val _comments = MutableStateFlow<List<CommentRecord>>(emptyList())
    val comments: StateFlow<List<CommentRecord>> = _comments.asStateFlow()

    private val _notifications = MutableStateFlow<List<UserNotificationRecord>>(emptyList())
    val notifications: StateFlow<List<UserNotificationRecord>> = _notifications.asStateFlow()

    private val _adminMessages = MutableStateFlow<List<AdminMessageRecord>>(emptyList())
    val adminMessages: StateFlow<List<AdminMessageRecord>> = _adminMessages.asStateFlow()

    private val _unreadCount = MutableStateFlow(0)
    val unreadCount: StateFlow<Int> = _unreadCount.asStateFlow()

    private val _metrics = MutableStateFlow(ReaderMetrics())
    val metrics: StateFlow<ReaderMetrics> = _metrics.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _isSaving = MutableStateFlow(false)
    val isSaving: StateFlow<Boolean> = _isSaving.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _avatarUploading = MutableStateFlow(false)
    val avatarUploading: StateFlow<Boolean> = _avatarUploading.asStateFlow()

    fun refresh() {
        val user = currentUser.value ?: return
        viewModelScope.launch {
            _isLoading.value = true
            val articleResult = supabaseClient.getMySubmittedBlogs(user.id, user.email)
            val commentResult = supabaseClient.getMyComments(user.id, user.email)
            val articles = articleResult.getOrDefault(emptyList())
            val comments = commentResult.getOrDefault(emptyList())
            _articles.value = articles
            _comments.value = comments
            _metrics.value = ReaderMetrics(
                totalArticles = articles.size,
                pendingArticles = articles.count { it.status.equals("Pending", true) },
                publishedArticles = articles.count {
                    it.status.equals("Published", true) || it.status.equals("Approved", true)
                },
                rejectedArticles = articles.count { it.status.equals("Rejected", true) },
                comments = comments.size
            )
            articleResult.exceptionOrNull()?.message?.let { _message.value = it }
            commentResult.exceptionOrNull()?.message?.let { if (_message.value == null) _message.value = it }
            _isLoading.value = false
        }
    }

    fun clearMessage() {
        _message.value = null
    }

    fun saveProfile(updated: UserProfile) {
        if (updated.displayFirstName.isBlank() || updated.displayLastName.isBlank()) {
            _message.value = "নামের প্রথম ও শেষ অংশ পূরণ করুন।"
            return
        }
        if (updated.about.isBlank()) {
            _message.value = "নিজের সম্পর্কে সংক্ষিপ্ত পরিচিতি লিখুন।"
            return
        }
        if (updated.phone.isBlank()) {
            _message.value = "ফোন নম্বর দিন।"
            return
        }
        if (updated.address.isBlank()) {
            _message.value = "ঠিকানা দিন।"
            return
        }
        if (updated.facebookId.isBlank()) {
            _message.value = "Facebook আইডি দিন।"
            return
        }
        if (updated.avatarUrl.isBlank()) {
            _message.value = "প্রোফাইল ছবি আপলোড করুন।"
            return
        }
        viewModelScope.launch {
            _isSaving.value = true
            _message.value = null
            val result = supabaseClient.updateReaderProfile(updated)
            result.onSuccess {
                _message.value = "প্রোফাইল সংরক্ষিত হয়েছে।"
            }.onFailure { error ->
                _message.value = error.message ?: "প্রোফাইল সংরক্ষণ যায়নি।"
            }
            _isSaving.value = false
        }
    }

    fun uploadAvatar(context: Context, uri: Uri) {
        val user = currentUser.value ?: return
        viewModelScope.launch {
            _avatarUploading.value = true
            _message.value = null
            val upload = ImgBbUploader.uploadFromUri(context, uri, "avatar_${user.id}")
            upload.onSuccess { image ->
                val next = user.copy(avatarUrl = image.displayUrl.ifBlank { image.url }, imgbbDeleteUrl = image.deleteUrl)
                val result = supabaseClient.updateReaderProfile(next)
                result.onFailure { _message.value = it.message ?: "ছবি সংরক্ষণ যায়নি।" }
            }.onFailure {
                _message.value = it.message ?: "ছবি আপলোড যায়নি।"
            }
            _avatarUploading.value = false
        }
    }

    fun submitArticle(title: String, content: String, thumbnailUri: Uri?, context: Context) {
        val user = currentUser.value ?: return
        if (!user.isProfileComplete) {
            _message.value = "নতুন প্রবন্ধ জমা দিতে আগে প্রোফাইল সম্পূর্ণ করুন।"
            return
        }
        if (title.isBlank() || content.isBlank()) {
            _message.value = "শিরোনাম ও লেখা আবশ্যক।"
            return
        }
        viewModelScope.launch {
            _isSaving.value = true
            _message.value = null
            var thumbnail = ""
            var deleteUrl = ""
            if (thumbnailUri != null) {
                val upload = ImgBbUploader.uploadFromUri(context, thumbnailUri, "article_${System.currentTimeMillis()}")
                val image = upload.getOrElse {
                    _isSaving.value = false
                    _message.value = it.message ?: "ছবি আপলোড যায়নি।"
                    return@launch
                }
                thumbnail = image.displayUrl.ifBlank { image.url }
                deleteUrl = image.deleteUrl
            }
            val record = SubmittedBlogRecord(
                id = UUID.randomUUID().toString(),
                title = title.trim(),
                designation = user.designation,
                address = user.address,
                phone = user.phone,
                thumbnail = thumbnail,
                imgbbDeleteUrl = deleteUrl,
                writerName = user.composedFullName(),
                writerDesignation = user.designation,
                writerProfileImage = user.avatarUrl,
                writerEmail = user.email,
                writerFacebook = user.facebookId,
                contentTitle = title.trim(),
                content = content.trim(),
                status = "Pending",
                userId = user.id
            )
            val result = supabaseClient.submitReaderArticle(record)
            result.onSuccess {
                _message.value = "লেখা জমা হয়েছে। সম্পাদকীয় পর্যালোচনার পর প্রকাশিত হবে।"
                refresh()
            }.onFailure {
                _message.value = it.message ?: "লেখা জমা যায়নি।"
            }
            _isSaving.value = false
        }
    }

    fun signOut() {
        viewModelScope.launch {
            googleAuthRepository.signOut()
        }
    }
}
