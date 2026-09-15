/**
 * The palettes — নীলা-কালি by default, and five more the reader can choose.
 *
 * The app used to have exactly one palette: a set of colours written down in `EditorialTheme.kt`
 * and read all over the app. It now has six, one of them built by the reader on a colour wheel,
 * so this file tests the *mechanism* rather than a list of hex values:
 *
 *  * that the registry holds the five presets plus the wheel, with নীলা-কালি as the default, and
 *    that the default is still the indigo the app shipped — a repaint must not shift it;
 *  * that every colour of every palette, on both sides, actually reads: ink on paper, the accent
 *    on paper, and what is written on the accent — computed here with the WCAG formula, so the
 *    numbers mean what they mean on any contrast checker;
 *  * that the wheel's palette is legible at *any* position, which is the reason it is derived by
 *    contrast rather than by eye — the same hue at a fixed lightness is bright yellow on one end
 *    and navy on the other;
 *  * that the choice and the wheel are stored, that a reader who never chose gets dark, and that
 *    the theme is built from the stored palette rather than from a constant;
 *  * and that nothing goes back to naming a colour directly — no `object EditorialPalette`, no
 *    hex outside the palette files, no screen that paints itself.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'app', 'src', 'main', 'java');
const APP = path.join(MAIN, 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

const PALETTES = read('ui', 'editorial', 'EditorialPalettes.kt');
const EDITORIAL_THEME = read('ui', 'editorial', 'EditorialTheme.kt');
const COLOR = read('ui', 'theme', 'Color.kt');
const MODELS = read('data', 'model', 'Models.kt');
const PREFS = read('data', 'preferences', 'UserPreferencesRepository.kt');
const SETTINGS = read('ui', 'screens', 'SettingsScreen.kt');
const MAIN_ACTIVITY = read('MainActivity.kt');

/** Every `.kt` under app/src/main, with its path relative to the package root. */
function loadSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.kt')) {
        out.push({ path: path.relative(APP, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(APP);
  return out;
}
const SOURCES = loadSources();

/** The text between the parentheses that open at [open], by balance, so a nested call cannot end it. */
function parenBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  assert.fail('an opening parenthesis never closes');
}

/** The body of an `object`/`class` declaration, by brace matching. */
function objectBody(text, name) {
  const start = text.indexOf(`object ${name} {`);
  assert.notEqual(start, -1, `object ${name} is not declared`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  assert.fail(`object ${name} never closes`);
}

/** `val Name = Color(0xFFRRGGBB)` pairs in a body — the declaration form, as `Color.kt` writes it. */
function coloursIn(body) {
  const found = {};
  for (const [, name, hex] of body.matchAll(/val (\w+) = Color\((0x[0-9A-Fa-f]{8})\)/g)) found[name] = hex;
  return found;
}

/** `role = Color(0xFFRRGGBB)` entries of a `PaletteSide(...)` — a constructor, so no `val`. */
function sideColours(body) {
  const found = {};
  for (const [, role, hex] of body.matchAll(/(\w+) = Color\((0x[0-9A-Fa-f]{8})\)/g)) found[role] = hex;
  return found;
}

// ---------------------------------------------------------------------------
// The registry, read out of the Kotlin
// ---------------------------------------------------------------------------

const PRESET_NAMES = ['Indigo', 'EyeWarm', 'Night', 'Forest', 'Rose'];

/** One preset: its id, its label, and its eighteen colours on each side. */
function preset(name) {
  const at = PALETTES.indexOf(`val ${name} = EditorialPaletteSpec(`);
  assert.notEqual(at, -1, `EditorialPalettes.${name} is not declared`);
  const body = parenBody(PALETTES, PALETTES.indexOf('(', at));
  const id = /id = AppPalette\.(\w+)/.exec(body);
  const label = /label = "([^"]+)"/.exec(body);
  const sides = {};
  for (const side of ['light', 'dark']) {
    const sideAt = body.indexOf(`${side} = PaletteSide(`);
    assert.notEqual(sideAt, -1, `${name}.${side} is not declared`);
    sides[side] = sideColours(parenBody(body, body.indexOf('(', sideAt)));
  }
  return { id: id && id[1], label: label && label[1], ...sides };
}

const REGISTRY = Object.fromEntries(PRESET_NAMES.map((name) => [name, preset(name)]));
const REGISTRY_BODY = objectBody(PALETTES, 'EditorialPalettes');

