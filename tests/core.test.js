const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const c = (line, body, extra = {}) => ({ id: `c${line}`, line, body, createdAt: line, ...extra });

test('lineContext: a long line stands alone', () => {
  const lines = ['Intro.', '', 'This sentence is comfortably longer than forty characters.'];
  assert.equal(Core.lineContext(lines, 2), 'This sentence is comfortably longer than forty characters.');
});

test('lineContext: a short line gets the previous meaningful line', () => {
  const lines = ['## Options', '', '- Redis', '- Postgres'];
  assert.equal(Core.lineContext(lines, 3), '- Redis\n- Postgres');
  assert.equal(Core.lineContext(lines, 2), '## Options\n- Redis');
});

test('lineContext: first line has nothing to borrow', () => {
  assert.equal(Core.lineContext(['Yes.', 'More'], 0), 'Yes.');
});

test('lineContext: blank lines and fences resolve to the nearest real line above', () => {
  const lines = ['A line of prose that is long enough to stand on its own.', '', '```', 'x = 1', '```'];
  assert.equal(Core.lineContext(lines, 1), lines[0]);
  // short code line borrows across the fence, skipping it
  assert.equal(Core.lineContext(lines, 3), `${lines[0]}\nx = 1`);
  assert.equal(Core.lineContext(lines, 4), `${lines[0]}\nx = 1`);
});

test('lineContext: table separator rows are skipped', () => {
  const lines = ['| a | b |', '|---|---|', '| 1 | 2 |'];
  assert.equal(Core.lineContext(lines, 2), '| a | b |\n| 1 | 2 |');
});

test('quoteBlock prefixes every line, keeps blank lines quoted', () => {
  assert.equal(Core.quoteBlock('one\n\ntwo'), '> one\n>\n> two');
});

test('exportComments: format, ordering and multi-line bodies', () => {
  const text = 'First line, which is long enough to be quoted on its own.\nShort.\nThird line that also happens to be quite long enough.';
  const out = Core.exportComments(text, [
    c(2, 'Third!'),
    c(0, 'About the first.\nSecond paragraph.'),
    c(1, '  Why short?  '),
  ]);
  assert.equal(
    out,
    [
      '> First line, which is long enough to be quoted on its own.\n\nAbout the first.\nSecond paragraph.',
      '> First line, which is long enough to be quoted on its own.\n> Short.\n\nWhy short?',
      '> Third line that also happens to be quite long enough.\n\nThird!',
    ].join('\n\n'),
  );
});

test('exportComments: a selection quote replaces the line context', () => {
  const out = Core.exportComments('Use Redis for caching and Postgres for everything else.', [
    c(0, 'Why not just Postgres?', { quote: 'Use Redis for caching' }),
  ]);
  assert.equal(out, '> Use Redis for caching\n\nWhy not just Postgres?');
});

test('exportComments: orphaned comments quote the line they were written on', () => {
  const out = Core.exportComments('Totally new text here.', [
    c(0, 'Hm.', { orphan: true, lineText: 'The original line.' }),
  ]);
  assert.equal(out, '> The original line.\n\nHm.');
});

test('exportComments: same-line comments keep creation order; empty bodies dropped', () => {
  const text = 'A sufficiently long line so that context is just this line.';
  const out = Core.exportComments(text, [
    { id: 'b', line: 0, body: 'second', createdAt: 2 },
    { id: 'a', line: 0, body: 'first', createdAt: 1 },
    { id: 'z', line: 0, body: '   ', createdAt: 3 },
  ]);
  assert.equal(out, `> ${text}\n\nfirst\n\n> ${text}\n\nsecond`);
});

test('reanchor follows moved lines and flags vanished ones', () => {
  const comments = [
    { id: 'a', line: 1, lineText: 'beta', body: 'x', createdAt: 1 },
    { id: 'b', line: 2, lineText: 'gamma', body: 'y', createdAt: 2 },
  ];
  const out = Core.reanchor('new first\nalpha\nbeta\ndelta', comments);
  assert.equal(out[0].line, 2);
  assert.equal(out[0].orphan, false);
  assert.equal(out[1].orphan, true);
  assert.equal(out[1].line, 2);
  // and recovers if the line comes back
  const back = Core.reanchor('gamma', out);
  assert.equal(back[1].orphan, false);
  assert.equal(back[1].line, 0);
});

test('reanchor prefers the nearest duplicate', () => {
  const out = Core.reanchor('x\nsame\nx\nx\nsame', [{ id: 'a', line: 3, lineText: 'same', body: 'b', createdAt: 0 }]);
  assert.equal(out[0].line, 4);
});

test('renderInline escapes HTML and only links safe URLs', () => {
  assert.equal(Core.renderInline('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(Core.renderInline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.match(Core.renderInline('[site](https://a.b/c?d=1&e=2)'), /<a href="https:\/\/a\.b\/c\?d=1&amp;e=2" target="_blank"/);
  assert.equal(Core.renderInline('"quoted"'), '&quot;quoted&quot;');
});

test('renderInline handles emphasis, code and line breaks', () => {
  assert.equal(Core.renderInline('**bold** and *it* and `a < b`'), '<strong>bold</strong> and <em>it</em> and <code>a &lt; b</code>');
  assert.equal(Core.renderInline('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(Core.renderInline('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(Core.renderInline('a<br>b'), 'a<br>b');
  assert.equal(Core.renderInline('`**not bold**`'), '<code>**not bold**</code>');
});

test('classifyLines: fences, headings, lists, tables', () => {
  const lines = [
    '# Title',
    '- item',
    '  1. nested',
    '- [x] done',
    '```js',
    '# not a heading',
    '```',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '> quoted',
    '---',
    'plain',
  ];
  const info = Core.classifyLines(lines);
  assert.deepEqual(info.map((i) => i.kind), [
    'heading', 'list', 'list', 'list', 'fence', 'code', 'fence', 'table', 'table', 'table', 'quote', 'hr', 'para',
  ]);
  assert.equal(info[0].level, 1);
  assert.equal(info[2].ordered, true);
  assert.equal(info[2].indent, 2);
  assert.equal(info[3].task, true);
  assert.equal(info[4].lang, 'js');
  assert.equal(info[7].header, true);
  assert.equal(info[8].sep, true);
  assert.deepEqual(info[9].cells, ['1', '2']);
  assert.equal(info[7].template, info[9].template);
});

test('splitTableRow honours escaped pipes', () => {
  assert.deepEqual(Core.splitTableRow('| a \\| b | c |'), ['a | b', 'c']);
});

test('deriveTitle skips markup and fences', () => {
  assert.equal(Core.deriveTitle('\n```\ncode\n```'), 'code');
  assert.equal(Core.deriveTitle('## **Short answer:** yes'), 'Short answer: yes');
  assert.equal(Core.deriveTitle(''), 'Untitled');
  assert.ok(Core.deriveTitle('x'.repeat(200)).endsWith('…'));
});

test('normalizeText converts CRLF and drops a byte-order mark', () => {
  assert.deepEqual(Core.splitLines('a\r\nb\rc'), ['a', 'b', 'c']);
  assert.equal(Core.normalizeText('﻿# Title'), '# Title');
});
