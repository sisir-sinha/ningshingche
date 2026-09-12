/**
 * Source health — the checks a compiler would make that the other gates cannot.
 *
 * The owner's first real `./gradlew assembleDebug` on this tree found twenty-odd
 * errors, none of which any of the lexical gates (balance, unused imports,
 * unresolved *imports*, duplicate declarations) could see, because every one of
 * them was a name that is *used* without being imported or declared:
 *
 *   * `Icons.Default.FormatListBulleted` — an icon is an extension property, so
 *     it needs an import of its own, and the filled family is deprecated in
 *     favour of the AutoMirrored one.
 *   * `Modifier.width(…)`, `rememberSaveable`, `ForumActivity` — used in one
 *     file, imported in none.
 *   * a duplicate `import` of a name (`EditorialSpace`) — "ambiguous" to the
 *     compiler, invisible to every gate here.
 *   * `@Composable` written twice over one declaration, and missing from a
 *     `fun` that composes (`MetricCard`) — the first is an error, the second is
 *     an error at every call site.
 *   * `shrinkVertically(shrinkFrom = …)` — a parameter renamed to
 *     `shrinkTowards` in Compose 1.7; a name that simply does not exist.
 *
 * These are static, file-reading checks. They are not a compiler: they cover the
 * mistakes this codebase has actually made, and each rule below names the
 * mistake it exists for.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'app', 'src', 'main', 'java');

/** Every .kt file under app/src/main/java, as { rel, pkg, imports, text, lines }. */
function loadSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.kt')) files.push(full);
    }
  };
  walk(MAIN);
  return files.sort().map((full) => {
    const text = fs.readFileSync(full, 'utf8');
    const pkg = (/^package\s+([\w.]+)/m.exec(text) || [, ''])[1];
    const imports = [...text.matchAll(/^import\s+([\w.]+)(?:\s+as\s+(\w+))?$/gm)].map((m) => ({
      fqn: m[1],
      simple: m[2] || m[1].split('.').pop(),
      explicitAlias: Boolean(m[2])
    }));
    return {
      rel: path.relative(ROOT, full),
      pkg,
      imports,
      text,
      // Comments and string literals out of the way, with the line structure kept.
      code: strip(text)
    };
  });
}

