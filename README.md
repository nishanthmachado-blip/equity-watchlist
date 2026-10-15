# Equity Watchlist MVP

## v4.8.0: what changed — live prices on every tab

- **Prices update every minute while the market is open** (9:15 am–3:30 pm IST, weekdays). Before, the interval was 15 minutes. Set the interval with `PRICE_REFRESH_SECONDS` (default 60, minimum 30).
  - One shared run prices every account's watchlist, swing positions and swing watchlist, fetching each stock once.
  - Sources: NSE (one by one, spaced), then Yahoo in batches of 40, then Yahoo's chart, Google and Screener for anything still missing or delayed, inside a time budget.
  - A run that takes longer delays the next one; runs never overlap.
  - The closing-price refresh after 3:30 pm stays.
- **⟳ Refresh prices in the top bar, on every tab:**
  - It shows "Live · 10:32 am" when prices are fresh, and turns amber when they are more than 5 minutes old during market hours.
  - Click it to refresh now; it spins while working and tells you which stocks got no fresh price.
- **Open pages update by themselves:** every page checks for newer prices every 20 seconds and redraws the screen you are on (Watchlist, Valuation, Home, Swing trading, …), with no click needed.
- New endpoints: `GET /api/prices/status` and `POST /api/prices/refresh`.

## v4.7.5: what changed — Swing page updates, tax on swing profits, closing prices

- **Swing page updates reliably:**
  - ⟳ Refresh prices shows a spinner ("Updating prices…") and then "Updated hh:mm:ss".
  - Each update waits at most 8 seconds. Prices still loading finish in the background and appear about 4 seconds later ("N still loading…").
  - An older, slower answer can no longer replace a newer one, and the page updates again when you come back to the tab.
  - Every price shows its source and age (e.g. "NSE · live", "Yahoo · 4 min old"), with saved prices marked in amber.
- **Tax and charges on swing trades** (estimates):
  - Each position shows "net ₹… after tax" if sold now; click it for the full breakdown.
  - The Sell box shows the breakdown live for the quantity, price and date you enter, and 🧮 Tax calculator works for any buy and sell.
  - Charges are Zerodha's delivery rates: STT 0.1% each side, NSE 0.00307%, SEBI ₹10/crore, stamp 0.015% on buys, GST 18%, DP ₹15.34 per stock sold.
  - Each FIFO lot is taxed by holding period: STCG 20%, or LTCG 12.5% above the ₹1.25 lakh yearly exemption (less long-term gains already booked this financial year and anything you enter as used elsewhere), plus 4% cess.
  - "Booked so far" also shows the amount after tax and charges.
- **Freshest price wins:** NSE quotes now carry their time stamp. When NSE is not available, a refresh keeps asking Yahoo, Screener and Google and uses the most recent quote, rather than the first one that answers.
- **Closing prices:** a refresh runs once after the close (15:40–17:00 IST). Before this, the day's last automatic price was from 15:15–15:30, which explained small differences in the evening.

## v4.7.4: what changed — prices that stick, and price debugging

- **Fix: an open page could put old prices back.** The page sends its own copy of the watchlist to the server when you edit or refresh. If it had been open for a while, its older prices overwrote newer ones the server had fetched (e.g. by the 15-minute refresh).
  - Now, for each stock, the newer price (by its timestamp) is kept.
  - Refresh starts from the server's current copy.
  - A price you type in the editor is stamped "Entered by you", so it still wins.
- **Refresh tells you what happened:** for example "✓ 98 of 107 prices refreshed (NSE 80, Screener 18). 9 failed, e.g. XYZ: …".
- **Integrations → Price sources → Compare sources** asks NSE, Yahoo, Screener and Google for one symbol, ignoring cool-downs. Kite is listed as not used. Each source shows its price, time taken and result, with a plain reason for failures:
  - could not connect (the network cause, e.g. ENOTFOUND, ECONNREFUSED, a certificate error);
  - blocked (401/403);
  - rate-limited (429);
  - timed out;
  - page changed.
- **Debug log (owner):** the server's last 1,500 log lines, filterable to price lines, with a Copy button. Each stock's refresh writes one `[price]` line, e.g. `[price] INFY: nse: ✗ HTTP 403 (210 ms) → yahoo: ✓ ₹1062.1 (380 ms)`. Each refresh ends with a `[refresh]` summary by source.
- NSE, Screener and Google requests are now spaced out (one at a time per site), since they block bursts of requests.

## v4.7.3: what changed — prices no longer from Kite

- **Kite is not used for prices any more:** its quotes go stale when the MCP connection drops. Default `PRICE_SOURCES=nse,yahoo,screener,google`:
  1. **NSE:** the exchange's own quote.
  2. **Yahoo:** the live `regularMarketPrice`.
  3. **Screener:** the "Current Price" on the company page.
  4. **Google Finance.**
- This applies everywhere: watchlist / valuation refresh, the Swing page's live prices and the market lists. Kite stays for syncing holdings and mutual funds, and as a last resort for the swing-ideas chart history. Add `kite` back to `PRICE_SOURCES` only if you want it.
- **Refresh always fetches a real-time quote:** Swing trading's "⟳ Refresh prices" skips the 45-second price cache. A saved price used as a last resort is labelled with its time.

## v4.7.2: what changed — correct live prices

- **The problem:** a stock could show an old price (INFY ₹1,048.85 while NSE showed ₹1,062.10) even after Refresh, labelled "Price refreshed".
  - Yahoo's feed was read from its last *daily bar*, which lags during the day, instead of its live price field. Its custom identity was also quick to be rate-limited.
  - When Kite and Yahoo failed, Google Finance was read from the first `data-last-price` on the page, which can belong to a related stock or index shown there.
- **Fixes:**
  - **NSE's own quote is now a price source**, right after Kite (default `PRICE_SOURCES=kite,nse,yahoo,google`). It is the exchange's price, the same as nseindia.com.
  - Yahoo uses `regularMarketPrice` (live) and Yahoo's own 52-week high/low, with a normal browser identity and the second Yahoo host as backup.
  - Google Finance takes the quote's own main price, or the tag naming the stock, before anything else.
  - The Swing page's live prices also try NSE and Yahoo's live price before falling back to the saved price.
  - **Every price shows where and when it came from**, e.g. "Price refreshed (NSE, 13 Oct, 3:30 pm)". If a refresh fails it says so, with the time of the price still shown.
  - The Integrations page lists NSE among the price sources, with its cool-down.

## v4.7.1: what changed — one position per stock

- Adding a swing position for a stock you already hold (+ Add swing position, "Bought" from the swing watchlist or from a swing idea) now adds to that position. The new buy becomes another dated buy, and quantity and average price are recalculated. A message confirms the new quantity and average.
  - The existing plan (limit, add level, targets, stop-loss, booking plan) is kept; anything blank is filled from the new entry.
  - The booking plan starts a new cycle, as with Buy.
- Duplicate entries saved by earlier versions are merged automatically the next time the Swing page opens. Every buy stays in the ledger and the 📒 Buys list.
- Fix: the green "Sell N now" badge in the Targets column was stretched across the column and hard to read.

## v4.7: what changed — Swing ideas scan no longer depends on Yahoo alone

- The ideas scan used only Yahoo's price history, so a Yahoo rate limit stopped it before the first chart ("No charts scanned yet"). Each stock now tries three sources, in order:
  1. **Zerodha Kite:** when an account is logged in to Kite in the app, using Kite's daily candles (`get_historical_data`). This is the fastest and most reliable source. The instrument numbers come from Zerodha's company list, which refreshes itself.
  2. **Yahoo:** if the main host refuses, the second host is tried.
  3. **Screener's price chart.**
- A source that rate-limits rests (Yahoo 15 min) while the others carry on. Only when every source is resting does the scan pause; it shows when it resumes and restarts by itself. **Scan now** clears the rests and tries again at once, for example right after logging in to Kite.
- Your own swing positions, swing watchlist and watchlists are scanned before the market list, so your stocks get ideas first. Stocks with no data are retried after 6 hours instead of 3 days.
- The status line shows which sources were used (e.g. "via Kite 180, Screener 61") and how many stocks had no data.

## v4.6: what changed — Swing ideas, stop-losses, trend health

- **💡 Swing ideas** (Swing trading page): the app scans daily charts after every market close (and when you press **Scan now**). It covers ~185 liquid NSE stocks plus everything in your watchlists and swing watchlist, and finds four rule-based setups:
  - **↘↗ Pullback in an uptrend:** 50-DMA above 200-DMA, price dipped back to its 20/50-day average, RSI 38–55.
  - **🚀 Breakout on volume:** close above the 55-day high on 1.5× average volume, in an uptrend, not more than 8% above the 20-day EMA.
  - **🪃 Oversold bounce:** still above the 200-day average, RSI ≤ 35, 8%+ off the 20-day high; target is the 20-day average.
  - **💎 Value stock turning up:** the app's valuation says it is in its buy zone, and the price has just moved back above its 20-day average.
- **Each idea is a full trade plan:**
  - entry, stop-loss (at least ½ ATR away, at most 12%), target 1 and 2 (capped at +25% / +40% for a swing horizon), reward:risk (only ideas with at least 1.5:1);
  - a score out of 100: setup, trend, 3-month strength vs Nifty, volume, reward:risk, valuation, liquidity and volatility;
  - a suggested size: no more than **Max per trade**, and a stop-out costs at most **Risk per trade** % of your swing cash (both in ⚙).
- **Acting on an idea:** filter by setup or "only my watchlists". Stocks you already hold are left out, with one idea per stock.
  - **+ Swing watchlist** adds the stock with its buy level, amount, stop-loss and targets.
  - **Bought** creates the position directly, with the stop and the targets (as T1/T2 %).
