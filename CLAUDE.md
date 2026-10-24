# Equity Watchlist: working notes

Personal Indian-equity research app: Node ESM server (`server.mjs`, per-user data via AsyncLocalStorage) and plain browser scripts in `public/` (one global scope, loaded in `index.html` order). Every user's data stays private to their login.

## Before every release (each improvement)
1. `npm run lint` (undefined names in server and browser code).
2. `npm test` (unit + server tests).
3. `npm run perf`: starts the server on a throw-away account with outside sites (NSE, Yahoo, Screener, AMFI, Stooq, Anthropic) **hanging**, times every page's API (cold and repeat p95), static files and the live stream, and fails on a broken budget or a >50% regression against `scripts/perf-baseline.json`. When a slower number is expected and accepted, refresh the baseline with `npm run perf -- --update` and say so in the release notes.
   `npm run check` runs all three.
4. New screens: add their GET API to `PAGES` in `scripts/perf.mjs`.

## Performance rules
- A page request never waits on an outside site. Answer from cache / saved data and refresh in the background; wait (with a short budget, ~1.5 s) only the first time something was never fetched, and never repeat a failed fetch on every request (remember the try).
- Static files are compressed and cached in memory at start (`static.mjs`): restart the server to see CSS/JS edits.
- Heavy libraries load on demand (e.g. `pdfjs-dist` only when a PDF is imported).

## Privacy rules
- Per-user files only through `userFile()`; shared public caches live in `DATA_DIR` root.
- The mutual fund X-ray library (`mf-xray.json`, `U.fundsFile`) is shared by every account (fund portfolios are public data); write it only inside `withXrayLock()`. Which funds a user holds, values and links stay in their own files.
- Secrets (broker sessions, Telegram, the Anthropic key `ai-key.json`) are excluded from backups (`BACKUP_SECRET_FILES`) and never sent to the browser.
- Ask AI (`ai.mjs`): only `buildContext()` output and tool results go to Anthropic; never account labels / client IDs / PAN / email / folio numbers.
