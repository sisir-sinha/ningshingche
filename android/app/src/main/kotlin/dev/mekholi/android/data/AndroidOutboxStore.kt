package dev.mekholi.android.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import dev.mekholi.core.OutboxStore
import dev.mekholi.core.QueuedWrite

/**
 * The outbox, on the device.
 *
 * SQLite because a sale that survived the app being killed is the entire point
 * of the outbox: a queue in memory would lose exactly the sales it exists to
 * protect. The columns mirror `QueuedWrite` one for one — the rules about
 * ordering and retries live in `Outbox` in `:core`, and this class is only
 * storage.
 *
 * Nothing here is encrypted, and nothing here needs to be: a queued sale is the
 * shape of a receipt, not a card number, and there is no payment credential to
 * lose. The session token is a different question, and it is not stored here —
 * see `SessionStore`.
 */
class AndroidOutboxStore(context: Context) : SQLiteOpenHelper(context, NAME, null, VERSION), OutboxStore {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            create table outbox (
              ref text primary key,
              kind text not null,
              body text not null,
              created_at integer not null,
              attempts integer not null default 0,
              last_attempt_at integer,
              last_error text,
              failed integer not null default 0
            )
            """.trimIndent()
        )
        // The drain walks oldest-first; without this it would sort the table on
        // every attempt, on a device that may be a decade old.
        db.execSQL("create index outbox_created_at on outbox (created_at)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // One table, additive changes only. A destructive upgrade here would
        // throw away queued sales, which is the one thing worth keeping.
    }

    override fun list(): List<QueuedWrite> =
        readableDatabase.rawQuery("select * from outbox order by created_at, ref", null).use { cursor ->
            buildList {
                while (cursor.moveToNext()) add(cursor.toWrite())
            }
        }

    override fun put(write: QueuedWrite) {
        writableDatabase.insertWithOnConflict(
            "outbox",
            null,
            write.toValues(),
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    override fun remove(ref: String) {
        writableDatabase.delete("outbox", "ref = ?", arrayOf(ref))
    }

    override fun find(ref: String): QueuedWrite? =
        readableDatabase.rawQuery("select * from outbox where ref = ?", arrayOf(ref)).use { cursor ->
            if (cursor.moveToFirst()) cursor.toWrite() else null
        }

    private fun android.database.Cursor.toWrite() = QueuedWrite(
        ref = getString(getColumnIndexOrThrow("ref")),
        kind = getString(getColumnIndexOrThrow("kind")),
        body = getString(getColumnIndexOrThrow("body")),
        createdAt = getLong(getColumnIndexOrThrow("created_at")),
        attempts = getInt(getColumnIndexOrThrow("attempts")),
        lastAttemptAt = getLongOrNull("last_attempt_at"),
        lastError = getStringOrNull("last_error"),
        failed = getInt(getColumnIndexOrThrow("failed")) == 1,
    )

    private fun QueuedWrite.toValues() = ContentValues().apply {
        put("ref", ref)
        put("kind", kind)
        put("body", body)
        put("created_at", createdAt)
        put("attempts", attempts)
        put("last_attempt_at", lastAttemptAt)
        put("last_error", lastError)
        put("failed", if (failed) 1 else 0)
    }

    private fun android.database.Cursor.getLongOrNull(column: String): Long? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getLong(index)
    }

    private fun android.database.Cursor.getStringOrNull(column: String): String? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getString(index)
    }

    private companion object {
        const val NAME = "mekholi-outbox.db"
        const val VERSION = 1
    }
}
