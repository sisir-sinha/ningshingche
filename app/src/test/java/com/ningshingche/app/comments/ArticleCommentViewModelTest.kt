package com.ningshingche.app.comments

import androidx.lifecycle.viewModelScope
import com.ningshingche.app.data.preferences.CommenterDetails
import com.ningshingche.app.data.preferences.CommenterDetailsStore
import com.ningshingche.app.data.remote.UserProfile
import com.ningshingche.app.data.remote.UserRole
import com.ningshingche.app.ui.reader.ArticleUiState
import com.ningshingche.app.ui.reader.ArticleViewModel
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ArticleCommentViewModelTest {
    private val models = mutableListOf<ArticleViewModel>()
    private val person = UserProfile(id = "22222222-2222-4222-8222-222222222222", fullName = "Reader Name",
        email = "reader@example.test", phone = "+8801700000000", role = UserRole.AUTHOR)
    private class Store(initial: CommenterDetails = CommenterDetails()) : CommenterDetailsStore {
        val state = MutableStateFlow(initial)
        override val details: Flow<CommenterDetails> = state
        val saved = mutableListOf<CommenterDetails>()
        var failSave = false
        override suspend fun save(details: CommenterDetails) {
            if (failSave) throw IOException("Fixture storage unavailable")
            saved += details; state.value = details
        }
    }
    @Before fun setUp() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun tearDown() { models.forEach { it.viewModelScope.cancel() }; Dispatchers.resetMain() }
    private suspend fun reader(api: CommentApiFixture, store: Store, user: MutableStateFlow<UserProfile?>): ArticleViewModel {
        val vm = ArticleViewModel(api.repository, store, user).also { models += it }
        withTimeout(10000) { vm.commentForm.first { it.detailsLoaded && it.identityFromAccount == (user.value != null) } }
        vm.load(CommentApiFixture.BLOG_ID)
        withTimeout(10000) { vm.state.first { it is ArticleUiState.Ready } }
        return vm
    }
    private suspend fun awaitSubmit(vm: ArticleViewModel) = withTimeout(10000) { vm.isPostingComment.first { !it } }

    @Test fun `guest cannot submit even if a method is called directly`() = runBlocking {
        CommentApiFixture().use { api ->
            val vm = reader(api, Store(), MutableStateFlow(null))
            vm.updateCommentForm(vm.commentForm.value.copy(content = "Guest comment"))
            vm.postComment()
            assertEquals(0, api.posts.get())
            assertTrue(vm.commentStatus.value!!.contains("সাইন ইন"))
        }
    }
    @Test fun `signed in comment sends profile identity and clears draft on success`() = runBlocking {
        CommentApiFixture().use { api ->
            val store = Store()
            val vm = reader(api, store, MutableStateFlow<UserProfile?>(person))
            vm.updateCommentForm(vm.commentForm.value.copy(content = "Comment text"))
            vm.postComment(); awaitSubmit(vm)
            assertEquals(1, api.posts.get())
            assertEquals("", vm.commentForm.value.content)
            assertTrue(store.saved.isEmpty())
            assertTrue(vm.commentStatus.value!!.contains("অনুমোদনের পর"))
            assertTrue((vm.state.value as ArticleUiState.Ready).comments.isEmpty())
        }
    }
    @Test fun `signing out or switching accounts clears the previous reader draft and details`() = runBlocking {
        CommentApiFixture().use { api ->
            val account = MutableStateFlow<UserProfile?>(person)
            val vm = reader(api, Store(CommenterDetails("Old", "old@example.test", "999")), account)
            vm.updateCommentForm(vm.commentForm.value.copy(content = "Private draft"))
            account.value = null
            withTimeout(5000) { vm.commentForm.first { !it.identityFromAccount } }
            assertEquals("", vm.commentForm.value.content)
            assertEquals("", vm.commentForm.value.email)
            vm.postComment()
            assertEquals(0, api.posts.get())
            account.value = person.copy(id = "33333333-3333-4333-8333-333333333333", fullName = "Another Reader", email = "other@example.test", phone = "")
            withTimeout(5000) { vm.commentForm.first { it.name == "Another Reader" } }
            assertEquals("", vm.commentForm.value.phone)
            assertEquals("", vm.commentForm.value.content)
        }
    }
    @Test fun `failed submission keeps draft and may be retried`() = runBlocking {
        CommentApiFixture().use { api ->
            api.responseCode = 403
            api.responseBody = """{"code":"42501","message":"Comment rejected by policy"}"""
            val store = Store()
            val vm = reader(api, store, MutableStateFlow<UserProfile?>(person))
            vm.updateCommentForm(vm.commentForm.value.copy(content = "Keep this draft"))
            vm.postComment(); awaitSubmit(vm)
            assertEquals("Keep this draft", vm.commentForm.value.content)
            assertTrue(vm.commentForm.value.isError)
            assertTrue(store.saved.isEmpty())
            api.responseCode = 201; api.responseBody = ""
            vm.postComment(); awaitSubmit(vm)
            assertEquals(2, api.posts.get())
            assertEquals("", vm.commentForm.value.content)
        }
    }
    @Test fun `rapid taps create one request and preserve draft while sending`() = runBlocking {
        CommentApiFixture().use { api ->
            api.blockPosts = true
            val vm = reader(api, Store(), MutableStateFlow<UserProfile?>(person))
            vm.updateCommentForm(vm.commentForm.value.copy(content = "One comment"))
            vm.postComment(); vm.postComment()
            assertTrue(api.enteredPost.await(5, TimeUnit.SECONDS))
            vm.updateCommentForm(vm.commentForm.value.copy(content = "Other"))
            assertEquals("One comment", vm.commentForm.value.content)
            api.releasePost.countDown(); awaitSubmit(vm)
            assertEquals(1, api.posts.get())
        }
    }
    @Test fun `empty comment is rejected locally`() = runBlocking {
        CommentApiFixture().use { api ->
            val vm = reader(api, Store(), MutableStateFlow<UserProfile?>(person))
            vm.postComment()
            assertEquals(0, api.posts.get())
            assertTrue(vm.commentForm.value.isError)
        }
    }
    @Test fun `legacy guest storage is not needed for authenticated submission`() = runBlocking {
        CommentApiFixture().use { api ->
            val store = Store().also { it.failSave = true }
            val vm = reader(api, store, MutableStateFlow<UserProfile?>(person))
            vm.updateCommentForm(vm.commentForm.value.copy(content = "Comment"))
            vm.postComment(); awaitSubmit(vm)
            assertEquals(1, api.posts.get())
            assertTrue(vm.commentStatus.value!!.contains("মন্তব্য জমা হয়েছে"))
            assertEquals("", vm.commentForm.value.content)
        }
    }
}
