// index-sparklines: today's 5-minute price path for the home-page index cards.
// Public, read-only market data (same as stock-data). Only whitelisted symbols
// are fetched and results are cached in memory for 60s, so the function can't
// be used to hammer Yahoo with arbitrary requests.
// GIFT Nifty (the near-month Nifty future on NSE IX) comes from NSE IX's public
// market-rate feed, which has no intraday series, so it is returned without points.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// ^INDIAVIX is shown as a tile beside GIFT Nifty, not as an index card.
const SYMBOLS = ["^NSEI", "^NSEBANK", "^BSESN", "^NSEMDCP50", "NIFTY_FIN_SERVICE.NS", "BSE-BANK.BO", "^INDIAVIX"];
const CACHE_MS = 60_000;

type Series = {
  symbol: string;
  price: number | null;
  previous_close: number | null;
  day_high: number | null;
  day_low: number | null;
  points: [number, number][];
};

let cache: { at: number; body: string } | null = null;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) ? n : null;
};

async function fetchSeries(symbol: string): Promise<Series> {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) +
    "?range=1d&interval=5m&includePrePost=false";
  const empty: Series = { symbol, price: null, previous_close: null, day_high: null, day_low: null, points: [] };
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!res.ok) return empty;
    const result = (await res.json())?.chart?.result?.[0];
    if (!result) return empty;
    const meta = result.meta || {};
    const ts: number[] = result.timestamp || [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
    const points: [number, number][] = [];
    ts.forEach((t, i) => {
      const c = num(closes[i]);
      if (c !== null && c > 0) points.push([t, Math.round(c * 100) / 100]);
    });
    const vals = points.map((p) => p[1]);
    return {
      symbol,
      price: num(meta.regularMarketPrice) ?? (vals.length ? vals[vals.length - 1] : null),
      previous_close: num(meta.chartPreviousClose) ?? num(meta.previousClose),
      day_high: num(meta.regularMarketDayHigh) ?? (vals.length ? Math.max(...vals) : null),
      day_low: num(meta.regularMarketDayLow) ?? (vals.length ? Math.min(...vals) : null),
      points,
    };
  } catch (_) {
    return empty;
  }
}

type Gift = { price: number; change: number; previous_close: number; change_percent: number; expiry: string; as_of: string; status: string | null };

const NSEIX_HEADERS = { "User-Agent": "Mozilla/5.0", Accept: "application/json", Referer: "https://www.nseix.com/" };

async function fetchGift(): Promise<Gift | null> {
  try {
    const [rate, status] = await Promise.all([
      fetch("https://www.nseix.com/api/market-rate?type=derivatives", { headers: NSEIX_HEADERS }).then((r) => r.ok ? r.json() : null),
      fetch("https://www.nseix.com/api/derivatives-market-status", { headers: NSEIX_HEADERS }).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    // Rows are near-month first; take the first NIFTY index future that has a price.
    const row = (rate?.data || []).find((x: Record<string, unknown>) =>
      x.SYMBOL === "NIFTY" && x.INSTRUMENTTYPE === "FUTIDX" && num(String(x.LASTPRICE).replace(/,/g, "")) !== null);
    if (!row) return null;
    const price = num(String(row.LASTPRICE).replace(/,/g, ""))!;
    const change = num(row.DAYCHANGE_1) ?? num(String(row.DAYCHANGE).replace(/,/g, "")) ?? 0;
    const prev = price - change;
    return {
      price,
      change,
      previous_close: Math.round(prev * 100) / 100,
      change_percent: prev ? Math.round(change / prev * 10000) / 100 : 0,
      expiry: String(row.EXPIRYDATE || ""),
      as_of: String(row.TIMESTMP || ""),
      status: typeof status?.marketstatus === "string" ? status.marketstatus : null,
    };
  } catch (_) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const [series, gift] = await Promise.all([Promise.all(SYMBOLS.map(fetchSeries)), fetchGift()]);
    const body = JSON.stringify({
      success: true,
      updated_at: new Date().toISOString(),
      series: Object.fromEntries(series.map((s) => [s.symbol, s])),
      gift_nifty: gift,
    });
    // Don't cache a response where Yahoo returned nothing at all.
    if (series.some((s) => s.points.length)) cache = { at: Date.now(), body };
    else return new Response(body, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(cache.body, {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=30" },
  });
});
