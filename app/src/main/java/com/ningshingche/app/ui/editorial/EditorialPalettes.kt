package com.ningshingche.app.ui.editorial

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.ningshingche.app.data.model.AppPalette
import com.ningshingche.app.ui.i18n.tNow

/**
 * The app's palettes, and what "the theme" means now.
 *
 * A palette is eighteen colours, supplied twice — once for paper and once for
 * night — and [EditorialTheme] turns the chosen pair into the tokens every screen
 * reads and into the Material colour scheme. Nothing else in the app names a
 * colour, which is what makes a palette a palette rather than a coat of paint.
 *
 * Five presets, and the sixth answer is the reader's own: [custom] builds a whole
 * palette out of one position on a colour wheel, so the accent is theirs and the
 * paper, the ink and the rules are tinted to match. The default is
 * [AppPalette.INDIGO] — চোখে-আরাম is the one most readers reach for, but the app
 * as designed is the indigo one.
 *
 * Each side carries these eighteen colours:
 *
 *  * the four surfaces a page is built from — [PaletteSide.paper],
 *    [PaletteSide.paperSunken], [PaletteSide.surface] (a card) and
 *    [PaletteSide.surfaceVariant];
 *  * three inks and two rules;
 *  * the accent and its fill, and what is written on the accent
 *    ([PaletteSide.onAccent]);
 *  * the second accent and its fill, with its own ink;
 *  * and the three semantic colours a status needs.
 *
 * The values are chosen for measured contrast rather than by eye: ink on paper at
 * 7:1 or better, the accent on paper and the inks on their fills at 4.5:1 or
 * better. `backend/tests/app-theme-palette.test.cjs` computes every one of those
 * ratios from this file, so a palette cannot arrive that reads badly.
 */
data class PaletteSide(
    val paper: Color,
    val paperSunken: Color,
    val surface: Color,
    val surfaceVariant: Color,
    val ink: Color,
    val inkSoft: Color,
    val inkMuted: Color,
    val rule: Color,
    val ruleStrong: Color,
    val accent: Color,
    val accentSoft: Color,
    val onAccent: Color,
    val second: Color,
    val secondSoft: Color,
    val onSecond: Color,
    val success: Color,
    val warning: Color,
    val danger: Color
)

/** A palette: its identity, its name for the reader, and its two sides. */
data class EditorialPaletteSpec(
    val id: AppPalette,
    val label: String,
    val note: String,
    val light: PaletteSide,
    val dark: PaletteSide
)

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

/**
 * WCAG contrast, 1:1 to 21:1.
 *
 * The same formula a contrast checker uses, so a number here means what it means
 * anywhere else — and `backend/tests/app-theme-palette.test.cjs` computes it again
 * for every colour in this file.
 */
private fun contrastOf(a: Color, b: Color): Float {
    val la = a.luminance()
    val lb = b.luminance()
    val hi = maxOf(la, lb)
    val lo = minOf(la, lb)
    return (hi + 0.05f) / (lo + 0.05f)
}

/**
 * [start] lightness, moved only as far as it must be to stand off [background] at
 * [target] — down when [darken], up when not.
 *
 * A fixed HSL lightness is not enough on its own, and this is the reason the custom
 * palette is built rather than written down: at the same lightness a yellow is far
 * brighter than a blue, so a yellow accent would read at a third of the contrast an
 * indigo one does. Binary search rather than a lookup table, because "far enough" is
 * exactly what [target] says.
 */
private fun legible(
    hue: Float,
    saturation: Float,
    start: Float,
    background: Color,
    target: Float,
    darken: Boolean
): Color {
    fun passes(lightness: Float) = contrastOf(Color.hsl(hue, saturation, lightness), background) >= target
    if (passes(start)) return Color.hsl(hue, saturation, start)
    var lo = if (darken) 0f else start
    var hi = if (darken) start else 1f
    repeat(18) {
        val mid = (lo + hi) / 2f
        if (passes(mid)) {
            if (darken) lo = mid else hi = mid
        } else {
            if (darken) hi = mid else lo = mid
        }
    }
    return Color.hsl(hue, saturation, if (darken) lo else hi)
}

/**
 * What is written on a filled chip: white when white can carry the contrast, the
 * hue's own dark ink when it cannot — which is what a yellow button needs and a
 * navy one must not have.
 */
