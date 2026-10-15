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
