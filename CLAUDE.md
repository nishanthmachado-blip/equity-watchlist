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
- New screens load on demand: list them in `LAZY_VIEWS` (app.js), put their script in `public/<name>.js` (not in index.html) and their styles in `public/screens.css`. The first page load (scripts + styles in index.html) must stay under the 900 KB compressed budget.

## Privacy rules
- Per-user files only through `userFile()`; shared public caches live in `DATA_DIR` root.
- The mutual fund X-ray library (`mf-xray.json`, `U.fundsFile`) is shared by every account (fund portfolios are public data); write it only inside `withXrayLock()`. Which funds a user holds, values and links stay in their own files.
- Secrets (broker sessions, Telegram, the Anthropic key `ai-key.json`) are excluded from backups (`BACKUP_SECRET_FILES`) and never sent to the browser.
- Ask AI (`ai.mjs`): only `buildContext()` output and tool results go to the AI provider the user picked (Anthropic or an OpenAI-compatible one); never account labels / client IDs / PAN / email / folio numbers. Provider keys live in `ai-key.json` / `ai-keys.json` (secret files).
- Side-menu arrangement (`navorder.js`, `/api/ui/menu`, `menu.json`) is per login. New menu buttons need an `id` and `class="viewTab"`; they land in their default group for users who already arranged the menu.
- FIRE planner (`fire.mjs`, `/api/fire`, `fire.json`) is per login and, like expenses and buckets, never goes to Ask AI.
- `decide.mjs` is the Ask AI hold-or-sell helper; the "What to do now" screen is `nowcall.mjs` + `public/decide.js` (`/api/decide`). Check a module name is free before creating one.
- Combined P&L (`pnl.mjs`, `/api/tax/pnl`, `public/pnl.js` lazy-loaded from tax.js) reads the per-user `tradebook.json`; holder names per account in `tax-holders.json`. `tax.mjs` `fifo()` is per account (`t.account`) and splits same-day buy+sell as intraday. Dhan trades come from read-only `GET /v2/trades` (path params go in `query` so the route allow-list still matches).
- Trades are also picked up daily (`captureBrokerTrades()`, weekdays after 15:45 IST): Kite MCP `get_trades` (today only; ISIN resolved from the scrip master) and Dhan's last week. `mergeTrades()` dedupes by `tradeId` per account first, then by identical rows.
- Broker tax P&L reports (`taxreport.mjs`: Zerodha Console xlsx, INDmoney consolidated xlsx) are stored per user in `tax-reports.json` without PAN, name or folio (PAN → `panKey` hash only). `pnlView()` uses a report's rows for its account up to `to`, computed FIFO after; `dedupeReports()` drops MF rows that an all-brokers report (INDmoney) also has.
- Tax shown anywhere (Swing's tax strip / exemption left, holdings clean-up) comes from `brokerTaxNow()` (combined P&L, memoised 60 s per login in `pnlPage()`; any POST to `/api/tax` or a trade capture drops it), never from the hand-typed swing journal. `swingrecon.mjs` + `/api/swing/recon` match the journal to broker sales; fixes move the journal to the broker's numbers.
- Swing book (`swingbook.mjs`, `/api/swingbook`, `public/swingbook.js`, view `swingbook`) is built only from broker data (pnlPage trades + tradebook FIFO lots); hand-added trades go into `tradebook.json` with `src: "manual"`. The old Swing trading screen (`swing.json`) is kept untouched until it is retired.
- Diwali Muhurat picks (`muhurat.mjs`, `/api/muhurat`, `public/muhurat.js`, view `muhurat`, per-login `muhurat.json`) are hand-entered long-term holds; their symbols are in `activeSymbols()`, the price refresh and `eodUniverse()`. Never sent to Ask AI.
