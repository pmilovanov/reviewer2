# reviewer2

Code-review-style comments for LLM responses. Paste a response, comment on any
line (or on a selected phrase), then copy all your comments at once — each one
under a quote of the text it refers to — and paste them back into the chat.

```
> Use **Postgres** for the queue unless you expect more than a few thousand jobs per second.

What counts as "a few thousand"?

> ### Why
> - It's already in your stack.

Only matters if the job writes to the same DB.
```

The blank line after each quote is deliberate: in Markdown, a line directly under
a `>` quote would be absorbed into it.

Works on phones and desktops. No build step, no server, no dependencies.

## Using it

- **Paste** a response into the box. Pasting into an empty box starts commenting
  straight away; there's also a *Paste from clipboard* button.
- **Or open a file** (`.md`, `.txt`, any plain text up to 2 MB) with *Open file…*,
  or drop it anywhere on the page on a computer. Several files at once become
  separate documents, titled after the file names. While editing a document's
  text, *Replace from file…* swaps in a new version; comments follow their lines.
- **Comment on a line**: tap/click the line (or, on a computer, its line number;
  phones and touch screens don't show numbers). `Ctrl/⌘+Enter`
  saves, `Esc` cancels.
- **Comment on a phrase**: select text, then press *Comment on selection*. The
  selection becomes the quote instead of the whole line. Selections can span lines.
- **Edit / delete** from the comment itself. Deleting can be undone from the toast.
- **Copy N comments** puts everything on the clipboard, in document order.
  *Preview* shows exactly what will be copied. An unsaved comment you're still
  typing is saved first, so it isn't left out.
- **Edit text** (pencil) lets you change the pasted text; comments follow their
  lines. A comment whose line disappeared is kept, marked ⚠, and quotes the
  original line.
- The `<>` button toggles between formatted markdown and the raw source.

### What gets quoted

- With a selection: the selected text.
- Otherwise: the line itself. If the line is short (under 40 characters — a
  heading, a terse list item), the previous non-blank line is quoted too, so the
  LLM can tell which "Yes." you mean.

## Storage

Everything lives in your browser's `localStorage`, one entry per document, like a
private gist list. Nothing is sent anywhere. Phone and desktop each keep their own
documents — there is no sync.

Safari on iOS may clear site data for websites you haven't opened in 7 days. Adding
the page to the Home Screen (Share → *Add to Home Screen*) exempts it, and also
gives you an app icon and offline use.

## Running it

Open `index.html` directly, or serve the folder:

```bash
npm start            # http://localhost:8080
```

To use it from your phone, host the folder anywhere static — e.g. GitHub Pages
(*Settings → Pages → Deploy from a branch*, root folder).

## Tests

```bash
npm test             # unit tests for the quoting/export/markdown logic (node:test)
npm run test:e2e     # drives the app in headless Chromium, desktop + phone (needs Playwright)
```

## Files

| File | What |
|---|---|
| `index.html`, `style.css` | Markup and responsive styles (light/dark) |
| `core.js` | Pure logic: line classification, inline markdown, quoting, export, re-anchoring |
| `app.js` | UI, storage, routing (`#<doc-id>`) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable/offline support |
