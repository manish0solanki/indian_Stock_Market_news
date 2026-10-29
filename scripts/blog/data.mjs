// Reads market data from Supabase's public REST API (same public key the website uses;
// every table/RPC read here is already publicly readable by the site).
export const SUPABASE_URL = process.env.SUPABASE_URL || "https://fzazdrzlemmkqngvpzxj.supabase.co";
const KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq";

export const NIFTY50 = ["ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK", "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BEL", "BHARTIARTL",
  "CIPLA", "COALINDIA", "DRREDDY", "EICHERMOT", "ETERNAL", "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE", "HINDALCO", "HINDUNILVR", "ICICIBANK",
  "INDIGO", "INFY", "ITC", "JIOFIN", "JSWSTEEL", "KOTAKBANK", "LT", "M&M", "MARUTI", "MAXHEALTH", "NESTLEIND", "NTPC", "ONGC", "POWERGRID",
  "RELIANCE", "SBILIFE", "SBIN", "SHRIRAMFIN", "SUNPHARMA", "TATACONSUM", "TMPV", "TATASTEEL", "TCS", "TECHM", "TITAN", "TRENT", "ULTRACEMCO", "WIPRO"];

async function req(path, init = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...init, signal: AbortSignal.timeout(30000),
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", Accept: "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path.split("?")[0]} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
const rpc = (name, args = {}) => req("/rest/v1/rpc/" + name, { method: "POST", body: JSON.stringify(args) });
const inList = (vals) => "in.(" + vals.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",") + ")";

async function selectAll(table, query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await req(`/rest/v1/${table}?${query}`, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function quotesFor(symbols) {
  const out = [];
  for (let i = 0; i < symbols.length; i += 150) {
    out.push(...await req(`/rest/v1/stock_quotes?select=symbol,price,previous_close,change,change_percent,high,low,high_52w,low_52w,market_cap,volume,avg_volume_3m,fifty_day_avg,two_hundred_day_avg,quote_time&symbol=${encodeURIComponent(inList(symbols.slice(i, i + 150)))}`));
  }
  return out;
}

// Everything the four post types need, fetched once per run.
export async function loadMarketData() {
  const [snapshot, sectors, fii, breadth, stocks] = await Promise.all([
    rpc("market_snapshot"), rpc("sector_indices"), rpc("fii_dii"), rpc("market_breadth"),
    selectAll("stocks", "select=symbol,company_name,sector&order=symbol"),
  ]);
  // Liquid universe for spotlights: the 600 largest stocks by market cap.
  const large = await req("/rest/v1/stock_quotes?select=symbol,price,previous_close,change,change_percent,high,low,high_52w,low_52w,market_cap,volume,avg_volume_3m,fifty_day_avg,two_hundred_day_avg,quote_time&market_cap=gt.0&order=market_cap.desc&limit=600");
  const nifty50 = await quotesFor(NIFTY50);
  return { snapshot, sectors, fii: fii?.history || [], breadth, stocks, large, nifty50 };
}

export async function quotesForSector(stocks, matcher) {
  const syms = stocks.filter((s) => s.sector && matcher.test(s.sector)).map((s) => s.symbol);
  return syms.length ? quotesFor(syms) : [];
}

export async function recentNews(symbol, sinceIso) {
  return req(`/rest/v1/news?select=title,short_term_impact,source,published_at&is_visible=eq.true&symbol=eq.${encodeURIComponent(symbol)}&published_at=gte.${encodeURIComponent(sinceIso)}&order=published_at.desc&limit=5`);
}
