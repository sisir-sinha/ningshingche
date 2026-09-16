#!/usr/bin/env python3
"""Wraps user-visible Bengali text in the app so a language swap can change it.

The app writes its copy in Bengali at the call site and asks the translation
table for it. That only works where the call site *asks*: a string literal that
is never passed through `t()` or `tNow()` is invisible to the language files, no
matter how good the translation is. This tool finds those literals, decides
whether they are copy a reader sees or a value the code acts on, and rewrites the
copy — `t("…")` where composition is available, `tNow("…")` everywhere else.

Nothing is guessed. A literal is only rewritten when its surroundings can be read
with confidence:

  * who owns the brace block it sits in — a function body, a composable content
    lambda, a plain statement block, or a lambda that runs outside composition;
  * whether the enclosing function is `@Composable`, with nothing that runs
    outside composition in between (a composable call there would not compile);
  * whether the literal is copy at all — comparisons, map keys, route names,
    regexes, prompts and single letters are left alone.

A thing that is skipped is reported, not silently dropped. `--check` re-runs the
whole analysis and fails if a literal is neither wrapped nor exempt, which is how
the test suite holds the app to it.
"""
from __future__ import annotations

import collections
import io
import json
import os
import re
import sys

ROOT = 'app/src/main/java/com/ningshingche/app'
BENGALI = re.compile(r'[\u0980-\u09FF]')

# Publication text, not interface copy: names and standing copy that read the
# same in every language.
CONTENT_FILES = {'NinghsingCheContentData.kt', 'AuthorProfiles.kt', 'SiteContact.kt'}

# Where the interface lives. `data/` is deliberately out of scope: its Bengali is
# mostly vocabulary the app *matches* and *stores* — a genre written to the
# server, an issue key, a playlist name compared later — and translating a value
# like that breaks the matching rather than the reading. Interface copy that the
# data layer produces for a reader (a request's error message) is a separate
# pass, listed in the report.
SWEEP_DIRS = ('ui/', 'notifications/', 'util/', 'playback/')

# Contexts where Bengali is a value, not copy.
NEVER_CONTEXT = 'testTag|Regex|matches|contains|startsWith|endsWith|removePrefix|removeSuffix'  

# Compose/Material composables that take a content lambda. Matched loosely
# because the same slot is spelled `title = { }` on one component and
# `Column { }` on the next.
MATERIAL_CONTENT = re.compile(
    r'^(?:'
    r'column|row|box|card|surface|button|outlinedbutton|textbutton|iconbutton|'
    r'floatingactionbutton|extendedfloatingactionbutton|scaffold|topappbar|'
    r'centeralignedtopappbar|bottombarapp|bottombar|lazycolumn|lazyrow|'
    r'lazyverticalgrid|lazygrid|dropdownmenu|dropdownmenuitem|alertdialog|dialog|'
    r'modalbottomsheet|tab|tabrow|navigationbar|navigationbaritem|navigationrail|'
    r'navigationdrawer|modalnavigationdrawer|chip|assistchip|filterchip|badge|badgedbox|'
    r'editorialtheme|theme|boxwithconstraints|flowrow|flowcolumn|animatedvisibility|'
    r'crossfade|rangeslider|slider|switch|checkbox|radiobutton|textfield|'
    r'outlinedtextfield|basictextfield|text|icon|image|spacer|divider|horizontaldivider|'
    r'verticaldivider|items|itemsindexed|stickyheader|pager|pulltorefreshbox|'
    r'drawer|listitem|navigationdraweritem|centerrow|centercolumn|tabrowitem|'
    r'progressindicator|circularprogressindicator|primarytabrow|sekectedtab|'
    r'animatedcontent|lookaheadscope|localcontentcolor|providecontentcolor|'
    r'asyncimage|subcomposeasyncimage|videoview|webview'
    r')$', re.IGNORECASE
)
# Slot names that carry composable content: `title = { Text(…) }` draws, it does
# not run an event.
UI_LAMBDA_PARAMS = {
    'title', 'text', 'label', 'placeholder', 'supportingText', 'topBar', 'bottomBar',
    'navigationIcon', 'leadingIcon', 'trailingIcon', 'actions', 'action', 'icon',
    'confirmButton', 'dismissButton', 'content', 'headlineContent', 'supportingContent',
    'overlineContent', 'trailingContent', 'leadingContent', 'floatingActionButton',
    'snackbarHost', 'badge', 'indicator', 'thumbnail', 'drawerContent', 'emptyState',
    'subtitle', 'summary', 'media', 'chip', 'dragHandle', 'loading', 'tab', 'body',
    'footer', 'header', 'prefix', 'suffix',
}
# Values the code acts on rather than shows.
NEVER = re.compile(
    r'^(?:[a-z0-9_/.:-]+|https?://\S+|\+?\d[\d\s()\-]*|[\u0980-\u09FF]{1,2})$', re.IGNORECASE)
