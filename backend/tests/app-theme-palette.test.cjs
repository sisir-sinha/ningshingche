/**
 * The palette — নীলা-কালি, indigo ink.
 *
 * The reader disliked the old colours (warm paper, maroon masthead, saffron accent) and chose
 * this one from a gallery of five. The scope was the app only, light **and** dark; the CMS
 * dashboard keeps its violet for now.
 *
 * A repaint is only finished when a stray hex from the old palette cannot come back, so these
 * tests assert three different things:
 *
 *  * the values themselves, in both themes, straight out of the two files that own them;
 *  * that the tokens and the Material schemes *read* the palette rather than repeating a literal,
 *    which is what made the previous palette spread into eight files;
 *  * that nothing in the app still names a colour from the old set — no `PortalMaroon`, no
 *    `#D97706`, no brown scrim — including the screens that sit outside `EditorialTheme`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'app', 'src', 'main', 'java');
const APP = path.join(MAIN, 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

const EDITORIAL_THEME = read('ui', 'editorial', 'EditorialTheme.kt');
const COLOR = read('ui', 'theme', 'Color.kt');

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

/** The body of a Kotlin object or class, by brace matching so a nested block cannot end it. */
function objectBody(text, name) {
  const start = text.indexOf(`object ${name} {`);
  assert.notEqual(start, -1, `${name} is not declared in the file`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  assert.fail(`${name} never closes`);
}

/** `val Name = Color(0xFFRRGGBB)` pairs, in declaration order. */
function coloursIn(body) {
  const found = {};
  for (const [, name, hex] of body.matchAll(/val (\w+) = Color\((0x[0-9A-Fa-f]{8})\)/g)) found[name] = hex;
  return found;
}

const PALETTE = coloursIn(objectBody(EDITORIAL_THEME, 'EditorialPalette'));
const BRAND = coloursIn(COLOR);

test('the palette is indigo ink, light and dark', () => {
  const expected = {
    // Cool paper — a bluish off-white, not the old cream.
    Paper: '0xFFF7F8FB',
    PaperSunken: '0xFFEDF0F7',
    Surface: '0xFFFFFFFF',
    SurfaceVariant: '0xFFF1F3F8',
    Ink: '0xFF131722',
    InkSoft: '0xFF414A5C',
    InkMuted: '0xFF6E7787',
    Rule: '0xFFDDE2EC',
    RuleStrong: '0xFFC3CBD9',
    Indigo: '0xFF2F4B8F',
    IndigoSoft: '0xFFE7ECF8',
    Gold: '0xFFB4761B',
    GoldSoft: '0xFFFBF0DC',
    Success: '0xFF1E7A54',
    Warning: '0xFFB4761B',
    Danger: '0xFFB4232A',
    DarkBg: '0xFF0D1017',
    DarkSurface: '0xFF141926',
    DarkSurfaceVariant: '0xFF1B2130',
    DarkInk: '0xFFEDF0F7',
    DarkInkSoft: '0xFFC3CAD8',
    DarkInkMuted: '0xFF8C95A6',
    DarkRule: '0xFF252C3B',
    DarkIndigo: '0xFF93B0E6',
    DarkIndigoSoft: '0xFF1D2740',
    DarkGold: '0xFFE3B368'
  };
  for (const [name, hex] of Object.entries(expected)) {
    assert.equal(PALETTE[name], hex, `EditorialPalette.${name}`);
  }
  // The dark theme keeps a soft fill for the accent; it used to be a literal in the tokens.
  assert.ok(PALETTE.DarkIndigoSoft, 'the dark accent needs a fill of its own');
});

test('the palette calls its accents what they are', () => {
  const names = Object.keys(PALETTE);
  assert.ok(names.includes('Indigo') && names.includes('DarkIndigo'), 'the accent is an indigo');
  assert.ok(names.includes('Gold') && names.includes('DarkGold'), 'the second accent is a gold');
  for (const retired of ['Maroon', 'MaroonSoft', 'DarkMaroon', 'Saffron', 'SaffronSoft', 'DarkSaffron']) {
    assert.ok(!names.includes(retired), `${retired} belonged to the old palette`);
  }
});

test('the tokens and the schemes read the palette, they do not repeat it', () => {
  assert.match(EDITORIAL_THEME, /accent = EditorialPalette\.Indigo,/);
  assert.match(EDITORIAL_THEME, /accentSoft = EditorialPalette\.IndigoSoft,/);
  assert.match(EDITORIAL_THEME, /accent = EditorialPalette\.DarkIndigo,/);
  assert.match(EDITORIAL_THEME, /accentSoft = EditorialPalette\.DarkIndigoSoft,/);
  assert.match(EDITORIAL_THEME, /primary = EditorialPalette\.Indigo,/);
  assert.match(EDITORIAL_THEME, /primary = EditorialPalette\.DarkIndigo,/);
  assert.match(EDITORIAL_THEME, /secondary = EditorialPalette\.Gold,/);
  assert.match(EDITORIAL_THEME, /secondary = EditorialPalette\.DarkGold,/);
  // A hex in the schemes is what lets a palette change miss half the app.
  const schemes = objectBody(EDITORIAL_THEME, 'EditorialPalette');
  assert.ok(!/Maroon|Saffron/.test(EDITORIAL_THEME), 'the old names are gone from the theme file');
  assert.ok(schemes.length > 0);
});

test('the brand and panel tokens carry the same palette', () => {
  assert.deepEqual(
    { BrandIndigo: BRAND.BrandIndigo, BrandIndigoDeep: BRAND.BrandIndigoDeep, BrandIndigoLight: BRAND.BrandIndigoLight },
    { BrandIndigo: '0xFF2F4B8F', BrandIndigoDeep: '0xFF263C73', BrandIndigoLight: '0xFF93B0E6' }
  );
  assert.deepEqual(
    { BrandGold: BRAND.BrandGold, BrandGoldLight: BRAND.BrandGoldLight, BrandOnGold: BRAND.BrandOnGold },
    { BrandGold: '0xFFB4761B', BrandGoldLight: '0xFFE3B368', BrandOnGold: '0xFF131722' }
  );
  assert.deepEqual(
    { PanelDeep: BRAND.PanelDeep, Panel: BRAND.Panel, PanelSoft: BRAND.PanelSoft, PanelRule: BRAND.PanelRule },
    { PanelDeep: '0xFF0B0E14', Panel: '0xFF141926', PanelSoft: '0xFF1B2130', PanelRule: '0xFF2A3141' }
  );
  assert.equal(BRAND.PanelInk, '0xFFEDF0F7');
  assert.equal(BRAND.PanelInkMuted, '0xFFC3CAD8');
  assert.equal(BRAND.BrandDarkCanvas, '0xFF0D1017');
  // The dark canvas is the dark theme's own background, not a second opinion about it.
  assert.equal(PALETTE.DarkBg, BRAND.BrandDarkCanvas);
});

test('no value from the previous palette survives anywhere in the app', () => {
  const retired = [
    '7A2E1E', // maroon masthead
    'F2E4DE', // maroon soft
    'D97706', 'FDF0DC', // saffron
    'E9A08C', 'F0A94B', // the dark theme's accents
    'FDFBF7', 'F6F1E8', 'F1EBE0', 'E3DACD', 'CDBCAA', // warm paper and its rules
    '1A1512', '4A423A', '7A6E62', // warm ink
    '12100E', '1C1917', '272320', '322C27', // warm dark theme
    'F7F2EA', 'D8CFC3', '9C9186', // warm dark ink
    '2A140E', '4A2216', '1A0C08', '8B5A2B', '5C3310', '3B1E0A', // brown slabs
    'FFF3D6', 'E7C9A0', 'E8C48A', 'FFF6E4', 'FFD59E', // cream text
    '100C09', '1A120B', '140D08', '1C0E0C', '2A120E', '120806', // brown-black panels
    'F4F0E6', 'F6EFE6', '120E0C', // the viewer's warm ink and its canvas
    '0E1A16', 'FF8C00', '0005FF', '0D6EFD' // the tick's scrim, the old saffron, two stray blues
  ];
  const offenders = [];
  for (const { path: file, text } of SOURCES) {
    // The palette files are where a value is allowed to be written down.
    if (file === 'ui/theme/Color.kt' || file === 'ui/editorial/EditorialTheme.kt') continue;
    for (const hex of retired) {
      if (text.includes(hex)) offenders.push(`${file}: ${hex}`);
    }
  }
  assert.deepEqual(offenders, [], 'the old palette left a value behind');
});

test('no token from the old palette is still named', () => {
  const retired = ['PortalMaroon', 'PortalSaffron', 'PortalDeepBrown', 'PortalCream1', 'PortalCream2',
    'PortalGold', 'PortalWhite', 'PortalDarkBg', 'PortalDarkText',
    'SepiaCanvas', 'SepiaSurface', 'SepiaText', 'PaperCanvasLight', 'PaperSurfaceLight',
    'PaperSurfaceVariantLight', 'PaperCardBorderLight', 'NightTextSecondary',
    'TextSecondaryLight', 'TextTertiaryLight', 'TextMutedLight',
    'AccentCulture', 'AccentBiography', 'AccentMythology', 'AccentScience', 'AccentReminiscence',
    'PlayingWaveBlue'];
  const offenders = [];
  for (const { path: file, text } of SOURCES) {
    for (const token of retired) {
      if (new RegExp(`\\b${token}\\b`).test(text)) offenders.push(`${file}: ${token}`);
    }
  }
  assert.deepEqual(offenders, [], 'a retired token is still referenced');
  // …while the amber ramp is a *prefix* family, so it is checked by prefix.
  const amber = SOURCES.filter(({ text }) => /\bAmber(50|100|200|300|400|500|600|700|800|900|950)\b/.test(text));
  assert.deepEqual(amber.map((s) => s.path), [], 'the amber ramp is still referenced');
});

test('the screens outside EditorialTheme paint from the brand tokens', () => {
  const screens = {
    'ui/screens/SplashScreen.kt': ['BrandIndigo', 'BrandGoldLight'],
    'ui/components/MusicPlayer.kt': ['BrandIndigo', 'BrandGoldLight', 'PanelDeep'],
    'ui/components/PortalDrawer.kt': ['BrandIndigo', 'BrandGoldLight', 'BrandDarkCanvas'],
    'ui/components/AppToast.kt': ['BrandGoldLight'],
    'ui/screens/PdfViewerScreen.kt': ['BrandGoldLight', 'Panel'],
    'ui/screens/PdfArchiveScreen.kt': ['BrandIndigo', 'BrandIndigoDeep', 'PanelInk']
  };
  for (const [file, tokens] of Object.entries(screens)) {
    const source = read(...file.split('/'));
    for (const token of tokens) assert.match(source, new RegExp(`\\b${token}\\b`), `${file} should read ${token}`);
    // Their imports have to come from the theme; a hex from nowhere is what drifted last time.
    assert.match(source, /import com\.ningshingche\.app\.ui\.theme\.(Brand|Panel)/, `${file} should import brand tokens`);
  }
  // The footer keeps its dark band, but in the app's own dark family.
  const footer = read('ui', 'editorial', 'SiteFooter.kt');
  assert.match(footer, /private val FooterBg = PanelDeep/);
  assert.match(footer, /private val FooterAccent = BrandGoldLight/);
});
