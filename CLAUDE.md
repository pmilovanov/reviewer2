# reviewer2

A static web app for commenting on LLM responses line by line, then copying the
comments as quoted replies. See README.md for what it does.

## Layout

- `core.js`: pure logic (line classification, inline markdown, quoting/export,
  re-anchoring). No DOM. Loaded as a classic script (global `Core`) and via
  `require` in tests, so keep it free of browser APIs.
- `app.js`: UI, localStorage (one key per document: `reviewer2:doc:<id>`), routing (`#<id>`).
- `index.html`, `style.css`: markup and responsive styles; phone layout below 760px.
- `sw.js`, `manifest.webmanifest`, `icons/`: installable/offline support.

No build step and no runtime dependencies. Scripts are deliberately not ES modules,
so the app also works opened from `file://`. Keep it that way.

## Checks

```bash
npm test           # unit tests for core.js (node:test)
npm run test:e2e   # Playwright, headless Chromium, desktop + phone emulation
```

Run both before pushing. UI changes should come with e2e coverage, and a look at
screenshots (desktop and phone, light and dark) rather than trusting the tests alone.

## Pull requests

The owner has authorised Claude to merge its own pull requests into `main` without
asking, once:

- `npm test` and `npm run test:e2e` pass on the final head,
- GitHub reports no merge conflict and no failing checks, and
- no review comments are left unanswered.

After merging, tell the owner what was merged. This does not extend to pull requests
opened by anyone else.