/** Comments and literals blanked out, character for character, so lines line up. */
function strip(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      while (i < n && text[i] !== '\n') { out += ' '; i += 1; }
    } else if (two === '/*') {
      while (i < n && text.slice(i, i + 2) !== '*/') { out += text[i] === '\n' ? '\n' : ' '; i += 1; }
      out += '  ';
      i += 2;
    } else if (text[i] === '"') {
      const triple = text.slice(i, i + 3) === '"""';
      const end = triple ? '"""' : '"';
      out += ' '.repeat(end.length);
      i += end.length;
      while (i < n) {
        if (!triple && text[i] === '\\') { out += '  '; i += 2; continue; }
        if (text.slice(i, i + end.length) === end) break;
        out += text[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += end;
      i += end.length;
    } else if (text[i] === "'") {
      out += ' ';
      i += 1;
      while (i < n) {
        if (text[i] === '\\') { out += '  '; i += 2; continue; }
        const ch = text[i];
        out += ch === '\n' ? '\n' : ' ';
        i += 1;
        if (ch === "'") break;
      }
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

const SOURCES = loadSources();
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** A declaration's body, from its opening brace to the one that closes it. */
function bodyAt(source, at) {
  const open = source.indexOf('{', source.indexOf('(', at));
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

// ---------------------------------------------------------------------------
// 1. No duplicate imports — "imported name 'EditorialSpace' is ambiguous"
// ---------------------------------------------------------------------------

test('no file imports the same name twice', () => {
  // Two *identical* imports are the compiler's "imported name is ambiguous".
  // Two different packages may legally declare the same simple name — an icon
  // exists in both `filled` and `automirrored.filled`, and `items` belongs to
  // both `lazy` and `lazy.grid` — so only the identical pair is flagged here.
  const complaints = [];
  for (const file of SOURCES) {
    const seen = new Set();
    for (const imp of file.imports) {
      if (seen.has(imp.fqn)) complaints.push(`${file.rel}: ${imp.fqn} imported twice`);
      seen.add(imp.fqn);
    }
  }
  assert.deepEqual(complaints, [], 'an import written twice is a conflict, not a habit');
});

// ---------------------------------------------------------------------------
// 2. An icon needs its own import — and the AutoMirrored family where it moved
// ---------------------------------------------------------------------------

const ICON_FAMILIES = {
  Default: 'filled',
  Filled: 'filled',
  Outlined: 'outlined',
  Rounded: 'rounded',
  Sharp: 'sharp',
  TwoTone: 'twotone',
  'AutoMirrored.Default': 'automirrored.filled',
  'AutoMirrored.Filled': 'automirrored.filled',
  'AutoMirrored.Outlined': 'automirrored.outlined',
  'AutoMirrored.Rounded': 'automirrored.rounded',
  'AutoMirrored.Sharp': 'automirrored.sharp',
  'AutoMirrored.TwoTone': 'automirrored.twotone'
};

test('every icon is imported from the family it is used from', () => {
  const complaints = [];
  for (const file of SOURCES) {
    for (const match of file.code.matchAll(/Icons\.((?:AutoMirrored\.)?[A-Za-z]+)\.([A-Za-z0-9]+)/g)) {
      const [, family, name] = match;
      const folder = ICON_FAMILIES[family];
      if (!folder) {
        complaints.push(`${file.rel}:${lineOf(file.code, match.index)} unknown family Icons.${family}`);
        continue;
      }
      const wanted = `androidx.compose.material.icons.${folder}.${name}`;
      const imported = file.imports.some((imp) => imp.fqn === wanted);
      if (!imported) {
        complaints.push(
          `${file.rel}:${lineOf(file.code, match.index)} Icons.${family}.${name} needs ` +
          `import ${wanted}`
        );
      }
    }
  }
  assert.deepEqual(complaints, [], 'an icon is an extension property: it is only in scope if imported');
});

// ---------------------------------------------------------------------------
// 3. Compose names that must be imported to be used at all
// ---------------------------------------------------------------------------

const NEEDS_IMPORT = [
  ['Modifier.width(', 'androidx.compose.foundation.layout.width'],
  ['Modifier.height(', 'androidx.compose.foundation.layout.height'],
  ['Modifier.size(', 'androidx.compose.foundation.layout.size'],
  ['Modifier.padding(', 'androidx.compose.foundation.layout.padding'],
  ['Modifier.fillMaxWidth(', 'androidx.compose.foundation.layout.fillMaxWidth'],
  ['Modifier.fillMaxSize(', 'androidx.compose.foundation.layout.fillMaxSize'],
  ['Modifier.offset(', 'androidx.compose.foundation.layout.offset'],
  ['Modifier.testTag(', 'androidx.compose.ui.platform.testTag'],
  ['rememberSaveable', 'androidx.compose.runtime.saveable.rememberSaveable'],
  ['rememberLazyListState(', 'androidx.compose.foundation.lazy.rememberLazyListState'],
  ['rememberScrollState(', 'androidx.compose.foundation.rememberScrollState'],
  ['collectAsStateWithLifecycle(', 'androidx.lifecycle.compose.collectAsStateWithLifecycle'],
  ['BackHandler(', 'androidx.activity.compose.BackHandler'],
  ['rememberLauncherForActivityResult(', 'androidx.activity.compose.rememberLauncherForActivityResult'],
  ['derivedStateOf', 'androidx.compose.runtime.derivedStateOf'],
  ['mutableIntStateOf', 'androidx.compose.runtime.mutableIntStateOf'],
  ['KeyboardOptions(', 'androidx.compose.foundation.text.KeyboardOptions']
];

test('the Compose names these files use are imported', () => {
  const complaints = [];
  for (const file of SOURCES) {
    for (const [needle, fqn] of NEEDS_IMPORT) {
      const at = file.code.indexOf(needle);
      if (at === -1) continue;
      // An exact import, not a substring: `layout.width` is inside the line that
      // imports `layout.widthIn`, and that has caught this check out before.
      if (file.imports.some((imp) => imp.fqn === fqn)) continue;
      complaints.push(`${file.rel}:${lineOf(file.code, at)} ${needle} needs import ${fqn}`);
    }
  }
  assert.deepEqual(complaints, [], 'these names are not in scope by default');
});

// ---------------------------------------------------------------------------
// 4. One @Composable per declaration, and one where it is needed
// ---------------------------------------------------------------------------

/** Names that compose — a `fun` that calls one of these is itself a composable. */
const COMPOSABLE_BUILDERS = [
  'Surface(', 'Column(', 'Row(', 'Box(', 'Text(', 'Icon(', 'Spacer(', 'Button(',
  'TextButton(', 'IconButton(', 'OutlinedButton(', 'FilterChip(', 'LazyColumn(',
  'LazyRow(', 'Scaffold(', 'Canvas(', 'AlertDialog(', 'CircularProgressIndicator(',
  'LinearProgressIndicator(', 'NavigationBar(', 'TopAppBar(', 'BackHandler('
];

test('@Composable is written once, and wherever it is needed', () => {
  const complaints = [];
  for (const file of SOURCES) {
    const lines = file.code.split('\n');

    // (a) twice over one declaration
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() !== '@Composable') continue;
      let back = i - 1;
      while (back >= 0 && (lines[back].trim() === '' || lines[back].trim().startsWith('*') ||
        lines[back].trim().startsWith('/*') || lines[back].trim().startsWith('//'))) back -= 1;
      if (back >= 0 && lines[back].trim() === '@Composable') {
        complaints.push(`${file.rel}:${i + 1} @Composable twice over one declaration`);
      }
    }

    // (b) missing where the body composes
    for (const match of file.code.matchAll(/^(?:internal |private |public )?fun ([A-Za-z0-9_]+)\(/gm)) {
      let back = lineOf(file.code, match.index) - 2;
      let annotated = false;
      while (back >= 0 && (lines[back].trim() === '' || lines[back].trim().startsWith('*') ||
        lines[back].trim().startsWith('/*') || lines[back].trim().startsWith('//'))) back -= 1;
      if (back >= 0) {
        for (let k = Math.max(0, back - 3); k <= back; k += 1) {
          if (lines[k].trim() === '@Composable') annotated = true;
        }
      }
      if (annotated) continue;
      const body = bodyAt(file.code, match.index);
      // The name must stand on its own: `getCategoryIcon(` and `splitTableRow(`
      // contain "Icon(" and "Row(" and are not composables. A real call is
      // preceded by nothing word-like and no dot.
      const composes = COMPOSABLE_BUILDERS.find((builder) =>
        new RegExp(`(?:^|[^\\w.])${builder.replace('(', '\\(')}`).test(body)
      );
      if (composes) {
        complaints.push(
          `${file.rel}:${lineOf(file.code, match.index)} fun ${match[1]}() calls ${composes.replace('(', '')} ` +
          'without @Composable'
        );
      }
    }
  }
  assert.deepEqual(complaints, [], 'a composable is a composable from the outside too');
});

// ---------------------------------------------------------------------------
// 5. A name from another package is used only where it is imported
// ---------------------------------------------------------------------------

test('every declaration used from another package is imported', () => {
  // Where each top-level name lives, and where it is used.
  // Only two kinds of name can be checked without a compiler: types, which are
  // capitalised, and functions whose name has an inner capital (`monthNameOf`),
  // which a sentence cannot accidentally contain. A property called `message`
  // belongs to half the codebase in one sense or another.
  const home = new Map(); // simple name -> [{ pkg, rel }]
  for (const file of SOURCES) {
    for (const match of file.code.matchAll(
      /^(?:internal |public |open |abstract |sealed |data |enum |value |annotation )*(?:class|interface|object|typealias) ([A-Za-z0-9_]+)/gm
    )) {
      if (match[1].length >= 4) home.set(match[1], [...(home.get(match[1]) || []), file]);
    }
    for (const match of file.code.matchAll(
      /^(?:internal |public |suspend |inline |operator |override )*fun (?:<[^>]*>\s*)?(?:[A-Za-z0-9_.<>?[\], ]+\.)?([a-z][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*)\(/gm
    )) {
      home.set(match[1], [...(home.get(match[1]) || []), file]);
    }
  }

  const complaints = [];
  for (const file of SOURCES) {
    const imported = new Set(file.imports.map((imp) => imp.simple));
    // Everything this file declares, nested and private included: a name that
    // lives here needs no import, whatever it is called elsewhere.
    const mine = new Set();
    for (const match of file.code.matchAll(
      /(?:class|interface|object|typealias|fun|val|var)\s+(?:<[^>]*>\s*)?([A-Za-z_][A-Za-z0-9_]*)/g
    )) {
      mine.add(match[1]);
    }
    for (const [name, places] of home) {
      if (imported.has(name) || mine.has(name)) continue;
      // Declared in this file's own package: in scope without an import.
      if (places.some((place) => place.pkg === file.pkg)) continue;
      // A name reached through a dot — `ReaderRoute.Article`, `PdfRenderer.Page`,
      // `com.ningshingche.app.util.PdfHelper` — is a member or a qualification,
      // not a top-level reference this rule can judge.
      const used = new RegExp(`(?<![\\w.])${name}\\b`).test(file.code);
      if (!used) continue;
      complaints.push(`${file.rel} uses ${name} (declared in ${places[0].rel}) without importing it`);
    }
  }
  assert.deepEqual(complaints, [], 'another package is another scope');
});