PATTERNISH = re.compile(r'\\[dDwWsS]|\(\?:|^\^.*\$$|\{\d+\}')
MARKDOWN_LEAD = re.compile(r'^\s*(?:#{1,6}\s|[-*•]\s|--+\s?|\*\S|\d+\.\s)')
SIMPLE_SLOT = re.compile(r'\$\{([^{}"\n]{1,80})\}|\$([A-Za-z_][A-Za-z0-9_]*)')


def literals(text):
    """Every string literal: (start, end, value, line, clean, raw)."""
    i, n, line = 0, len(text), 1
    while i < n:
        ch = text[i]
        if ch == '\n':
            line += 1
            i += 1
            continue
        if text.startswith('//', i):
            j = text.find('\n', i)
            i = n if j < 0 else j
            continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2)
            if j < 0:
                i = n
            else:
                line += text.count('\n', i, j)
                i = j + 2
            continue
        if ch == '"':
            j, raw, clean = i + 1, [], True
            while j < n:
                if text[j] == '\\':
                    nxt = text[j + 1:j + 2]
                    raw.append({'n': ' ', 'r': ' ', 't': ' '}.get(nxt, nxt))
                    j += 2
                    continue
                if text[j] == '"':
                    break
                if text[j] == '\n':
                    clean = False
                    break
                raw.append(text[j])
                j += 1
            yield i, j + 1, ''.join(raw), line, clean, text[i:j + 1]
            i = j + 1
            continue
        i += 1


def project_classes():
    """Names the app itself declares as classes: never evidence of drawing.

    `data class Image(url, alt)` exists in the markdown and HTML renderers, so
    `Image(` in a lambda may be building a value rather than drawing one.
    """
    names = set()
    for root, _, files in os.walk(ROOT):
        for name in files:
            if not name.endswith('.kt'):
                continue
            text = io.open(os.path.join(root, name), encoding='utf-8').read()
            for match in re.finditer(r'\b(?:data\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)', text):
                names.add(match.group(1))
    return names


def project_composables():
    """`@Composable fun Name` across the app: what a content lambda may call."""
    names = set()
    for root, _, files in os.walk(ROOT):
        for name in files:
            if not name.endswith('.kt'):
                continue
            text = io.open(os.path.join(root, name), encoding='utf-8').read()
            for match in re.finditer(
                    r'@Composable\b[^\n]*\n(?:[^\n]*\n){0,3}?\s*(?:private\s+|internal\s+|public\s+)*'
                    r'fun\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)',
                    text):
                names.add(match.group(1))
    return names


def scan(text):
    """Brace and paren pairing, with strings and comments skipped."""
    braces, paren_map, pstack, bstack, i, n = [], {}, [], [], 0, len(text)
    in_string = None
    while i < n:
        ch = text[i]
        if in_string:
            if ch == '\\':
                i += 2
                continue
            if ch == in_string:
                in_string = None
            elif ch == '\n' and in_string == '"':
                in_string = None
            i += 1
            continue
        if text.startswith('//', i):
            j = text.find('\n', i)
            i = n if j < 0 else j
            continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if ch == '"':
            in_string = ch
            i += 1
            continue
        if ch == '(':
            pstack.append(i)
            i += 1
            continue
        if ch == ')':
            if pstack:
                paren_map[i] = pstack.pop()
            i += 1
            continue
        if ch == '{':
            bstack.append(i)
            i += 1
            continue
        if ch == '}':
            if bstack:
                braces.append((bstack.pop(), i))
            i += 1
            continue
        i += 1
    braces += [(op, None) for op in bstack]
    return sorted(braces), paren_map