// ---------------------------------------------------------------------------
// WCAG contrast, computed rather than asserted from a table
// ---------------------------------------------------------------------------

/** `0xFFRRGGBB` → linear-light relative luminance. */
function luminance(hex) {
  const channel = (value) => {
    const c = parseInt(value, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [hex.slice(4, 6), hex.slice(6, 8), hex.slice(8, 10)].map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * What each colour has to manage against what it is written on.
 *
 * The thresholds are the WCAG ones: 4.5:1 for text and for anything written on a fill,
 * 3:1 for a graphic — a rule, a tint, an icon standing on its own.
 *
 * `danger` is held to the text threshold even though it is a status colour, because it
 * *is* text: it becomes Material's `error`. `success` and `warning` are tints — a dot, a
 * badge, an icon — so they are held to the graphic threshold, which is also what the
 * app's own gold already meets (3.56:1 on indigo paper). Pinning them to 4.5 would have
 * meant repainting the accepted palette to satisfy a test, which is the wrong way round.
 */
const CONTRAST_RULES = [
  ['ink on paper', 'ink', 'paper', 7],
  ['soft ink on paper', 'inkSoft', 'paper', 6],
  ['muted ink on paper', 'inkMuted', 'paper', 3.8],
  ['the accent on paper', 'accent', 'paper', 4.5],
  ['what is written on the accent', 'onAccent', 'accent', 4.5],
  ['the second accent on paper', 'second', 'paper', 3],
  ['what is written on the second accent', 'onSecond', 'second', 4.5],
  ['success on paper', 'success', 'paper', 3],
  ['warning on paper', 'warning', 'paper', 3],
  ['danger on paper', 'danger', 'paper', 4.5]
];

// ---------------------------------------------------------------------------
// The wheel, ported so its whole range can be walked
// ---------------------------------------------------------------------------
//
// This is `EditorialPalettes.custom()` in JavaScript. A port can go stale, so the
// test asserts the lines it mirrors are still there: if the Kotlin changes, this
// fails and says so instead of quietly checking an old copy of the arithmetic.

const PORTED_LINES = [
  /const val INK_TARGET = 10f/,
  /const val ACCENT_TARGET = 4\.6f/,
  /const val MUTED_TARGET = 3\.9f/,
  /const val SOFT_TARGET = 6\.2f/,
  /val lightPaper = Color\.hsl\(hf, s \* 0\.35f, 0\.972f\)/,
  /val lightAccent = legible\(hf, s, 0\.36f, lightPaper, ACCENT_TARGET, darken = true\)/,
  /val lightSecond = legible\(opposite, s \* 0\.85f, 0\.33f, lightPaper, ACCENT_TARGET, darken = true\)/,
  /val darkPaper = Color\.hsl\(hf, s \* 0\.40f, 0\.055f\)/,
  /val darkAccent = legible\(hf, s \* 0\.85f, 0\.70f, darkPaper, ACCENT_TARGET, darken = false\)/,
  /val darkSecond = legible\(opposite, s \* 0\.70f, 0\.69f, darkPaper, ACCENT_TARGET, darken = false\)/,
  /val opposite = \(hf \+ 150f\) % 360f/
];

const TARGETS = { ink: 10, accent: 4.6, muted: 3.9, soft: 6.2 };

/** `Color.hsl` as Compose defines it: an sRGB colour from hue°, saturation and lightness. */
function hsl(hue, saturation, lightness) {
  const h = ((((hue % 360) + 360) % 360) / 360) * 6;
  const s = Math.min(Math.max(saturation, 0), 1);
  const l = Math.min(Math.max(lightness, 0), 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6];
  const hex = table.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
  return `0xFF${hex}`;
}

/** The matching pair of a paper: how far a colour must move to stand off it. */
function legible(hue, saturation, start, background, target, darken) {
  const passes = (lightness) => contrast(hsl(hue, saturation, lightness), background) >= target;
  if (passes(start)) return hsl(hue, saturation, start);
  let lo = darken ? 0 : start;
  let hi = darken ? start : 1;
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    if (passes(mid)) {
      if (darken) lo = mid; else hi = mid;
    } else if (darken) hi = mid; else lo = mid;
  }
  return hsl(hue, saturation, darken ? lo : hi);
}

function inkOn(fill, hue, saturation, target) {
  const light = '0xFFFFFFFF';
  const dark = legible(hue, saturation * 0.7, 0.09, fill, target, true);
  return contrast(light, fill) >= contrast(dark, fill) ? light : dark;
}

function custom(hue, strength) {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(Math.max(strength, 0), 100) / 100;
  const opposite = (h + 150) % 360;

  const lightPaper = hsl(h, s * 0.35, 0.972);
  const lightAccent = legible(h, s, 0.36, lightPaper, TARGETS.accent, true);
  const lightSecond = legible(opposite, s * 0.85, 0.33, lightPaper, TARGETS.accent, true);
  const darkPaper = hsl(h, s * 0.40, 0.055);
  const darkAccent = legible(h, s * 0.85, 0.70, darkPaper, TARGETS.accent, false);
  const darkSecond = legible(opposite, s * 0.70, 0.69, darkPaper, TARGETS.accent, false);

  return {
    light: {
      paper: lightPaper,
      ink: legible(h, s * 0.45, 0.115, lightPaper, TARGETS.ink, true),
      inkSoft: legible(h, s * 0.30, 0.285, lightPaper, TARGETS.soft, true),
      inkMuted: legible(h, s * 0.24, 0.420, lightPaper, TARGETS.muted, true),
      accent: lightAccent,
      onAccent: inkOn(lightAccent, h, s, TARGETS.accent),
      second: lightSecond,
      onSecond: inkOn(lightSecond, opposite, s, TARGETS.accent),
      success: legible(152, 0.45, 0.290, lightPaper, TARGETS.accent, true),
      warning: legible(38, 0.72, 0.360, lightPaper, TARGETS.accent, true),
      danger: legible(2, 0.62, 0.410, lightPaper, TARGETS.accent, true)
    },
    dark: {
      paper: darkPaper,
      ink: legible(h, s * 0.20, 0.940, darkPaper, TARGETS.ink, false),
      inkSoft: legible(h, s * 0.18, 0.770, darkPaper, TARGETS.soft, false),
      inkMuted: legible(h, s * 0.15, 0.630, darkPaper, TARGETS.muted, false),
      accent: darkAccent,
      onAccent: inkOn(darkAccent, h, s, TARGETS.accent),
      second: darkSecond,
      onSecond: inkOn(darkSecond, opposite, s, TARGETS.accent),
      success: legible(152, 0.45, 0.600, darkPaper, TARGETS.accent, false),
      warning: legible(38, 0.70, 0.680, darkPaper, TARGETS.accent, false),
      danger: legible(2, 0.70, 0.700, darkPaper, TARGETS.accent, false)
    }
  };
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

test('the five presets and the wheel are registered, in picker order', () => {
  for (const name of PRESET_NAMES) assert.ok(REGISTRY[name], `EditorialPalettes.${name}`);
  assert.match(REGISTRY_BODY, /val presets = listOf\(Indigo, EyeWarm, Night, Forest, Rose\)/);
  assert.deepEqual(
    PRESET_NAMES.map((name) => REGISTRY[name].id),
    ['INDIGO', 'EYE_WARM', 'NIGHT', 'FOREST', 'ROSE'],
    'each preset carries the AppPalette id it is stored under'
  );
  assert.deepEqual(
    PRESET_NAMES.map((name) => REGISTRY[name].label),
    ['নীলা-কালি', 'চোখে-আরাম', 'নিশীথ', 'বন', 'গোলাপ'],
    'the labels are the ones the picker shows'
  );
  // The wheel is a palette like the others, built from a point rather than written down.
  assert.match(PALETTES, /fun custom\(hue: Int, saturation: Int\): EditorialPaletteSpec/);
  assert.match(PALETTES, /id = AppPalette\.CUSTOM,\s*\n\s*label = "নিজের রঙ"/);
  assert.match(PALETTES, /AppPalette\.CUSTOM -> custom\(hue, saturation\)/);
  // An id this build does not know answers the default rather than crashing.
  assert.match(REGISTRY_BODY, /else -> presets\.firstOrNull \{ it\.id == id \} \?: default/);
});

test('the default is নীলা-কালি, and it is still the indigo the app shipped', () => {
  assert.match(REGISTRY_BODY, /val default = Indigo/);
  assert.match(EDITORIAL_THEME, /palette: EditorialPaletteSpec = EditorialPalettes\.default/);
  // The accepted palette of 36104f7, unchanged: a new mechanism must not move the colours.
  const expected = {
    light: {
      paper: '0xFFF7F8FB', surface: '0xFFFFFFFF', ink: '0xFF131722', inkSoft: '0xFF414A5C',
      inkMuted: '0xFF6E7787', rule: '0xFFDDE2EC', ruleStrong: '0xFFC3CBD9',
      accent: '0xFF2F4B8F', accentSoft: '0xFFE7ECF8', second: '0xFFB4761B'
    },
    dark: {
      paper: '0xFF0D1017', surface: '0xFF141926', ink: '0xFFEDF0F7', inkSoft: '0xFFC3CAD8',
      accent: '0xFF93B0E6', accentSoft: '0xFF1D2740', second: '0xFFE3B368'
    }
  };
  for (const [side, colours] of Object.entries(expected)) {
    for (const [role, hex] of Object.entries(colours)) {
      assert.equal(REGISTRY.Indigo[side][role], hex, `নীলা-কালি, ${side}, ${role}`);
    }
  }
  // The dark paper is the dark canvas the rest of the app already used, not a second opinion.
  assert.equal(REGISTRY.Indigo.dark.paper, coloursIn(COLOR).BrandDarkCanvas);
});

test('each palette is complete on both sides', () => {
  const roles = ['paper', 'paperSunken', 'surface', 'surfaceVariant', 'ink', 'inkSoft', 'inkMuted',
    'rule', 'ruleStrong', 'accent', 'accentSoft', 'onAccent', 'second', 'secondSoft', 'onSecond',
    'success', 'warning', 'danger'];
  for (const name of PRESET_NAMES) {
    for (const side of ['light', 'dark']) {
      const colours = REGISTRY[name][side];
      for (const role of roles) {
        assert.match(colours[role] || '', /^0xFF[0-9A-F]{6}$/, `${name}.${side}.${role}`);
      }
      assert.equal(Object.keys(colours).length, roles.length, `${name}.${side} has exactly these colours`);
    }
    // Five different palettes, not five copies: the accent is what a reader picks by, so
    // no two may share one.
  }
  const accents = PRESET_NAMES.map((name) => REGISTRY[name].light.accent);
  assert.equal(new Set(accents).size, PRESET_NAMES.length, 'two presets share an accent');
  const papers = PRESET_NAMES.map((name) => REGISTRY[name].light.paper);
  assert.equal(new Set(papers).size, PRESET_NAMES.length, 'two presets share a paper');
});

test('every preset reads: ink on paper, the accent on paper, the inks on their fills', () => {
  const failures = [];
  for (const name of PRESET_NAMES) {
    for (const side of ['light', 'dark']) {
      const colours = REGISTRY[name][side];
      for (const [what, fg, bg, need] of CONTRAST_RULES) {
        const ratio = contrast(colours[fg], colours[bg]);
        if (ratio < need) failures.push(`${name} ${side}: ${what} is ${ratio.toFixed(2)}:1, needs ${need}:1`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('the wheel stays legible at every position, which is why it is derived', () => {
  for (const line of PORTED_LINES) assert.match(PALETTES, line, 'the wheel’s arithmetic changed — update this port');
  const failures = [];
  const worst = {};
  for (const strength of [0, 25, 50, 75, 100]) {
    for (let hue = 0; hue < 360; hue += 15) {
      const spec = custom(hue, strength);
      for (const side of ['light', 'dark']) {
        for (const [what, fg, bg, need] of CONTRAST_RULES) {
          const ratio = contrast(spec[side][fg], spec[side][bg]);
          if (ratio < need) failures.push(`hue ${hue}, strength ${strength}, ${side}: ${what} is ${ratio.toFixed(2)}:1`);
          if (!worst[what] || ratio < worst[what].ratio) worst[what] = { ratio, at: `hue ${hue} strength ${strength} ${side}` };
        }
      }
    }
  }
  assert.deepEqual(failures, []);
  // Not just barely: the tightest rule has real room, so a reader can look at it.
  for (const [what, { ratio, at }] of Object.entries(worst)) {
    const need = CONTRAST_RULES.find(([label]) => label === what)[3];
    assert.ok(ratio >= need, `the tightest ${what} on the whole wheel is ${ratio.toFixed(2)}:1 at ${at}`);
  }
  // A real palette comes out of it: paper and ink are not the same colour at any position.
  const sample = custom(222, 62);
  assert.ok(contrast(sample.light.ink, sample.light.paper) > 7, 'the wheel’s light side reads');
  assert.ok(contrast(sample.dark.ink, sample.dark.paper) > 7, 'the wheel’s dark side reads');
});

// ---------------------------------------------------------------------------
// The stored choice
// ---------------------------------------------------------------------------

test('the palette and the wheel are stored, and read back', () => {
  assert.match(MODELS, /enum class AppPalette \{\s*\n\s*INDIGO, EYE_WARM, NIGHT, FOREST, ROSE, CUSTOM;/);
  assert.match(MODELS, /val appPalette: AppPalette = AppPalette\.INDIGO/);
  assert.match(MODELS, /val customHue: Int = AppPalette\.DEFAULT_CUSTOM_HUE/);
  assert.match(MODELS, /val customSaturation: Int = AppPalette\.DEFAULT_CUSTOM_SATURATION/);
  // The wheel opens on the indigo accent, so the first thing it shows is the default palette.
  assert.match(MODELS, /const val DEFAULT_CUSTOM_HUE = \d+/);
  assert.match(MODELS, /const val DEFAULT_CUSTOM_SATURATION = \d+/);

  for (const key of ['app_palette', 'custom_hue', 'custom_saturation']) {
    assert.match(PREFS, new RegExp(`stringPreferencesKey|intPreferencesKey\\)\\("${key}"\\)`), `${key} key`);
  }
  assert.match(PREFS, /val appPalette = try \{/);
  assert.match(PREFS, /AppPalette\.INDIGO/);
  assert.match(PREFS, /suspend fun updateAppPalette\(palette: AppPalette\)/);
  assert.match(PREFS, /suspend fun updateCustomWheel\(hue: Int, saturation: Int\)/);
  assert.match(PREFS, /preferences\[Keys\.APP_PALETTE\] = palette\.name/);
  assert.match(PREFS, /preferences\[Keys\.CUSTOM_HUE\] = hue/);
  assert.match(PREFS, /preferences\[Keys\.CUSTOM_SATURATION\] = saturation/);
});

test('a reader who never chose gets dark, and the app’s own palette', () => {
  // Both fallbacks: the model's default and the repository's, for a reader with no stored mode.
  assert.match(MODELS, /val appThemeMode: AppThemeMode = AppThemeMode\.DARK/);
  assert.equal((PREFS.match(/AppThemeMode\.SYSTEM/g) || []).length, 0, 'SYSTEM is a choice, never a default');
  assert.equal((PREFS.match(/\?\: AppThemeMode\.DARK\.name/g) || []).length, 1, 'the stored default is dark');
  assert.match(PREFS, /AppThemeMode\.DARK\n\s*\}$/m);
  // The three modes are still offered; the default is only where a reader starts.
  for (const mode of ['SYSTEM', 'LIGHT', 'DARK']) assert.match(MODELS, new RegExp(`AppThemeMode[\\s\\S]{0,40}${mode}`), mode);
});

test('the theme is built from the stored palette, not from a constant', () => {
  assert.match(EDITORIAL_THEME, /fun EditorialTheme\(\s*\n\s*palette: EditorialPaletteSpec = EditorialPalettes\.default,/);
  assert.match(EDITORIAL_THEME, /darkTheme: Boolean = isSystemInDarkTheme\(\)/);
  assert.match(EDITORIAL_THEME, /fun EditorialPaletteSpec\.tokens\(darkSide: Boolean\): EditorialTokens/);
  assert.match(EDITORIAL_THEME, /val LocalEditorialTokens = staticCompositionLocalOf/);
  assert.match(MAIN_ACTIVITY, /EditorialPalettes\.of\(\s*\n\s*preferences\.appPalette,\s*\n\s*preferences\.customHue,\s*\n\s*preferences\.customSaturation/);
  assert.match(MAIN_ACTIVITY, /EditorialTheme\(palette = palette, darkTheme = darkTheme\)/);
  // Two colours cannot follow the theme, and both are named for what they are instead:
  // a page is paper in both (the PDF reader), and a chip drawn over artwork is pale in
  // both, so the ink on it must stay the dark one.
  assert.match(EDITORIAL_THEME, /pagePaper = light\.paper/);
  assert.match(EDITORIAL_THEME, /accentDeep = light\.accent/);
  assert.match(EDITORIAL_THEME, /val pagePaper: Color,/);
  assert.match(EDITORIAL_THEME, /val accentDeep: Color,/);
  // The old single palette is gone, and gone means gone: nothing may reference it.
  assert.ok(!/object EditorialPalette\b/.test(PALETTES + EDITORIAL_THEME), 'object EditorialPalette is retired');
  const stragglers = SOURCES.filter(({ text }) => /EditorialPalette\./.test(text)).map(({ path: file }) => file);
  assert.deepEqual(stragglers, [], 'a screen still names a palette colour instead of reading a token');
});

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

test('the picker is in Settings, above the light/dark cards', () => {
  assert.ok(SETTINGS.includes('রঙের প্যালেট'), 'the section is labelled');
  const pickerAt = SETTINGS.indexOf('রঙের প্যালেট');
  const modeAt = SETTINGS.indexOf('App Theme Mode Selection');
  assert.ok(pickerAt !== -1 && modeAt !== -1 && pickerAt < modeAt, 'the palette comes first: it decides what light and dark mean');
  // One card per palette, the wheel's included, and each carries its palette's name as a tag.
  assert.match(SETTINGS, /EditorialPalettes\.presets \+ custom/);
  assert.match(SETTINGS, /testTag\("palette_card_" \+ spec\.id\.name\.lowercase\(\)\)/);
  assert.match(SETTINGS, /viewModel\.updateAppPalette\(spec\.id\)/);
  // Each palette says what it is for, in the registry, and the picker shows the chosen one.
  assert.match(PALETTES, /note = "[^"]+"/);
  assert.match(SETTINGS, /text = chosen\.note/);
  // The wheel itself, with the two sliders a finger has: hue around, strength outward.
  assert.match(SETTINGS, /testTag\("palette_wheel"\)/);
  assert.match(SETTINGS, /viewModel\.updateCustomWheel\(hue, strength\)/);
  assert.match(SETTINGS, /atan2\(dy\.toDouble\(\), dx\.toDouble\(\)\)/);
  // It writes when the finger stops, not on every pixel of the drag.
  assert.match(SETTINGS, /LaunchedEffect\(localHue, localStrength\)/);
  assert.match(SETTINGS, /delay\(260\)/);
  // And the three mode cards are untouched, still offering all three.
  assert.match(SETTINGS, /ThemeModeCard\(/);
  assert.match(SETTINGS, /onClick = \{ viewModel\.updateAppThemeMode\(AppThemeMode\.SYSTEM\) \}/);
  assert.match(SETTINGS, /onClick = \{ viewModel\.updateAppThemeMode\(AppThemeMode\.LIGHT\) \}/);
  assert.match(SETTINGS, /onClick = \{ viewModel\.updateAppThemeMode\(AppThemeMode\.DARK\) \}/);
});

test('the picker’s own previews are built from the palette, not from literals', () => {
  assert.match(SETTINGS, /EditorialPalettes\.custom\(preferences\.customHue, preferences\.customSaturation\)/);
  assert.match(SETTINGS, /private fun PalettePreviewCard\(label: String, side: PaletteSide/);
  assert.match(SETTINGS, /side\.onAccent/, 'the preview shows what is written on the accent');
  // A preview is a preview: it may paint the palette's colours, but nothing else in the screen
  // may hold a hex of its own.
  const literals = SETTINGS.match(/Color\(0x[0-9A-Fa-f]{8}\)/g) || [];
  assert.deepEqual(literals, [], 'the Settings screen has no colours of its own');
});

// ---------------------------------------------------------------------------
// The repaint stays repainted
// ---------------------------------------------------------------------------

test('the dashboard keeps its violet — the palettes are the app’s', () => {
  // The scope of this task was the app. The CMS has its own stylesheet and its own accent.
  const dashboard = fs.readFileSync(path.join(ROOT, 'backend', 'assets', 'js', 'dashboard.js'), 'utf8');
  assert.match(dashboard, /--violet|#7C3AED|violet/i, 'the dashboard still paints itself');
  assert.ok(!/appPalette|EditorialPalettes/.test(dashboard), 'the dashboard does not read the app’s palette');
});

test('no value from a previous palette survives anywhere in the app', () => {
  const retired = [
    '7A2E1E', 'F2E4DE', // the maroon masthead
    'D97706', 'FDF0DC', // saffron
    'E9A08C', 'F0A94B', // the old dark accents
    'FDFBF7', 'F6F1E8', 'F1EBE0', 'E3DACD', 'CDBCAA', // warm paper and its rules
    '1A1512', '4A423A', '7A6E62', // warm ink
    '12100E', '1C1917', '272320', '322C27', // warm dark
    'F7F2EA', 'D8CFC3', '9C9186', // warm dark ink
    '2A140E', '4A2216', '1A0C08', '8B5A2B', '5C3310', '3B1E0A', // brown slabs
    'FFF3D6', 'E7C9A0', 'E8C48A', 'FFF6E4', 'FFD59E', // cream text
    '100C09', '1A120B', '140D08', '1C0E0C', '2A120E', '120806', // brown-black panels
    'F4F0E6', 'F6EFE6', '120E0C', // the viewer's warm ink and its canvas
    '0E1A16', 'FF8C00', '0005FF', '0D6EFD'
  ];
  const whitelist = ['ui/theme/Color.kt', 'ui/editorial/EditorialPalettes.kt'];
  const offenders = [];
  for (const { path: file, text } of SOURCES) {
    if (whitelist.includes(file)) continue;
    for (const hex of retired) if (text.includes(hex)) offenders.push(`${file}: ${hex}`);
  }
  assert.deepEqual(offenders, [], 'the old palette left a value behind');
});

test('no token from an old palette is still named', () => {
  const retired = ['PortalMaroon', 'PortalSaffron', 'PortalDeepBrown', 'PortalCream1', 'PortalCream2',
    'PortalGold', 'PortalWhite', 'PortalDarkBg', 'PortalDarkText',
    'SepiaCanvas', 'SepiaSurface', 'SepiaText', 'PaperCanvasLight', 'PaperSurfaceLight',
    'PaperSurfaceVariantLight', 'PaperCardBorderLight', 'NightTextSecondary',
    'TextSecondaryLight', 'TextTertiaryLight', 'TextMutedLight',
    'AccentCulture', 'AccentBiography', 'AccentMythology', 'AccentScience', 'AccentReminiscence',
    'PlayingWaveBlue'];
  const offenders = [];
  for (const { path: file, text } of SOURCES) {
    for (const token of retired) if (new RegExp(`\\b${token}\\b`).test(text)) offenders.push(`${file}: ${token}`);
  }
  assert.deepEqual(offenders, [], 'a retired token is still referenced');
  // The amber ramp is a prefix family, so it is checked by prefix.
  const amber = SOURCES.filter(({ text }) => /\bAmber(50|100|200|300|400|500|600|700|800|900|950)\b/.test(text));
  assert.deepEqual(amber.map((s) => s.path), [], 'the amber ramp is still referenced');
});

test('the screens that still name the brand family import it from the theme', () => {
  // These sit outside EditorialTheme on purpose — a toast, the music player, the PDF screens —
  // and their colours come from one file rather than from a hex written at the call site.
  const screens = {
    'ui/components/MusicPlayer.kt': ['BrandIndigo', 'BrandGoldLight', 'PanelDeep'],
    'ui/components/AppToast.kt': ['BrandGoldLight'],
    'ui/screens/PdfViewerScreen.kt': ['Panel', 'LocalEditorialTokens'],
    'ui/screens/PdfArchiveScreen.kt': ['BrandIndigo', 'BrandIndigoDeep', 'PanelInk']
  };
  for (const [file, tokens] of Object.entries(screens)) {
    const source = read(...file.split('/'));
    for (const token of tokens) assert.match(source, new RegExp(`\\b${token}\\b`), `${file} should read ${token}`);
    assert.match(source, /import com\.ningshingche\.app\.ui\.(theme\.(Brand|Panel)|editorial\.LocalEditorialTokens)/,
      `${file} should import its colours`);
  }
  // The two screens that were repainted read the theme, and no longer name the brand at all.
  for (const file of ['ui/screens/SplashScreen.kt', 'ui/components/PortalDrawer.kt']) {
    const source = read(...file.split('/'));
    assert.match(source, /LocalEditorialTokens\.current/, `${file} reads the palette`);
    assert.ok(!/import com\.ningshingche\.app\.ui\.theme\.(Brand|Panel)/.test(source), `${file} no longer needs the brand family`);
  }
  // The footer keeps its dark band, in the app's own dark family.
  const footer = read('ui', 'editorial', 'SiteFooter.kt');
  assert.match(footer, /private val FooterBg = PanelDeep/);
  assert.match(footer, /private val FooterAccent = BrandGoldLight/);
});
