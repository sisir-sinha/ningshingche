package com.ningshingche.app.comments

import com.ningshingche.app.data.preferences.CommenterDetails
import com.ningshingche.app.data.preferences.CommenterDetailsStore
import com.ningshingche.app.ui.reader.ArticleUiState
import com.ningshingche.app.ui.reader.ArticleViewModel
import com.ningshingche.app.ui.reader.CommentFormState
import androidx.lifecycle.viewModelScope
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

    private class Store(initial: CommenterDetails = CommenterDetails()) : CommenterDetailsStore {
        val state = MutableStateFlow(initial)
        override val details: Flow<CommenterDetails> = state
        val saved = mutableListOf<CommenterDetails>()
        var failSave = false
        override suspend fun save(details: CommenterDetails) {
            if (failSave) throw IOException("Fixture storage unavailable")
            saved += details
            state.value = details
        }
    }

    @Before fun setUp() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun tearDown() {
        models.forEach { it.viewModelScope.cancel() }
        Dispatchers.resetMain()
    }

    private suspend fun reader(api: CommentApiFixture, store: Store): ArticleViewModel {
        val vm = ArticleViewModel(api.repository, store).also { models += it }
        withTimeout(10000) { vm.commentForm.first { it.detailsLoaded } }
        vm.load(CommentApiFixture.BLOG_ID)
        withTimeout(10000) { vm.state.first { it is ArticleUiState.Ready } }
        return vm
    }

    private suspend fun awaitSubmit(vm: ArticleViewModel) {
        withTimeout(10000) { vm.isPostingComment.first { !it } }
    }

    @Test fun `successful anonymous comment saves identity only and starts next article with blank content`() = runBlocking {
        CommentApiFixture().use { api ->
            val store = Store()
            val vm = reader(api, store)
            vm.updateCommentForm(vm.commentForm.value.copy(name = " পাঠক ", email = " reader@example.test ",
                phone = " +880 1700000000 ", content = "এই মন্তব্যটি ক্যাশে রাখা যাবে না"))
            vm.postComment()
            awaitSubmit(vm)
            assertEquals(1, api.posts.get())
            assertEquals(listOf(CommenterDetails("পাঠক", "reader@example.test", "+880 1700000000")), store.saved)
            assertEquals("", vm.commentForm.value.content)
            assertFalse(vm.commentForm.value.isError)
            assertTrue(vm.commentStatus.value!!.contains("অনুমোদনের পর"))
            assertTrue("Pending comments must not appear published", (vm.state.value as ArticleUiState.Ready).comments.isEmpty())
            val next = reader(api, store)
            assertEquals("পাঠক", next.commentForm.value.name)
            assertEquals("reader@example.test", next.commentForm.value.email)
            assertEquals("+880 1700000000", next.commentForm.value.phone)
            assertEquals("", next.commentForm.value.content)
        }
    }

    @Test fun `name and comment alone work and clear previously cached optional details`() = runBlocking {
        CommentApiFixture().use { api ->
            val store = Store(CommenterDetails("Old name", "old@example.test", "12345"))
            val vm = reader(api, store)
            vm.updateCommentForm(vm.commentForm.value.copy(name = "Anonymous reader", email = "", phone = "", content = "Hello"))
            vm.postComment()
            awaitSubmit(vm)
            assertEquals(1, api.posts.get())
            assertEquals(CommenterDetails("Anonymous reader", "", ""), store.saved.single())
            assertEquals("", vm.commentForm.value.content)
        }
    }

    @Test fun `rejected comment preserves every input and does not replace cached details`() = runBlocking {
        CommentApiFixture().use { api ->
            api.responseCode = 403
            api.responseBody = """{"code":"42501","message":"Comment rejected by policy"}"""
            val old = CommenterDetails("Saved reader", "saved@example.test", "12345")
            val store = Store(old)
            val vm = reader(api, store)
            val draft = vm.commentForm.value.copy(name = "New name", email = "new@example.test", phone = "67890", content = "Keep this draft")
            vm.updateCommentForm(draft)
            vm.postComment()
            awaitSubmit(vm)
            assertEquals(draft.copy(isError = true), vm.commentForm.value)
            assertEquals("Comment rejected by policy", vm.commentStatus.value)
            assertTrue(store.saved.isEmpty())
            assertEquals(old, store.state.value)
            assertFalse(vm.isPostingComment.value)
            api.responseCode = 201
            api.responseBody = ""
            vm.postComment() // Explicit retry, not an automatic duplicate.
            awaitSubmit(vm)
            assertEquals(2, api.posts.get())
            assertEquals("", vm.commentForm.value.content)
            assertEquals(1, store.saved.size)
        }
    }

    @Test fun `rapid taps create one POST and fields cannot change while sending`() = runBlocking {
        CommentApiFixture().use { api ->
            api.blockPosts = true
            val store = Store()
            val vm = reader(api, store)
            val draft = vm.commentForm.value.copy(name = "Reader", content = "One comment")
            vm.updateCommentForm(draft)
            vm.postComment()
            vm.postComment()
            assertTrue(api.enteredPost.await(5, TimeUnit.SECONDS))
            assertTrue(vm.isPostingComment.value)
            vm.updateCommentForm(draft.copy(content = "A different draft"))
            assertEquals("One comment", vm.commentForm.value.content)
            api.releasePost.countDown()
            awaitSubmit(vm)
            assertEquals(1, api.posts.get())
            assertEquals(1, store.saved.size)
        }
    }

    @Test fun `required fields and malformed optional email prevent API calls`() = runBlocking {
        CommentApiFixture().use { api ->
            val store = Store()
            val vm = reader(api, store)
            for (form in listOf(
                CommentFormState(name = "  ", content = "Text", detailsLoaded = true),
                CommentFormState(name = "Name", content = "  ", detailsLoaded = true),
                CommentFormState(name = "Name", email = "invalid", content = "Text", detailsLoaded = true)
            )) {
                vm.updateCommentForm(form)
                vm.postComment()
                assertTrue(vm.commentForm.value.isError)
                assertFalse(vm.isPostingComment.value)
            }
            assertEquals(0, api.posts.get())
            assertTrue(store.saved.isEmpty())
        }
    }

    @Test fun `local cache failure is not reported as a failed comment submission`() = runBlocking {
        CommentApiFixture().use { api ->
            val store = Store().also { it.failSave = true }
            val vm = reader(api, store)
            vm.updateCommentForm(vm.commentForm.value.copy(name = "Reader", content = "Comment"))
            vm.postComment()
            awaitSubmit(vm)
            assertEquals(1, api.posts.get())
            assertEquals("", vm.commentForm.value.content)
            assertFalse(vm.commentForm.value.isError)
            assertTrue(vm.commentStatus.value!!.contains("মন্তব্য জমা হয়েছে"))
            assertTrue(vm.commentStatus.value!!.contains("মনে রাখা যায়নি"))
            assertTrue(store.saved.isEmpty())
        }
    }
}