- **Stop-loss** on swing positions and swing-watchlist stocks: the row turns red with 🛑 when the price reaches it, with an alert (and Telegram if connected) and a "near stop-loss" warning within 2.5%. The stop carries over when a watchlist stock is bought.
- **Trend health** on each position (under LTP): ▲ Uptrend / ◆ Pausing (under the 20-day average) / ▼ Below 50-DMA / ▼ Below 200-DMA. The hover text and the edit box suggest a trailing stop: 2 ATR under the price or the 20-day low, whichever is higher.
- The scan pauses for 15 minutes if Yahoo rate-limits and resumes by itself. Chart data is a shared cache (`swing-scan.json`); ideas, positions and sizing stay per account.

## v4.5: what changed — ETFs valued, standalone-only companies fixed, swing ledger

- **ETFs are valued now** (NIFTYBEES, JUNIORBEES, BANKBEES, GOLDBEES, SILVERBEES, LIQUIDBEES and other ETFs, recognised by symbol or name, or by Yahoo marking it an ETF). An ETF has no earnings, so P/E does not apply.
  - **How it's valued:** the app reads up to 5 years of daily prices and measures the gap between the price and its 200-day average on every day. Today's gap is then ranked against that history.
  - **Buy zone:** the cheapest 20% of its history. **Fair value:** its median level. **Bull value:** its 80th percentile.
  - **Verdicts:** ETF: accumulate (cheap vs its trend) / fair, continue SIPs / stretched, go slow on lump sums / expensive vs its trend, wait.
  - **Also shown:** the 52-week range and distance from the high, 1/3/5-year returns, the premium to iNAV (from NSE), and the tracked index's P/E, P/B and yield (from NSE's index list, e.g. NIFTY 50 for NIFTYBEES).
  - **Special cases:** liquid and debt ETFs are labelled "for parking cash", with no zone. Gold and silver ETFs carry a hedge note. ETFs with under 200 days of history use the 52-week range and are marked low confidence.
  - ETF data refreshes daily. ETF cards skip Screener and the Growth lens.
- **Tips Music, Thangamayil and other companies without subsidiaries now get valued.** Screener's "consolidated" page for them loads but every figure is blank, and the app used to stop there. It now falls back to the standalone page.
  - "Data sources busy (rate limit)" now appears only when every source really was rate-limited. Otherwise the real error is shown.
- **Swing ledger (📒):**
  - **Ledger section:** every buy (date, qty, price, how much is still held or was sold, and when) and every sale (date, price, P/L, average bought price, whether at target), newest first. Filter it by stock to see totals bought, sold, booked and held.
  - **📒 Buys on each position:** enter the dates and prices you actually bought at; split an imported position into several buys. Quantity and average follow from them, and the FIFO tax export uses these dates.
  - **Dated trades:** Buy, Sell and "Bought" from the swing watchlist take a trade date (today by default; future dates are refused).
  - **Excel export:** gains a **Ledger** sheet.
  - **Fix:** saving a position's edit box no longer merges its separate buys into one. Quantity and average are locked there when a position has several buys; change them in 📒 Buys.

## v4.4: what changed — Swing: booking plan, scorecard, cash, Telegram, Home strip, Excel

- **Booking plan:** how much of each position to sell at T1, T2 and T3. The default is a third at each (33, 33, 34); you can set your own in ⚙, or per position (e.g. "50, 50", or "25, 25" to keep a runner).
  - The Targets column shows "sell N" next to each price. The row shows **Sell N now** when a target is reached, and the Sell box is filled in with that number.
  - Once that step is sold, the row turns **✓ Booked · riding** (light green) until the next target. Skipping T1 means T2 asks for both steps.
  - Buying more starts a new cycle.
- **Swing scorecard** (built from closed trades):
  - win rate and wins/losses;
  - average win and average loss (₹ and %);
  - profit factor and average P/L per trade;
  - average days held, and sales made at a target;
  - best and worst trade, plus booked P/L by month.
- **Free cash:** set the cash you keep for swing trades in ⚙ (e.g. 5L).
  - Recorded buys take from it, sales add to it, and Reopen reverses the sale. Every movement is listed under "Cash movements".
  - The card turns red when deploy signals need more than you have.
- **Phone alerts on Telegram** (🔔 Alerts → 📱 Phone alerts): create a bot with @BotFather, press Start in it, then paste the token. The app finds your chat and sends a confirmation.
  - Alerts are sent from the server, so they arrive with the app closed.
  - Choose all alerts or swing only; you can pause, send a test, or disconnect.
  - The token is per account and is never shown again in full. WhatsApp is not used because its API needs a paid business account.
- **Swing on Home:** a strip on the Home page shows to-book and to-deploy counts, signals near a level, P/L, free cash and any shortfall. Tap it to open Swing trading.
- **⬇ Excel (tax):** downloads `swing-trades-<date>.xlsx` with three sheets:
  - **Closed trades (FIFO):** one row per buy lot sold, with buy and sell dates, cost, sale value, gain, days held and STCG/LTCG.
  - **Tax by year:** an estimate per financial year using the same rules as the Tax view.
  - **Scorecard.**
- **Buy dates:** positions now keep their buy lots; set **First bought on** in a position's edit box so the export gets STCG/LTCG right. Imported positions otherwise use the import date.

## v4.3: what changed — Undo a closed swing trade

- Each row under **Closed trades** (Swing trading) now has **↩ Reopen** and **✕**.
  - **Reopen** (the sale never happened): the shares go back into your positions at the price you bought them, merged with any you still hold. The limit, add plan and targets come back too. The trade's P/L comes off **Booked so far**.
  - **✕ Delete** (wrong record): removes the trade and its P/L from **Booked so far**. Positions are not changed.
- Both ask for confirmation first. **Booked so far** now counts every closed trade, not just the latest 100 shown.

## v4.2: what changed — Swing targets T1 / T2 / T3

- **Targets column** on Swing trading: the sell price for each level next to every position. Defaults: T1 = +10%, T2 = +20%, T3 = +40% from your average price. Levels already reached are green with ✓, and the next one is underlined. Hover a level to see the profit at that price.
- **An alert at each level:** 🎯 when T1 is reached, then again at T2 and at T3 (title names the level, its price and the LTP). Falling back below a level does not alert again.
- **Your own levels:** ⚙ Targets sets T1/T2/T3 for all positions. A single position can have its own (e.g. "8, 15, 30") in its edit box. An older single-target setting carries over as T1.

## v4.1: what changed — Swing trading

A new **⚡ Swing trading** page (side menu) tracks your swing positions at live market prices.

- **Positions:** qty, average price, limit (e.g. 3L) and an "add X below Y" rule. Each row shows LTP, value, P/L and how much limit is left.
- **🎯 Book profit (green):** a position up 10% or more from your average (change the target in ⚙ Settings, or per position). An alert fires once and repeats only after 24 hours.
- **💰 Deploy (blue):** the price is at or below your add level. The amount shown is the smaller of your add amount and the limit left. Positions without an add level signal on an 8% dip from average.
- **Near (amber):** within 2.5% of either level.
- **Swing watchlist:** stocks you plan to buy, with a "buy below" price and an amount. Deploy alerts work the same way; **Bought** moves a row into positions.
- **Paste from my sheet:** paste rows straight from Excel/Google Sheets ("Add 2L below 4.7k" is understood). Names are matched to NSE symbols and you can fix any before importing.
- **Sell / Buy more:** records trades, recalculates the average and keeps closed trades with booked P/L.
- **Prices:** Zerodha Kite quotes when logged in, else Yahoo, else the last saved price (labelled). Checked every minute while the page is open and every 5 minutes in the background during market hours. Alerts appear under 🔔 and as browser notifications.
- Data is per user (`swing.json`, or MongoDB when enabled) like everything else.

## v4.0: what changed — MongoDB storage and Docker

- **Data now lives in MongoDB** when `MONGO_URL` is set, which `docker-compose.yml` does for you. Redeploying, rebuilding or replacing the app no longer resets it. Stored there:
  - accounts, sign-ins and sign-in history;
  - every user's watchlists, synced holdings (all brokers), broker logins, net worth and goals, tax lots, fund X-rays and alerts;
  - the shared market-data caches.

  Each user's documents carry their account id, so users still see only their own data.
- **First start on an empty database imports your existing `data` folder**, so nothing from earlier versions is lost.
- **Dockerised:**
  - `Dockerfile` (Node 22 Alpine, non-root, health check);
  - `docker-compose.yml` (app + MongoDB 7 with a persistent volume, database not exposed);
  - `docker-compose.aws.yml` (adds Caddy with automatic HTTPS).

  Runs the same on Windows (Docker Desktop), a Mac mini and AWS. See **DOCKER.md**.
- **Backups:** `scripts/backup-mongo.sh` / `.ps1` and `scripts/restore-mongo.sh` (mongodump / mongorestore).
- **Health and status:** `/healthz` now also checks the database (503 when MongoDB is down); `/api/storage` (owner) shows the storage mode and any failed writes.
- **Without `MONGO_URL`** the app still runs with JSON files, exactly as before.

## v3.4: what changed — INDmoney through its official MCP server

- **INDmoney** (Connect brokers → INDmoney) now connects by default through INDmoney's own MCP server at `https://mcp.indmoney.com/mcp`, which is built in.
  - **Login:** press **Connect**, sign in on INDmoney's page (mobile, OTP, MPIN) and approve. No API key or daily access token. Standard MCP OAuth (PKCE, dynamic client registration); tokens are stored only in your account folder.
  - **Sync holdings** reads `networth_holdings` once per asset type the tool accepts (Indian stocks, mutual funds, US stocks, …; taken from the tool's own schema, v3.4.1):
    - Indian stocks go to **My holdings** (names without a symbol are matched against the listed-companies list);
    - mutual funds go to **Net worth → Mutual funds** (linkable to an X-ray portfolio for the look-through);
    - US stocks go to **Net worth → US / global stocks**.
  - INDmoney's other assets (EPF, FDs, …) are listed on Net worth as a reminder, not added, so nothing is counted twice.
  - **Read-only:** INDmoney's server has no trading tools, and this app still only allows its named read tools.
  - **Test holdings** shows exactly what the server returned and what the app understood, for checking the first sync.
  - The old INDstocks access-token route is still available under "Broker API".
- **Angel One** keeps its SmartAPI connection (read-only `getAllHolding`), unchanged.

## v3.3: what changed — search always works, Watchlists page

- **Search works when online sources are busy.** IOC, ONGC and similar searches failed because suggestions came only from Yahoo's online search, which was rate-limiting this server (HTTP 429). Search now uses a local list of every NSE and BSE company:
  - downloaded weekly from Zerodha's public instrument list (or NSE's EQUITY_L.csv), with ~170 large and mid caps built in for the first run;
  - matches both symbols and names ("IOC", "indian oil", "ongc");
  - calls Yahoo only when the local list has fewer than 3 matches, caches its answers for a day and pauses 10 minutes after a rate-limit.
