package com.ningshingche.app.data.music

import com.ningshingche.app.data.portal.MusicTrack

enum class MusicShelfKind { Genre, Artist, Album }

data class MusicShelf(
    val kind: MusicShelfKind,
    val name: String,
    val imageUrl: String,
    val description: String,
    val trackCount: Int
)

object MusicCatalogIndex {

    fun matches(track: MusicTrack, query: String): Boolean {
        val needle = query.trim()
        if (needle.isEmpty()) return true
        return track.title.contains(needle, ignoreCase = true) ||
            track.artist.contains(needle, ignoreCase = true) ||
            track.album.contains(needle, ignoreCase = true) ||
            track.genre.contains(needle, ignoreCase = true) ||
            track.description.contains(needle, ignoreCase = true) ||
            track.lyrics.contains(needle, ignoreCase = true)
    }

    fun artists(tracks: List<MusicTrack>): List<MusicShelf> =
        group(tracks, MusicShelfKind.Artist) { listOf(it.artist.trim()).filter { name -> name.isNotEmpty() } }

    fun albums(tracks: List<MusicTrack>): List<MusicShelf> =
        group(tracks, MusicShelfKind.Album) { listOf(it.album.trim()).filter { name -> name.isNotEmpty() } }

    fun genres(tracks: List<MusicTrack>): List<MusicShelf> =
        group(tracks, MusicShelfKind.Genre) { MusicGenres.parse(it.genre) }

    fun tracksFor(kind: MusicShelfKind, name: String, tracks: List<MusicTrack>): List<MusicTrack> {
        val key = name.trim()
        if (key.isEmpty()) return emptyList()
        return tracks.filter { track ->
            when (kind) {
                MusicShelfKind.Artist -> track.artist.equals(key, ignoreCase = true)
                MusicShelfKind.Album -> track.album.equals(key, ignoreCase = true)
                MusicShelfKind.Genre -> MusicGenres.parse(track.genre).any { it.equals(key, ignoreCase = true) }
            }
        }
    }

    fun shelf(kind: MusicShelfKind, name: String, tracks: List<MusicTrack>): MusicShelf? =
        when (kind) {
            MusicShelfKind.Artist -> artists(tracks)
            MusicShelfKind.Album -> albums(tracks)
            MusicShelfKind.Genre -> genres(tracks)
        }.firstOrNull { it.name.equals(name.trim(), ignoreCase = true) }
            ?: tracksFor(kind, name, tracks).takeIf { it.isNotEmpty() }?.let { group ->
                MusicShelf(
                    kind = kind,
                    name = name.trim(),
                    imageUrl = imageOf(kind, group),
                    description = descriptionOf(kind, group),
                    trackCount = group.size
                )
            }

    private fun group(
        tracks: List<MusicTrack>,
        kind: MusicShelfKind,
        keys: (MusicTrack) -> List<String>
    ): List<MusicShelf> {
        val buckets = linkedMapOf<String, MutableList<MusicTrack>>()
        val labels = linkedMapOf<String, String>()
        tracks.forEach { track ->
            keys(track).forEach { raw ->
                val key = raw.lowercase()
                labels.putIfAbsent(key, raw)
                buckets.getOrPut(key) { mutableListOf() }.add(track)
            }
        }
        return buckets.map { (key, group) ->
            MusicShelf(
                kind = kind,
                name = labels[key].orEmpty(),
                imageUrl = imageOf(kind, group),
                description = descriptionOf(kind, group),
                trackCount = group.distinctBy { it.id }.size
            )
        }.sortedBy { it.name }
    }

    private fun imageOf(kind: MusicShelfKind, group: List<MusicTrack>): String {
        val dedicated = when (kind) {
            MusicShelfKind.Artist -> group.firstOrNull { it.artistImage.isNotBlank() }?.artistImage
            MusicShelfKind.Album -> group.firstOrNull { it.albumImage.isNotBlank() }?.albumImage
            MusicShelfKind.Genre -> null
        }
        return dedicated?.takeIf { it.isNotBlank() }
            ?: group.firstOrNull { it.thumbnailUrl.isNotBlank() }?.thumbnailUrl.orEmpty()
    }

    private fun descriptionOf(kind: MusicShelfKind, group: List<MusicTrack>): String {
        return when (kind) {
            MusicShelfKind.Artist -> group.firstOrNull { it.artistDescription.isNotBlank() }?.artistDescription.orEmpty()
            MusicShelfKind.Album -> group.firstOrNull { it.albumDescription.isNotBlank() }?.albumDescription.orEmpty()
            MusicShelfKind.Genre -> ""
        }
    }
}