private fun inkOn(fill: Color, hue: Float, saturation: Float, target: Float): Color {
    val light = Color.White
    val dark = legible(hue, saturation * 0.7f, 0.09f, fill, target, darken = true)
    return if (contrastOf(light, fill) >= contrastOf(dark, fill)) light else dark
}

/** The ratios the derived palette is held to. */
private const val INK_TARGET = 10f
private const val ACCENT_TARGET = 4.6f
private const val MUTED_TARGET = 3.9f
private const val SOFT_TARGET = 6.2f

object EditorialPalettes {

    /** নীলা-কালি — the app's own palette, and the default. */
    val Indigo = EditorialPaletteSpec(
        id = AppPalette.INDIGO,
        label = tNow("নীলা-কালি"),
        note = tNow("ঠান্ডা কাগজ, ইন্ডিগো আর সোনালি"),
        light = PaletteSide(
            paper = Color(0xFFF7F8FB),
            paperSunken = Color(0xFFEDF0F7),
            surface = Color(0xFFFFFFFF),
            surfaceVariant = Color(0xFFF1F3F8),
            ink = Color(0xFF131722),
            inkSoft = Color(0xFF414A5C),
            inkMuted = Color(0xFF6E7787),
            rule = Color(0xFFDDE2EC),
            ruleStrong = Color(0xFFC3CBD9),
            accent = Color(0xFF2F4B8F),
            accentSoft = Color(0xFFE7ECF8),
            onAccent = Color(0xFFFFFFFF),
            second = Color(0xFFB4761B),
            secondSoft = Color(0xFFFBF0DC),
            onSecond = Color(0xFF131722),
            success = Color(0xFF1E7A54),
            warning = Color(0xFFB4761B),
            danger = Color(0xFFB4232A)
        ),
        dark = PaletteSide(
            paper = Color(0xFF0D1017),
            paperSunken = Color(0xFF1B2130),
            surface = Color(0xFF141926),
            surfaceVariant = Color(0xFF1B2130),
            ink = Color(0xFFEDF0F7),
            inkSoft = Color(0xFFC3CAD8),
            inkMuted = Color(0xFF98A1B2),
            rule = Color(0xFF252C3B),
            ruleStrong = Color(0xFF2F3749),
            accent = Color(0xFF93B0E6),
            accentSoft = Color(0xFF1D2740),
            onAccent = Color(0xFF0A1730),
            second = Color(0xFFE3B368),
            secondSoft = Color(0xFF33280F),
            onSecond = Color(0xFF33240B),
            success = Color(0xFF4CC38A),
            warning = Color(0xFFE3B368),
            danger = Color(0xFFFF9A8F)
        )
    )

    /** চোখে-আরাম — the warm sepia palette most readers ask for by that name. */
    val EyeWarm = EditorialPaletteSpec(
        id = AppPalette.EYE_WARM,
        label = tNow("চোখে-আরাম"),
        note = tNow("গরম কাগজ আর মাটির রঙ, দীর্ঘ পড়ার জন্য"),
        light = PaletteSide(
            paper = Color(0xFFFAF3E3),
            paperSunken = Color(0xFFF2E7D2),
            surface = Color(0xFFFFFCF4),
            surfaceVariant = Color(0xFFF6EDDC),
            ink = Color(0xFF2A2118),
            inkSoft = Color(0xFF4C3F2E),
            inkMuted = Color(0xFF6E5F49),
            rule = Color(0xFFE3D5BC),
            ruleStrong = Color(0xFFCFBB9B),
            accent = Color(0xFF8A5312),
            accentSoft = Color(0xFFF4E4C6),
            onAccent = Color(0xFFFFFDF7),
            second = Color(0xFF356150),
            secondSoft = Color(0xFFE1EEE5),
            onSecond = Color(0xFFFFFFFF),
            success = Color(0xFF2C6244),
            warning = Color(0xFF8A5312),
            danger = Color(0xFF9E3A2A)
        ),
        dark = PaletteSide(
            paper = Color(0xFF14100B),
            paperSunken = Color(0xFF221B12),
            surface = Color(0xFF1A150E),
            surfaceVariant = Color(0xFF241C12),
            ink = Color(0xFFF6EEDD),
            inkSoft = Color(0xFFD6C9B0),
            inkMuted = Color(0xFFB1A288),
            rule = Color(0xFF2E2517),
            ruleStrong = Color(0xFF3D3120),
            accent = Color(0xFFE0A85A),
            accentSoft = Color(0xFF33260F),
            onAccent = Color(0xFF2A1B06),
            second = Color(0xFF8FCBA8),
            secondSoft = Color(0xFF1B2A22),
            onSecond = Color(0xFF0B1913),
            success = Color(0xFF8FCBA8),
            warning = Color(0xFFE0A85A),
            danger = Color(0xFFF09A86)
        )
    )