- **Rate-limited valuation:** when Screener / Yahoo refuse a fundamentals fetch, the stock stays saved and is retried automatically after 20 minutes, with a clear message instead of an error.
- **⭐ Watchlists page** (menu → Main, and the mobile tab bar):
  - every watchlist as a tab, with a search box to add stocks straight into the list;
  - per stock: price, P/E vs sector, verdict, buy zone and status, upside to fair value, 52-week range and dividend yield;
  - filters (In buy zone, Buy ideas, Growth, Expensive, Not valued yet), sorting, ⇄ copy / move to another list, ✕ remove with Undo, ⟳ retry for stocks without data, rename and delete;
  - "+ New watchlist" opens straight into the new list.
- The watchlist picker bar now appears only on screens that use it (Value a stock, Valuation table, Picks, Plan, Reports, Thesis), with an "Open watchlist" button. The mobile tab bar is Value · Lists · Holdings · Net worth · More.

## v3.2: what changed — Model portfolio and US stocks

- **🧩 Model portfolio** (menu → Your portfolio): pick a risk profile (Conservative 40/50/10, Balanced 60/30/10, Aggressive 80/10/10 equity/debt/gold), a style (Dividend income, Growth, Value, All-weather blend), an amount, and a goal from Net worth (or years until you need the money).
  - **Asset split** with amounts and what to use for each part, next to your current mix from Net worth. Equity is cut automatically for goals under 3 or 5 years away.
  - **Stock basket** from the stocks this app has valued, scored for the chosen style. Filters per profile: quality score, debt, no small caps for Conservative. Weights respect per-stock (8 / 9 / 10%), per-sector (20 / 25 / 30%) and small-cap (0 / 15 / 40%) caps.
  - **Per stock:** amount, approximate shares, verdict, "Buy now / in 2–3 parts / on dips", why it is in and any red flags. Click a stock for its valuation.
  - **Save as watchlist** or download as CSV. The Dividend style fetches missing dividend histories in the background and refreshes itself.
- **🇺🇸 US stocks** (menu → Main): your own US list (search any SEC-registered ticker or company name) or 40 popular large caps.
  - **Data:** fundamentals from **SEC EDGAR** (10-K XBRL company facts, free and official); prices from **Stooq**, falling back to Yahoo.
  - **Valuation:** fair value = average of a fair P/E (from growth and a 0–100 quality score) and a 10-year free-cash-flow DCF at 9%, with bear / bull ±20%. It also shows the growth today's price already assumes.
  - **Screens:** Undervalued, Quality compounders, High growth, Dividend payers, Low P/E value; sortable columns.
  - **Detail sheet:** 6 years of revenue, profit, EPS and FCF; set your own growth assumption to see fair value change.
  - **Not covered:** banks / insurers are valued on earnings only; foreign 20-F filers are not covered.
  - **Server setting:** set `SEC_USER_AGENT="Your Name your@email.com"`, as the SEC asks of every client.

## v3.1: what changed — sign-in activity and "sign out everywhere"

- **👤 → Sign-in activity**: every device signed in to your account right now (browser and OS, network address or city, when it signed in, last active), with **Sign out** per device and **Sign out all other devices**. Below that, the last 30 events: sign-ins, wrong passwords, password changes, sign-outs.
- **Alerts in the top banner**: a sign-in from a device your account has not used before (last 7 days), and 3+ wrong-password attempts in 24 hours, each with a "Review sign-ins" button.
- **Location**: shown when the app runs behind CloudFront (forward the `CloudFront-Viewer-City` / `-Country-Name` headers) or Cloudflare; otherwise the IP address. No third-party lookup service is called.
- Wrong-password attempts are recorded only against existing accounts. Session tokens are never shown; each session has a separate short id used for "Sign out".
- Long dialogs now scroll inside the window.

## v3.0: what changed — backup, freshness warnings, goals, tax view, install as an app

- **Backup & restore** (👤 → Backup & restore): download one JSON file with everything in your account (watchlists, holdings, net worth, goals, alerts, plans, fund X-rays, tradebook). Broker logins and API keys are left out unless you tick the box (only for moving servers). Restore replaces matching files; "remove data not in the backup" makes it an exact copy. Before every restore the current data is saved to `.before-restore.json` in your folder.
- **Freshness warnings**: a banner when a Zerodha login has expired (they end every morning), when a broker's holdings were last synced 2+ trading days ago, when watchlist prices are old, or when Coin mutual funds could not be read. Each has a one-click fix (Log in / Sync now / Refresh prices) and can be dismissed for the session.
- **Net worth goals**: "₹5 Cr by Mar 2036" with a monthly investment and expected return. Shows the yearly growth needed, your assumption, your actual growth (from the daily history, after 2 months), projected value, On track / Stretch / Behind, and how much more to invest monthly to close a gap. Measure against net worth or investable assets (excludes property). A note appears when hand-entered values are 3+ months old.
- **Tax view** (menu → 🧾 Tax view): import your Zerodha Console tradebook (Equity, and Mutual funds) as CSV or Excel; re-importing is safe. FIFO lots give long- vs short-term gains per holding (click a row for its lots), this financial year's realised gains after set-off, exemption left and estimated tax. Ideas follow the sell-oldest-first rule: long-term gains to harvest within the ₹1.25 lakh exemption, positions that turn fully long term within 60 days, and losses at the front of the queue you could book. Rates: 12.5% LTCG above ₹1.25 L, 20% STCG, long term after 12 months (Finance Act 2024, unchanged in Budget 2026). Not handled: pre-2018 grandfathering, surcharge/cess, F&O, intraday, debt funds. An estimate, not tax advice.
- **Install as an app**: the app is installable (Android / desktop Chrome & Edge: 👤 → Install as an app; iPhone: Share → Add to Home Screen). Opens full screen with its own icon; shortcuts to Value a stock, My holdings and Net worth; a friendly offline page. Needs https (or localhost). Your data is never cached on the device.
- Views now have their own address (`/#networth`, `/#tax`, `/#portfolio`…), so a reload or a bookmark opens the same screen.

## v2.9: what changed — Net worth tab and Zerodha mutual funds

- **Net worth tab** (menu → Your portfolio → 🏦 Net worth): one number for everything you own minus everything you owe, with 30-day / 1-year change and a daily trend line (a snapshot is saved each day you open the page).
  - **Pulled automatically:** stocks from every synced broker account, and mutual funds from Zerodha Coin.
  - **Entered by hand:** EPF / PF, PPF, NPS, gold, real estate, fixed deposits, bonds / small savings, bank & cash, US stocks, crypto, insurance cash value, other assets. Liabilities: home, vehicle, personal and education loans, credit cards, other. Each entry has today's value, optional invested amount (for gain %), owner (Self / Spouse / Joint) and a note.
  - Asset mix by class (equity, debt, NPS, gold, real estate, cash, other), category cards (empty ones show where to add), one table of every entry with edit / delete.
