# MarketPulse 📈

**A free, mobile-first dashboard for the Indian stock market**: live indices and prices, market insights through the trading day, stock signals with paper trading, portfolio tracking for stocks and mutual funds, IPOs, an events calendar, an AI-written daily blog, and a crypto paper-trading bot.

🌐 **Live site:** https://tradesutra-chi.vercel.app

> MarketPulse is for information and education only. It is **not investment advice**. Signals and trading features are **paper trading only**: no real orders are ever placed with a broker.

---

## Contents

- [Features](#-features)
- [How it is built](#-how-it-is-built)
- [Data and automation](#-data-and-automation)
- [Repository layout](#-repository-layout)
- [Database](#-database-supabase)
- [Blog generator](#-blog-generator)
- [Setup and deployment](#-setup-and-deployment)
- [Configuration and secrets](#-configuration-and-secrets)
- [Notes and limits](#-notes-and-limits)

---

## ✨ Features

### 🏠 Home dashboard (`index.html`)
- **Two price tickers**: the market ticker, plus a **"My stocks"** row of the user's own stocks (edited on the *My Ticker* page).
- **Index cards** for Nifty 50, Nifty Bank, Sensex, Bankex, Midcap 50 and Fin Service, each with an intraday sparkline, previous close and day range.
- **GIFT Nifty** strip (NSE IX near-month future, with premium or discount vs Nifty) and an **India VIX** tile with a calm / normal / nervous / high-fear label.
- **Your portfolio** card: total value, invested, P&L, and **today's change shown separately for stocks and for mutual funds**. Mutual funds are labelled with their NAV date, because funds publish one NAV a day.
- **Live Market Insights**, refreshed every 15 minutes during market hours (09:15–15:30 IST). Each refresh produces a set of insight cards:
  - market pulse, and breadth vs the index (e.g. "narrow rally")
  - sector leaders and laggards, and large-cap movers
  - unusual volume, and 52-week highs and lows
  - results today and how stocks are reacting
  - active trade signals and global cues

  The panel also shows a Nifty timeline, an "as of" time and a 🔊 **Listen** (read-aloud) button. After the close it shows the day's final insights until the Daily Wrap is published, then switches to the latest blog articles.
- **🎯 Top Signals**: the best 3 stock signals still in their entry zone, ranked by quality (see [Stock Signals](#-stock-signals-stock-signalshtml)). Signed-out visitors see a sign-in prompt.
- **Market heatmap** (Nifty 50 / Top 100 / Top 500), top gainers and losers, market breadth, FII/DII flows, global indices, crude oil impact, and a news feed with sentiment tags.
- **Global Market page** (`index.html#global`, `global-market.js`): a rule-based "global cues for India" read (GIFT Nifty, US futures, Asia, Brent, rupee, US 10-year yield, VIX), a market clock (Sydney to New York, in opening order) showing for each exchange whether it is open, "opens in" / "closes in" countdowns and its session in IST (daylight saving handled; the next exchange to open is highlighted; holidays not known), with the same open/close times on every index row, open markets listed first in every section (closed ones below, soonest to open first; sections with a live market move up), gold (₹/10 g) and silver (₹/kg) in rupees estimated from the international price × USD/INR plus the import duty (`DUTY` in `global-market.js`, currently 15%) with the 3%-GST and duty-free figures alongside, US / Asia-Pacific / Europe indices, currencies and yields, commodities and crypto with 5-day trends and a note on why each matters for India, plus global headlines. Refreshes every 30 seconds; the "Updated" pill shows a countdown to the next refresh on this page. Data: `global_market()` (`supabase/global-market.sql`).
- **My Watchlist on Home** (`home-watchlist.js`): the signed-in user's watchlist, shared with the ☆ button on the stock card, the My Watchlist window and ☆ Watch on Stock Analysis. Summary (average move, up/down, best and worst today, signals and events), and per stock: 1-month trend line, price and day change, today's range, 52-week range and distance from the high, trend vs the 50/200-day averages, volume spikes, active Stock Signals trades and results or ex-dividend dates within 7 days. Shown as swipeable cards (4 per view on desktop with arrows, one card plus a peek on phones), sortable by added, today, 1 month or A–Z. Data: `watchlist_details()` (`supabase/watchlist-details.sql`).
- **News tab on the stock card** (`stock-news.js`, also used on Stock Analysis): MarketPulse's impact-tagged news for the stock, the latest headlines (Google News, last 14 days) and the company's NSE filings, from the `stock-news` Edge Function (cached 15 minutes).
- **Stock search**, with a detail card showing:
  - live quote and key metrics
  - **quarterly results from NSE filings** (last 8 quarters with YoY growth)
  - Yahoo trailing fundamentals
  - a **price history chart** (1D, 1W, 1M, 3M, 6M, 1Y)

### 📊 Portfolio (`portfolio.html`)
- Stock holdings from manual entries or a broker file import (CSV / Excel).
- **Mutual funds**, entered by hand or imported from a **CAS statement** (CAMS / KFintech PDF, parsed in the browser by `cas-parser.js`). Live NAVs come from the `mf-data` function.
- Day change and P&L per holding, a stocks vs funds split, allocation, and insights (asset mix, best and worst, concentration).

### 💰 Money (`money.html`, `money.js`): personal finance manager, private to each login
- **Month view:** income, plus a planned vs actual budget per category. Each bar has a pace marker showing where spending would be at an even rate through the month, with on-track, ahead-of-pace, over and unplanned flags. Copy last month's plan in one tap.
- **Key numbers:** planned spend, spent so far, left to spend (with a "safe per day" figure), and amount saved with savings rate. Investment categories are tracked separately from spending.
- **Insights:** overspent categories, a month-end projection at the current pace, spending with no plan, bills due soon or overdue, and goal set-asides.
- **💼 Income from many sources:** salary, rent received, freelance, business, dividends, interest, pension, bonus, gift, refund or other.
  - Recurring income (amount and pay day) shows in every month as *expected* until marked **✓ Received**, at the actual amount and date. You can skip a month, change it from now on, or stop it.
  - One-off income (a bonus, a gift) belongs to just that month.
  - The headline shows received vs expected, and savings use income received, or expected when nothing has arrived yet.
  - An insight flags expected income that hasn't arrived.
  - Tables: `pf_income_sources` and `pf_incomes`. The earlier single monthly income was moved over automatically.
- **Quick add:** amount, category chips, date, payment method, note, and a ⭐ Major expense flag. Major expenses get their own yearly list.
- **Bills & EMIs:** due day, paid, due-soon or overdue status, and Mark paid (records the expense, undoable).
- **Major expenses & goals:** target, date, saved so far, the monthly set-aside needed, and "Mark bought" (records it as a major expense).
- **Charts and records:** a donut of where the money went, a 6-month planned vs spent chart (tap a month to open it, with a table view), and a searchable transaction list you can edit, filter by category and export to CSV.
- **Data:** `supabase/money.sql` (`pf_categories`, `pf_income_sources`, `pf_incomes`, `pf_budgets`, `pf_transactions`, `pf_bills`, `pf_goals`; `pf_months` is legacy). Every table has row level security on `user_id = auth.uid()`, so each user sees only their own data. Signed-out visitors see a login invitation.

### 📈 Stock Signals (`stock-signals.html`)
- **Swing and intraday technical setups** (20-day breakout, trend pullback, bear trend pullback) across ~220 NSE stocks, refreshed every 5 minutes.
- Each signal shows entry, stop, targets (1.5R / 2R), RSI, volume and the reasons it fired.
- **Paper trading account**:
  - place, manage and exit simulated trades
  - stops and targets are checked server-side every minute
  - target 1 books half the position
  - intraday trades are squared off at 15:20 IST
- **Top Signals** quality ranking (`stock_signals_top()`):
  - **Tradable only:** price between stop and target 1, not more than 0.5R past entry, at least 1.2R left to target 1, market cap ≥ ₹1,000 Cr, stop ≤ 6%.
  - **Ranking:** strategy score, plus bonuses for volume, entry position, reward left, market direction, stop size and company size, minus a penalty for chasing (RSI > 75 on buys, < 25 on sells).
  - Only signals with quality ≥ 120 are shown.
- Requires sign-in. Links like `/stock-signals.html?sig=SYMBOL|swing` open a signal directly.

- **Signals are fixed once issued** (`supabase/signal-log.sql`):
  - The scanner rewrites `stock_signals` every 5 minutes. `signal_log_sync()` (pg_cron `signal-log-sync`, every minute) issues each new setup into `signal_log` with frozen entry, stop and targets.
  - Each signal gets an expiry: intraday at 15:20 IST the same day; swing at the close of the 5th trading day.
  - It is tracked on live prices and closes at the first of stop, target 1 or expiry. If stop and target are hit in the same check, the stop counts.
  - A later setup in the same stock is a new signal.
  - The Signals page, Home's top signals, Analysis and the bell all read the active signals, which show their issue time, expiry and result since issue.
- **History → Signal record** (`signal_history()`): every closed signal with its outcome (target, stop, expired), result in % and R, win rate and average R, filterable by swing or intraday and by outcome. "My paper trades" keeps your own trade history.
- **F&O filter** on the Signals tab and the Signal record: shows only stocks with NSE futures & options (`is_fno` in the feed, `stocks.is_fno` for the record; win rate and average R are recomputed for F&O stocks). F&O signals carry a badge; the choice is remembered in the browser.

### 🧭 Sector Analysis (`index.html#sectors`, `sectors-page.js/.css`)
- **Trade with the sector** (the use case): sectors are used as a *filter* on stock trades, not as a buy signal. A sector is **strong** when its index is above its 50-day average and has beaten the Nifty over the past month, **weak** when it is below and behind. The panel lists breakouts (close above the previous 20-day high, above the 50-day average) in strong sectors, stocks close to a breakout, the signal scanner's BUY ideas tagged with their sector's state, and breakouts to skip in weak sectors (`sector_trade_setup()`, `supabase/sector-trades.sql`).
  - **Does this work?** `sector_trade_evidence()` re-runs the test every day on the stored daily bars: Jun–Oct 2026, ~200 scanner stocks, 20 trading days later, breakouts in strong sectors went up 46% of the time (avg −0.1%) vs 35% (avg −2.5%) in weak sectors, in a market where the Nifty averaged −2% per 20 days. The rotation phase on its own showed no edge over 20 months of index data, so it is shown only as context.
  - The scanner's daily bars are archived into `stock_price_history` (pg_cron `swing-bars-archive`) so the test grows beyond the scanner's ~130-day cache.
- **Market read**: a plain-English verdict (e.g. "Relief rally in a weak market") from today's breadth, the share of stocks above their 50- and 200-day averages and stocks near 52-week highs vs lows, with gauges and the reasons.
- **Sector scoreboard**: the 20 NSE sector indices against the Nifty 50 over Today / 1W / 1M / 3M / 6M / 1Y, with the gap to the Nifty, trend (above the 50/200-day average), distance from the 52-week high, a 3-month chart and the rotation phase. Click a row for that group's stocks.
- **Rotation map**: relative strength vs the Nifty (price ratio over its 3-month average) against its 10-day momentum, in four quadrants (Leading, Weakening, Lagging, Improving) with a 4-week trail.
- **Breadth & valuation by sector**: for each broad group, market-cap-weighted move, up/down, % above the 50/200-day averages, near highs/lows, median P/E, volume vs normal and top gainer/loser; click for the stocks (`sector_group_stocks()`).
- **Today's sector signals** (crude impact, defensive vs risk-on, is the move confirmed) in tabs, and every industry in a collapsible table.
- Groups: NBFCs now count as Financial Services (they were matched as banks), and new listings with no NSE industry get a group guessed from the company name (`mp_stock_group()`). Stocks with no trade in 10 days or a move outside NSE's 20% band (stale quotes) are left out of breadth and averages.
- Data: `sector_dashboard()` (`supabase/sector-dashboard.sql`), daily index closes in `sector_index_history` from the `sector-history` function. Seven indices Yahoo has no history for (Media, Private Bank, Oil & Gas, Healthcare, Consumer Durables, Commodities, Services) show "—" for longer periods until their history builds up day by day.

### 🔍 Stock Analysis (`stock-analysis.html`)
- **TradingView Lightweight Charts** price chart (open source, Apache 2.0, loaded from jsDelivr `lightweight-charts@4.2.0`; the small TradingView logo on the chart is the attribution its licence asks for): candles or area, volume, EMA 20/50, SMA 200, Bollinger Bands, support / resistance, and the Stock Signals scanner's entry / stop / targets when it has a live setup. Pinch or scroll to zoom, drag to pan (a vertical swipe still scrolls the page); range buttons set the window and live updates keep your zoom; follows light / dark. Falls back to the built-in SVG chart if the library can't load. Both charts end on today's candle, built from the live quote (`stock_quotes`) because the daily-history feed stops at the last completed session.
- Indicators: RSI, MACD, Bollinger Bands, ADX, support and resistance, plus fundamentals for any NSE stock.
- **Sector state badge** next to the sector (Strong / Neutral / Weak sector, the Sectors page's trade filter) and a **sector check** under the Risk plan saying what the state means for a buy, from `stock_sector_state()` (`supabase/sector-trades.sql`). Stocks whose group has no NSE sector index (e.g. Defence) say so.
- **All signals** list: the same BUY / WAIT / SELL rules run across the ~220 stocks the signals scanner follows (daily bars from `analysis_scan_bars()`, `supabase/analysis-scan.sql`), with Buy / Sell / Wait tabs, an "F&O stocks" filter (NSE futures & options stocks from `stocks.is_fno`, remembered in the browser; F&O stocks carry a badge), search, and sorting by score, signal, symbol or company (A–Z), price, day / 1-month / 3-month change, RSI, sector or market cap, either direction. Strong scanner setups upgrade WAIT as on the single-stock view.

### 🧮 Stock Screener (`screener.html`)
- Filters every NSE stock with a recent quote by **P/E, P/B, ROE, ROCE, market cap, dividend yield, 52-week high/low, volume spike, trend (50/200-day averages), today's move, sector and F&O**.
- Ready-made screens: quality at a fair price, large caps in uptrend, near 52-week high/low, volume spikes, high dividend, value picks, today's gainers.
- Data comes from one call to `stock_screener()` (`supabase/stock-screener.sql`); filtering and sorting run in the browser. Filters are kept in the URL, so a screen can be shared, and results download as CSV.

### ✨ Festive Picks (`picks.html`)
- **5 large-cap, 5 mid-cap and 5 small-cap stocks for the next 12 months**, published for each occasion: Diwali, New Year, Holi, Akshaya Tritiya, Independence Day (dates in `pick_occasions`, `supabase/festive-picks.sql`; add or move occasions there).
- Picked by the `festive-picks` Edge Function from our own data:
  - quality (ROE/ROCE);
  - value against the stock's own industry P/E;
  - a healthy trend (no falling knives);
  - liquidity;
  - the latest quarterly results from NSE filings (shrinking or loss-making businesses are dropped; half-year figures and growth off a loss are detected rather than taken at face value);
  - one stock per sector per size bucket.
- Each pick has a 12-month model target (forward EPS × fair P/E), the reasons, the key risks and the target maths. There is also a market note, a valuation table and a festive banner themed per occasion.
- **Live track record:** return since the pick for each stock and the basket against the Nifty 50, plus targets hit. Published picks are locked, never re-picked. Earlier occasions stay in the tabs, and upcoming ones show a countdown.
- **💰 Investment calculator:**
  - Enter an amount (or tap ₹25k to ₹10 L) and choose a split: equal in each stock, Balanced 60/25/15, Conservative 75/20/5 or Aggressive 40/30/30 across large, mid and small caps. Size groups can be left out.
  - It works out whole shares of each stock at live prices and spends the leftover one share at a time on the most under-weight stock.
  - A stock whose single share is too expensive for its slice is skipped, and its money goes to the same size group so the split holds. The page says how much you'd need to hold all 15.
  - Shows the amount invested, cash left, value at targets, estimated charges and the split by size.
  - Copy the order list or download it as CSV. The amount and split are remembered on the device.
- **⬇ Download** (on the banner), drawn in the browser by `picks-export.js` with no libraries; each design follows the occasion's theme (diyas and marigolds, fireworks, Holi colours, gold coins, the tricolour):
  - **Poster image:** 1600×1000 PNG of all 15 picks.
  - **Phone story image:** 1080×1920 PNG for WhatsApp status and Instagram stories.
  - **PDF report:** 11-page A4, with a cover and market note, the picks at a glance with a valuation table, two stocks per page (reasons, risks, data, target maths), and how we pick.
  - **Share:** on phones that support it, sends the story image straight to an app.
  - **Branding:** every download carries the MarketPulse logo (the favicon's indigo tile and gold diamond, redrawn as vector art): a "Picked by MarketPulse" badge, a sign-off panel with the live track-record address, and "MarketPulse" as the PDF author. The PDF links back to the picks page from every footer.
- Runs daily at 08:41 IST from pg_cron; admins can also run it from Data health → Run now. Educational, not investment advice (disclaimer on the page).

### 🔔 Notifications bell (every page, `notify.js`)
- A bell in the header with a red badge counting what's new since you last opened it (remembered per device, no sign-in needed). It covers:
  - festive picks published, and a reminder the day before they go out;
  - **strong trade signals**, the same high-quality, tradable setups as Home's top signals;
  - festive picks reaching their targets;
  - IPOs opening or listing today;
  - site updates and new features.
- The panel has filters for Picks, Signals, IPOs and Updates, plus "Mark all as read". If something new arrives while a page is open, a small pop-up appears.
- Data: `site_notifications` (`supabase/notifications.sql`), filled every 5 minutes by `mp_capture_notifications()` (pg_cron job `notifications-capture`; each event is recorded once) and read through `site_notifications_feed()`.
- Admins post an announcement with `admin_post_notification(title, body, url, icon)`.

### ⇅ F&O Option Chain (`fno.html`)
- Option chain for Nifty, Bank Nifty, Fin Nifty, Midcap Nifty, Nifty Next 50 and every F&O stock, any expiry.
- Worked out for you: **PCR** (OI and volume), **max pain**, **support / resistance** (largest put OI at or below spot, largest call OI at or above it), **ATM IV** and the **expected move** (ATM straddle).
- Open interest / change-in-OI chart by strike, the chain table with ITM shading and the spot line, and a plain-English summary and glossary.
- Data: the `option-chain` Edge Function (NSE's option-chain API, cached a minute). Refreshes every minute in market hours.

### 🩺 Data Health (Admin Panel → Data health tab, `admin-health.js`, admins only)
- One page that shows whether every data feed is working: Indian and global quotes, stock quotes and coverage, sector indices, daily price history, FII/DII, news, global headlines, crude, live insights, events, IPOs, the economic calendar schedule, the signals scanner, background job heartbeats and pg_cron failures (from `data_health()`).
- Each check knows what to expect at that moment (strict in market hours, last session's data otherwise), so nights and weekends don't raise false alarms.
- Live checks call each backend function from the browser (GIFT Nifty, option chain, index history, stock data, stock news, MF NAVs, global market data) and the published blog posts are checked against the expected dates. Data Health also checks GIFT Nifty's last trade time during its sessions.
- **▶ Run now** on each check that is backed by a background job re-runs that job straight away (`admin_run_job()` in `supabase/admin-run-job.sql`). Manual runs pass `force=1` so they skip the "refreshed recently" / market-hours throttles, the reply is shown under the button, and the checks are re-run afterwards. Only allowlisted data jobs can be run (trading bots and clean-up jobs are excluded), at most once per 30 seconds; the cron secret never leaves the database and each run is logged in `admin_job_runs`.
- A tab in the Admin Panel (`admin-news.html#health`) with a badge counting problems; re-checks every 2 minutes. `admin-health.html` redirects there.

### 📅 Events Calendar (`events.html`)
- **Economy events** alongside company events: RBI policy decisions, India CPI and GDP, the Union Budget, US Fed (FOMC) decisions and US CPI, with IST times, what each one is and how it tends to move Indian markets. Kept in `econ_events` (`supabase/econ-events.sql`); dates not read from the official calendar are marked "Expected date". Add new dates (e.g. the next RBI or Fed calendar) by extending that file and re-running it.
- Upcoming and recent **results, dividends, bonus, splits, buybacks and fund-raising** from the NSE event calendar and corporate actions.
- **Latest price and today's change** next to every company in the list, on calendar chips (desktop; in the tooltip on phones) and in the event window, from `stock_quotes`, refreshed every 2 minutes. A stock with no trade in 10 days shows its last traded price marked "old".
- **After results**, each company gets:
  - the quarter's numbers vs the previous quarter and a year ago (from NSE's XBRL filings)
  - the share-price reaction
  - a positive / negative / mixed verdict with the reasons, and related signals
- Calendar and list views, filters, and a detail window.

### 🆕 IPOs (`ipo.html`)
- Open, upcoming and closed IPOs (mainboard and SME): price band, lot size, dates, category-wise subscription and **grey market premium (GMP)** with estimated listing price.

### 📰 Blog (`/blog/`)
- Four automatic posts every trading day:
  - **Daily Wrap**
  - **Sector Analysis**
  - **Stock Spotlight**, an unusual mover
  - **FII/DII Flows**
- Written with the **Moonshot (Kimi) API** from the day's market data, capped at 500 output tokens per post. Every number in the AI text must match the data, otherwise the post uses a plain template (see [Blog generator](#-blog-generator)).
- 🔊 **Listen** button on every article. It reads only the article text, using the browser's built-in speech engine with an Indian English voice where available.

### 🪙 Crypto (`crypto-signals.html`)
- Crypto **paper-trading bot**:
  - signals with confidence scores
  - automatic trades and live P&L
  - daily-loss and losing-streak limits
  - a **loss circuit-breaker** that pauses trading when recent results turn negative, with "shadow trades" tracked meanwhile
- Performance tab: win rate, average win and loss, equity curve, and findings.

### 🧩 Site-wide
- Shared header and phone bottom navigation (`site-header.js`), dark and light themes, and an installable PWA (`manifest.json`, service worker).
- **"Updated n s ago" pill** (`refresh-stamp.js`) pinned on Home, Portfolio and Signals. Tap it to refresh immediately.
- **Outside links never open a new tab** (`link-viewer.js`). Sites that allow it open in an in-site viewer; the rest open in the same tab, so Back returns to MarketPulse.
- **Sign-in** with email and password. **Google** and **phone number (SMS code)** buttons appear automatically once those providers are enabled in Supabase (`auth-extra.js`).
- Profile with name and photo, watchlist, price alerts, and an admin panel for news and users.

### White-label mode

The whole site can run under another firm's name, for demos to prospects or for a client's own deployment (`brand.js`, loaded first in every page's `<head>`, and `brand-studio.html`).

- **What changes:** the brand name everywhere it appears (page text, titles, tooltips, meta tags), the logo and favicon (an uploaded logo, or a monogram tile), the main colours, which sections are offered (hidden ones leave the menus and their pages redirect to Home), and the festive-picks poster, story and PDF (`picks-export.js` reads `window.MP_BRAND`).
- **SEBI details:** with a registration number, every page gets a footer with the entity, SEBI registration type and number, BSE enlistment, address and contacts, the grievance officer, links to SEBI SCORES and SMART ODR, and the standard SEBI wording ("Registration granted by SEBI … no assurance of returns", "Investment in securities market are subject to market risks …"). "Not SEBI-registered" lines on the site become the firm's registration line.
- **Brand Studio** (`/brand-studio.html`, MarketPulse admin only: linked as "🎨 Brand Studio" in the Admin Panel, and the page and the database both check it): fill in the name, monogram, logo, colours, registration and contacts and the sections to offer, with a live desktop and phone preview of Home, Signals, Picks, Analysis and Screener. It gives a **demo link** (`?wl=…`, the whole brand travels in the link).
- **Client sites, no GitHub editing:** in Brand Studio, give a brand a short name (slug) and the client's domain(s) and press **Save & publish**. The brand is saved on the client's `tenants` row (`supabase/brand-studio.sql`), and the `brand-publish` Edge Function writes every live client brand into **`brands.js`** and commits it to `main` with the `GIT_HUB_ACCESS` token, so Vercel deploys it in about a minute. Every page loads `brands.js` just before `brand.js`. The client list shows each client's state (Live / Not published / Off), domains, users and last publish, with **Edit**, **Demo** and **Delete** (a client with no users is removed; one with users is switched off and its accounts kept). Still by hand, once per client: add the domain in Vercel, point DNS at it, and add it to Supabase Auth's redirect URLs.
- **Demo links** apply only in that browser tab and always show a "Demo · <name>" pill (its ✕ only shrinks it to a small "Demo" tag; there is no link back to MarketPulse) and a note that the details were entered for a preview and are not verified, so a link can't pass the site off as a real firm. To leave a demo, close the tab or open any page with `?brand=reset`.
- **A client's domain** always shows their brand (no pill); `?brand=<slug>` also selects a published brand. Each client and demo site keeps its login under its own storage key (`MP_AUTH_KEY`), so a demo link opened in the same browser never touches the main-site login.
- **Sample data for demos** (`sample-data.js`, loaded right after `brand.js`): on a demo link (unless its brand switches "Demo links use sample data" off) or with `?sample=1`, the site's data requests to Supabase and the Worker are answered from a saved snapshot of real responses in `sample/`, so a prospect always sees a full, working site, at any hour, without touching the live feeds. A request with no saved answer goes to the live service (sign-in and a user's own data always do); `?sample=0` turns it off for the tab. The snapshot is recorded by `scripts/demo/record.mjs` in the **"Demo sample data"** GitHub Action (`.github/workflows/demo-data.yml`): it serves the repo, opens every page in Chromium as a signed-out visitor (plus 12 popular stocks, Home's stock cards and the Signals page's public data) and commits each successful response. It runs every Saturday morning, when the recorder changes, and from Brand Studio's **Refresh sample data** button (`brand-publish?action=sample`). Brand Studio shows when it was last recorded.
- **Separate users per client** (`supabase/tenants.sql`): every account belongs to one site (`marketpulse`, `demo` for demo links, or a client's slug), stored in the login token's `app_metadata.tenant`, which only the server can set. On client and demo sites `brand.js` adds an `x-mp-tenant` header to every Supabase call, and a restrictive "same site only" policy on every table of personal data (portfolios, Money, watchlist, alerts, paper trades, crypto, ticker, profile) lets a request through only when the two match. Sign-ups are tagged with the site; a Google / phone account claims the site on its first sign-in (`claim_tenant()`); an account from another site is signed out with a short message. The main site sends no header (a missing one counts as `marketpulse`). Saving a client in Brand Studio creates it; **`/admin-clients.html`** (linked from the Admin Panel) shows every client with user counts, users and admins; a client's admins see only their own users, on their own site. Logins are one pool per Supabase project, so an email can hold one account on one site.
- The client must review the Terms, Privacy Policy and disclosures themselves; the name is swapped into the existing pages. Not covered yet: the manifest / installed-app name, emails sent by Supabase Auth, and blog posts' fixed text in RSS.

---

### 📈 Options Paper Desk (Signals page → **Options** tab, platform admin only, paper only)
- The **Options** tab on `stock-signals.html` is created only after `mp_is_platform_admin()` confirms the signed-in user is the admin; other users and logged-out visitors never get the tab or its code (`options-desk.js/.css` load on first open), and `options_paper_feed()` refuses non-admins anyway. `?tab=options` opens it (the Admin Panel's 📈 Options Desk link). `admin-options.html` shows the same desk on its own page.
- The Stock Signals scanner's BUY / SELL signals on **F&O stocks** turned into **defined-risk debit spreads** and paper-traded at real NSE option prices by the `options-signals` edge function (pg_cron `options-signals`, every 15 minutes 9:30 AM – 3:15 PM IST on weekdays).
  - BUY → bull call spread (buy the at-the-money call, sell the call at the strike nearest target 1); SELL → bear put spread. One lot, one spread per stock.
  - **Nifty and Bank Nifty** get their own signals (the scanner has none for indices), checked from 2:45 PM IST on daily closes (`sector_index_history`) plus the live level: BUY on a pullback in an uptrend (20-day avg above the 50-day, the index below its 20-day avg but above its 50-day, and under its lowest close of the previous 4 days), SELL on the mirror image; stop 1.5× and target 2.5× the 14-day average daily move. Tested on ~21 months of closes: 81 signals, target first 38, stop first 32, +0.71× the daily move per signal (a 20-day breakout rule tested the same way was ~0, so it isn't used). No sector filter; at most one signal per index per day. `?dry=1&sim=NIFTY:BUY` pretends a signal fired, to test the spread builder.
  - Skipped (with the reason logged) when: the sector is weak (Sectors page filter), no expiry has 14–70 days left, a leg has no live bid/ask, the bid-ask spread is over 12% (bought leg) / 20% (sold leg), open interest is under 50 contracts, IV is over 1.6× the 20-day historical volatility, or the maximum profit is under 0.8× the maximum loss.
  - **Cap** (editable on the desk, `option_paper_settings`): maximum open spreads (default 10), maximum total at risk (default ₹1.5 lakh, the sum of each spread's maximum loss × lots), lots per new trade, and an auto-open switch. When the cap is full the engine stops opening; free slots go to Nifty / Bank Nifty signals first, then strong-sector stocks, neutral, no sector index, then by scanner score.
  - **Manual controls** like Stock Signals: **Exit now** (live prices; after hours at the last mark), **Edit** (stop, target, lots), **Delete**, **Take** on a dry-run candidate (opens it at live prices even over the cap; marked "Taken by hand"), **Clear closed** and **Clear everything** (spreads and log; settings kept). Exit / Take go through the edge function (`?action=exit&id=`, `?action=take&symbol=`); the rest are admin-only RPCs `options_paper_settings_set / _edit / _delete / _clear`.
  - Fills are conservative (buy at the ask, sell at the bid); brokerage and taxes are not included. Lot sizes come from NSE's daily `fo_mktlots.csv` (`fno_lots`).
  - Closed when the stock hits the signal's stop, reaches target 1, the spread is worth 80% of its width, or 2 days before expiry.
- The desk shows each open spread as a plan (strikes, cost = maximum loss, maximum profit, breakeven, stock vs stop / target, live mark), closed spreads, win rate and P&L, every engine decision, and **Run now** / **Dry run** buttons. Linked from the Admin Panel (📈 Options Desk).
- Not shown to users: options trade ideas for the public need SEBI research-analyst registration. There is no back-test (no stored option prices), so it is judged on its paper record.
- Data: `option_paper_trades`, `option_signal_log`, `fno_lots`, `options_paper_feed()` (`supabase/options-paper.sql`).

### Sales (selling the white-label platform)

- **Sales Desk** (`/admin-sales.html`, MarketPulse admin only, linked as "🤝 Sales Desk" in the Admin Panel): every SEBI-registered research analyst is a lead (`sales_leads`, `supabase/sales.sql`), imported from SEBI's public register by the `sales-import` Edge Function (name, registration no., contact person, email, phone, address, city; ~2,330 entries) and ranked by fit (`sales_fit()`: independents and small firms with a reachable email first; banks, brokers and AMCs last). Tabs: **Today** (follow-ups due, then the best uncontacted leads), **Pipeline** (search and filter by stage / type), **Templates & playbook** (pricing, cadence, 3 emails, WhatsApp, LinkedIn, call script, demo agenda, personalised per lead) and **Import & settings** (your signature, re-import from SEBI). A lead's panel has **Make demo** (the whole site under the prospect's name with their SEBI registration in the footer, via a demo link), one-click personalised email and WhatsApp that log the touch and schedule the next follow-up (day 3, 7, 12), call / LinkedIn / demo logging, stage, plan and fee, notes and history (`sales_activities`).
- **Pitch page** (`/for-advisors.html`, linked "For research analysts" in the footer; hidden on client sites): features, built-in compliance, 48-hour onboarding, pricing (Founding Partner ₹4,999/month for the first 10 clients; Starter ₹6,999 + ₹14,999 setup; Pro ₹14,999 + ₹24,999 setup; Enterprise from ₹39,999; before GST; annual = 2 months free), FAQ and a demo form (`submit_demo_request()`) that shows the visitor their own branded demo at once and lands in the Sales Desk as a warm lead.

## 🏗 How it is built

```
 Browser (static HTML/CSS/JS on Vercel)
   │   supabase-js: RPCs, tables (row-level security), auth
   ▼
 Supabase
   ├─ Postgres: quotes, signals, insights, events, portfolios, trades …
   ├─ pg_cron: schedules every refresh job (and the blog dispatch)
   ├─ Edge Functions (Deno): fetch NSE / NSE IX / Yahoo / AMFI / news, run the bots
   └─ Auth: email, Google, phone OTP
   │
   ▼
 GitHub Actions ── blog generator (Node) ── Moonshot API
   └─ commits new posts to main ──► Vercel redeploys
```

- **No framework, no build step.** Every page is plain HTML with its own JS and CSS, deployed as static files by Vercel on each push to `main`.
- **Supabase** does all data work: scheduled jobs collect market data into tables, and pages read them through public RPCs or row-level-secured tables.
- Nothing is committed or redeployed for live data. Only blog posts are committed, once per post per day.

---

## 🔄 Data and automation

### Scheduled jobs (pg_cron, times in UTC)

| Job | Schedule | What it does |
|---|---|---|
| `index-refresh` | every minute + every 30 s | Indian indices every minute. Global markets, US futures, Asian and European indices, VIX, US yields, currencies, commodities and crypto every 30 seconds (`?fast=1`, Yahoo batch quotes), with last trade times added every 5 minutes (`index_quotes`) |
| `sector-refresh` | every 3 min | Sector indices and ~2,600 stock quotes (`sector_index_quotes`, `stock_quotes`) |
| `options-signals` | every 15 min, 04:00–09:45 Mon–Fri | Options Paper Desk: opens, marks and closes paper debit spreads from the scanner's F&O signals |
| `swing-bars-archive` | 11:15 and 16:15 Mon–Sat | Copies the signal scanner's daily bars into `stock_price_history` (`archive_swing_bars()`) for the sector trade test |
| `sector-history` | 10:50 Mon–Fri (4:20 PM IST) | Daily closes of the sector indices and the Nifty 50 for the Sectors page (`sector_index_history`) |
| `stock-signals-refresh` | every 5 min | Rebuilds swing and intraday signals (`stock_signals`) |
| `stock-paper-monitor` | every minute | Fills stops and targets on open paper trades |
| `live-insights` | :05/:20/:35/:50, 03–10 UTC, Mon–Fri | `refresh_live_insights()`: Home's live insight cards (skips holidays) |
| `news-refresh` | every 15 min | News feed with sentiment |
| `feeds-refresh` | every 10 min | Breadth, FII/DII and other feeds |
| `ipo-refresh` | every 10 min | IPO list, subscription, GMP |
| `events-refresh` | hourly at :23 | Events calendar, pre-event data and post-results analysis |
| `crude-refresh` | every 30 min | Crude oil feed and impact |
| `stocks-sync` | 03:11 and 13:11 | Stock master list |
| `signal-log-sync` | every minute | Issues new signals into `signal_log` (frozen levels, expiry) and closes them at stop, target or expiry |
| `notifications-capture` | every 5 min | Records new strong signals, picks, targets hit and IPO days for the 🔔 bell |
| `festive-picks` | 03:11 daily | Publishes an occasion's picks on its publish date and marks targets hit |
| `crypto-bot`, `crypto-monitor` | every minute | Crypto paper-trading bot and position monitor |
| `blog-market-posts` (+ backup) | 10:09 (11:39) Mon–Fri | Dispatches the Daily Wrap, Sector and Spotlight posts |
| `blog-fiidii` (+ retry, backup) | 13:49 (15:19, 16:45) Mon–Fri | Dispatches the FII/DII post once NSE publishes flows |
| `purge-old-news`, `prune-*` | daily / hourly | Housekeeping |

### Edge Functions (`supabase/functions/`)

| Function | Purpose |
|---|---|
| `stock-data` | On-demand quote, Yahoo fundamentals and daily history (`?symbol=TCS&days=400`) |
| `stock-fundamentals` | Last 8 quarterly results from NSE integrated-filing XBRL, cached 6 h |
| `index-sparklines` | Intraday index paths, GIFT Nifty (NSE IX; the near-month contract is picked by expiry, ignoring stale rows in the feed) and India VIX |
| `mf-data` | Mutual fund NAVs |
| `stock-news` | Per-stock headlines (Google News) and NSE filings for the stock card's News tab (`?symbol=POWERGRID&name=...`), cached 15 min |
| `option-chain` | NSE option chain with PCR, max pain, support/resistance and expected move (`?symbol=NIFTY&expiry=03-Nov-2026`), cached a minute |
| `events-refresh` | Events calendar and results analysis |
| `festive-picks` | Festive picks: screens, reads results, picks 15 stocks with targets, reasons and risks (`?occasion=diwali-2026`, `?dry=1` to preview) |
| `ipo-refresh` | IPOs and GMP |
| `news-refresh` | News collection |
| `index-refresh`, `sector-refresh`, `stocks-sync` | Market data collection |
| `options-signals` | Paper debit spreads from the scanner's F&O signals (`?dry=1` to preview, `?debug=SYMBOL` for raw NSE fields; cron secret or platform admin) |
| `sector-history` | Daily closes of the NSE sector indices and the Nifty 50 from Yahoo (2 years for a new index, else the last month; `?range=` to override) |
| `crypto-bot`, `crypto-monitor` | Crypto paper-trading bot, circuit-breaker, shadow trades |
| `blog-dispatch` | Starts the GitHub Actions blog workflow from pg_cron |
| `frame-check` | Tells `link-viewer.js` whether an outside page can be embedded |
| `contact-message` | Contact form |

A few deployed functions (`feeds-refresh`, `crude-refresh`, `stock-signals-refresh`, `stock-paper-monitor`, `stock-signal-data`, `stock-signal-intraday`, `sector-data`) currently live only in Supabase and are not yet mirrored in this repo.

### Data sources
NSE (quotes, event calendar, corporate actions, integrated-filing XBRL results, FII/DII), NSE IX (GIFT Nifty), Yahoo Finance (charts, fundamentals, global markets, India VIX), AMFI (mutual fund NAVs), public news feeds, and InvestorGain (IPO GMP).

---

## 📁 Repository layout

```
├── index.html               Home dashboard (+ login, profile, admin, watchlist, alerts)
├── home-overview.js/.css    Home cards: indices, GIFT Nifty, VIX, portfolio, heatmap, movers
├── live-insights.js         Live Market Insights panel (+ read aloud)
├── top-signals.js           Top Signals card
├── portfolio.html           Portfolio (stocks + mutual funds)
├── portfolio-core.js        Shared portfolio summary (Home card, My stocks ticker)
├── cas-parser.js            CAS PDF statement parser
├── stock-signals.html/.js/.css   Stock signals and paper trading
├── stock-analysis.html      Technical / fundamental analysis
├── screener.html/.js         Stock screener
├── money.html/.js            Money: budget, expenses, bills, goals (per user)
├── picks.html/.js            Festive picks (Diwali, New Year, Holi...) with track record
├── notify.js                Notifications bell in the header (all pages)
├── picks-export.js          Festive picks downloads: poster/story PNG and PDF report
├── fno.html/.js              F&O option chain, PCR, max pain
├── admin-news.html, admin-health.js   Admin Panel: news moderation and the data health tab
├── options-desk.js/.css     Options Paper Desk (platform admin): the Signals page's admin-only Options tab and admin-options.html
├── events.html              Events calendar
├── ipo.html                 IPOs and GMP
├── crypto-signals.html, crypto-performance.js/.css, crypto-manager/   Crypto bot UI
├── sectors.html             Sector explorer
├── my-ticker.html/.js       Edit the "My stocks" ticker
├── site-header.js/.css      Shared header, nav, theme (loads link-viewer and blog read-aloud)
├── refresh-stamp.js         "Updated n s ago" pill
├── link-viewer.js           Outside links in-site / same tab
├── auth-extra.js            Google and phone sign-in options
├── stock-search.js          Shared stock search
├── admin.html, admin-news.html   Admin tools
├── privacy.html, terms.html, legal.css   Privacy Policy (DPDP Act 2023) and Terms of Use
├── blog/                    Generated posts, posts.json, sitemap.xml, read-aloud.js
├── scripts/blog/            Blog generator (Node): data, build, ai, render, generate, ai-check
├── supabase/                SQL schemas and functions (*.sql) + Edge Functions (functions/)
├── .github/workflows/       blog.yml (publish), ai-check.yml (Moonshot diagnostic)
├── data/                    Static crude-oil reference data
├── manifest.json, sw.js, marketpulse-sw.js   PWA
└── STOCK_SIGNALS.md         Notes on the stock signals module
```

---

## 🗄 Database (Supabase)

The main tables:

| Area | Tables / functions |
|---|---|
| Market data | `index_quotes`, `sector_index_quotes`, `stock_quotes`, `stocks`, `stock_swing_cache`, `market_quotes`, `fii_dii_daily`, `news`, `global_headlines`, `crude_feed` |
| Insights | `live_insights` + `refresh_live_insights()` (`supabase/live-insights.sql`) |
| Signals | `stock_signals`, `stock_signals_feed()`, `stock_signals_top()` (`supabase/stock-signals-top.sql`), `stock_paper_accounts`, `stock_paper_trades` |
| Screener | `stock_screener()`, `mp_broad_sector()` (`supabase/stock-screener.sql`) |
| Sectors | `sector_index_history`, `sector_index_groups`, `sector_dashboard()`, `sector_group_stocks()` (`supabase/sector-dashboard.sql`); `sector_group_index`, `mp_stock_group()`, `sector_trade_setup()`, `sector_trade_evidence()`, `stock_price_history` (`supabase/sector-trades.sql`) |
| Fundamentals | `stock_fundamentals_cache` (`supabase/stock-fundamentals-schema.sql`) |
| Events / IPO | `market_events` (`events-schema.sql`), `econ_events` (`supabase/econ-events.sql`), `ipos` (`ipo-schema.sql`) |
| Users | `profiles` (users can only edit their name and photo), `portfolios`, `portfolio_transactions`, `portfolio_mf_transactions`, `watchlist`, `stock_alerts`, `user_ticker` |
| Crypto | `crypto_signals`, `crypto_trades`, `crypto_shadow_trades`, `crypto_bot_settings`, `crypto_bot_status`, `crypto_bot_runs`, `crypto_wallet_transactions`, `crypto_reset_trading()` |
| Internal | `app_secrets` (cron shared secret), `feed_state` |
| Admin | `data_health()` (`supabase/data-health.sql`): freshness of every feed, job heartbeats and pg_cron failures, admins only |

Row-level security is on. Users only see and change their own rows, and public market tables are read-only.

---

## 📝 Blog generator

`scripts/blog/` is run by `.github/workflows/blog.yml`, which Supabase's `blog-dispatch` starts on schedule (GitHub's own schedule also runs as a backup).

1. **`data.mjs`** loads the day's data from Supabase: Nifty, sectors, movers, breadth, FII/DII and news.
2. **`build.mjs`** builds each post: key-number tiles, tables, facts and a plain-language fallback.
3. **`ai.mjs`** asks Moonshot to write the commentary from the facts only:
   - Model: `kimi-k3.1-pro`, with fallbacks `kimi-k2.6` and `kimi-k3`.
   - Up to **500 output tokens** per post, with thinking off and temperature 0.6 (which Moonshot requires when thinking is off).
   - About 200–260 words, in a news-style story with a "what to watch" ending.
   - **Every number in the AI text is checked against the data.** Index names (Nifty 50) and indicator periods (200-day, 52-week) are allowed. Anything unverified sends the post to the template instead.
4. **`render.mjs` / `generate.mjs`** write `blog/<category>/<slug>/index.html` and update `posts.json` and `sitemap.xml`. The workflow then commits to `main`.

Each post records which writer produced it (`moonshot:<model>` or `template (reason)`).

**Run the generator locally:**

```bash
MOONSHOT_API_KEY=… node scripts/blog/generate.mjs --posts=wrap,sector,spotlight,fiidii --dry
```

**Check the Moonshot setup:** run **Actions → Blog AI check**. It lists the models your key can use and times a sample request, and publishes nothing.

---

## 🚀 Setup and deployment

1. **Frontend:** import the repo in Vercel as a static site, with no build command. Every push to `main` deploys.
   - The repo is **private**. That's fine for Vercel, but on the Hobby plan Vercel only deploys commits whose author is the account owner. If a push doesn't show up on the site, check Vercel → Deployments for a "blocked" deployment.
   - The blog token (`GIT_HUB_ACCESS`) must keep the `repo` scope so it can reach the private repo.
   - Private repos get 2,000 free GitHub Actions minutes a month; the blog workflow uses far less.
2. **Supabase:**
   - Create a project and run the SQL files in `supabase/`.
   - Deploy the Edge Functions in `supabase/functions/` with `supabase functions deploy <name>`.
   - Create the pg_cron jobs listed above (each sends the `x-cron-secret` header from `app_secrets`).
3. **Point the pages at your project:** set `SUPABASE_URL` and the publishable key in `index.html`, `portfolio.html`, `stock-signals.js` and the other pages that create a Supabase client.
4. **Blog:**
   - Add the repo secret `MOONSHOT_API_KEY` (Settings → Secrets and variables → Actions).
   - Give Supabase a GitHub token (Edge Function secret `GIT_HUB_ACCESS`) so `blog-dispatch` can start the workflow.
5. **Optional sign-in providers** (Supabase → Authentication):
   - **URL Configuration:** Site URL `https://tradesutra-chi.vercel.app`, and add `https://tradesutra-chi.vercel.app/**` under Redirect URLs.
   - **Google:** create a Google Cloud OAuth "Web application" client with redirect URI `https://<project>.supabase.co/auth/v1/callback`, then enable Google with its Client ID and Secret.
   - **Phone:** enable it with an SMS provider. Twilio Verify is the easiest choice for India, as it handles DLT rules, but each SMS has a cost.

---

## 🔐 Configuration and secrets

**Backend addresses live in one file: `site-config.js`.** It holds the Supabase project URL, the publishable key, the legacy anon key (Crypto page only) and the Cloudflare Worker address, and derives the auth storage key and Edge Function URLs from them. Every page loads it first in `<head>`, every script reads `window.MP_CONFIG`, and the blog generator imports it (`SUPABASE_URL` / `SUPABASE_ANON_KEY` env vars still override). To move the site to another Supabase project or Worker, edit that file and redeploy; nothing else in the front end changes. `config.json` is now empty (it used to repeat the Worker address and carried an unused NewsAPI key).

The backend itself still names the project in a few places that a new project recreates anyway: scheduled jobs in `supabase/events-schema.sql`, `global-market.sql`, `festive-picks.sql` and `blog-dispatch.sql`, plus jobs created directly in the database.

| Secret | Where | Used by |
|---|---|---|
| `MOONSHOT_API_KEY` | GitHub Actions secret | Blog AI text and the AI check |
| `GIT_HUB_ACCESS` | Supabase Edge Function secret | `blog-dispatch` (starts the blog workflow) |
| `crypto_cron` | `app_secrets` table | Shared secret that cron jobs send to Edge Functions |
| Google OAuth client, SMS provider keys | Supabase Auth settings | Google and phone sign-in |

The Supabase **publishable** key in the pages is designed to be public; access is controlled by row-level security. Never commit service-role keys, API keys or tokens to this repo.

---

## ⚠️ Notes and limits

- **Mutual fund day change** is the move to the latest NAV, which funds publish once a day (evening), so during market hours it reflects the previous session.
- **Top Signals after the close:** prices sit at the close the signals were built from, so most signals look "in entry zone". The ranking matters most during market hours.
- **Yahoo's newest daily bar** often has no close until the next day; the site fills it from the live quote.
- **Read aloud** uses the device's own voices, so quality varies by phone and browser.
- **Many news sites and NSE** refuse to be embedded, so those links open in the same tab rather than the in-site viewer.
- **Holidays:** live insights and blog posts skip days with no trading data.

---

*Built with plain HTML/JS, Supabase and GitHub Actions. Not affiliated with NSE, BSE, NSE IX or any broker.*
