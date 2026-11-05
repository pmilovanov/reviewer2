// End-to-end check in headless Chromium, desktop and phone: `node tests/e2e.js [screenshot-dir]`.
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');
const { createServer } = require('./serve.js');

const SAMPLE = `## Short answer

Use **Postgres** for the queue unless you expect more than a few thousand jobs per second.

### Why

- It's already in your stack.
- Transactions: enqueue in the same commit as the data.
- \`SKIP LOCKED\` makes it fast.

\`\`\`sql
SELECT * FROM jobs
WHERE run_at < now()
FOR UPDATE SKIP LOCKED LIMIT 10;
\`\`\`

| Option | Throughput | Ops burden |
|---|---|---|
| Postgres | Medium | None |
| Redis | High | Low |

Let me know if you want a migration plan.`;

const shotDir = process.argv[2];
const errors = [];

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
}

const lineSel = (n) => `.line[data-line="${n - 1}"]`; // 1-based, as displayed
const threadSel = (n) => `.thread[data-thread="${n - 1}"]`;

async function clipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

async function desktop(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  watch(page);
  await page.goto(base);

  // Empty state: the paste box.
  await page.waitForSelector('#editor:not([hidden])');
  assert.ok(await page.isVisible('#editorIntro'));

  // Paste with the keyboard into the empty box: goes straight to commenting.
  await page.evaluate((t) => navigator.clipboard.writeText(t), SAMPLE);
  await page.focus('#sourceInput');
  await page.keyboard.press('Control+V');
  await page.waitForSelector('#doc:not([hidden])');
  assert.equal(await page.locator('.line').count(), SAMPLE.split('\n').length);
  assert.match(page.url(), /#[a-z0-9]+$/);
  assert.equal(await page.inputValue('#titleInput'), '');
  assert.equal(await page.getAttribute('#titleInput', 'placeholder'), 'Short answer');
  if (shotDir) await page.screenshot({ path: `${shotDir}/desktop-doc.png` });

  // 1. Comment via the gutter, save with Ctrl+Enter.
  await page.click(`${lineSel(3)} .gutter`);
  await page.waitForSelector(`${threadSel(3)} .composer textarea`);
  assert.ok(await page.evaluate(() => document.activeElement.matches('.composer textarea')));
  await page.keyboard.type('What counts as "a few thousand"?');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector(`${threadSel(3)} .comment`);
  assert.equal(await page.textContent(`${threadSel(3)} .comment-body`), 'What counts as "a few thousand"?');
  assert.ok(await page.locator(lineSel(3)).evaluate((e) => e.classList.contains('has-comments')));

  // 2. Comment by clicking the text of a short list line.
  await page.click(`${lineSel(7)} .content`);
  await page.waitForSelector(`${threadSel(7)} .composer textarea`);
  await page.keyboard.type('Only if the job writes to the same DB.');
  await page.click(`${threadSel(7)} .composer .btn-primary`);
  await page.waitForSelector(`${threadSel(7)} .comment`);

  // 3. Switching lines with an unsaved draft saves it rather than losing it.
  await page.click(`${lineSel(22)} .gutter`);
  await page.keyboard.type('Yes please.');
  await page.click(`${lineSel(19)} .gutter`);
  await page.waitForSelector(`${threadSel(22)} .comment`);
  await page.keyboard.press('Escape'); // empty draft: just closes
  assert.equal(await page.locator('.composer').count(), 0);

  // 4. Edit a comment.
  await page.click(`${threadSel(7)} [data-act="edit"]`);
  const ta = page.locator(`${threadSel(7)} .composer textarea`);
  assert.equal(await ta.inputValue(), 'Only if the job writes to the same DB.');
  await ta.fill('Only matters if the job writes to the same DB.');
  await page.click(`${threadSel(7)} .composer .btn-primary`);
  assert.equal(await page.textContent(`${threadSel(7)} .comment-body`), 'Only matters if the job writes to the same DB.');

  // 5. Delete, then undo.
  await page.click(`${threadSel(22)} [data-act="delete"]`);
  assert.equal(await page.locator(`${threadSel(22)} .comment`).count(), 0);
  await page.click('.toast-action');
  await page.waitForSelector(`${threadSel(22)} .comment`);

  // 6. Comment on a selection.
  await page.evaluate(() => {
    const content = document.querySelector('.line[data-line="2"] .content');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.data.indexOf('unless you expect');
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 'unless you expect'.length);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
    }
    throw new Error('text not found');
  });
  await page.waitForSelector('#selBtn:not([hidden])');
  await page.click('#selBtn');
  await page.waitForSelector(`${threadSel(3)} .composer .composer-quote`);
  assert.equal(await page.textContent(`${threadSel(3)} .composer-quote-text`), 'unless you expect');
  await page.keyboard.type('Expect at peak, or on average?');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector(`${threadSel(3)} .comment-quote`);

  // 7. Copy.
  const copyBtn = page.locator('.topbar [data-action="copy"]');
  assert.equal((await copyBtn.textContent()).trim(), 'Copy 4 comments');
  await copyBtn.click();
  await page.waitForSelector('.toast:not([hidden])');
  const expected = [
    '> Use **Postgres** for the queue unless you expect more than a few thousand jobs per second.\nWhat counts as "a few thousand"?',
    '> unless you expect\nExpect at peak, or on average?',
    "> ### Why\n> - It's already in your stack.\nOnly matters if the job writes to the same DB.",
    '> Let me know if you want a migration plan.\nYes please.',
  ].join('\n\n');
  assert.equal(await clipboard(page), expected);

  // Preview shows the same text.
  await page.click('.topbar [data-action="preview"]');
  assert.equal(await page.inputValue('#previewText'), expected);
  if (shotDir) await page.screenshot({ path: `${shotDir}/desktop-preview.png` });
  await page.click('#previewClose');

  // 8. Draft survives a reload; comments persist.
  await page.click(`${lineSel(12)} .gutter`);
  await page.keyboard.type('half-written thought');
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('#doc:not([hidden])');
  assert.equal(await page.locator('.comment').count(), 4);
  assert.equal(await page.inputValue(`${threadSel(12)} .composer textarea`), 'half-written thought');
  await page.click(`${threadSel(12)} .composer .btn:not(.btn-primary)`); // Cancel
  assert.equal(await page.locator('.composer').count(), 0);
  await page.click('.toast-action'); // Undo discard
  assert.equal(await page.inputValue(`${threadSel(12)} .composer textarea`), 'half-written thought');
  await page.keyboard.press('Escape');

  // 9. Edit the text: comments follow their lines.
  await page.click('#editBtn');
  const src = await page.inputValue('#sourceInput');
  await page.fill('#sourceInput', `Preamble added.\n\n${src}`);
  await page.click('#editorDone');
  await page.waitForSelector('#doc:not([hidden])');
  assert.equal(await page.textContent(`${threadSel(5)} .comment-body`), 'What counts as "a few thousand"?');
  assert.equal(await page.locator(`${threadSel(9)} .comment`).count(), 1);
  assert.equal(await page.locator('.comment.orphan').count(), 0);

  // 10. Title, raw mode.
  await page.fill('#titleInput', 'Queue choice');
  assert.equal(await page.textContent('.doc-item.active .doc-title'), 'Queue choice');
  await page.click('#rawBtn');
  assert.equal(await page.textContent(`${lineSel(5)} .content`), 'Use **Postgres** for the queue unless you expect more than a few thousand jobs per second.');
  await page.click('#rawBtn');

  // 11. A second document; switch back via the sidebar; delete with undo.
  await page.click('#newBtn');
  await page.waitForSelector('#editor:not([hidden])');
  await page.fill('#sourceInput', 'Another response entirely.');
  await page.click('#editorDone');
  await page.waitForSelector('#doc:not([hidden])');
  assert.equal(await page.locator('.doc-item').count(), 2);
  await page.click('.doc-item:has-text("Queue choice") .doc-link');
  await page.waitForFunction(() => document.querySelectorAll('.comment').length === 4);
  const otherId = await page.evaluate(() => [...document.querySelectorAll('.doc-link')].find((a) => a.textContent.includes('Another')).getAttribute('href'));
  await page.click(`.doc-item:has(a[href="${otherId}"]) .doc-del`, { force: true });
  assert.equal(await page.locator('.doc-item').count(), 1);
  await page.click('.toast-action');
  assert.equal(await page.locator('.doc-item').count(), 2);

  if (shotDir) {
    await page.click(`${lineSel(16)} .gutter`);
    await page.keyboard.type('Is this index-backed?');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${shotDir}/desktop-comments.png` });
    await page.keyboard.press('Escape');
  }

  // 12. Open files: several at once become separate documents titled after the
  // file; a binary file is refused; a byte-order mark is dropped.
  const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.click('#newBtn');
  await page.waitForSelector('#editor:not([hidden])');
  assert.equal((await page.textContent('#fileBtn')).trim(), 'Open file…');
  await page.setInputFiles('#fileInput', [
    file('notes.md', '﻿# Notes\n\nFirst file, opened from disk.'),
    file('second.txt', 'Second file.'),
    { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d]) },
  ]);
  await page.waitForSelector('#doc:not([hidden])');
  assert.equal(await page.inputValue('#titleInput'), 'notes');
  assert.equal(await page.textContent(`${lineSel(1)} .content`), 'Notes');
  assert.match(await page.textContent('#toast'), /photo\.png doesn’t look like a text file/);
  assert.equal(await page.locator('.doc-item').count(), 4);
  assert.ok(await page.locator('.doc-item .doc-title', { hasText: 'second' }).count());
  // Back goes to the previous document, not to an empty paste box.
  await page.goBack();
  await page.waitForFunction(() => document.querySelectorAll('.comment').length === 4);

  // While editing a document's text, a file replaces the text (unsaved until "Save text").
  await page.click('.doc-item:has-text("notes") .doc-link');
  await page.waitForFunction(() => document.querySelector('#titleInput').value === 'notes');
  await page.click(`${lineSel(3)} .gutter`);
  await page.keyboard.type('Keep me.');
  await page.keyboard.press('Control+Enter');
  await page.click('#editBtn');
  assert.equal((await page.textContent('#fileBtn')).trim(), 'Replace from file…');
  await page.setInputFiles('#fileInput', [file('v2.md', '# Notes v2\n\nFirst file, opened from disk.')]);
  await page.waitForFunction(() => document.querySelector('#sourceInput').value.startsWith('# Notes v2'));
  await page.click('#editorDone');
  await page.waitForSelector('#doc:not([hidden])');
  assert.equal(await page.textContent(`${lineSel(1)} .content`), 'Notes v2');
  assert.equal(await page.textContent(`${threadSel(3)} .comment-body`), 'Keep me.');

  // Drag and drop a file anywhere.
  const dropped = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['Dropped in.'], 'dropped.md', { type: 'text/markdown' }));
    const fire = (type) => document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    fire('dragenter');
    const overlay = getComputedStyle(document.querySelector('.drop-overlay')).display;
    const label = document.querySelector('#dropLabel').textContent;
    fire('dragover');
    fire('drop');
    return { overlay, label };
  });
  assert.deepEqual(dropped, { overlay: 'flex', label: 'Drop to open as a new review' });
  await page.waitForFunction(() => document.querySelector('#titleInput').value === 'dropped');
  assert.ok(!(await page.evaluate(() => document.body.classList.contains('dragging'))));
  assert.equal(await page.locator('.doc-item').count(), 5);
  await context.close();
}

async function phone(browser, base) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  watch(page);
  await page.goto(base);
  await page.waitForSelector('#editor:not([hidden])');
  assert.ok(await page.isVisible('#pasteBtn'), 'paste-from-clipboard button on phones');
  assert.ok(await page.isVisible('#fileBtn'), 'open-file button on phones');
  if (shotDir) await page.screenshot({ path: `${shotDir}/phone-empty.png` });

  await page.evaluate((t) => navigator.clipboard.writeText(t), SAMPLE);
  await page.tap('#pasteBtn');
  await page.waitForSelector('#doc:not([hidden])');
  assert.ok(await page.isVisible('#bottombar'));
  assert.ok(!(await page.isVisible('.topbar [data-action="copy"]')), 'desktop copy button hidden on phones');

  // Tap a line: composer opens immediately and the copy bar gets out of the keyboard's way.
  await page.tap(`${lineSel(7)} .content`);
  await page.waitForSelector(`${threadSel(7)} .composer textarea`);
  assert.ok(await page.evaluate(() => document.activeElement.matches('.composer textarea')));
  assert.ok(!(await page.isVisible('#bottombar .btn-primary')));
  await page.keyboard.type('Which stack?');
  if (shotDir) await page.screenshot({ path: `${shotDir}/phone-composing.png` });
  await page.tap(`${threadSel(7)} .composer .btn-primary`);
  await page.waitForSelector(`${threadSel(7)} .comment`);
  assert.ok(await page.isVisible('#bottombar .btn-primary'));

  await page.tap('#bottombar [data-action="copy"]');
  await page.waitForSelector('.toast:not([hidden])');
  assert.equal(await clipboard(page), "> ### Why\n> - It's already in your stack.\nWhich stack?");
  if (shotDir) await page.screenshot({ path: `${shotDir}/phone-doc.png` });

  // Drawer.
  await page.tap('#menuBtn');
  await page.waitForTimeout(300);
  const box = await page.locator('#sidebar').boundingBox();
  assert.ok(box.x >= -1, 'drawer slides in');
  if (shotDir) await page.screenshot({ path: `${shotDir}/phone-drawer.png` });
  await page.tap('#backdrop', { position: { x: 400, y: 400 } });
  await page.waitForTimeout(300);
  assert.ok((await page.locator('#sidebar').boundingBox()).x < 0, 'drawer closes');

  // No horizontal overflow on a narrow screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `page overflows horizontally by ${overflow}px`);
  await context.close();
}

(async () => {
  const server = createServer().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    await desktop(browser, base);
    console.log('ok - desktop');
    await phone(browser, base);
    console.log('ok - phone');
    assert.deepEqual(errors, [], 'no page errors');
    console.log('ok - no console errors');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  if (errors.length) console.error(errors);
  process.exit(1);
});
