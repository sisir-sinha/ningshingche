package com.example.comments

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.example.data.preferences.CommenterDetails
import com.example.data.preferences.CommenterPreferencesRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CommenterPreferencesTest {
    @get:Rule val folder = TemporaryFolder()

    @Test
    fun `details survive store recreation and file contains only name email phone`() = runBlocking {
        val file = folder.root.resolve("commenter_details.preferences_pb")
        val firstJob = SupervisorJob()
        val firstStore = PreferenceDataStoreFactory.create(scope = CoroutineScope(firstJob + Dispatchers.IO)) { file }
        val repository = CommenterPreferencesRepository(firstStore)
        assertEquals(CommenterDetails(), repository.details.first())
        repository.save(CommenterDetails("  পাঠক  ", " reader@example.test ", " +880 1700000000 "))
        val expected = CommenterDetails("পাঠক", "reader@example.test", "+880 1700000000")
        assertEquals(expected, repository.details.first())
        assertEquals(setOf("commenter_name", "commenter_email", "commenter_phone"),
            firstStore.data.first().asMap().keys.map { it.name }.toSet())
        firstJob.cancelAndJoin()

        val secondJob = SupervisorJob()
        try {
            val reopened = CommenterPreferencesRepository(
                PreferenceDataStoreFactory.create(scope = CoroutineScope(secondJob + Dispatchers.IO)) { file }
            )
            assertEquals(expected, reopened.details.first())
            reopened.save(CommenterDetails("Reader", "", ""))
            assertEquals(CommenterDetails("Reader", "", ""), reopened.details.first())
        } finally {
            secondJob.cancelAndJoin()
        }
    }
}
