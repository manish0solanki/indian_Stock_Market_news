# MarketPulse Stock Signals (v1)

This is an additive stock-only module. It is deliberately separate from `crypto-signals.html`, `crypto-manager/`, and all crypto database tables.

## Files
- `stock-signals.html`: standalone responsive page.
- `stock-signals.css`: isolated page styles.
- `stock-signals.js`: quote/history validation and swing setup scanner.
- `supabase/stock-signals-schema.sql`: additive stock-only persistence schema.

## Current data-feed audit
The homepage currently uses an API base from `/config.json` for `/fno-list` and several market feeds. The stock detail UI also calls the Supabase Edge Function `/functions/v1/stock-data?symbol=...`; its response is expected to contain `success`, `price`, a quote timestamp, and `history[]`. The public repository code shows that daily history is used to draw the stock chart. I did not find a verified 5-minute OHLCV endpoint in the repository's documented API routes or frontend contract.

**Do not treat this as an end-to-end live-feed certification.** A reachable endpoint is not proof of exchange-grade freshness. Confirm the Edge Function's actual response fields and quote timestamp, compare sample prices and candle timestamps with the broker/NSE feed, and verify whether the upstream provider is licensed for this use. This page fails closed when timestamp/history checks fail. Intraday mode is intentionally blocked until a 5-minute candle source is configured.

## Strategy v1 (daily swing only)
- Universe source: existing `/fno-list` endpoint. This initial version scans up to 35 symbols per run to limit calls, with common liquid names prioritized; it is not a complete ranking by current traded value.
- Trend: close vs EMA20 and EMA20 vs EMA50.
- Entry setup: 20-session breakout / breakdown or EMA20 pullback in the direction of trend.
- Confirmation: RSI(14), MACD(12,26,9), and relative volume.
- Stop: structure plus ATR-based buffer. Targets: 1.5R and 2R.
- Quantity: floor(risk budget / rupee risk per share), based on chosen capital and risk percentage. This is a planning estimate; brokerage, taxes, slippage, lot size, liquidity and overnight gaps are not fully modeled.
- Signal threshold: score >= 75 plus risk distance checks.
- Data quality: valid OHLC, at least 60 daily candles, quote timestamp present and no older than 96 hours, last candle no older than 7 days, and quote/last-close difference <= 12%.

These are transparent technical rules, not a proven profitable strategy. The first implementation is a candidate scanner, not a backtested system or a recommendation to trade. It may produce zero setups.

## Persistence and performance testing
Run `supabase/stock-signals-schema.sql` manually in the correct Supabase project after reviewing it. It creates only `stock_trade_signals` and `stock_signal_events`; it does not alter crypto tables. The UI saves signals only when a user is signed in and the schema has been installed.

For valid performance results, add a historical replay job that uses point-in-time candles and simulates next-bar execution after signal creation, with brokerage, STT, exchange charges, GST, stamp duty, slippage, gaps, corporate actions and realistic stop/target ordering. Report trade count, expectancy in R, win rate, profit factor, max drawdown, net return, average win/loss, exposure, and results by symbol/regime. Use walk-forward/out-of-sample data and paper trading before real money. Never report a win rate from signals that have not actually been replayed.

## Next steps
1. Verify real `stock-data` Edge Function payload and the `/fno-list` payload.
2. Add a reliable 5-minute OHLCV source before enabling intraday signals.
3. Add event tracking for paper entries/exits and a historical replay/backtest service.
4. Add freshness badges, source attribution and explicit invalidation/expiry handling.
5. Review current SEBI/exchange requirements before distributing personalized recommendations or integrating broker APIs. This module places no orders.

## Manual deployment
Merge the feature branch only after testing. The static page will then be available at `/stock-signals.html` on the Vercel domain. If adding a homepage nav link later, keep it limited to the single stock-signals link; do not change crypto UI or logic.


# Stock Signals (paper trading)

Broker-style app at `/stock-signals.html`: **Signals · Positions · History · Account**.
Everything runs on Supabase + Yahoo Finance — no n8n, no Cloudflare worker, and nothing is scanned in the browser.

## How it works
| Piece | Where | What it does |
|---|---|---|
| `stock-signals-refresh` | Supabase Edge Function, cron every 5 min | Caches ~130 completed daily bars for the 213 F&O stocks (once per session), then re-evaluates them against the live quotes. Intraday (5-minute) signals for the 60 most liquid names during market hours. Writes `stock_signals`. |
| `stock-paper-monitor` | Supabase Edge Function, cron every minute | Replays completed 5-minute candles for every OPEN paper trade. **Stops/targets fill at their exact level**, stop is checked before targets inside one candle, Target 1 books half, intraday trades are squared off at 15:20 IST. |
| `sector-refresh` | Supabase Edge Function, cron every 3 min | Keeps live prices for every stock in `stock_quotes` (used for LTP everywhere). |
| RPCs | `stock_signals_feed`, `stock_quotes_for`, `stock_signals_status`, `market_snapshot` | Read-only data for the page. |
| Tables | `stock_signals`, `stock_swing_cache`, `stock_paper_trades`, `stock_paper_accounts` | Account settings (balance, risk %, charges) live in `stock_paper_accounts`, so every device sees the same account. |

## Strategy (unchanged rules)
* **Swing (daily):** 20-day breakout/breakdown with volume ≥ 1.15× average, or a pullback to the 20-EMA in a 20/50-EMA trend; RSI + MACD must agree; score ≥ 75.
* **Intraday (5-minute):** EMA 9/21 trend with breakout or pullback, RSI + MACD confirmation; only 09:30–15:00 IST.
* Stop = recent swing low/high or 1.5×ATR (1.2×ATR intraday); Target 1 = 1.5R (books half), Target 2 = 2R.
* Improvement over the old scanner: indicators use **completed** sessions only; today's forming bar is built from the live quote with **projected full-day volume**, so breakouts are detected during the session instead of appearing after the close.

## Paper account rules
* Available cash = starting balance + realised P&L − invested (realised P&L now counts).
* One open position per stock. Suggested size = risk % of equity ÷ stop distance, capped by cash.
* Orders fill at the last available price (refreshes about every 3 minutes). No real order is ever placed.