    /** নিশীথ — true black, for an OLED screen and a dark room. */
    val Night = EditorialPaletteSpec(
        id = AppPalette.NIGHT,
        label = tNow("নিশীথ"),
        note = tNow("আসল কালো, রাতের পড়ার জন্য"),
        light = PaletteSide(
            paper = Color(0xFFF7F7F8),
            paperSunken = Color(0xFFEDEEF1),
            surface = Color(0xFFFFFFFF),
            surfaceVariant = Color(0xFFF2F3F6),
            ink = Color(0xFF111214),
            inkSoft = Color(0xFF3E4046),
            inkMuted = Color(0xFF63666E),
            rule = Color(0xFFDCDEE4),
            ruleStrong = Color(0xFFC1C4CD),
            accent = Color(0xFF215FA6),
            accentSoft = Color(0xFFE4EDF8),
            onAccent = Color(0xFFFFFFFF),
            second = Color(0xFF4F5F73),
            secondSoft = Color(0xFFECEFF3),
            onSecond = Color(0xFFFFFFFF),
            success = Color(0xFF1F6E4B),
            warning = Color(0xFF8A5A12),
            danger = Color(0xFFA32B24)
        ),
        dark = PaletteSide(
            paper = Color(0xFF000000),
            paperSunken = Color(0xFF0B0D10),
            surface = Color(0xFF0A0C0F),
            surfaceVariant = Color(0xFF14171C),
            ink = Color(0xFFF2F4F7),
            inkSoft = Color(0xFFC4C9D2),
            inkMuted = Color(0xFF9AA0AA),
            rule = Color(0xFF1E2228),
            ruleStrong = Color(0xFF2B3038),
            accent = Color(0xFF6FB2F0),
            accentSoft = Color(0xFF132234),
            onAccent = Color(0xFF061019),
            second = Color(0xFFA7B4C4),
            secondSoft = Color(0xFF1A2027),
            onSecond = Color(0xFF0A0F14),
            success = Color(0xFF5FCB92),
            warning = Color(0xFFE9C46A),
            danger = Color(0xFFFF8A80)
        )
    )

    /** বন — a green that stays quiet, for readers who find blue restless. */
    val Forest = EditorialPaletteSpec(
        id = AppPalette.FOREST,
        label = "বন",
        note = tNow("সবুজ পাতা আর অলিভ-সোনালি"),
        light = PaletteSide(
            paper = Color(0xFFF5F8F4),
            paperSunken = Color(0xFFE9EFE7),
            surface = Color(0xFFFFFFFF),
            surfaceVariant = Color(0xFFEFF4EE),
            ink = Color(0xFF141A15),
            inkSoft = Color(0xFF3E4A40),
            inkMuted = Color(0xFF5D6C61),
            rule = Color(0xFFD6E0D3),
            ruleStrong = Color(0xFFB9C9B6),
            accent = Color(0xFF2C6B45),
            accentSoft = Color(0xFFDFEDE3),
            onAccent = Color(0xFFFFFFFF),
            second = Color(0xFF7A5C16),
            secondSoft = Color(0xFFF2EAD6),
            onSecond = Color(0xFFFFFFFF),
            success = Color(0xFF2C6B45),
            warning = Color(0xFF7A5C16),
            danger = Color(0xFF9A362B)
        ),
        dark = PaletteSide(
            paper = Color(0xFF0B110D),
            paperSunken = Color(0xFF141C16),
            surface = Color(0xFF101711),
            surfaceVariant = Color(0xFF18211A),
            ink = Color(0xFFEAF2EA),
            inkSoft = Color(0xFFBFCFC2),
            inkMuted = Color(0xFF96A69A),
            rule = Color(0xFF1F2A21),
            ruleStrong = Color(0xFF2C3A2E),
            accent = Color(0xFF7FC49A),
            accentSoft = Color(0xFF14261B),
            onAccent = Color(0xFF07160D),
            second = Color(0xFFD6B96A),
            secondSoft = Color(0xFF2A2413),
            onSecond = Color(0xFF231B06),
            success = Color(0xFF7FC49A),
            warning = Color(0xFFD6B96A),
            danger = Color(0xFFF09A90)
        )
    )

