# Indian Stock Market News Automation

This repository contains an importable n8n workflow that monitors Indian finance news, identifies NSE-listed companies mentioned in the news, analyzes the likely stock impact, and sends a formatted Telegram digest.

## Workflow

Import [`workflows/indian-finance-news-impact.json`](workflows/indian-finance-news-impact.json) into n8n.

The workflow does the following:

1. Runs every hour.
2. Reads latest market news from Indian finance RSS feeds:
   - Moneycontrol market reports
   - Economic Times markets
   - Mint markets
3. Normalizes, deduplicates, and keeps only recent articles.
4. Downloads the NSE equity master list from `https://archives.nseindia.com/content/equities/EQUITY_L.csv`.
5. Matches articles only against NSE-listed equity-series companies.
6. Uses OpenAI to classify the expected short-term stock impact as `Positive`, `Negative`, `Neutral`, or `Mixed`.
7. Sends a formatted Telegram message with:
   - company name
   - NSE symbol
   - short news description
   - impact label
   - impact reason
   - confidence
   - source link

## Required n8n credentials

Create and attach these credentials after import:

- **OpenAI account** for the `Analyze Stock Impact` node.
- **Telegram account** for the `Send Telegram Digest` node.

The workflow includes placeholder credential IDs that must be replaced by n8n during import or manually selected in the node UI.

## Environment variables

Configure these variables in your n8n environment:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TELEGRAM_CHAT_ID` | Yes | none | Telegram chat/channel/user ID to receive the digest. |
| `NEWS_MAX_AGE_HOURS` | No | `24` | Maximum article age to analyze. |
| `NEWS_MAX_ARTICLES` | No | `30` | Maximum deduplicated articles per run. |

## Notes and limitations

- The workflow intentionally ignores news if no NSE-listed equity company is matched.
- Company matching is deterministic and runs before the AI analysis, so the AI only receives pre-filtered NSE matches.
- The impact label is an analytical classification, not investment advice.
- RSS source schemas can change; if a feed stops working, replace that RSS node URL with another finance news feed.
- For production usage, consider adding a database node to store previously sent article URLs and avoid repeated alerts across separate workflow runs.

## Example Telegram output

```text
🇮🇳 Indian NSE Stock News Impact Digest
Generated: 16 Jul 2026, 10:30 am IST

1. Reliance Industries Limited (RELIANCE)
📰 Reliance announced a major expansion in its retail business after reporting stronger quarterly revenue.
🟢 Impact: Positive — Stronger retail growth can improve earnings expectations and investor sentiment.
🎯 Confidence: Medium
🔗 https://example.com/news/reliance
```
