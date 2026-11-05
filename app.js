/* reviewer2 — UI. Depends on core.js (global `Core`). */
(function () {
  'use strict';

  const DOC_PREFIX = 'reviewer2:doc:';
  const PREFS_KEY = 'reviewer2:prefs';
  const SCROLL_KEY = 'reviewer2:scroll';

  // ---------------------------------------------------------------------------
  // Tiny helpers

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function relTime(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const hr = Math.round(m / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.round(hr / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
  }

  function debounce(fn, ms) {
    let t = null;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, ms);
    };
    wrapped.flush = () => { if (t) { clearTimeout(t); t = null; fn(); } };
    return wrapped;
  }

  // ---------------------------------------------------------------------------
  // Storage: one localStorage key per document, so tabs don't clobber each other.

  function loadDoc(id) {
    try {
      const raw = localStorage.getItem(DOC_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveDoc(d) {
    try {
      localStorage.setItem(DOC_PREFIX + d.id, JSON.stringify(d));
      return true;
    } catch (err) {
      toast(`Couldn't save: ${err && err.name === 'QuotaExceededError' ? 'browser storage is full' : err}`);
      return false;
    }
  }

  function listDocs() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DOC_PREFIX)) continue;
      try {
        const d = JSON.parse(localStorage.getItem(k));
        if (d && d.id) out.push(d);
      } catch { /* skip corrupt entries */ }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function loadPrefs() {
    try { return { raw: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { raw: false }; }
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // State

  let prefs = loadPrefs();
  let doc = null; // current document, or null when composing a new one
  let lines = [];
  let mode = 'new'; // 'new' | 'edit' | 'view'
  let draft = null; // { kind: 'new'|'edit', line, quote, commentId, body, original }
  let composerEl = null;
  let lineEls = [];
  let threadEls = [];
  let firstRoute = true;

  const persist = () => { if (doc) saveDoc(doc); };
  const persistDraftSoon = debounce(() => {
    if (!doc) return;
    doc.draft = draft ? { ...draft } : null;
    persist();
  }, 400);

  function touch() {
    if (doc) doc.updatedAt = Date.now();
  }

  // ---------------------------------------------------------------------------
  // Elements

  const el = {
    sidebar: $('#sidebar'),
    docList: $('#docList'),
    backdrop: $('#backdrop'),
    menuBtn: $('#menuBtn'),
    newBtn: $('#newBtn'),
    title: $('#titleInput'),
    headerLabel: $('#headerLabel'),
    editBtn: $('#editBtn'),
    rawBtn: $('#rawBtn'),
    editor: $('#editor'),
    editorIntro: $('#editorIntro'),
    source: $('#sourceInput'),
    pasteBtn: $('#pasteBtn'),
    fileBtnText: $('#fileBtnText'),
    fileInput: $('#fileInput'),
    dropLabel: $('#dropLabel'),
    editorCancel: $('#editorCancel'),
    editorDone: $('#editorDone'),
    doc: $('#doc'),
    selBtn: $('#selBtn'),
    toast: $('#toast'),
    dlg: $('#previewDlg'),
    dlgText: $('#previewText'),
    dlgCount: $('#previewCount'),
  };

  // ---------------------------------------------------------------------------
  // Toast (with optional Undo)

  let toastTimer = null;
  function toast(msg, opts = {}) {
    clearTimeout(toastTimer);
    el.toast.textContent = '';
    el.toast.append(h('span', {}, msg));
    if (opts.action) {
      el.toast.append(
        h('button', {
          class: 'toast-action',
          onclick: () => { el.toast.hidden = true; opts.onAction(); },
        }, opts.action),
      );
    }
    el.toast.hidden = false;
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, opts.action ? 6000 : 3000);
  }

  // ---------------------------------------------------------------------------
  // Sidebar

  function docTitle(d) {
    return (d.title && d.title.trim()) || Core.deriveTitle(d.text);
  }

  function renderSidebar() {
    const docs = listDocs();
    el.docList.textContent = '';
    if (!docs.length) {
      el.docList.append(h('p', { class: 'doc-empty' }, 'Nothing saved yet.'));
      return;
    }
    for (const d of docs) {
      const n = (d.comments || []).length;
      el.docList.append(
        h('div', { class: `doc-item${doc && doc.id === d.id ? ' active' : ''}` },
          h('a', { class: 'doc-link', href: `#${d.id}` },
            h('span', { class: 'doc-title' }, docTitle(d)),
            h('span', { class: 'doc-meta' }, `${n ? plural(n, 'comment') : 'no comments'} · ${relTime(d.updatedAt)}`),
          ),
          h('button', {
            class: 'icon-btn doc-del',
            title: 'Delete',
            'aria-label': `Delete “${docTitle(d)}”`,
            html: ICONS.trash,
            onclick: () => deleteDoc(d.id),
          }),
        ),
      );
    }
  }

  function setDrawer(open) {
    document.body.classList.toggle('drawer-open', open);
  }

  function deleteDoc(id) {
    const d = loadDoc(id);
    if (!d) return;
    localStorage.removeItem(DOC_PREFIX + id);
    renderSidebar();
    const wasOpen = !!doc && doc.id === id;
    toast(`Deleted “${docTitle(d)}”`, {
      action: 'Undo',
      onAction: () => {
        saveDoc(d);
        renderSidebar();
        if (wasOpen) location.hash = d.id;
      },
    });
    if (wasOpen) {
      doc = null;
      draft = null;
      const next = listDocs()[0];
      location.replace(`#${next ? next.id : 'new'}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Header / chrome

  function updateChrome() {
    const viewing = mode === 'view' && doc;
    el.title.hidden = !doc;
    el.headerLabel.hidden = !!doc;
    if (doc) {
      if (document.activeElement !== el.title) el.title.value = doc.title || '';
      el.title.placeholder = Core.deriveTitle(doc.text);
    }
    el.editBtn.hidden = !viewing;
    el.rawBtn.hidden = !viewing;
    el.rawBtn.classList.toggle('on', !!prefs.raw);
    el.rawBtn.title = prefs.raw ? 'Show formatted' : 'Show raw markdown';
    updateCount();
  }

  function updateCount() {
    const n = doc ? doc.comments.length + (draft && draft.kind === 'new' && draft.body.trim() ? 1 : 0) : 0;
    const viewing = mode === 'view' && !!doc;
    for (const b of $$('[data-action="copy"]')) {
      b.hidden = !viewing;
      b.disabled = !n;
      b.querySelector('.label-long').textContent = n ? `Copy ${plural(n, 'comment')}` : 'No comments yet';
      b.querySelector('.label-short').textContent = n ? `Copy ${n}` : 'Copy';
    }
    for (const b of $$('[data-action="preview"]')) {
      b.hidden = !viewing;
      b.disabled = !n;
    }
  }

  // ---------------------------------------------------------------------------
  // Editor (paste / edit text)

  function showEditor() {
    el.doc.hidden = true;
    el.editor.hidden = false;
    hideSelBtn();
    const isNew = mode === 'new';
    el.editorIntro.hidden = !isNew;
    el.editorCancel.hidden = isNew;
    el.editorDone.textContent = isNew ? 'Start commenting' : 'Save text';
    el.source.value = isNew ? '' : doc.text;
    el.pasteBtn.hidden = !(isNew && navigator.clipboard && navigator.clipboard.readText);
    el.fileBtnText.textContent = isNew ? 'Open file…' : 'Replace from file…';
    el.fileInput.multiple = isNew;
    updateChrome();
    if (!isNew || matchMedia('(hover: hover)').matches) el.source.focus({ preventScroll: true });
  }

  /** Create and save a document; returns it, or null if storage refused. */
  function createDoc(text, title = '') {
    const now = Date.now();
    const d = { id: uid(), title, text, comments: [], createdAt: now, updatedAt: now, draft: null };
    if (!saveDoc(d)) return null;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return d;
  }

  function goToNewDoc(d) {
    if (mode === 'new') {
      // Don't leave the empty paste box behind in history.
      history.replaceState(null, '', `#${d.id}`);
      openDoc(d);
    } else {
      location.hash = d.id;
    }
  }

  // ---------------------------------------------------------------------------
  // Files (picker and drag-and-drop)

  const MAX_FILE_BYTES = 2 * 1024 * 1024; // localStorage holds ~5 MB in all

  async function readTextFile(file) {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`${file.name} is too large (${(file.size / 1048576).toFixed(1)} MB; the limit is 2 MB)`);
    }
    const text = await file.text();
    if (text.includes('\u0000')) throw new Error(`${file.name} doesn’t look like a text file`);
    const clean = Core.normalizeText(text).replace(/\s+$/, '');
    if (!clean.trim()) throw new Error(`${file.name} is empty`);
    return clean;
  }

  function fileTitle(name) {
    return name.replace(/\.(md|markdown|mdown|mkd|mdx|txt|text)$/i, '');
  }

  /** New documents from files — or, while editing a document's text, replace that text. */
  async function openFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;

    if (mode === 'edit') {
      try {
        el.source.value = await readTextFile(files[0]);
        toast(`Loaded ${files[0].name}${files.length > 1 ? ' (one file at a time here)' : ''} — Save text to keep it`);
      } catch (err) {
        toast(err.message);
      }
      return;
    }

    const created = [];
    const failed = [];
    for (const f of files) {
      try {
        const d = createDoc(await readTextFile(f), fileTitle(f.name));
        if (d) created.push(d);
      } catch (err) {
        failed.push(err.message);
      }
    }
    if (failed.length === 1) toast(failed[0]);
    else if (failed.length) toast(`${failed.length} files couldn’t be opened: ${failed.join('; ')}`);
    else if (created.length > 1) toast(`Opened ${plural(created.length, 'file')} — they’re all in the list`);
    if (!created.length) return;
    renderSidebar();
    goToNewDoc(created[0]);
  }

  function finishEditor() {
    const text = Core.normalizeText(el.source.value).replace(/\s+$/, '');
    if (!text.trim()) {
      toast('Paste some text first.');
      el.source.focus();
      return;
    }
    if (mode === 'new') {
      const d = createDoc(text);
      if (d) goToNewDoc(d);
      return;
    }
    if (text !== doc.text) {
      doc.comments = Core.reanchor(text, doc.comments);
      doc.text = text;
      touch();
      persist();
      const orphans = doc.comments.filter((c) => c.orphan).length;
      if (orphans) toast(`${plural(orphans, 'comment')} lost ${orphans === 1 ? 'its' : 'their'} line — kept and marked ⚠`);
    }
    mode = 'view';
    showDoc();
  }

  // ---------------------------------------------------------------------------
  // Document view

  function lineContentHTML(text, info) {
    if (prefs.raw) return Core.escapeHtml(text);
    switch (info.kind) {
      case 'blank':
        return '';
      case 'code':
        return Core.escapeHtml(text);
      case 'fence':
        return info.open && info.lang ? Core.escapeHtml(info.lang) : '';
      case 'heading':
        return Core.renderInline(info.text);
      case 'list':
      case 'quote':
      case 'para':
        return Core.renderInline(info.text);
      case 'hr':
        return '';
      case 'table':
        if (info.sep) return '';
        return `<div class="cells" style="grid-template-columns:${info.template}">${info.cells
          .map((c) => `<div class="cell">${Core.renderInline(c)}</div>`)
          .join('')}</div>`;
      default:
        return Core.escapeHtml(text);
    }
  }

  function lineClasses(info) {
    if (prefs.raw) return 'line k-raw';
    const cls = ['line', `k-${info.kind}`];
    if (info.kind === 'heading') cls.push(`h${info.level}`);
    if (info.kind === 'fence') cls.push(info.open ? 'open' : 'close');
    if (info.kind === 'table') cls.push(info.sep ? 'sep' : info.header ? 'th' : 'td');
    return cls.join(' ');
  }

  function listMarker(info, depth) {
    if (info.task !== null) return info.task ? '☑' : '☐';
    if (info.ordered) return info.marker;
    return depth % 2 ? '◦' : '•';
  }

  function renderDoc() {
    lines = Core.splitLines(doc.text);
    const info = prefs.raw ? lines.map(() => ({ kind: 'raw' })) : Core.classifyLines(lines);
    const frag = document.createDocumentFragment();
    lineEls = [];
    threadEls = [];
    lines.forEach((text, i) => {
      const inf = info[i];
      const content = h('div', { class: 'content', html: lineContentHTML(text, inf) });
      if (!prefs.raw) {
        if (inf.kind === 'list') {
          const depth = Math.min(Math.floor(inf.indent / 2), 8);
          content.style.setProperty('--indent', depth);
          content.dataset.marker = listMarker(inf, depth);
        } else if (inf.kind === 'para' && inf.indent) {
          content.style.setProperty('--indent', Math.min(Math.floor(inf.indent / 2), 8));
        }
      }
      const blank = !text.trim();
      const row = h('div', { class: lineClasses(inf), 'data-line': i },
        h('button', {
          class: 'gutter',
          tabindex: '-1',
          'aria-label': `Comment on line ${i + 1}`,
          title: `Comment on line ${i + 1}`,
        }, blank ? '' : String(i + 1)),
        content,
      );
      if (blank) row.classList.add('blank');
      const thread = h('div', { class: 'thread', 'data-thread': i, hidden: true });
      lineEls.push(row);
      threadEls.push(thread);
      frag.append(row, thread);
    });
    el.doc.textContent = '';
    el.doc.classList.toggle('raw', !!prefs.raw);
    el.doc.append(frag);
    const linesWithThreads = new Set(doc.comments.map((c) => c.line));
    if (draft) linesWithThreads.add(draft.line);
    for (const i of linesWithThreads) renderThread(i);
  }

  function showDoc() {
    el.editor.hidden = true;
    el.doc.hidden = false;
    if (draft) buildComposer();
    renderDoc();
    updateChrome();
  }

  function openDoc(d) {
    persistDraftSoon.flush();
    doc = d;
    doc.comments = doc.comments || [];
    draft = d.draft || null;
    if (draft && draft.line >= Core.splitLines(d.text).length) draft = null;
    mode = 'view';
    showDoc();
    renderSidebar();
    setDrawer(false);
    let y = 0;
    if (firstRoute) {
      try {
        const s = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null');
        if (s && s.id === d.id) y = s.y;
      } catch { /* ignore */ }
    }
    window.scrollTo(0, y);
  }

  function openNew() {
    persistDraftSoon.flush();
    doc = null;
    draft = null;
    mode = 'new';
    showEditor();
    renderSidebar();
    setDrawer(false);
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------------------
  // Threads, comments, composer

  function renderComment(c) {
    return h('div', { class: `comment${c.orphan ? ' orphan' : ''}`, 'data-id': c.id },
      c.orphan
        ? h('div', { class: 'comment-warn' }, '⚠ The line this was on has changed. It was: ', h('q', {}, c.lineText || '(blank)'))
        : null,
      c.quote ? h('div', { class: 'comment-quote' }, c.quote) : null,
      h('div', { class: 'comment-body' }, c.body),
      h('div', { class: 'comment-actions' },
        h('button', { class: 'link-btn', 'data-act': 'edit', 'data-id': c.id }, 'Edit'),
        h('button', { class: 'link-btn danger', 'data-act': 'delete', 'data-id': c.id }, 'Delete'),
      ),
    );
  }

  function renderThread(i) {
    const slot = threadEls[i];
    const row = lineEls[i];
    if (!slot || !row) return;
    const hadFocus = composerEl && composerEl.contains(document.activeElement);
    slot.textContent = '';
    const items = Core.sortComments(doc.comments.filter((c) => c.line === i));
    let placed = false;
    for (const c of items) {
      if (draft && draft.kind === 'edit' && draft.commentId === c.id) {
        slot.append(composerEl);
        placed = true;
      } else {
        slot.append(renderComment(c));
      }
    }
    if (draft && draft.line === i && !placed && composerEl) slot.append(composerEl);
    slot.hidden = !slot.firstChild;
    row.classList.toggle('has-comments', items.length > 0);
    row.classList.toggle('active', !!draft && draft.line === i);
    row.querySelector('.gutter').dataset.count = items.length ? String(items.length) : '';
    if (hadFocus && composerEl && composerEl.isConnected) {
      composerEl.querySelector('textarea').focus({ preventScroll: true });
    }
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  }

  function buildComposer() {
    const d = draft;
    const ta = h('textarea', {
      rows: '3',
      placeholder: d.quote ? 'Comment on the selection…' : `Comment on line ${d.line + 1}…`,
      'aria-label': 'Comment',
    });
    ta.value = d.body;
    ta.addEventListener('input', () => {
      d.body = ta.value;
      autosize(ta);
      persistDraftSoon();
      updateCount();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitDraft(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelDraft(); }
    });
    const quote = d.quote
      ? h('div', { class: 'composer-quote' },
        h('span', { class: 'composer-quote-text' }, d.quote),
        h('button', {
          class: 'icon-btn sm',
          title: 'Quote the whole line instead',
          'aria-label': 'Quote the whole line instead',
          html: ICONS.x,
          onclick: () => { d.quote = null; quote.remove(); ta.placeholder = `Comment on line ${d.line + 1}…`; persistDraftSoon(); ta.focus(); },
        }))
      : null;
    composerEl = h('div', { class: 'composer' },
      quote,
      ta,
      h('div', { class: 'composer-actions' },
        h('span', { class: 'hint' }, `${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}+Enter to save · Esc to cancel`),
        h('button', { class: 'btn', onclick: () => cancelDraft() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', onclick: () => commitDraft() }, d.kind === 'edit' ? 'Update' : 'Comment'),
      ),
    );
    requestAnimationFrame(() => autosize(ta));
    return composerEl;
  }

  function openComposer({ line, quote = null, commentId = null }) {
    if (!doc) return;
    // Tapping the line you're already writing on just returns you to it.
    if (draft && !commentId && !quote && draft.kind === 'new' && draft.line === line && composerEl) {
      focusComposer();
      return;
    }
    if (draft) commitDraft({ quiet: false });
    let body = '';
    if (commentId) {
      const c = doc.comments.find((x) => x.id === commentId);
      if (!c) return;
      line = c.line;
      quote = c.quote;
      body = c.body;
    }
    draft = { kind: commentId ? 'edit' : 'new', line, quote, commentId, body, original: body };
    buildComposer();
    renderThread(line);
    focusComposer();
    persistDraftSoon();
  }

  function focusComposer() {
    const ta = composerEl && composerEl.querySelector('textarea');
    if (!ta) return;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const r = composerEl.getBoundingClientRect();
    const top = el.doc.getBoundingClientRect().top > 0 ? 0 : 64;
    if (r.bottom > window.innerHeight - 16 || r.top < top) {
      composerEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /** Save the open draft (if it has text). Returns the saved comment, if any. */
  function commitDraft({ quiet = true } = {}) {
    if (!draft || !doc) return null;
    const d = draft;
    const body = d.body.trim();
    draft = null;
    doc.draft = null;
    let saved = null;
    if (body) {
      const now = Date.now();
      const existing = d.kind === 'edit' && doc.comments.find((c) => c.id === d.commentId);
      if (existing) {
        if (existing.body !== body || (existing.quote || null) !== (d.quote || null)) {
          existing.body = body;
          existing.quote = d.quote || null;
          existing.updatedAt = now;
          touch();
        }
        saved = existing;
      } else {
        saved = {
          id: uid(),
          line: d.line,
          lineText: lines[d.line] ?? '',
          quote: d.quote || null,
          body,
          createdAt: now,
          updatedAt: now,
        };
        doc.comments.push(saved);
        touch();
      }
      if (!quiet) toast(`Saved comment on line ${d.line + 1}`);
    }
    persistDraftSoon.flush();
    persist();
    composerEl = null;
    renderThread(d.line);
    updateCount();
    renderSidebar();
    return saved;
  }

  function cancelDraft() {
    if (!draft) return;
    const d = draft;
    const changed = d.body.trim() && d.body !== d.original;
    draft = null;
    doc.draft = null;
    composerEl = null;
    persist();
    renderThread(d.line);
    updateCount();
    if (changed) {
      toast('Draft discarded', {
        action: 'Undo',
        onAction: () => {
          if (draft) commitDraft();
          draft = d;
          buildComposer();
          renderThread(d.line);
          focusComposer();
        },
      });
    }
  }

  function deleteComment(id) {
    const idx = doc.comments.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const [c] = doc.comments.splice(idx, 1);
    touch();
    persist();
    renderThread(c.line);
    updateCount();
    renderSidebar();
    const docId = doc.id;
    toast('Comment deleted', {
      action: 'Undo',
      onAction: () => {
        if (!doc || doc.id !== docId) return;
        doc.comments.push(c);
        persist();
        renderThread(c.line);
        updateCount();
        renderSidebar();
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Line taps and text selection

  let pointerHadSelection = false;
  let lastPointerType = 'mouse';
  let clickTimer = null;

  function docSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return null;
    const range = sel.getRangeAt(0);
    if (!el.doc.contains(range.commonAncestorContainer)) return null;
    return range;
  }

  /** The selected text (per line, markdown markers excluded) and its last line. */
  function selectionInfo() {
    const range = docSelection();
    if (!range) return null;
    const parts = [];
    for (const row of lineEls) {
      if (!range.intersectsNode(row)) continue;
      const content = row.querySelector('.content');
      const r = document.createRange();
      r.selectNodeContents(content);
      if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(range.endContainer, range.endOffset);
      parts.push({ line: +row.dataset.line, text: r.collapsed ? '' : r.toString() });
    }
    while (parts.length && !parts[0].text.trim()) parts.shift();
    while (parts.length && !parts[parts.length - 1].text.trim()) parts.pop();
    if (!parts.length) return null;
    const quote = parts.map((p) => p.text.replace(/\s+$/, '')).join('\n').trim();
    if (!quote) return null;
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    return { line: parts[parts.length - 1].line, quote, rect };
  }

  let selInfo = null;
  let selHideTimer = null;
  let selRaf = 0;

  function hideSelBtn() {
    el.selBtn.hidden = true;
    selInfo = null;
  }

  function updateSelBtn() {
    const info = mode === 'view' ? selectionInfo() : null;
    clearTimeout(selHideTimer);
    if (!info) {
      // Linger briefly: on touch screens the selection collapses before the tap lands.
      selHideTimer = setTimeout(hideSelBtn, 400);
      return;
    }
    selInfo = info;
    const b = el.selBtn;
    b.hidden = false;
    const bw = b.offsetWidth;
    const vw = document.documentElement.clientWidth;
    const isTouch = lastPointerType !== 'mouse';
    const left = Math.max(8, Math.min(info.rect.right - bw / 2, vw - bw - 8));
    const top = info.rect.bottom + (isTouch ? 30 : 8); // clear the native selection handles
    b.style.left = `${left + window.scrollX}px`;
    b.style.top = `${top + window.scrollY}px`;
  }

  function onDocPointerDown(e) {
    lastPointerType = e.pointerType || 'mouse';
    pointerHadSelection = !!docSelection();
  }

  function onDocClick(e) {
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'edit') openComposer({ commentId: act.dataset.id });
      else if (act.dataset.act === 'delete') deleteComment(act.dataset.id);
      return;
    }
    const row = e.target.closest('.line');
    if (!row || e.target.closest('a')) return;
    const line = +row.dataset.line;
    if (e.target.closest('.gutter')) {
      openComposer({ line });
      return;
    }
    if (pointerHadSelection || docSelection()) return; // dismissing or making a selection
    if (lastPointerType === 'mouse') {
      // Wait out a double-click (word selection) before opening.
      clearTimeout(clickTimer);
      if (e.detail > 1) return;
      clickTimer = setTimeout(() => { if (!docSelection()) openComposer({ line }); }, 220);
    } else {
      openComposer({ line });
    }
  }

  // ---------------------------------------------------------------------------
  // Copy / preview

  function exportText() {
    return doc ? Core.exportComments(doc.text, doc.comments) : '';
  }

  async function writeClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through */ }
    const ta = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0;' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  async function copyComments() {
    if (draft && draft.body.trim()) commitDraft();
    const text = exportText();
    if (!text) return;
    const n = doc.comments.length;
    if (await writeClipboard(text)) {
      toast(`Copied ${plural(n, 'comment')} — paste into your chat`);
    } else {
      openPreview();
      toast('Couldn’t reach the clipboard — copy from here instead');
    }
  }

  function openPreview() {
    if (draft && draft.body.trim()) commitDraft();
    el.dlgText.value = exportText();
    el.dlgCount.textContent = plural(doc.comments.length, 'comment');
    if (typeof el.dlg.showModal === 'function') el.dlg.showModal();
    else el.dlg.setAttribute('open', '');
  }

  // ---------------------------------------------------------------------------
  // Routing

  function route() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) {
      const recent = listDocs()[0];
      if (recent) { history.replaceState(null, '', `#${recent.id}`); openDoc(recent); }
      else openNew();
    } else if (id === 'new') {
      openNew();
    } else if (doc && doc.id === id) {
      // already here
    } else {
      const d = loadDoc(id);
      if (d) openDoc(d);
      else { history.replaceState(null, '', '#new'); openNew(); }
    }
    firstRoute = false;
  }

  // ---------------------------------------------------------------------------
  // Icons

  const ICONS = {
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  // ---------------------------------------------------------------------------
  // Wire-up

  el.menuBtn.addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer-open')));
  el.backdrop.addEventListener('click', () => setDrawer(false));
  el.newBtn.addEventListener('click', () => {
    if (location.hash === '#new') openNew();
    else location.hash = 'new';
  });
  el.docList.addEventListener('click', (e) => {
    const a = e.target.closest('a.doc-link');
    if (a && a.getAttribute('href') === location.hash) setDrawer(false);
  });

  el.title.addEventListener('input', () => {
    if (!doc) return;
    doc.title = el.title.value;
    touch();
    persist();
    renderSidebar();
  });
  el.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.title.blur(); });

  el.editBtn.addEventListener('click', () => {
    if (!doc) return;
    if (draft) commitDraft();
    mode = 'edit';
    showEditor();
  });
  el.rawBtn.addEventListener('click', () => {
    prefs.raw = !prefs.raw;
    savePrefs();
    renderDoc();
    updateChrome();
  });

  el.editorDone.addEventListener('click', finishEditor);
  el.editorCancel.addEventListener('click', () => { mode = 'view'; showDoc(); });
  el.source.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finishEditor(); }
  });
  el.source.addEventListener('paste', () => {
    // Pasting into an empty new document goes straight to commenting.
    if (mode !== 'new' || el.source.value.trim()) return;
    setTimeout(() => { if (mode === 'new' && el.source.value.trim()) finishEditor(); }, 0);
  });
  el.pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { toast('The clipboard is empty.'); return; }
      el.source.value = text;
      finishEditor();
    } catch {
      toast('Clipboard access was refused — paste into the box instead.');
      el.source.focus();
    }
  });

  // #fileBtn is a <label> wrapping the input, so the browser opens the picker natively.
  el.fileInput.addEventListener('change', () => {
    const files = [...el.fileInput.files];
    el.fileInput.value = ''; // so choosing the same file again still fires
    openFiles(files);
  });

  // Drop files anywhere. Only file drags are intercepted; dragging text into a
  // textarea behaves as usual.
  let dragDepth = 0;
  const isFileDrag = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const endDrag = () => { dragDepth = 0; document.body.classList.remove('dragging'); };
  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (dragDepth++ === 0) {
      el.dropLabel.textContent = mode === 'edit' ? 'Drop to replace the text' : 'Drop to open as a new review';
      document.body.classList.add('dragging');
    }
  });
  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    if (--dragDepth <= 0) endDrag();
  });
  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); // otherwise the browser navigates away to the file
    endDrag();
    openFiles(e.dataTransfer.files);
  });

  el.doc.addEventListener('pointerdown', onDocPointerDown);
  el.doc.addEventListener('click', onDocClick);
  el.doc.addEventListener('dblclick', () => clearTimeout(clickTimer));
  el.doc.addEventListener('focusin', (e) => { if (e.target.closest('.composer')) document.body.classList.add('composing'); });
  el.doc.addEventListener('focusout', (e) => { if (e.target.closest('.composer')) document.body.classList.remove('composing'); });

  document.addEventListener('selectionchange', () => {
    cancelAnimationFrame(selRaf);
    selRaf = requestAnimationFrame(updateSelBtn);
  });
  // Keep the selection alive while pressing the button (desktop).
  el.selBtn.addEventListener('mousedown', (e) => e.preventDefault());
  el.selBtn.addEventListener('click', () => {
    if (!selInfo) return;
    const { line, quote } = selInfo;
    hideSelBtn();
    window.getSelection().removeAllRanges();
    openComposer({ line, quote });
  });
  window.addEventListener('resize', () => { if (!el.selBtn.hidden) updateSelBtn(); });

  for (const b of $$('[data-action="copy"]')) b.addEventListener('click', copyComments);
  for (const b of $$('[data-action="preview"]')) b.addEventListener('click', openPreview);
  $('#previewCopy').addEventListener('click', async () => {
    const ok = await writeClipboard(el.dlgText.value);
    if (ok) { el.dlg.close(); toast('Copied — paste it into your chat'); }
    else { el.dlgText.focus(); el.dlgText.select(); toast('Select the text and copy it manually'); }
  });
  $('#previewClose').addEventListener('click', () => el.dlg.close());
  el.dlg.addEventListener('click', (e) => { if (e.target === el.dlg) el.dlg.close(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) setDrawer(false);
  });

  window.addEventListener('hashchange', route);

  // Another tab changed something.
  window.addEventListener('storage', (e) => {
    if (e.key !== null && !e.key.startsWith('reviewer2:')) return;
    if (e.key === PREFS_KEY) { prefs = loadPrefs(); if (mode === 'view' && doc) { renderDoc(); updateChrome(); } return; }
    renderSidebar();
    if (!doc || (e.key !== null && e.key !== DOC_PREFIX + doc.id)) return;
    const fresh = loadDoc(doc.id);
    if (!fresh) { doc = null; draft = null; location.replace('#'); return; }
    const mine = draft;
    doc = fresh;
    doc.comments = doc.comments || [];
    draft = mine;
    doc.draft = mine;
    if (mode === 'view') showDoc();
  });

  function saveTransient() {
    persistDraftSoon.flush();
    try {
      if (doc) sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ id: doc.id, y: window.scrollY }));
    } catch { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveTransient(); });
  window.addEventListener('pagehide', saveTransient);

  // Refresh "2h ago" labels now and then.
  setInterval(renderSidebar, 60 * 1000);

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  route();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