    /** গোলাপ — rose, with a blue second that keeps it from going sweet. */
    val Rose = EditorialPaletteSpec(
        id = AppPalette.ROSE,
        label = tNow("গোলাপ"),
        note = tNow("গোলাপি আর নীল — উষ্ণ অথচ শান্ত"),
        light = PaletteSide(
            paper = Color(0xFFFBF6F7),
            paperSunken = Color(0xFFF3E9EB),
            surface = Color(0xFFFFFFFF),
            surfaceVariant = Color(0xFFF7EFF1),
            ink = Color(0xFF1D1416),
            inkSoft = Color(0xFF4C3A3E),
            inkMuted = Color(0xFF6D585D),
            rule = Color(0xFFE6D6D9),
            ruleStrong = Color(0xFFD2BCC0),
            accent = Color(0xFF9B2F4E),
            accentSoft = Color(0xFFF7E3E9),
            onAccent = Color(0xFFFFFFFF),
            second = Color(0xFF2F5D7C),
            secondSoft = Color(0xFFE3EDF5),
            onSecond = Color(0xFFFFFFFF),
            success = Color(0xFF2C6244),
            warning = Color(0xFF8A5312),
            danger = Color(0xFFA32B33)
        ),
        dark = PaletteSide(
            paper = Color(0xFF140C0F),
            paperSunken = Color(0xFF221519),
            surface = Color(0xFF1A1013),
            surfaceVariant = Color(0xFF241519),
            ink = Color(0xFFF7EDEF),
            inkSoft = Color(0xFFD8C4C8),
            inkMuted = Color(0xFFB49CA1),
            rule = Color(0xFF2E1C21),
            ruleStrong = Color(0xFF3D262C),
            accent = Color(0xFFE9A0B4),
            accentSoft = Color(0xFF331821),
            onAccent = Color(0xFF2B0F17),
            second = Color(0xFF8FB6D6),
            secondSoft = Color(0xFF152230),
            onSecond = Color(0xFF08131C),
            success = Color(0xFF74C79A),
            warning = Color(0xFFE0B472),
            danger = Color(0xFFFF9AA0)
        )
    )

    /** The five presets, in the order the Settings picker shows them. */
    val presets = listOf(Indigo, EyeWarm, Night, Forest, Rose)

    /** The palette the app ships with, which is also what a reader who never opens Settings sees. */
    val default = Indigo

    /**
     * The palette for a stored choice. A preset is looked up by id; [AppPalette.CUSTOM]
     * is built from the wheel. An id this build does not know — a downgrade, or a
     * palette added and then removed — answers the default rather than crashing.
     */
    fun of(id: AppPalette?, hue: Int, saturation: Int): EditorialPaletteSpec = when (id) {
        null -> default
        AppPalette.CUSTOM -> custom(hue, saturation)
        else -> presets.firstOrNull { it.id == id } ?: default
    }

