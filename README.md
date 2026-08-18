# MarketPulse 📈

**Real-time Indian stock market dashboard** — live news, prices, sector heatmaps, FII/DII flows, and market breadth, all in a single HTML file powered by n8n webhooks.

A lightweight, mobile-friendly PWA for tracking Indian equities. The entire frontend is one self-contained `index.html` (no frameworks, no build step), hosted on Vercel, with all data served by n8n workflows running on a self-hosted instance exposed via a Cloudflare Tunnel.

---

## ✨ Features

### 📰 News
- **Live news feed** with auto-refresh every 30 seconds
- **AI sentiment tagging** — filter stories by Positive / Negative / Neutral impact
- **Session-aware filtering** — shows news relevant to the current trading session (rolls over at 3:30 PM IST market close), with an optional "show older news" toggle
- **Global headlines** — international market news in a collapsible section
- **Inline price chips** — mentioned stocks show live prices next to headlines

### 📊 Market Data
- **Live ticker** — scrolling price strip for major indices/stocks
- **Market snapshot** — key indices at a glance
- **Sector heatmap** — colour-coded tiles with per-stock detail on tap
- **Market breadth** — advances vs. declines gauge
- **FII/DII flows** — daily institutional buying/selling with visual bars and net cards
- **Global indices** — world markets table (US, Asian, European indices)
- **Sector explorer** — drill into any sector: constituent stocks, sortable columns, F&O badge highlighting, gainers/losers filtering

### 🔍 Stock Tools
- **Stock search** with debounced dropdown autocomplete
- **Voice search** (Web Speech API, shown only when the browser supports it)
- **Stock detail panel** — price, change, sector, promoter holding, and key metrics

### 🎨 Experience
- **Dark / Light mode** — dark by default, persisted via `localStorage`
- **PWA support** — installable, with manifest and theme colour
- **Skeleton loaders** while data fetches
- **Responsive design** — built mobile-first for phones and tablets
- **Contact form** — messages routed through an n8n webhook

---

## 🏗️ Architecture

```
┌─────────────┐      HTTPS       ┌──────────────────┐      ┌────────────┐
│  index.html │ ───────────────► │  Cloudflare      │ ───► │  n8n       │
│  (Vercel)   │ ◄─────────────── │  Tunnel          │ ◄─── │  workflows │
└─────────────┘      JSON        └──────────────────┘      └────────────┘
                                     │                         │
                                     │                    Scrapes/APIs:
                                     │                    NSE, NewsAPI,
                                     │                    moneycontrol, etc.
```

- **Frontend:** single-file HTML/CSS/JS, deployed to **Vercel** via GitHub
- **Backend:** **n8n** workflows running in Termux (self-hosted), exposed through a **Cloudflare quick tunnel**
- **Refresh:** client polls endpoints every 30 seconds

### n8n Webhook Endpoints

| Endpoint | Purpose |
|---|---|
| `/webhook/news-feed` | Indian market news with sentiment tags |
| `/webhook/price-feed` | Live stock/index prices |
| `/webhook/index-feed` | Market snapshot indices |
| `/webhook/global-news` | Global market headlines |
| `/webhook/heatmap-data` | Sector heatmap tiles |
| `/webhook/market-breadth` | Advances / declines |
| `/webhook/fii-dii-data` | FII & DII daily flows |
| `/webhook/global-indices` | World index table |
| `/webhook/stock-search` | Symbol autocomplete |
| `/webhook/stock-detail` | Single-stock detail |
| `/webhook/sector-indices` | Sector index list |
| `/webhook/sector-list` | Available sectors |
| `/webhook/sector-stocks` | Stocks within a sector |
| `/webhook/fno-list` | F&O-eligible symbols |
| `/webhook/contact-message` | Contact form submissions |

---

## 🚀 Setup & Deployment

### 1. Frontend (Vercel)
1. Push this repo to GitHub.
2. Import the repo in [Vercel](https://vercel.com) — no build command needed, it's a static site.
3. Every push to `main` auto-deploys.

### 2. Backend (n8n + Cloudflare Tunnel)
1. Start n8n on your server/device (e.g. Termux):
   ```bash
   n8n start
   ```
2. Start the tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:5678
   ```
3. Import the workflows into n8n and **activate** them.
4. Copy the generated `*.trycloudflare.com` URL.

### 3. Point the frontend at your backend
Three ways, in order of precedence:

| Method | How |
|---|---|
| **Settings modal (runtime override)** | Click the ⚙️ icon in the app → paste `https://<your-tunnel>.trycloudflare.com/webhook` → Save & Reload. Stored in `localStorage`. |
| **`config.json`** | Add a `config.json` next to `index.html`:<br>`{ "apiBase": "https://<tunnel>.trycloudflare.com/webhook", "newsApiKey": "..." }` |
| **Code default** | Edit `DEFAULT_API_BASE` in `index.html`. |

> ⚠️ **Quick tunnels change URL on every restart.** When you restart cloudflared, update the URL via the Settings modal (or `config.json`) — no code change needed. For a permanent URL, use a [named Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) with a fixed subdomain.

---

## 📁 Repo Structure

```
├── index.html        # Entire frontend (markup, styles, JS)
├── config.json       # (Optional) API base URL + NewsAPI key overrides
├── manifest.json     # PWA manifest
├── favicon-*.png     # Icons
└── README.md
```

---

## 🛠️ Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS · Inter + JetBrains Mono · CSS custom properties for theming
- **Backend:** n8n (workflow automation)
- **Tunnel:** Cloudflare Tunnel
- **Hosting:** Vercel
- **Data:** NSE, NewsAPI, public financial sources (aggregated in n8n)

---

## 🗺️ Roadmap

**Market Data** — Option Chain · Economic Calendar
**News** — AI summaries · X/Twitter feed · Earnings calendar
**Tools** — Position sizing calculator · Brokerage calculator · Pivot/CPR levels · SIP calculator · Trading journal
**User** — Watchlists · Price alerts (via n8n) · PWA polish
**Content** — Daily commentary · Strategy library · Glossary

---

## ⚠️ Disclaimer

MarketPulse is a personal project for informational purposes only. Nothing shown here is investment advice. Market data may be delayed or inaccurate — always verify with your broker or official exchange sources before trading.

---

## 📄 License

MIT — feel free to fork and adapt for your own dashboard.
