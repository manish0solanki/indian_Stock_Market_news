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
- **Stock search**, with a detail card showing:
  - live quote and key metrics
  - **quarterly results from NSE filings** (last 8 quarters with YoY growth)
  - Yahoo trailing fundamentals
  - a **price history chart** (1D, 1W, 1M, 3M, 6M, 1Y)

### 📊 Portfolio (`portfolio.html`)
- Stock holdings from manual entries or a broker file import (CSV / Excel).
- **Mutual funds**, entered by hand or imported from a **CAS statement** (CAMS / KFintech PDF, parsed in the browser by `cas-parser.js`). Live NAVs come from the `mf-data` function.
- Day change and P&L per holding, a stocks vs funds split, allocation, and insights (asset mix, best and worst, concentration).

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

### 🔍 Stock Analysis (`stock-analysis.html`)
- Interactive chart with RSI, MACD, Bollinger Bands, ADX, and support and resistance, plus fundamentals for any NSE stock.

### 🧮 Stock Screener (`screener.html`)
- Filters every NSE stock with a recent quote by **P/E, P/B, ROE, ROCE, market cap, dividend yield, 52-week high/low, volume spike, trend (50/200-day averages), today's move, sector and F&O**.
- Ready-made screens: quality at a fair price, large caps in uptrend, near 52-week high/low, volume spikes, high dividend, value picks, today's gainers.
- Data comes from one call to `stock_screener()` (`supabase/stock-screener.sql`); filtering and sorting run in the browser. Filters are kept in the URL, so a screen can be shared, and results download as CSV.

### ⇅ F&O Option Chain (`fno.html`)
- Option chain for Nifty, Bank Nifty, Fin Nifty, Midcap Nifty, Nifty Next 50 and every F&O stock, any expiry.
- Worked out for you: **PCR** (OI and volume), **max pain**, **support / resistance** (largest put OI at or below spot, largest call OI at or above it), **ATM IV** and the **expected move** (ATM straddle).
- Open interest / change-in-OI chart by strike, the chain table with ITM shading and the spot line, and a plain-English summary and glossary.
- Data: the `option-chain` Edge Function (NSE's option-chain API, cached a minute). Refreshes every minute in market hours.

### 📅 Events Calendar (`events.html`)
- **Economy events** alongside company events: RBI policy decisions, India CPI and GDP, the Union Budget, US Fed (FOMC) decisions and US CPI, with IST times, what each one is and how it tends to move Indian markets. Kept in `econ_events` (`supabase/econ-events.sql`); dates not read from the official calendar are marked "Expected date". Add new dates (e.g. the next RBI or Fed calendar) by extending that file and re-running it.
- Upcoming and recent **results, dividends, bonus, splits, buybacks and fund-raising** from the NSE event calendar and corporate actions.
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

---

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
| `index-refresh` | every minute | Indices, global markets, crude, Bitcoin (`index_quotes`) |
| `sector-refresh` | every 3 min | Sector indices and ~2,600 stock quotes (`sector_index_quotes`, `stock_quotes`) |
| `stock-signals-refresh` | every 5 min | Rebuilds swing and intraday signals (`stock_signals`) |
| `stock-paper-monitor` | every minute | Fills stops and targets on open paper trades |
| `live-insights` | :05/:20/:35/:50, 03–10 UTC, Mon–Fri | `refresh_live_insights()`: Home's live insight cards (skips holidays) |
| `news-refresh` | every 15 min | News feed with sentiment |
| `feeds-refresh` | every 10 min | Breadth, FII/DII and other feeds |
| `ipo-refresh` | every 10 min | IPO list, subscription, GMP |
| `events-refresh` | hourly at :23 | Events calendar, pre-event data and post-results analysis |
| `crude-refresh` | every 30 min | Crude oil feed and impact |
| `stocks-sync` | 03:11 and 13:11 | Stock master list |
| `crypto-bot`, `crypto-monitor` | every minute | Crypto paper-trading bot and position monitor |
| `blog-market-posts` (+ backup) | 10:09 (11:39) Mon–Fri | Dispatches the Daily Wrap, Sector and Spotlight posts |
| `blog-fiidii` (+ retry, backup) | 13:49 (15:19, 16:45) Mon–Fri | Dispatches the FII/DII post once NSE publishes flows |
| `purge-old-news`, `prune-*` | daily / hourly | Housekeeping |

### Edge Functions (`supabase/functions/`)

| Function | Purpose |
|---|---|
| `stock-data` | On-demand quote, Yahoo fundamentals and daily history (`?symbol=TCS&days=400`) |
| `stock-fundamentals` | Last 8 quarterly results from NSE integrated-filing XBRL, cached 6 h |
| `index-sparklines` | Intraday index paths, GIFT Nifty (NSE IX) and India VIX |
| `mf-data` | Mutual fund NAVs |
| `option-chain` | NSE option chain with PCR, max pain, support/resistance and expected move (`?symbol=NIFTY&expiry=03-Nov-2026`), cached a minute |
| `events-refresh` | Events calendar and results analysis |
| `ipo-refresh` | IPOs and GMP |
| `news-refresh` | News collection |
| `index-refresh`, `sector-refresh`, `stocks-sync` | Market data collection |
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
├── fno.html/.js              F&O option chain, PCR, max pain
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
| Fundamentals | `stock_fundamentals_cache` (`supabase/stock-fundamentals-schema.sql`) |
| Events / IPO | `market_events` (`events-schema.sql`), `econ_events` (`supabase/econ-events.sql`), `ipos` (`ipo-schema.sql`) |
| Users | `profiles` (users can only edit their name and photo), `portfolios`, `portfolio_transactions`, `portfolio_mf_transactions`, `watchlist`, `stock_alerts`, `user_ticker` |
| Crypto | `crypto_signals`, `crypto_trades`, `crypto_shadow_trades`, `crypto_bot_settings`, `crypto_bot_status`, `crypto_bot_runs`, `crypto_wallet_transactions`, `crypto_reset_trading()` |
| Internal | `app_secrets` (cron shared secret), `feed_state` |

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
