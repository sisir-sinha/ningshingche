package com.ningshingche.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ArticleDao {
    @Query("SELECT * FROM articles ORDER BY publishedDate DESC")
    fun getAllArticles(): Flow<List<ArticleEntity>>

    @Query("SELECT * FROM articles WHERE id = :id LIMIT 1")
    suspend fun getArticleById(id: String): ArticleEntity?

    @Query("SELECT * FROM articles WHERE id = :idOrSlug OR slug = :idOrSlug LIMIT 1")
    suspend fun getArticleByIdOrSlug(idOrSlug: String): ArticleEntity?

    @Query("SELECT * FROM articles WHERE isFeatured = 1 ORDER BY publishedDate DESC")
    fun getFeaturedArticles(): Flow<List<ArticleEntity>>

    @Query("SELECT * FROM articles WHERE categorySlug = :categorySlug ORDER BY publishedDate DESC")
    fun getArticlesByCategory(categorySlug: String): Flow<List<ArticleEntity>>

    @Query("SELECT * FROM articles WHERE authorId = :authorId ORDER BY publishedDate DESC")
    fun getArticlesByAuthor(authorId: String): Flow<List<ArticleEntity>>

    @Query("SELECT * FROM articles WHERE year = :year ORDER BY publishedDate DESC")
    fun getArticlesByYear(year: Int): Flow<List<ArticleEntity>>

    @Query("SELECT * FROM articles WHERE title LIKE '%' || :query || '%' OR content LIKE '%' || :query || '%' OR authorName LIKE '%' || :query || '%' OR category LIKE '%' || :query || '%'")
    fun searchArticles(query: String): Flow<List<ArticleEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertArticles(articles: List<ArticleEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertArticle(article: ArticleEntity)


    @Query("DELETE FROM articles")
    suspend fun clearAll()

    @Query("DELETE FROM articles WHERE id LIKE 'art-%'")
    suspend fun deleteSeedArticles()

}

@Dao
interface BookmarkDao {
    @Query("SELECT * FROM bookmarks ORDER BY savedAtTimestamp DESC")
    fun getAllBookmarks(): Flow<List<BookmarkEntity>>

    @Query("SELECT EXISTS(SELECT 1 FROM bookmarks WHERE articleId = :articleId)")
    fun isBookmarked(articleId: String): Flow<Boolean>

    @Query("SELECT EXISTS(SELECT 1 FROM bookmarks WHERE articleId = :articleId)")
    suspend fun isBookmarkedDirect(articleId: String): Boolean

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertBookmark(bookmark: BookmarkEntity)

    @Query("DELETE FROM bookmarks WHERE articleId = :articleId")
    suspend fun deleteBookmark(articleId: String)

    @Query("DELETE FROM bookmarks")
    suspend fun clearAll()
}

@Dao
interface HistoryDao {
    @Query("SELECT * FROM reading_history ORDER BY readAtTimestamp DESC")
    fun getAllHistory(): Flow<List<HistoryEntity>>



    @Query("DELETE FROM reading_history")
    suspend fun clearAll()
}

@Dao
interface SearchDao {
    @Query("SELECT * FROM search_history ORDER BY timestamp DESC LIMIT 15")
    fun getRecentSearches(): Flow<List<SearchHistoryEntity>>

    @Query("DELETE FROM search_history")
    suspend fun clearAll()
}

@Dao
interface ChatDao {


    @Query("SELECT * FROM ai_chat_messages WHERE articleId = :articleId ORDER BY timestamp ASC")
    suspend fun getMessagesForArticle(articleId: String): List<ChatMessageEntity>


    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: ChatMessageEntity)



    @Query("DELETE FROM ai_chat_messages")
    suspend fun clearAll()
}

@Dao
interface MusicLibraryDao {
    @Query("SELECT * FROM music_playlists WHERE userId = :userId ORDER BY kind DESC, createdAt DESC")
    fun playlists(userId: String): Flow<List<MusicPlaylistEntity>>


    @Query("SELECT * FROM music_playlists WHERE id = :id LIMIT 1")
    suspend fun playlistById(id: String): MusicPlaylistEntity?

    @Query("SELECT * FROM music_playlists WHERE userId = :userId AND kind = 'loved' LIMIT 1")
    suspend fun lovedPlaylist(userId: String): MusicPlaylistEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPlaylist(playlist: MusicPlaylistEntity)

    @Query("DELETE FROM music_playlists WHERE id = :id AND userId = :userId")
    suspend fun deletePlaylist(id: String, userId: String)

    @Query("SELECT * FROM music_offline ORDER BY savedAt DESC")
    fun offline(): Flow<List<MusicOfflineEntity>>


    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertOffline(item: MusicOfflineEntity)

    @Query("DELETE FROM music_offline WHERE trackId = :trackId")
    suspend fun deleteOffline(trackId: String)
}