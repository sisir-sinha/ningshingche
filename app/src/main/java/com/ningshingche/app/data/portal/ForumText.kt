package com.ningshingche.app.data.portal

/**
 * What the forum counts as a character, and the limits it enforces.
 *
 * The rules live in two places on purpose: the database refuses a title that is
 * too short (`forum_create_discussion`, migration 029) and the app has to say so
 * *before* the writer presses the button, or they lose what they typed to a
 * round trip. This is the app's half, and it has to agree with the server's
 * `forum_text_units`.
 *
 * Bengali is the reason this is not simply `String.length`. A syllable arrives
 * pre-composed from one keyboard (`ো`, U+09CB) and decomposed from another
 * (`ে` + `া`), and the same word then measures three characters one way and
 * five the other. Counting the marks out makes the number the writer sees beside
 * the field the number the server enforces — whatever they typed it on. The
 * server's own check is asserted in `backend/tests/sql/run.sh` against the two
 * Unicode normal forms, and this comment is the reason it is.
 */
object ForumText {

    const val TITLE_MIN = 4
    const val TITLE_MAX = 160
    const val BODY_MAX = 8000
    const val REPLY_MAX = 4000

    /**
     * The combining marks Bengali builds syllables from: the signs, the nukta,
     * the vowel signs and the virama, plus the zero-width joiners a keyboard may
     * leave behind. Everything else — letters, digits, punctuation — counts.
     */
    private val MARKS = setOf(
        '\u0981', '\u0982', '\u0983',              // ঁ ং ঃ
        '\u09BC',                                   // ় nukta
        '\u09BE', '\u09BF', '\u09C0', '\u09C1', '\u09C2', '\u09C3', '\u09C4',
        '\u09C7', '\u09C8', '\u09CB', '\u09CC',     // া ি ী ু ূ ৃ ৄ ে ৈ ো ৌ
        '\u09CD',                                   // ্ virama
        '\u09D7', '\u09E2', '\u09E3', '\u09FE',
        '\u200C', '\u200D'                          // ZWNJ, ZWJ
    )

    /** Characters the writer would count: marks and spaces are not characters. */
    fun units(text: String): Int = text.count { !it.isWhitespace() && it !in MARKS }

    /** First thing wrong with a title, or null when it is acceptable. */
    fun titleProblem(title: String): String? {
        val units = units(title)
        return when {
            units < TITLE_MIN -> "শিরোনাম অন্তত ৪ অক্ষরের হতে হবে।"
            title.length > TITLE_MAX -> "শিরোনাম ১৬০ অক্ষরের বেশি হতে পারবে না।"
            else -> null
        }
    }

    /** First thing wrong with a discussion body, or null. */
    fun bodyProblem(body: String): String? = when {
        units(body) < 1 -> "আলোচনার কথা লিখুন।"
        body.length > BODY_MAX -> "আলোচনার কথা ৮০০০ অক্ষরের বেশি হতে পারবে না।"
        else -> null
    }

    /** First thing wrong with a reply, or null. */
    fun replyProblem(body: String): String? = when {
        units(body) < 1 -> "উত্তর লিখুন।"
        body.length > REPLY_MAX -> "উত্তর ৪০০০ অক্ষরের বেশি হতে পারবে না।"
        else -> null
    }
}