    /**
     * A palette from one point on the wheel.
     *
     * The accent is the reader's hue at the strength they chose; the paper, cards and
     * rules are faint tints of the same hue so the page belongs to the accent instead
     * of fighting it; and then every colour that carries meaning is pushed until it
     * stands off its background at a documented ratio ([ACCENT_TARGET] and friends).
     *
     * That last step is the whole point. At equal HSL lightness a yellow is far
     * brighter than a blue, so a palette built on fixed lightness would hand one
     * reader a legible screen and another an unreadable one, depending only on the
     * colour they happened to pick.
     *
     * The second accent sits 150° away, near enough to be a relation and far enough to
     * be told apart, and the status colours stay where meaning needs them.
     */
    fun custom(hue: Int, saturation: Int): EditorialPaletteSpec {
        val h = ((hue % 360) + 360) % 360
        val s = (saturation.coerceIn(0, 100)) / 100f
        val hf = h.toFloat()
        val opposite = (hf + 150f) % 360f

        // The surfaces are tints of the reader's hue; the colours that carry meaning
        // are then pushed until they stand off them at the documented ratio. That is
        // what makes a wheel-built palette safe: every hue, at every strength, lands
        // on the same legibility instead of on the same lightness.
        val lightPaper = Color.hsl(hf, s * 0.35f, 0.972f)
        val lightSunken = Color.hsl(hf, s * 0.40f, 0.942f)
        val lightAccent = legible(hf, s, 0.36f, lightPaper, ACCENT_TARGET, darken = true)
        val lightSecond = legible(opposite, s * 0.85f, 0.33f, lightPaper, ACCENT_TARGET, darken = true)

        val darkPaper = Color.hsl(hf, s * 0.40f, 0.055f)
        val darkSunken = Color.hsl(hf, s * 0.35f, 0.120f)
        val darkAccent = legible(hf, s * 0.85f, 0.70f, darkPaper, ACCENT_TARGET, darken = false)
        val darkSecond = legible(opposite, s * 0.70f, 0.69f, darkPaper, ACCENT_TARGET, darken = false)

        return EditorialPaletteSpec(
            id = AppPalette.CUSTOM,
            label = tNow("নিজের রঙ"),
            note = tNow("চাকা ঘুরিয়ে নিজের অ্যাকসেন্ট বেছে নিন"),
            light = PaletteSide(
                paper = lightPaper,
                paperSunken = lightSunken,
                surface = Color.White,
                surfaceVariant = Color.hsl(hf, s * 0.32f, 0.958f),
                ink = legible(hf, s * 0.45f, 0.115f, lightPaper, INK_TARGET, darken = true),
                inkSoft = legible(hf, s * 0.30f, 0.285f, lightPaper, SOFT_TARGET, darken = true),
                inkMuted = legible(hf, s * 0.24f, 0.420f, lightPaper, MUTED_TARGET, darken = true),
                rule = Color.hsl(hf, s * 0.30f, 0.878f),
                ruleStrong = Color.hsl(hf, s * 0.30f, 0.762f),
                accent = lightAccent,
                accentSoft = Color.hsl(hf, s * 0.55f, 0.928f),
                onAccent = inkOn(lightAccent, hf, s, ACCENT_TARGET),
                second = lightSecond,
                secondSoft = Color.hsl(opposite, s * 0.55f, 0.928f),
                onSecond = inkOn(lightSecond, opposite, s, ACCENT_TARGET),
                success = legible(152f, 0.45f, 0.290f, lightPaper, ACCENT_TARGET, darken = true),
                warning = legible(38f, 0.72f, 0.360f, lightPaper, ACCENT_TARGET, darken = true),
                danger = legible(2f, 0.62f, 0.410f, lightPaper, ACCENT_TARGET, darken = true)
            ),
            dark = PaletteSide(
                paper = darkPaper,
                paperSunken = darkSunken,
                surface = Color.hsl(hf, s * 0.35f, 0.092f),
                surfaceVariant = Color.hsl(hf, s * 0.32f, 0.148f),
                ink = legible(hf, s * 0.20f, 0.940f, darkPaper, INK_TARGET, darken = false),
                inkSoft = legible(hf, s * 0.18f, 0.770f, darkPaper, SOFT_TARGET, darken = false),
                inkMuted = legible(hf, s * 0.15f, 0.630f, darkPaper, MUTED_TARGET, darken = false),
                rule = Color.hsl(hf, s * 0.28f, 0.200f),
                ruleStrong = Color.hsl(hf, s * 0.28f, 0.280f),
                accent = darkAccent,
                accentSoft = Color.hsl(hf, s * 0.60f, 0.190f),
                onAccent = inkOn(darkAccent, hf, s, ACCENT_TARGET),
                second = darkSecond,
                secondSoft = Color.hsl(opposite, s * 0.55f, 0.180f),
                onSecond = inkOn(darkSecond, opposite, s, ACCENT_TARGET),
                success = legible(152f, 0.45f, 0.600f, darkPaper, ACCENT_TARGET, darken = false),
                warning = legible(38f, 0.70f, 0.680f, darkPaper, ACCENT_TARGET, darken = false),
                danger = legible(2f, 0.70f, 0.700f, darkPaper, ACCENT_TARGET, darken = false)
            )
        )
    }
}