- **Zerodha mutual funds:** the Kite MCP read-only tool `get_mf_holdings` is now allowed. *Sync from Zerodha* (on Net worth) or *Sync holdings* (on Connect brokers) reads stocks and Coin mutual funds for every logged-in Zerodha account: units, average NAV, NAV, value, P/L, folio. Funds held elsewhere are added by hand as "Mutual funds".
- **Look-through: what you really own.** Link each fund to its portfolio from **Mutual fund X-ray** (matched by name automatically when it is clearly the same scheme, e.g. "HELIOS FLEXI CAP FUND - DIRECT PLAN - GROWTH" → "Helios Flexi Cap"). The app then adds up each stock held directly plus its share inside every fund (fund value × the stock's weight), shows stocks you own both ways, how much of each fund overlaps your direct holdings, and your concentration. Click a stock for its valuation.
- No third-party MCP publishes the stocks inside an Indian mutual fund (AMFI / mftool MCPs give NAVs and returns only), so the fund's monthly portfolio file from its AMC website is still the source for the look-through.

## v2.8: what changed — sign-in and private data per account

- **Stock details open in place:** clicking a stock in My holdings, Focus list, Where to invest, Market today, Mutual fund X-ray or Alerts now slides its full valuation in over the page you are on. "← Back to …", Esc or a click outside closes it and you are exactly where you were (same tab, filter and scroll position).

The app now needs a sign-in, and every account's data is kept apart. Safe to put on a server (AWS or anywhere): nobody can see your holdings without your password, and other people you invite only ever see their own.

- **First run:** the server prints a one-time **setup code** (also in `data/auth/setup-code.txt`). Open the app, enter the code and create the **owner** account. Everything already in the app (watchlist, synced holdings, Kite/broker logins, lists, alerts, dividend plan, funds) moves into the owner's private folder `data/users/<id>/`. The code stops working once the owner exists.
- **No public sign-up.** Only the owner adds accounts (👤 → Manage accounts): reset a password, disable or remove an account (removing deletes that account's data).
- **What is private per account:** watchlist and lists, synced holdings from every broker, Kite / Angel One / Dhan / Groww / INDmoney logins and saved API keys, alerts, theses, buying plan, dividend plan, fund X-rays, valuation log, growth overrides. **Shared:** public market data caches only (fundamentals, Screener extras, dividends history, swing data), which hold no personal information.
- **Owner only:** broker keys in `.env` (other accounts enter their own on Connect brokers), manual fundamentals import (shared data), and the AI advisor (spends your Anthropic key; open it with `ALLOW_MEMBER_ADVISOR=1`). New accounts start with an empty watchlist rather than your curated list.
- **Security:** passwords hashed with scrypt + per-user salt; 256-bit session token in an `HttpOnly; SameSite=Lax` cookie (plus `Secure` on HTTPS), only its SHA-256 stored on disk; 5 wrong passwords lock that username for 15 minutes; changing a password signs out every other device; writes from other websites are refused; `nosniff`, `X-Frame-Options: DENY` and HSTS (on HTTPS) headers.

### Deploying on AWS (EC2 or Lightsail)

1. Run it behind HTTPS, never plain HTTP on the internet (the password and cookie would travel in clear text). Easiest: **Caddy** on the same box gets a free certificate automatically:
   ```
   # /etc/caddy/Caddyfile
   watchlist.example.com {
     reverse_proxy 127.0.0.1:4173
   }
   ```
   Or an **Application Load Balancer** with an ACM certificate forwarding to the instance.
2. Start the app with:
   ```
   PUBLIC_URL=https://watchlist.example.com TRUST_PROXY=1 COOKIE_SECURE=1 node server.mjs
   ```
   Keep the default `HOST=127.0.0.1` when Caddy is on the same machine. With a load balancer use `HOST=0.0.0.0` and let the security group allow port 4173 **only from the load balancer**.
3. Security group: open 443 (and 80 for the certificate) only; SSH (22) only from your own IP.
4. Keep `data/` on the instance's disk (or point `DATA_DIR` at a mounted EBS volume) and back it up; it contains broker sessions, so treat it like a password file (the app writes them with mode 600).
5. Read the setup code from the log (`journalctl -u equity-watchlist` if you run it as a systemd service) and create your owner account straight away.

| Setting | Default | Use |
|---|---|---|
| `HOST` | `127.0.0.1` | Address to listen on (`0.0.0.0` behind a load balancer) |
| `PUBLIC_URL` | `http://localhost:4173` | Your https address (OAuth return link for Angel One / Dhan MCP) |
| `TRUST_PROXY` | off | `1` when Caddy / nginx / ALB sits in front (reads `X-Forwarded-Proto` / `-For`) |
| `COOKIE_SECURE` | off | `1` to always mark the session cookie Secure |
| `SESSION_DAYS` | `30` | How long a sign-in lasts |
| `DATA_DIR` | `./data` | Where all data lives |
| `SETUP_CODE` | random | Fix the first-run setup code instead of a random one |
| `ALLOW_MEMBER_ADVISOR` | off | Let other accounts use the AI advisor (your API key) |

Kite note: Zerodha's Kite MCP login opens on kite.zerodha.com and links to the session the app started, so it works from a server too; each account logs into its own Zerodha.

## v2.7: what changed

- **Full redesigns** (🎨 menu → "Full redesigns"; optional, Indigo ledger stays the default). Each changes type, shapes, spacing, surfaces, header and menu, not just colours:
  - **Terminal**: trading-terminal look: black, monospace (JetBrains Mono), compact square tables with zebra rows, amber headings, green data, bracketed [ BUTTONS ], one-line header with a blinking cursor.
  - **Glass**: aurora gradient background, frosted translucent cards and dialogs, gradient pill buttons, a floating rounded menu.
  - **Editorial**: financial-newspaper style: salmon paper, Playfair Display / Source Serif headlines, centred masthead with a double rule, hairline rules instead of cards, underlined tabs.
  - **Vibe** and **Vibe night**: the Gen-Z neo-brutal look, now optional.
- Theme picker groups colour themes and full redesigns, with a one-line description for each redesign.

## v2.6: what changed

- **Theme reverted**: the Gen-Z "Vibe" themes are removed and Indigo ledger is the default again (anyone who picked Vibe is moved back to Indigo). The other themes stay in the 🎨 picker.
- **Menu**: fully open on the right with labels on screens 1400px and wider; a slim icon rail that expands on hover between 1100 and 1400px; drawer / bottom tab bar on smaller screens.

## v2.5: what changed

- **Growth lens** (stock card): values a stock on where its earnings could be in 5-15 years: your expected growth for 5 years, then half of it, an exit P/E that follows return on capital (25 / 20 / 15), discounted at your required return (12%). Shows growth-adjusted fair value (bear / base / bull), the growth today's price already assumes, your expected yearly return and PEG. Edit the assumptions live and save them per stock. Fast compounders that pass the growth and durability gates and are fairly priced for their growth are no longer marked "avoid": they read "Growth buy (growth justifies P/E)" or "Quality growth: fair for its growth" (cyclicals excluded). The Focus list and Where-to-invest use it too.
- Model fix: lenders (banks, NBFCs) are no longer failed on operating-cash-flow tests, which do not fit lending businesses.
- **Mutual fund X-ray** (menu → Screens): upload a fund's monthly portfolio Excel (or CSV, or a table pasted from Value Research / Moneycontrol). Equity holdings are kept, matched to NSE symbols (your watchlist, then Screener's search; fix any by hand), tracked and valued in the background. The fund page shows weighted P/E, valuation mix by weight, growth-justified share, overlap with your holdings and each holding's verdict and growth lens.
- **In-app dialogs** replace every browser prompt / confirm / alert, including a richer "Create a watchlist" dialog (quick-pick names, start empty / from your holdings / as a copy).

## v2.4: what changed

- **Layout fixed** for the right-hand menu: on wide screens it is a slim icon rail that expands over the page on hover / keyboard focus (no more squeezed, clipped content); medium screens use the ☰ Menu drawer; phones get a bottom tab bar (Value · Market · Holdings · Dividends · More).
- **Gen-Z "Vibe" look is the new default** (light) plus "Vibe night" (dark): chunky outlined cards with hard shadows, pill buttons, a lime sticker label, a gradient headline and the Bricolage Grotesque display font. All earlier themes are still in the 🎨 picker; once you pick one it is remembered.

## v2.3: what changed

- **Menu is a permanent right-hand sidebar** on screens 1100px and wider (icons, compact rows); on narrower screens it is still a drawer opened with ☰ Menu.
- **Market today works from your Kite login**: today's movers among your watchlist and holdings from Kite's live quotes (Yahoo if Kite is not logged in): 52-week highs / lows (within 2%), most active by volume and by value, top gainers and losers. NSE's whole-market lists are still available as a source but NSE blocks many home connections, so they are no longer the default; "Volume gainers" was removed (needs average-volume data Kite does not provide).

## v2.2: what changed

- **Peer comparison reworked**: the stock card shows Screener's own peer table (same industry, same columns: CMP, P/E, market cap, dividend yield, quarterly profit and sales with growth, ROCE, plus the industry median), with your stock highlighted and each peer's verdict in this app (or a Value button). Below it, a plain-English comparison with the stocks you track in the same industry (falls back to the sector when you track fewer than 2 in the industry).
- **Dividend lens and swing overlay now come from Screener** (the same site as the fundamentals) instead of Yahoo, which rate-limits many home connections: yearly dividend per share (EPS × payout %), dividend yield, years paid, 5-year growth, payout; and Screener's price/volume chart data for the 50/200-day averages, RSI and breakouts. Yahoo is only a fallback. Each panel now says what it is.
- Cached in `data/screener-extra.json` (peers 7 days, swing 6 hours); the dividend planner and its goal tab use the Screener dividend figures too.

## v2.1: what changed

- **P/E for synced holdings**: My holdings now shows P/E and sector P/E (official, or "~" estimate from tracked peers) for every holding.
- **Header status**: the "Price + news auto-refresh" pill was only a status label, not a button. It is now a plain status line: "● Prices updated 3:45 pm" (or "Server running" / "Server not running"), with the refresh schedule on hover.
- **Market today** (menu → Main): NSE-style lists of new 52-week highs, new 52-week lows, most active by volume, most active by value and volume gainers, with LTP, change, volume, value (₹ Cr), P/E, sector P/E, whether you track/hold it and its verdict. Uses NSE's market-wide APIs when NSE answers your network; otherwise ranks your own watchlist + holdings from Yahoo quotes (and says so). Cached 5 minutes in market hours.

## v2.0: what changed

- **Themes** (🎨 in the header): Indigo ledger (default), Indigo night, Midnight amber (the Dividend Income Planner palette), Ivory & espresso, Forest and Slate (high contrast). Remembered per browser.
- **Dividend planner → Goal planner tab**: the "Dividend Income Planner" page rebuilt in the dashboard style: monthly goal, three allocation methods, up to 15 stocks (top 15 by yield), editable price / dividend with live values for tracked stocks, plan table, capital-allocation donut, CSV download. Fixed the original page's "Equal capital per stock" maths, which planned only 1/n of the goal.
- **INDmoney via its official API** (INDstocks): paste the daily access token in the INDmoney card under Connect brokers; read-only `GET /user/profile` and `GET /portfolio/holdings`. The CSV import stays as a fallback.
- **Focus list** (Your portfolio → Focus list): ranks your holdings (65% business quality + 35% valuation), marks the top 25–30, and sorts each into Accumulate / Hold / Trim / Exit / Review with reasons, weight now → equal-weight target and a suggested ₹ move; suggests watchlist ideas when you hold fewer stocks than the list size.

## v1.9: what changed

- **Sync feedback**: Sync buttons show a spinner, and a toast confirms "Synced N holdings from <account>" with a **View holdings** shortcut (also for Angel One / Dhan / Groww and CSV imports). Failures show a red toast.
- **My holdings** (was "Portfolio & broker import"): holdings are now at the top, with one tab per broker account (All accounts · each Zerodha login · Angel One · INDmoney CSV …). Inside an account tab, quantity, cost, value and P/L are that account's own. Syncing and CSV import moved into the collapsible "Add or sync holdings" panel; Connect brokers only handles connections.
- **Menu**: Value, Growth and Dividend screens are one entry ("Value · Growth · Dividend screens") with tabs, and follow the selected watchlist. Your curated research (curated watchlist tabs, buying plan, thesis, reports) sits in a collapsible "My research" group.
- **Dividend income planner**: add dividend stocks (search, or import your holdings), see dividend per share (last 12 months, editable), yield, annual and monthly income, safety, years paid, 5-year growth and payment months; an income calendar; progress to a monthly-income target; a year-by-year projection with monthly investment, dividend growth and reinvestment; and dividend ideas from your tracked stocks. Saved in `data/dividend-plan.json`.
- Dividend history that cannot be downloaded is marked "history unavailable" and retried after 6 hours (and Yahoo rate-limits pause requests for 10 minutes) instead of being re-requested on every page view.

## v1.8: what changed

- **Search as you type**: suggestions appear while you type a company name, NSE symbol or BSE code. Stocks you track come first with price, P/E, sector P/E and verdict; NSE and BSE listings from Yahoo's search follow (a company on both shows once, as NSE). Arrow keys + Enter to value, **+ Watchlist** (or Ctrl+Enter) to move a suggestion into the selected watchlist; its data is fetched in the background. Untracked suggestions show a quick price / P/E preview.
- **Your own watchlists**: the existing list is the default "My watchlist". Create more (+ New watchlist), pick stocks for each (Choose stocks), switch with the Watchlist selector; every screen follows the selected list.
- **BSE-listed / newly listed stocks**: add by BSE scrip code (e.g. 544252) or from a BSE suggestion. Prices come from Yahoo `.BO` / Google `BOM`, fundamentals from Screener; NSE-only sources are skipped for them.
- **Sector P/E**: it used to come only from NSE's quote API, which blocks most non-browser clients, so it was missing for every stock. It now also comes from Screener's peer table (industry median, saved on the next fundamentals refresh: use Valuation table → Refresh all with "Re-fetch even if fresh" once). Until then a "~" estimate shows the median P/E of the same-sector stocks you track (display only; not used in the valuation).
- **Data for every listed stock**: stocks on a watchlist with no fundamentals are fetched automatically in the background (on start and when added). Selecting a stock whose refresh fails now shows its saved data with its age instead of nothing.

## v1.7: what changed

- **Several Zerodha accounts at once** (Connect brokers): each account is its own login slot with Log in / Sync / Disconnect; add up to 8. Zerodha expires logins daily, so log in again when a slot says so.
- **Alerts** (🔔 in the header): logged when a stock enters its buy zone or its verdict changes class; checked after each 15-minute price refresh and whenever the app is opened; optional browser notifications.
- **Where to invest ₹X**: splits an amount across buy-zone stocks, weighted by quality and upside, capped per stock and per sector against your synced portfolio.
- **Stock card extras**: dividend lens (yield, unbroken years, 5-yr growth, payout, Safe / Watch / At risk), swing overlay (50/200 DMA, golden cross, RSI(14), 20-day volume breakout), and a peer comparison drawn from the stocks you track. A "Dividend" tag (Safe payer yielding 2%+) joins Value / Growth.
- **Portfolio health card**: concentration by stock, sector and market cap, valuation mix, value/growth/dividend tilt, and warnings.
- New files: `classify.mjs` (server-side verdicts), `dividends.mjs`, `technicals.mjs`, `peers.mjs`, `alerts.mjs`, `allocate.mjs`, `health.mjs`; tests in `test/features.test.mjs`. Dividend and price history come from Yahoo's public chart endpoint (best effort, cached).

## v1.6: what changed

- **Home = "Value a stock".** Type an NSE symbol or company name; the stock is added and valued (fair value bear/base/bull, buy zone, Value / Growth / Buy verdict, reasons). Everything else moved into the **☰ More** side menu.
- **Portfolio & broker import** (side menu): holdings from Kite, Angel One, Dhan and Groww (set up under *Connect brokers*), plus a CSV import for INDmoney or any broker (`symbol, quantity, average price`; INDmoney has no public holdings API). "Add all holdings & value them" adds them to the watchlist and fetches fundamentals; the table filters by Buy zone / Value / Growth / Wait / Expensive.
- New endpoints: `GET /api/search`, `POST /api/holdings/import`, `POST /api/holdings/add-to-watchlist`. Verdicts are rule-based screens, not advice.

Run locally:

```bash
npm start
```

Open `http://localhost:4173`.

This MVP stores the watchlist server-side, refreshes daily prices and 52-week ranges through a Yahoo Finance market-feed fallback, and retrieves one recent headline per stock through Google News RSS. It runs a 15-minute scheduled price refresh during NSE cash-market hours while the server is running. Use a licensed India-market provider before relying on it for investment decisions or production use.

The `Refresh sources` button immediately refreshes the full published watchlist, writes it to `data/watchlist.json`, and makes the current state available to later sessions. Price/news feeds update facts only. Valuation labels and investment actions require a reviewed research update with evidence.

## Category Tabs & Pagination

The Watchlist is split into distinct tabs with counts and pagination (max 10 stocks per page):

- **Core** — high-conviction compounders and durable-moat businesses suited for large, long-hold allocations.
- **Satellite** — growth, turnaround, thematic, and speculative opportunities.
- **Avoid** — avoid-rated businesses with structural headwinds, poor capital allocation, or unattractive risk/reward.
- **All Stocks** — full portfolio view across all categories.
- **Value / Quality top 10**, **Momentum top 10**, and **Growth top 10** — curated, ranked candidates selected from the current watchlist.
- **New Age candidates** — a higher-risk shortlist of newer platform, technology, and emerging-business names. These are not predicted multibaggers.

These four factor tabs are curated research lists, not quantitative live screens. The current app does not calculate audited fundamental-value scores or benchmark-relative price/volume momentum. Confirm financial statements, current valuation, price history, and risk independently; use the list as a starting point for research, not a buy recommendation.

Each tab supports sorting, searching by company/ticker, filtering by account or action, and quick page navigation (`‹ Prev`, page numbers, `Next ›`).

## Dark Theme

A theme toggle in the header (`🌙 Dark` / `☀️ Light`) lets you switch between a bright daytime theme and an eye-friendly dark palette. Theme preferences are persisted locally in `localStorage` and automatically detect your operating system's color scheme preference on initial load.

## Reports

A second top-level view (`Watchlist` / `Reports`) adds three report types, built from the same `data/watchlist.json` plus a new `data/history.json` audit log:

- **Dashboard** — portfolio summary cards, bucket/action/valuation breakdown bars, a "needs attention" list (stale prices, unconfirmed tickers, failed refreshes) and a "least recently reviewed" list (stocks whose action/valuation/notes haven't been touched in the longest time).
- **Printable report** — a clean, print-styled view for either the full watchlist (grouped by action, e.g. all "Buy gradually" names together, then "Watch", then "Avoid") or a single stock (full detail plus its change history). Use the `Print / save as PDF` button — it uses the browser's native print dialog, so "Save as PDF" there produces a PDF with no extra dependencies.
- **Change history** — a searchable, timestamped log of every change to a stock's bucket, action, valuation, KPI or research note, newest first.

### How the change log works

`server.mjs` now diffs every write to `data/watchlist.json` against the previous version:

- Changes to **bucket / action / valuation / kpi / note** are logged as individual timestamped events (`data/history.json` → `changes`). These are rare and meaningful, so every change is kept (capped at the most recent 2,000).
- **Price** is logged as at most one snapshot per stock per IST calendar day (`data/history.json` → `priceSeries`), not on every 15-minute refresh — otherwise the log would be almost entirely price noise. This is what powers the small price-trend sparkline in the stock detail panel and in the single-stock printable report.

New endpoint: `GET /api/history` (optionally `?id=<stockId>` to scope to one stock).

## Financial advisor

A fourth Reports tab (**Advisor**), plus an "Ask the advisor" button in the stock detail panel, calls the real Claude API — using **your own** Anthropic API key, at **your own** cost — to suggest, per stock:

- a recommended **investment action** (Buy gradually / Buy on dips / Buy on correction / Wait for correction / Watch / Avoid),
- a refreshed **valuation** label,
- a **style** tag: exactly one of **Core** (durable-moat, large long-hold allocation), **Satellite** (smaller/thematic, more idiosyncratic risk, sized smaller), **Growth** (prioritises expansion over current profitability), or **Momentum** (case rests on price action/a re-rating catalyst rather than durable quality — needs tighter risk management),
- a **long-term-story verdict** (Intact / Weakening / Broken / Too early to tell) with one paragraph of reasoning,
- a one-line key risk, a confidence level, and a caveat about data/knowledge limitations.

Both advisor entry points include a **Research lens** selector: Balanced, Value, Growth, or Momentum. The lens changes which evidence the model prioritizes; it is not a quantitative screener. The Value lens requires verified earnings/cash-flow and balance-sheet data, and the Momentum lens requires price history, relative-strength benchmarks, and volume. When those inputs are missing from the watchlist, the advisor is instructed to say the factor is unassessed rather than invent evidence. The selected lens is remembered in this browser.

**Nothing is ever applied automatically.** Every suggestion — single-stock or bulk — is shown for your review first; you tick/accept the ones you agree with, and only those are written to `data/watchlist.json` (which also logs them to the change-history audit trail, so you can see exactly what the advisor changed and when).

### Setup

1. Get an API key at https://console.anthropic.com.
2. Either `export ANTHROPIC_API_KEY=sk-ant-...` before `npm start`, or copy `.env.example` to `.env`, fill it in, and run `npm run start:advisor` (requires Node 20.6+ for `--env-file`).
3. Optionally set `ADVISOR_MODEL` to a different model name (defaults to `claude-sonnet-5`). A faster/cheaper model is a reasonable choice if you plan to run the advisor across many stocks at once.

Every advisor call is billed to your key under Anthropic's usage-based pricing (see https://www.anthropic.com/pricing for current rates). The rest of the app — prices, news, reports, history — works fully without this key; the advisor is the only feature that needs it, and it fails with a clear message rather than crashing if the key isn't set.

### Bulk-refreshing the Watch list

Reports → Advisor → scope "All Watch stocks" → **Run advisor**. It calls the API twice-concurrently (a light rate limit) and shows results as they come in — action, valuation, style, verdict, confidence — with a checkbox per row (pre-ticked on success, unticked on error). Review, untick anything you disagree with, then **Apply selected**.

The Watchlist also has a dedicated **Downturn top 10** tab. It displays the ten curated names in rank order; select any row to review its full thesis, KPI, notes, recent changes, and available price history in the detail panel. This downturn list is separate from the AI research lens and is not automatically recalculated from Value/Growth/Momentum runs.

## Product roadmap ideas

- Add licensed, timestamped financial-statement and price/volume feeds, with visible source links and freshness status before generating scores.
- Once data quality is in place, calculate explainable factor scores (value, growth, momentum, quality, and risk) from explicit metrics, then let users choose weights and create a screened Top 10.
- Add portfolio-aware exposure, concentration, drawdown, and watchlist-change alerts, with configurable thresholds and a reviewable audit trail.
- For a commercial launch, add user accounts, encrypted per-user credentials or managed model billing, rate limits, entitlement plans, data-provider licensing, and legal/compliance review for the markets served.

### On accuracy

The advisor is a large language model reasoning from what it knows about each business, not a live data feed — it has no access to real-time financial statements or filings, and its knowledge has a training cutoff. It's designed to say so ("caveat" field) rather than guess confidently at very recent numbers. Treat its output the way you'd treat a well-read analyst's first pass: a useful starting point to verify against actual filings and current data, not a final answer — this app does not attach a screen for evaluating AI-model accuracy, so use ordinary judgement about how much to trust any given suggestion. This is a personal research tool, not licensed financial advice.

### Data-integrity fix

Previously, the app republished its full local state to the server on *every* page load, regardless of whether the server already had newer data. Opening the app in a fresh browser or device (empty `localStorage`) would silently overwrite `data/watchlist.json` — including any research you'd already saved — with the app's built-in defaults. The app now loads from the server first and only republishes when the server is confirmed empty (first run ever) or after an explicit edit/refresh, so a second browser or device no longer clobbers the server's live data.

## Valuation tab (rule-based verdict + buy zones)

A top-level **Valuation** view shows, for every stock with fundamentals: price, 52W range, P/E, fair P/E, P/B, ROCE, ROE, promoter %, a valuation view (Undervalued / Fair / Fair to rich / Rich / Very rich), a buy zone, the gap to that zone, and a status (In zone / Below zone / Above zone / Wait (far above)). Nothing is written to your watchlist automatically.

- **Where the data comes from:** click **Fetch from Yahoo** (or the ↻ on a row). `fundamentals-yahoo.mjs` calls Yahoo Finance's free, unofficial endpoints (no API key): `quoteSummary` for price, P/E, P/B, ROE, 52W range and insider holding, and `fundamentals-timeseries` for annual revenue, net income, EBIT, assets, current liabilities, debt and equity. The app derives the rest itself: 3-year sales/profit CAGR, ROCE (EBIT ÷ (assets − current liabilities)), and borrowings vs equity. Results are cached in `data/fundamentals-cache.json` (created on first fetch; no seed file) and re-fetched only when older than 7 days or forced with ↻.
- **Limits you should know:** Yahoo's endpoints are unofficial and can change or rate-limit without notice (errors are shown per stock; set `YAHOO_DEBUG=1` to log which data blocks came back). Coverage of Indian small caps is patchy, so some fields can be missing; the row then shows what was missing and the model falls back to a 10% growth assumption. Numbers will not match Screener exactly: ROCE is derived by this app, and "promoter %" is Yahoo's insider holding (approximate, and there is no 3-year promoter-change figure, so the promoter-selling penalty is not applied). A `CHECK:` flag appears when Yahoo's price differs >20% from your watchlist price or the company name does not match the ticker.
- The maths lives in `valuation.mjs` (`MODEL` holds every threshold; the rules are printed under the table). P/E is re-scaled to the live price using the EPS implied when the fundamentals were captured.
- Manual override: **Manual CSV override** or `POST /api/fundamentals` with `{csv}` / `{entries}`. `GET /api/valuation` returns computed rows; `GET /api/fundamentals` returns the cache.
- The optional Claude advisor (needs `ANTHROPIC_API_KEY`) includes a stock's fundamentals and computed view when available.

## v0.2: more accurate valuation, Plan tab, checks

- **Sector-aware rules** (`valuation.mjs`, profile auto-set from Yahoo's industry, override with a `profile` column): *financial* (banks/lenders) uses P/B vs a fair P/B from ROE; *cyclical* normalises P/E on 4-year average profit; everything else uses P/E vs a fair P/E.
- **Cash-flow quality:** fair P/E is cut for weak cash conversion, negative free cash flow, and heavy debtor/inventory days.
- **Sector P/E (NSE):** `nse.mjs` pulls the NSE quote (P/E, sector P/E, industry) as a supplement, and as a fallback when Yahoo fails. NSE blocks many non-browser clients, so this is best-effort and never fatal.
- **Fair value range:** bear / base / bull (0.75× / 1× / 1.25× the fair multiple) with upside to base.
- **Data freshness:** rows older than 90 days are faded and marked ⚠. A daily job (after 19:00 IST) refreshes fundamentals older than 7 days, up to 15 stocks; set `AUTO_FUNDAMENTALS=0` to disable.
- **Plan tab:** record buys per stock; triggers are measured from your first buy (Standard −15/−25/−35/−45%, Smaller −25/−40%). ADD only appears when the valuation gate is OK, otherwise HOLD. Shows invested vs planned maximum, average cost and P/L, sector exposure (⚑ above 25% of the plan), and a stress table (cash needed if every stock falls 10–40%, vs your cash reserve). Data is in `data/positions.json`.
- **Manage stocks:** add a stock or fix a wrong ticker (e.g. Apollo) from the Plan tab. Four stocks from the small-cap plan (Anand Rathi Wealth, Gravita, Safari, Shaily) are pre-added.
- **Data checks:** *Yahoo vs Screener* compares cached Yahoo numbers with 20 Screener figures captured by hand on 1 Oct 2026 (`data/reference-check.json`, never used for valuation). *Forward tracker* logs each verdict daily (`data/valuation-log.json`) and reports what prices did afterwards by verdict. A true historical back-test needs historical fundamentals, which this app does not have.
- **Tests:** `npm test` (Node's built-in runner; no dependencies).

## v0.3: Best 30 tab and Yahoo rate-limit handling

- **Best 30 (10-yr) tab** in the Watchlist: 12 core compounders, 12 quality-growth names and 6 small-cap compounders, shortlisted on 4 Oct 2026 from this watchlist (durable business, returns, runway; excludes loss-making, theme-driven and governance-flag names). It is a research shortlist, not a recommendation or a return forecast. The list lives in `best30` at the top of `public/app.js`. On the Valuation tab, tick **Best 30 only** and set **Max stocks** to 30 to fetch fundamentals for exactly these.
- **429 from Yahoo (`crumb request failed (HTTP 429)`):** Yahoo throttles by IP, and retrying only prolongs it. The fetcher now tries three crumb routes (query1, query2, finance.yahoo.com cookie), then starts a cooldown (10 minutes, or Yahoo's `Retry-After` up to 30). During the cooldown no Yahoo requests are made, a batch stops after the first throttled chunk, and the UI says when to retry. Stocks already fetched are kept. Calls are spaced 1.2 s apart, and the 15-minute price refresh now runs 3 requests at a time instead of 5, to avoid triggering the throttle. `GET /api/health` shows `yahooCooldownUntil`.

## v0.4 – NSE as a real fallback
- Source selector on the Valuation tab: **Yahoo, NSE if blocked** (default) or **NSE only**. Env `FUNDAMENTALS_SOURCE=nse` sets the default for scheduled runs.
- If Yahoo is rate-limited (HTTP 429) or cooling down, the app asks NSE instead of giving up.
  - Stock already has cached statements: keeps growth/ROCE/cash-flow and refreshes only price, P/E, sector P/E and 52-week range (`nseRefreshedAt`).
  - No cached data: builds a thin entry; the valuation is marked **low confidence** (P/E vs sector P/E only).
- NSE has its own 5-minute cooldown and 15 s timeout when it returns 403/429.
- NSE's quote API has no sales/profit growth, ROCE or cash flow, so those still need Yahoo (or the CSV override).

### Diagnosing blocks
Open `http://localhost:4173/api/diagnose` – it probes Yahoo and NSE once and shows the HTTP status each returns from your network. 429 = your IP is throttled (wait 30–60 min, or try a phone hotspot/another network); 403 = treated as a bot. Restart the server to clear the in-memory cooldowns.

## v0.5 – Screener.in source and P/E on the watchlist
- **Source "Screener → Yahoo → NSE"** (default): the app reads the public Screener.in company page (consolidated, else standalone) for P/E, ROCE, ROE, book value, 3-yr sales/profit CAGR, borrowings, reserves, cash conversion, debtor/inventory days, promoter holding and sector. It falls back to Yahoo, then NSE, each with its own cooldown. Other choices: Screener only / Yahoo only / NSE only.
- Screener is polite-rate-limited (2.5 s between stocks, 10-minute cooldown on 429). Fetch 5–10 stocks at a time. Respect Screener's terms; this is for personal research.
- Parsing follows Screener's current page layout. If the layout changes you get "layout not recognised" rather than wrong numbers; the Manual CSV override remains the fallback.
- The Watchlist table has a **P/E (fair)** column: today's P/E (re-scaled to the latest price), the model's fair multiple and the valuation view. It shows "—" until fundamentals are fetched.

## v0.6 – Value picks tab
- **Value picks → Undervalued & fair**: every stock the model rates Undervalued or Fair, cheapest versus its fair multiple first. Filters: only in/below buy zone, include Fair to rich, hide low-confidence (NSE-only) rows.
- **Value picks → My 10 wishlist**: drag stocks from the list (or press +) into your own list of up to 10; it is saved in `data/custom-list.json`. The table shows the fetched data for those stocks and "Fetch data for my list" pulls only those, which keeps requests to Screener/Yahoo/NSE low.

## v0.7 – Refresh all
Valuation tab → **Refresh all** runs a background job over the whole watchlist (one stock at a time, spaced out), skipping stocks fetched in the last 7 days unless "Re-fetch even if fresh" is ticked. Progress shows in the page and survives reloads; Cancel stops it. If every source rate-limits three stocks in a row it pauses; run it again later and it continues with the stocks that are still missing.

## v0.8 – Largecap / Midcap / Smallcap tags
Each stock with fundamentals gets a cap tag next to its name (Watchlist, Valuation, Value picks) and a cap filter on the Valuation and Value picks tabs. Market cap comes from Screener (or Yahoo), scaled to the latest price. Classes follow the SEBI/AMFI scheme (large = top 100, mid = 101–250, small = rest) using approximate rupee cut-offs in `MODEL.capBands` (`valuation.mjs`: large ≥ ₹1,00,000 Cr, mid ≥ ₹33,000 Cr). AMFI republishes the real list each January and July; adjust the two numbers when it does.

## v0.9 – Visual refresh
`public/theme.css` restyles the app (indigo header band, segmented main nav, stat tiles with a colour edge, verdict/status chips). Each valuation row gets a **gauge** (today's multiple against fair, left of the centre mark = cheaper) and each price a **52-week range bar**. Works in light and dark themes. Delete the theme.css link in `index.html` to go back to the old look.

## v1.0 – Quick add
Valuation tab → **+ Add a new stock**: type an NSE symbol (the part in `screener.in/company/SYMBOL`), optionally a name, and press **Add & get valuation**. The stock is added to the watchlist and its fundamentals are fetched immediately (Source setting applies). If no name is given the real company name is filled in from the data source. IndiGo (`INDIGO`) is now in the default watchlist.

## v1.1 – Google Finance prices and Zerodha Kite (MCP)

New **Integrations** tab, a **price-source chain**, and an optional read-only **Kite MCP** connection.

### Price sources
Prices are taken from the first working source in `PRICE_SOURCES` (default `kite,yahoo,google`; set e.g. `PRICE_SOURCES=google,yahoo`). Yahoo behaves exactly as before; **Google Finance** is the new fallback, and **Kite** is skipped unless enabled and logged in. Each stock records which source priced it (`priceSource`).
- **Google Finance** (`googlefinance.mjs`): Google has no public API, so this reads the public quote page (`google.com/finance/quote/SYMBOL:NSE`). It reads price, 52-week range and previous close. If the layout is not recognised it fails with a clear message and the next source is used, never a guessed number. A price more than 40% away from the stored close is rejected as a probable wrong instrument. A 403/429 starts a 10-minute cooldown. For a fully supported Google route, use Google Sheets' `GOOGLEFINANCE()` function instead.
- **Kite last-traded price** comes in one batched call per refresh. Kite has no 52-week range, so that is topped up from Yahoo/Google at most once a day (`rangeUpdated`).
- **Compare sources:** Integrations tab, or `GET /api/price-compare?symbol=RELIANCE`, shows Google, Yahoo and Kite side by side. Run this first on your network to confirm each feed works. `GET /api/diagnose` also probes Google and Kite now.

### Zerodha Kite via MCP (read-only)
`kite-mcp.mjs` is a small dependency-free MCP client (Streamable HTTP, JSON or SSE replies) for [Zerodha's Kite MCP server](https://github.com/zerodha/kite-mcp-server).
1. Start with `KITE_MCP_ENABLED=1` (optionally `KITE_MCP_URL`, default hosted `https://mcp.kite.trade/mcp`; use your own URL if you self-host).
2. Integrations tab → **Log in to Kite**. Zerodha's login page opens; sign in there. No API key, secret or password is stored by this app.
3. **Sync holdings** stores your holdings in `data/kite-holdings.json` (git-ignored) and lists them against the watchlist: quantity, average cost, value, P/L, and which held stocks are not on the watchlist.
4. **Several Zerodha accounts:** one login is one account. Sync, press **Disconnect**, log in as the next account, sync again; holdings are combined per symbol and show which account holds what.
- **Read-only by design:** only `login`, `get_profile`, `get_holdings`, `get_positions`, `get_margins`, `get_quotes`, `get_ltp`, `get_ohlc`, `get_historical_data` and `search_instruments` can be called (`READ_ONLY_TOOLS`). Order, modify, cancel and GTT tools are refused in code before any request is made, even on a self-hosted server that exposes them.
- The MCP session id is saved in `data/kite-session.json` (git-ignored, mode 600) so a restart does not force a new login. Kite expires logins daily, so log in again each trading day; until you do, refreshes quietly use the next price source.
- Endpoints: `GET /api/kite/status`, `POST /api/kite/login`, `POST /api/kite/sync` (`{label}`), `GET /api/kite/holdings`, `POST /api/kite/disconnect`, `POST /api/kite/remove-account`, `GET /api/kite/tools`.
- Holdings are not written into the Plan tab automatically; the Plan's ladder depends on your first-buy price and date, which holdings do not carry.

### Verification status
Covered by `npm test` (Google parser and fetch/cooldown logic, and the Kite client against a fake MCP server over JSON and SSE, including session reuse, expiry, login-required and the read-only guard). The Google parser is built from the known page markup but was **not** checked against a live Google page, and the Kite client was **not** run against the live Zerodha server (neither was reachable where this was built). Run `/api/price-compare` and the Kite login once on your machine to confirm both.

### Kite login troubleshooting
- Integrations tab → **Log in to Kite** shows the Zerodha link (use it if no tab opened) and then polls: the status turns to "Connected" by itself once you finish signing in. Then press **Sync holdings**.
- **Diagnose** (or `GET /api/kite/diagnose`) runs connect → tools/list → login → get_profile and shows which step fails.
- The login link is decoded from prose, markdown or JSON (Go escapes `&` as `&`, which used to produce a broken link).
- Kite's login is tied to the MCP session that asked for it, and Zerodha lists the AI clients it supports; if Diagnose shows the login link arrives but get_profile stays "not logged in" after you sign in, the hosted server is not linking this client's session. In that case self-host the Kite MCP server (needs your own Kite Connect API key) and set `KITE_MCP_URL`.

## v1.2 – Thesis tracker
Thesis tab: for each stock, write **why you own it** and the measurable conditions under which that reason stops being true ("thesis holds while ROCE ≥ 15"). Stored in `data/theses.json`.
- Metrics: ROCE, ROE, 3-yr sales/profit growth, promoter holding and 3-yr change, borrowings ÷ reserves, cash conversion, P/E, P/E ÷ fair multiple, fall from 52-week high. Operators: ≥ ≤ > <. One-click starting points are offered in the form.
- Each condition shows ✓ holds, ✗ broken (with the date it first broke) or "no data". A thesis is **Broken** if any condition fails, **Intact** if none fail and at least one is checkable, otherwise "No data yet".
- Conditions are re-checked whenever the tab or `GET /api/thesis` is loaded, so they follow every fundamentals refresh. When the overall status flips, an entry (field `thesis`) is added to Reports → Change history.
- Broken theses on stocks held in a synced Zerodha account are shown first and counted separately.
- Caveats: it is only as current as the fundamentals (the "as of" date is shown); a condition with no data is never treated as broken; lenders and conglomerates with finance arms (for example M&M) can show high borrowings ÷ reserves, so choose conditions that suit the business. A tracker for your own reasoning, not advice.
- Endpoints: `GET /api/thesis`, `POST /api/thesis/save` (`{symbol, reasons, conditions[]}`), `POST /api/thesis/remove`.

### Turning on settings (Kite, advisor key, price order)
Settings are environment variables. **`npm start KITE_MCP_ENABLED=1` does not work** (npm treats it as an argument). Use a `.env` file instead, which works the same on Windows, macOS and Linux: create a file named `.env` in the project folder (next to `server.mjs`; copy `.env.example`) containing, for example,

```
KITE_MCP_ENABLED=1
```

then restart with plain `npm start`. The console prints `[config] ... Kite MCP: ENABLED` when it took effect. Variables already set in your shell win over `.env`. Shell alternatives: macOS/Linux `KITE_MCP_ENABLED=1 npm start`; Windows PowerShell `$env:KITE_MCP_ENABLED=1; npm start`; Windows cmd `set KITE_MCP_ENABLED=1 && npm start`.

## v1.3 – Click a holding for details and a stance
Integrations tab → click any synced holding to open a popup (same style as the Watchlist popup) with:
- **Suggested stance**: Accumulate / Hold / Hold (don't add) / Review / Trim / No view, with confidence and every reason listed (✓ for, ✗ against), plus "what would change this".
- **Your position** (quantity, cost, value, P/L, share of synced holdings, per-account split), **valuation** (view, buy zone, fair-value range, ROCE/ROE/growth/promoter), your **thesis** status, and your **watchlist** rating and note.
- Buttons: fetch/refresh fundamentals, or for a stock not on the watchlist **Add to watchlist & fetch valuation**; **Write/Edit thesis** jumps to the Thesis tab. The table also gets `% of total` and `Stance` columns and a stance count line.

How the stance is decided (`stance.mjs`, all rules shown in the popup): a score from the valuation view (Undervalued +2 … Very rich −2), buy-zone status (+1 in/below zone, −1 far above), thesis (Intact +1, Broken −2), and the watchlist action (Buy gradually +1, Wait −1, Avoid −2). Score ≥ 3 → Accumulate; 0–2 → Hold; below 0 → Hold (don't add). Caps: a stock above 12% of your synced holdings is never "Accumulate"; a broken thesis or an Avoid rating on a stock you hold → Review; above 20% **and** Rich/Very rich or thesis broken → Trim. Missing valuation → No view; stale (>90 days) or NSE-only data → Low confidence. Thresholds are `LIMITS` in `stance.mjs`.
Limits: it uses cached fundamentals, ignores your tax position, goals, time horizon and holdings outside the synced Zerodha accounts (weights are % of those only), and is a checklist, not advice.
Tests: `npm test` now also boots the real server and checks the read-only endpoints.

## v1.4 – Angel One, Dhan and Groww holdings (always on)

Integrations tab → **Angel One · Dhan · Groww**. All three brokers and Zerodha Kite are **always enabled**: no `.env` editing or restart. Open a broker's **Settings**, type your details (each field says where to find it in that broker's app or website), press **Save details**, then **Sync holdings**. Its holdings join your Zerodha holdings in the same table. Stance, % of total, thesis "held" flags and the holding popup all work across brokers. A symbol held at several brokers is one row, and "Held in" shows the split (e.g. `Angel One - Vinay (4), Dhan - 1100 (2)`). Several accounts per broker work the same way as Kite: sync, disconnect, connect the next account, sync again.

| Broker | Details to enter | Automatic daily login when you also save | Prices |
|---|---|---|---|
| **Angel One** (SmartAPI, free) | SmartAPI key (smartapi.angelone.in → My Profile → My APIs → Create an App), client ID (Angel One app → profile) | PIN + TOTP secret (smartapi.angelone.in/enable-totp, the text code shown with the QR) | Come with the holdings |
| **Dhan** (DhanHQ v2, free) | Client ID (Dhan app → Profile); or just paste the daily access token (web.dhan.co → My Profile → Access DhanHQ APIs) | PIN + TOTP secret (web.dhan.co → DhanHQ Trading APIs → Setup TOTP) | Market-feed LTP needs Dhan's paid Data API plan. Without it: a live price another broker returned for the same stock, else the watchlist price (marked `*`) |
| **Groww** (Trade API, paid subscription) | API key (groww.in → Settings → Trading APIs); or just paste the daily access token | TOTP secret (or API secret, but then the key must be approved on Groww each day) | LTP endpoint, 50 symbols per call |

- **Always on, logs in by itself**: when a broker's daily session expires, the next status check or sync logs in again using the saved details (PIN + TOTP secret, or API key + TOTP secret). A failed automatic login is retried at most every 2 minutes, so a wrong or expired secret cannot hammer the broker. Without those optional fields, you type the 6-digit TOTP (or paste the day's token) once a day.
- **Where details are kept**: `data/broker-credentials.json` on this computer only (git-ignored, file mode 600). PINs and TOTP secrets are never sent back to the page, not even partly; the page shows `••••` for saved secrets. **Remove saved** deletes a field. Values in `.env` (`ANGEL_API_KEY`, `DHAN_CLIENT_ID`, `GROWW_API_KEY`, … see `.env.example`) still work as a fallback; details saved in the app win. A PIN plus TOTP secret is enough to log in to your broker account, so keep this computer and that file private. Leave those two fields empty if you prefer to type the code daily.
- **Kite** is now on by default too. Press **Log in to Kite**; no key is needed. Set `KITE_MCP_ENABLED=0` in `.env` to switch it off. The 15-minute price refresh only asks Kite once you have logged in.
- **Read-only by design** (`brokers.mjs`, `READ_ONLY_ROUTES`): the only endpoints that can be called are login/token, profile, holdings and last-traded price. Order, modify, cancel, GTT and fund-transfer endpoints are refused in code before any request is made, and the list cannot be extended from the UI or `.env`.
- **Sessions**: kept in `data/broker-sessions.json` (git-ignored, mode 600). Changing the API key, client ID or access token drops the old session.
- **Storage**: holdings from every broker are kept in `data/kite-holdings.json` (the v1.1 name, so existing Zerodha syncs carry over). Zerodha accounts are keyed by Kite user id, others by `angel:<client ID>`, `dhan:<client ID>` or `groww:<UCC>`.
- **Symbols**: Angel's series suffix is removed (`RELIANCE-EQ` → `RELIANCE`) so holdings match watchlist symbols. A BSE-only holding keeps the broker's symbol and may show as "not on watchlist".
- **Endpoints**: `GET /api/brokers/status`, `POST /api/brokers/{angel|dhan|groww}/settings` (`{values: {...}}` or `{clear: [field]}`), `POST /api/brokers/{id}/login` (`{mode, pin, totp, accessToken, clientCode}`), `POST /api/brokers/{id}/sync` (`{label}`), `POST /api/brokers/{id}/disconnect`, `GET /api/holdings` (all brokers combined; `/api/kite/holdings` returns the same). `GET /api/diagnose` also probes the three broker API hosts.
- **Verification status**: `npm test` (88 tests) covers TOTP against the RFC 6238 vectors, each broker's login → profile → holdings flow against fake servers (session expiry, missing data plan, Groww's 50-symbol LTP batching and approval checksum), saved settings (file mode, masking, `.env` fallback, automatic re-login, the retry pause) and the read-only guard. The app was also run in a browser end to end with the broker APIs faked. It was **not** run against the live Angel One, Dhan or Groww servers, because that needs real accounts. Connect one account per broker on your machine and compare the synced quantities with the broker's app before relying on them. The "where to find it" paths describe each broker's site as documented; brokers do move menus.
- Holdings are not written into the Plan tab, for the same reason as Kite: a holding has no first-buy date.

## v1.5 – Angel One and Dhan through MCP (like Kite MCP)

The Angel One and Dhan cards now have **Connection: Broker API | MCP server**. With **MCP server**, the app talks to the broker's MCP server the same way it talks to Zerodha's Kite MCP: it passes your saved account details, finds the server's holdings and profile tools, and syncs into the same holdings table. **Sync holdings** uses whichever connection is selected; you can switch back to Broker API at any time.

**Dhan.** Dhan publishes an official MCP server ([docs.dhanhq.co/mcp](https://docs.dhanhq.co/mcp/)). Copy its server URL from Dhan's MCP installation page into the card and press **Save URL**, then **Connect**.
- If the server uses the standard MCP login (OAuth), a Dhan consent page opens. After you approve, it returns to `http://localhost:4173/api/brokers/mcp/callback` and the card turns "MCP connected".
- Your saved client ID and access token are also sent as `client-id` / `access-token` headers, for servers that take a token instead.

**Angel One.** Angel One does not publish an MCP server. You have two options:
- **Hosted:** enter the URL of an MCP server you run.
- **Local:** set a command in `.env` to start one on this computer, e.g. `ANGEL_MCP_COMMAND=python -m angelone_mcp.server` for the community [pyalgobot/angelone-mcp](https://github.com/pyalgobot/angelone-mcp) (`pip install` it first). The saved API key, client ID, PIN and TOTP secret are passed to it as `ANGELONE_API_KEY`, `ANGELONE_CLIENT_CODE`, `ANGELONE_PIN`, `ANGELONE_TOTP_SECRET` (and `ANGEL_*`). If it reports "not logged in", the app calls its `login` tool first. Review any community server's code before running it: it receives your credentials, and most can also trade (this app never calls those tools, but the server has the ability).

**How it connects:**
- **Transports:** Streamable HTTP (JSON or SSE replies, session ids) and stdio (a local process; newline-delimited JSON-RPC). A URL wins over a command if both are set. `DHAN_MCP_URL` / `ANGEL_MCP_URL` / `DHAN_MCP_COMMAND` work in `.env` too. Commands can only come from `.env`, never from the browser.
- **Logins supported:** MCP OAuth (protected-resource discovery, dynamic client registration, PKCE S256, refresh tokens); a Kite-style `login` tool that returns a link (the link is shown in the card); and servers that log themselves in from the details you saved.
- **Read-only guard** (`isReadOnlyTool` in `broker-mcp.mjs`): only `get_`/`fetch_`/`list_`/`search_`/`view_` tools and a login tool can run. Anything mentioning orders, trades, GTT, alerts, funds transfer, margin, convert, exit or similar is refused before a request is made. **Show tools** lists every tool the server offers, marked usable or blocked.
- **Data:** holdings in Angel, Dhan, Kite or Groww field formats are recognised. A server that returns plain text instead of JSON gives a clear error. Holdings without prices are valued like the Dhan REST case (another broker's live price, else the watchlist price, marked `*`).
- **Storage:** MCP session ids and OAuth tokens are kept in `data/broker-mcp.json` (git-ignored, mode 600). **Disconnect** forgets them.
- **Security fix in this version:** every request that changes data must now come from the app's own page (`Origin` check). Previously another website open in your browser could have posted to `localhost:4173`. That mattered more now that a saved server URL receives your tokens.
- **`.env` fix:** a value made of several quoted parts (a command line such as `"C:\Program Files\Python\python.exe" -m pkg`) is no longer mangled.
- **Verification status:** `npm test` (93 tests) runs both connections against fake servers. For Dhan, a hosted MCP server with OAuth (PKCE checked, forged state rejected, account headers present). For Angel One, a local stdio server that needs its own login, plus a Kite-style login-link server; in both cases the trading tools stay blocked. The browser flow was also run end to end, including the consent tab and the callback, for both brokers. It was **not** run against Dhan's real MCP server, whose exact URL, login method and tool names are not public in a form this build could read. If its holdings tool has an unusual name or format, the card says which tools it found. Send me that list and the mapping is a one-line change.
