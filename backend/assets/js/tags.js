(function (NC) {
  'use strict';

  /**
   * Blog tag helpers.
   *
   * Tags are free text in public.blogs.tags (text[]). The annual issue tags
   * ("নিংশিং চে বার্ষিক সংখ্যা") exist in several spellings — "নিংশিং চে - ২০২৩",
   * "নিংশিং চে-২০২৩", "নিংশিং চে-2023" — so every comparison in the dashboard
   * goes through keyOf(), which ignores whitespace, dash style, letter case and
   * Bengali/ASCII digit differences. The same rules are installed in Supabase
   * by supabase/migrations/013_blog_tags.sql (blog_tag_key) so the REST/RPC
   * endpoints and the dashboard always agree.
   */

  const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';
  const ISSUE_PATTERN = /^(?:নিংশিংচে|ningshingche|ningshing-che)-?(\d{4})$/u;
  const ISSUE_LABEL_PREFIX = 'নিংশিং চে';
  const ISSUE_KEY_PREFIX = 'নিংশিংচে-';

  function toAsciiDigits(value) {
    return String(value ?? '').replace(/[০-৯]/g, (digit) => String(BENGALI_DIGITS.indexOf(digit)));
  }

  function toBengaliDigits(value) {
    return String(value ?? '').replace(/[0-9]/g, (digit) => BENGALI_DIGITS[Number(digit)]);
  }

  /** Display form: NFC, trimmed, single spaces, no leading "#". */
  function clean(tag) {
    return String(tag ?? '').normalize('NFC').replace(/^#+/, '').replace(/\s+/g, ' ').trim();
  }

  /** Raw normalisation: lower-case, ASCII digits, plain hyphen, no whitespace. */
  function normalize(tag) {
    return toAsciiDigits(clean(tag)).toLocaleLowerCase().replace(/[–—−]/g, '-').replace(/\s+/g, '');
  }

  /** Returns the four-digit year for an annual issue tag, otherwise null. */
  function issueYear(tag) {
    const match = normalize(tag).match(ISSUE_PATTERN);
    return match ? Number(match[1]) : null;
  }

  function isIssue(tag) {
    return issueYear(tag) !== null;
  }

  /** Stable key shared by every spelling of the same issue, e.g. "নিংশিংচে-2025". */
  function issueKey(year) {
    return `${ISSUE_KEY_PREFIX}${Number(toAsciiDigits(year))}`;
  }

  /** Comparison key. Issue tags collapse to issueKey(); everything else to normalize(). */
  function keyOf(tag) {
    const year = issueYear(tag);
    return year ? issueKey(year) : normalize(tag);
  }

  /** Canonical display label, e.g. "নিংশিং চে-২০২৫". */
  function issueLabel(year) {
    return `${ISSUE_LABEL_PREFIX}-${toBengaliDigits(Number(toAsciiDigits(year)))}`;
  }

  /**
   * Concrete spellings to send to PostgREST when migration 013 is not
   * installed (tags=ov.{…} / cs.{…} match exact strings only).
   */
  function issueVariants(year) {
    const ascii = String(Number(toAsciiDigits(year)));
    const bengali = toBengaliDigits(ascii);
    const variants = [];
    [bengali, ascii].forEach((digits) => {
      variants.push(
        `${ISSUE_LABEL_PREFIX} - ${digits}`, `${ISSUE_LABEL_PREFIX}-${digits}`, `${ISSUE_LABEL_PREFIX} ${digits}`,
        `${ISSUE_LABEL_PREFIX} – ${digits}`, `${ISSUE_LABEL_PREFIX} — ${digits}`, `নিংশিংচে-${digits}`, `নিংশিংচে ${digits}`
      );
    });
    return [...new Set(variants)];
  }

  /** Accepts a record with a tags column, an array, or a comma string. */
  function tagsOf(source) {
    if (Array.isArray(source)) return source.map(clean).filter(Boolean);
    if (typeof source === 'string') return NC.utils.parseTags(source).map(clean).filter(Boolean);
    const tags = source?.tags;
    if (Array.isArray(tags)) return tags.map(clean).filter(Boolean);
    return NC.utils.parseTags(tags || '').map(clean).filter(Boolean);
  }

  function matchesKey(source, key) {
    const expected = String(key || '');
    if (!expected) return false;
    return tagsOf(source).some((tag) => keyOf(tag) === expected);
  }

  function matchesIssue(source, year) {
    const expected = Number(toAsciiDigits(year));
    if (!Number.isFinite(expected)) return false;
    return tagsOf(source).some((tag) => issueYear(tag) === expected);
  }

  /** Parses "2025", "২০২৫", "নিংশিং চে-২০২৫" or an issue key into a year, else null. */
  function parseIssueParam(value) {
    const ascii = toAsciiDigits(String(value ?? '').trim());
    if (/^\d{4}$/.test(ascii)) return Number(ascii);
    return issueYear(value);
  }

  /**
   * Groups the tags of many blog records.
   * Returns { issues: [...], tags: [...] } where each entry is
   * { key, label, year, count, publishedCount, variants[] }.
   * Issues are sorted newest first; other tags by frequency.
   */
  function index(records = []) {
    const issues = new Map();
    const others = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      const published = record?.status === 'Publish';
      const seen = new Set();
      tagsOf(record).forEach((label) => {
        const year = issueYear(label);
        const key = keyOf(label);
        if (!key || seen.has(key)) return;
        seen.add(key);
        const bucket = year ? issues : others;
        const entry = bucket.get(key) || { key, label, year, count: 0, publishedCount: 0, variantCounts: new Map() };
        entry.count += 1;
        if (published) entry.publishedCount += 1;
        entry.variantCounts.set(label, (entry.variantCounts.get(label) || 0) + 1);
        bucket.set(key, entry);
      });
    });
    const finalize = (entry) => {
      const variants = [...entry.variantCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
      return {
        key: entry.key,
        label: entry.year ? issueLabel(entry.year) : (variants[0] || entry.label),
        year: entry.year,
        count: entry.count,
        publishedCount: entry.publishedCount,
        variants
      };
    };
    return {
      issues: [...issues.values()].map(finalize).sort((a, b) => b.year - a.year),
      tags: [...others.values()].map(finalize).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'bn'))
    };
  }

  /** Converts rows of the blog_tag_counts view (migration 013) into index() shape. */
  function indexFromRows(rows = []) {
    const issues = [];
    const tags = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const year = row.issue_year != null ? Number(row.issue_year) : issueYear(row.tag);
      const entry = {
        key: row.tag_key || keyOf(row.tag),
        label: year ? issueLabel(year) : clean(row.tag),
        year: year || null,
        count: Number(row.total || 0),
        publishedCount: Number(row.published || 0),
        variants: Array.isArray(row.spellings) && row.spellings.length ? row.spellings.map(clean) : [clean(row.tag)]
      };
      (year ? issues : tags).push(entry);
    });
    issues.sort((a, b) => b.year - a.year);
    tags.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'bn'));
    return { issues, tags };
  }

  /**
   * Spelling used when the dashboard writes a new issue tag: the most common
   * existing spelling wins (so new records match older ones exactly on the
   * public website), falling back to the canonical "নিংশিং চে-YYYY".
   */
  function houseIssueLabel(year, tagIndex) {
    const templates = new Map();
    (tagIndex?.issues || []).forEach((issue) => {
      issue.variants.forEach((variant, position) => {
        const template = variant.replace(/[০-৯0-9]{4}/, '{year}');
        if (!template.includes('{year}')) return;
        const usesBengali = /[০-৯]/.test(variant);
        const entry = templates.get(template) || { template, usesBengali, weight: 0 };
        entry.weight += Math.max(1, issue.count - position);
        templates.set(template, entry);
      });
    });
    const best = [...templates.values()].sort((a, b) => b.weight - a.weight)[0];
    const ascii = String(Number(toAsciiDigits(year)));
    if (!best) return issueLabel(ascii);
    return best.template.replace('{year}', best.usesBengali ? toBengaliDigits(ascii) : ascii);
  }

  /** Human label for any tag: issues become the canonical label, others are cleaned. */
  function displayLabel(tag) {
    const year = issueYear(tag);
    return year ? issueLabel(year) : clean(tag);
  }

  /** Removes every issue tag from a list and optionally prepends a new one. */
  function withIssue(tags, year, tagIndex) {
    const rest = tagsOf(tags).filter((tag) => !isIssue(tag));
    if (!year) return rest;
    return [houseIssueLabel(year, tagIndex), ...rest];
  }

  NC.tags = Object.freeze({
    toAsciiDigits, toBengaliDigits, clean, normalize, keyOf, issueYear, isIssue, issueKey, issueLabel,
    issueVariants, tagsOf, matchesKey, matchesIssue, parseIssueParam, index, indexFromRows,
    houseIssueLabel, displayLabel, withIssue
  });
})(window.NC);