def name_before(text, pos, chars=None):
    """The identifier ending just before `pos`, or ''."""
    chars = chars or '_.<>?'
    j = pos - 1
    while j >= 0 and text[j] in ' \t\n':
        j -= 1
    end = j + 1
    while j >= 0 and (text[j].isalnum() or text[j] in chars):
        j -= 1
    return text[j + 1:end]


def direct_body(text, open_pos, close_pos):
    """The block's own body, without the nested blocks inside it."""
    if close_pos is None:
        return text[open_pos + 1:]
    out, depth, i, n = [], 0, open_pos + 1, close_pos
    while i < n:
        ch = text[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        elif depth == 0:
            out.append(ch)
        i += 1
    return ''.join(out)


def classify(text, open_pos, close_pos, paren_map, composables):
    """What the block starting at `open_pos` is."""
    j = open_pos - 1
    while j >= 0 and text[j] in ' \t\n':
        j -= 1
    if j < 0:
        return 'other', None
    before = text[j]
    if before == '>':
        return 'block', None
    if before == ')':
        open_paren = paren_map.get(j)
        if open_paren is None:
            return 'other', None
        callee = name_before(text, open_paren)
        head = text[max(0, open_paren - 120):open_paren]
        if re.search(r'\bfun\s*$', head) or re.search(r'\bfun\s+[A-Za-z_][A-Za-z0-9_]*\s*$', head):
            return 'fun', open_paren
        if re.search(r'\b(class|interface|object)\s+[A-Za-z_][A-Za-z0-9_]*\s*$', head):
            return 'other', None
        last = callee.split('.')[-1]
        if last in ('if', 'for', 'while', 'when', 'catch'):
            return 'block', None
        if last in composables or MATERIAL_CONTENT.match(last):
            return 'content', None
        return ('content', None) if body_calls_composable(text, open_pos, close_pos, composables) \
            else ('other', None)
    if before.isalnum() or before == '_':
        word = name_before(text, j + 1, chars='_')
        if word in ('else', 'try', 'finally', 'do', 'when', 'if', 'for', 'while', 'init'):
            return 'block', None
        if word in composables or MATERIAL_CONTENT.match(word):
            return 'content', None
        return ('content', None) if body_calls_composable(text, open_pos, close_pos, composables) \
            else ('other', None)
    if before == '=':
        slot = name_before(text, j)
        if slot in UI_LAMBDA_PARAMS:
            return 'content', None
        return ('content', None) if body_calls_composable(text, open_pos, close_pos, composables) \
            else ('other', None)
    if before == ',':
        return ('content', None) if body_calls_composable(text, open_pos, close_pos, composables) \
            else ('other', None)
    return 'other', None


def body_calls_composable(text, open_pos, close_pos, composables):
    """Evidence, not inference: the block already draws something.

    Existing code compiles, so a composable call written inside a lambda proves
    the lambda runs in composition — a call that draws cannot sit in a handler.
    The whole body counts, nested blocks included: `if (ready) { Text(…) }` proves
    it exactly as well as a direct call. (A name that is both a composable and a
    data class would be a false witness; there is no such name in the app.)
    """
    body = text[open_pos + 1:close_pos] if close_pos is not None else text[open_pos + 1:]
    if re.search(r'(?<![A-Za-z0-9_.])(Text|Icon|Image|Spacer|Column|Row|Box|Card|Surface|'
                 r'HORIZONTALDivider|HorizontalDivider|VerticalDivider|LazyColumn|LazyRow|'
                 r'Button|IconButton|TextButton|Scaffold|TopAppBar|CircularProgressIndicator|'
                 r'LinearProgressIndicator|Slider|Switch|Checkbox|Badge|Divider|Canvas|'
                 r'LazyVerticalGrid|TabRow|NavigationBar|DropdownMenu|Dialog|AlertDialog)\s*\(',
                 body):
        return True
    for name in composables:
        if re.search(r'(?<![A-Za-z0-9_.])' + re.escape(name) + r'\s*\(', body):
            return True
    return False


def composable_context(text, pos, kinds, brace_spans, fun_starts):
    """Is a composable call legal here? Only when nothing outside composition sits between."""
    chain = [(op, cl, kinds[op]) for op, cl in brace_spans
             if op < pos and (cl is None or pos < cl)]
    chain = [(op, cl, kind[0] if isinstance(kind, tuple) else kind) for op, cl, kind in chain]
    if not chain:
        return False
    index = max((i for i, (_, _, kind) in enumerate(chain) if kind == 'fun'), default=None)
    if index is None:
        return False
    if any(kind == 'other' for _, _, kind in chain[index + 1:]):
        return False
    # `kinds[block]` carries where the declaration starts, so a long signature or
    # a KDoc cannot push the annotation out of view.
    declaration = chain[index][2][1] if isinstance(chain[index][2], tuple) else chain[index][0]
    head = text[max(0, (declaration or chain[index][0]) - 300):(declaration or chain[index][0])]
    return '@Composable' in head


def rewrite(raw):
    """`তোমার ${count}টি` -> key `তোমার {1}টি` plus the arguments."""
    args, manual = [], False

    def slot(match):
        expr = (match.group(1) or match.group(2)).strip()
        if expr.count('(') != expr.count(')') or '"' in expr or '{' in expr:
            manual = True
        args.append(expr)
        return '{' + str(len(args)) + '}'

    key = SIMPLE_SLOT.sub(slot, raw)
    # The inventory builds its keys with `.strip()`, and the app's own lookup
    # trims too (its loose map), so `"লাইক {1} · "` and `"লাইক {1} ·"` are one
    # string to everyone except a byte comparison.
    return key.strip(), args, manual


def ui_keys():
    """The strings the language files actually carry.

    The inventory that built them already decided what interface copy is: it
    dropped prompts, regexes, ids and publication text. Asking the same question
    by reading the file keeps the two definitions from drifting — a literal only
    gets wrapped if a row exists to translate it, so no site can end up wired to
    nothing.
    """
    keys = set()
    for code in ('en', 'bpy', 'bn'):
        path = os.path.join('backend', 'assets', 'lang', f'{code}.csv')
        if not os.path.exists(path):
            continue
        text = io.open(path, encoding='utf-8').read()
        rows, row, cell, quoted = [], [], '', False
        i = 0
        while i < len(text):
            ch = text[i]
            if quoted:
                if ch == '"' and text[i + 1:i + 2] == '"':
                    cell += '"'; i += 2; continue
                if ch == '"':
                    quoted = False
                else:
                    cell += ch
            elif ch == '"':
                quoted = True
            elif ch == ',':
                row.append(cell); cell = ''
            elif ch == '\n':
                row.append(cell); rows.append(row); row = []
                cell = ''
            else:
                cell += ch
            i += 1
        if cell or row:
            row.append(cell); rows.append(row)
        if rows and rows[0][0].strip().lower() == 'key':
            rows = rows[1:]
        keys |= {r[0] for r in rows if len(r) >= 2 and r[0].strip()}
    return keys


def analyse(verbose=False):
    composables = project_composables() - project_classes()
    keys = ui_keys()
    findings = []
    for root, _, files in os.walk(ROOT):
        for name in sorted(files):
            if not name.endswith('.kt'):
                continue
            path = os.path.join(root, name)
            rel = path.split('com/ningshingche/app/')[1]
            if name in CONTENT_FILES or not rel.startswith(SWEEP_DIRS):
                continue
            text = io.open(path, encoding='utf-8').read()
            brace_spans, paren_map = scan(text)
            kinds = {}
            for op, cl in brace_spans:
                kinds[op], _ = classify(text, op, cl, paren_map, composables)
            for start, end, value, line, clean, raw in literals(text):
                if not BENGALI.search(value):
                    continue
                kind_of = 'copy'
                before = text[max(0, start - 60):start]
                if re.search(r'(?<![A-Za-z0-9_.])(t|tNow)\s*\(\s*$', before):
                    kind_of = 'wired'
                elif not clean:
                    kind_of = 'odd'
                elif NEVER.match(value.strip()) or PATTERNISH.search(value) or MARKDOWN_LEAD.match(value):
                    kind_of = 'not copy'
                elif re.search(r'(==|!=)\s*$', before) \
                        or re.search(r'(?<![A-Za-z0-9_.])(?:' + NEVER_CONTEXT + r')\s*\(\s*$', before):
                    kind_of = 'compared or an identifier'
                elif rewrite(raw[1:-1])[0] not in keys:
                    kind_of = 'no row in the language files'
                findings.append(dict(file=rel, line=line, start=start, end=end, raw=raw,
                                     value=value, kind=kind_of,
                                     call=('t' if composable_context(text, start, kinds, brace_spans, None)
                                           else 'tNow')))
    return findings


def main(argv):
    write = '--write' in argv
    findings = analyse()
    counts = collections.Counter()
    todo = collections.defaultdict(list)
    for f in findings:
        if f['kind'] == 'copy':
            key, args, manual = rewrite(f['raw'][1:-1])
            if manual:
                counts['manual: template too complex'] += 1
                todo['manual'].append((f['file'], f['line'], f['raw'][:70]))
                continue
            counts[f"wrap {f['call']}"] += 1
            todo[f['call']].append((f['file'], f['line'], key[:70]))
        else:
            counts[f['kind']] += 1
            todo[f['kind']].append((f['file'], f['line'], f['value'][:70]))
    json.dump({k: v for k, v in todo.items()}, io.open('/tmp/wrap_report.json', 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(counts, ensure_ascii=False, indent=1))
    if not write:
        return 0
    by_file = collections.defaultdict(list)
    for f in findings:
        if f['kind'] != 'copy':
            continue
        key, args, manual = rewrite(f['raw'][1:-1])
        if manual:
            continue
        arg_text = ''.join(', ' + a for a in args)
        # The rewritten key, not the literal as it was written: a template inside
        # the string (`"গান ${count}টি"`) would be filled in before the lookup, and
        # no row can ever match a string that has already been interpolated.
        literal = '"' + key + '"'
        by_file[f['file']].append((f['start'], f['end'], f"{f['call']}({literal}{arg_text})", f['call']))
    for rel, edits in by_file.items():
        path = os.path.join('app/src/main/java/com/ningshingche/app', rel)
        text = io.open(path, encoding='utf-8').read()
        for start, end, new, _ in sorted(edits, reverse=True):
            text = text[:start] + new + text[end:]
        needs = []
        if re.search(r'(?<![A-Za-z0-9_.])t\(', text) and 'import com.ningshingche.app.ui.i18n.t\n' not in text:
            needs.append('t')
        if re.search(r'(?<![A-Za-z0-9_.])tNow\(', text) and 'import com.ningshingche.app.ui.i18n.tNow\n' not in text:
            needs.append('tNow')
        if needs and 'package com.ningshingche.app.ui.i18n' not in text:
            lines = text.split('\n')
            anchors = [i for i, l in enumerate(lines) if l.startswith('import ')]
            if anchors:
                anchor = anchors[-1]
            else:
                anchor = next(i for i, l in enumerate(lines) if l.startswith('package '))
                lines.insert(anchor + 1, '')
            for offset, need in enumerate(sorted(needs)):
                lines.insert(anchor + 1 + offset, f'import com.ningshingche.app.ui.i18n.{need}')
            text = '\n'.join(lines)
        io.open(path, 'w', encoding='utf-8').write(text)
    print('WRITTEN')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
