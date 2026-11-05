/*
 * Pure logic for reviewer2: no DOM, no storage. Loaded as a classic script in
 * the browser (exposes `Core`) and as a CommonJS module in tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** A line shorter than this (trimmed) gets the previous line as extra context. */
  const MIN_CONTEXT_CHARS = 40;

  function normalizeText(text) {
    return String(text ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  }

  function splitLines(text) {
    return normalizeText(text).split('\n');
  }

  // ---------------------------------------------------------------------------
  // Line classification (lightweight, line-by-line markdown)

  const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
  const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

  function isTableSeparator(line) {
    return line.includes('-') && line.includes('|') && TABLE_SEP_RE.test(line);
  }

  function splitTableRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  /**
   * Classify each source line so the view can style it. Fenced code is tracked
   * across lines; consecutive table rows are grouped so their columns align.
   */
  function classifyLines(lines) {
    let fence = null;
    const info = lines.map((line) => {
      const fm = line.match(FENCE_RE);
      if (fence) {
        if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && fm[2].trim() === '') {
          fence = null;
          return { kind: 'fence', close: true };
        }
        return { kind: 'code' };
      }
      if (fm && !(fm[1][0] === '`' && fm[2].includes('`'))) {
        fence = fm[1];
        return { kind: 'fence', open: true, lang: fm[2].trim() };
      }
      if (line.trim() === '') return { kind: 'blank' };
      let m;
      if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/))) {
        return { kind: 'heading', level: m[1].length, text: m[2] };
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return { kind: 'hr' };
      if (/^\s*\|/.test(line)) return { kind: 'table' };
      if ((m = line.match(/^\s*>\s?(.*)$/))) return { kind: 'quote', text: m[1] };
      if ((m = line.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/))) {
        return {
          kind: 'list',
          indent: m[1].replace(/\t/g, '    ').length,
          marker: m[2],
          ordered: /\d/.test(m[2]),
          task: m[3] === undefined ? null : m[3] !== ' ',
          text: m[4],
        };
      }
      const lead = line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
      return { kind: 'para', indent: lead, text: line.trim() };
    });

    // Group table rows.
    for (let i = 0; i < info.length; ) {
      if (info[i].kind !== 'table') { i++; continue; }
      let j = i;
      while (j < info.length && info[j].kind === 'table') j++;
      const rows = lines.slice(i, j).map((l) => ({ sep: isTableSeparator(l), cells: splitTableRow(l) }));
      const cols = Math.max(1, ...rows.map((r) => (r.sep ? 0 : r.cells.length)));
      const weights = [];
      for (let c = 0; c < cols; c++) {
        const lens = rows.filter((r) => !r.sep).map((r) => (r.cells[c] || '').length);
        const avg = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
        weights.push(Math.round(Math.max(4, Math.min(40, avg))));
      }
      const template = weights.map((w) => `minmax(0, ${w}fr)`).join(' ');
      const hasHeader = rows.length > 1 && rows[1].sep;
      rows.forEach((r, k) => {
        const cells = r.cells.slice(0, cols);
        while (cells.length < cols) cells.push('');
        info[i + k] = { kind: 'table', sep: r.sep, header: hasHeader && k === 0, cells, template };
      });
      i = j;
    }
    return info;
  }

  // ---------------------------------------------------------------------------
  // Inline markdown -> HTML (escaped; only a safe subset is produced)

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  function isSafeUrl(url) {
    return /^(https?:|mailto:)/i.test(url);
  }

  function renderInline(src) {
    const codes = [];
    let s = String(src).replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, ticks, code) => {
      codes.push(code.length > 2 && code[0] === ' ' && code[code.length - 1] === ' ' ? code.slice(1, -1) : code);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = escapeHtml(s);
    s = s.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;.*?&quot;)?\)/g, (m, text, url) =>
      isSafeUrl(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>` : m,
    );
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
    s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_(?=[^\s_])([^_]*?[^\s_])_(?![_\w])/g, '$1<em>$2</em>');
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
    return s;
  }

  function stripInline(src) {
    return String(src)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/[*_`~]+/g, '');
  }

  // ---------------------------------------------------------------------------
  // Comments: context, ordering, export, re-anchoring

  /** Lines that carry no meaning on their own and make poor context. */
  function isFiller(line) {
    if (line === undefined) return true;
    const t = line.trim();
    return t === '' || FENCE_RE.test(line) || /^([-*_])(\s*\1){2,}$/.test(t) || isTableSeparator(line);
  }

  /**
   * The quoted context for a comment on line `idx`: the line itself, plus the
   * previous meaningful line when the line is too short to stand alone.
   */
  function lineContext(lines, idx, minChars = MIN_CONTEXT_CHARS) {
    if (!lines.length) return '';
    idx = Math.max(0, Math.min(idx, lines.length - 1));
    let i = idx;
    while (i > 0 && isFiller(lines[i])) i--;
    if (isFiller(lines[i])) i = idx; // nothing better above; use the line as-is
    const out = [lines[i].trimEnd()];
    if (lines[i].trim().length < minChars) {
      let j = i - 1;
      while (j >= 0 && isFiller(lines[j])) j--;
      if (j >= 0) out.unshift(lines[j].trimEnd());
    }
    return out.join('\n');
  }

  function commentContext(lines, c) {
    if (c.quote) return c.quote;
    if (c.orphan) return c.lineText || '';
    return lineContext(lines, c.line);
  }

  function quoteBlock(text) {
    return String(text)
      .split('\n')
      .map((l) => (l.trim() ? `> ${l}` : '>'))
      .join('\n');
  }

  function sortComments(comments) {
    return [...comments].sort((a, b) => a.line - b.line || a.createdAt - b.createdAt);
  }

  /** The text that goes to the clipboard. */
  function exportComments(text, comments) {
    const lines = splitLines(text);
    return sortComments(comments)
      .filter((c) => c.body && c.body.trim())
      .map((c) => `${quoteBlock(commentContext(lines, c))}\n${c.body.trim()}`)
      .join('\n\n');
  }

  /**
   * After the text is edited, move each comment to the line whose content
   * matches the line it was written on (nearest match wins). Comments whose
   * line vanished are kept but flagged `orphan`.
   */
  function reanchor(newText, comments) {
    const lines = splitLines(newText);
    return comments.map((c) => {
      if (lines[c.line] === c.lineText) return { ...c, orphan: false };
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === c.lineText && Math.abs(i - c.line) < bestDist) {
          best = i;
          bestDist = Math.abs(i - c.line);
        }
      }
      if (best >= 0) return { ...c, line: best, orphan: false };
      return { ...c, line: Math.max(0, Math.min(c.line, lines.length - 1)), orphan: true };
    });
  }

  function deriveTitle(text) {
    for (const raw of splitLines(text)) {
      if (FENCE_RE.test(raw) || isTableSeparator(raw)) continue;
      const t = stripInline(raw.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+|\|)/, ''))
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (t) return t.length > 80 ? `${t.slice(0, 77).trimEnd()}…` : t;
    }
    return 'Untitled';
  }

  return {
    MIN_CONTEXT_CHARS,
    normalizeText,
    splitLines,
    classifyLines,
    splitTableRow,
    isTableSeparator,
    escapeHtml,
    renderInline,
    lineContext,
    commentContext,
    quoteBlock,
    sortComments,
    exportComments,
    reanchor,
    deriveTitle,
  };
});
