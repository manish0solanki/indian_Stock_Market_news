// index-sparklines: today's 5-minute price path for the home-page index cards.
// Public, read-only market data (same as stock-data). Only whitelisted symbols
// are fetched and results are cached in memory for 60s, so the function can't
// be used to hammer Yahoo with arbitrary requests.
// GIFT Nifty (the near-month Nifty future on NSE IX) comes from NSE IX's public
// market-rate feed, which has no intraday series, so it is returned without points.
// Its open/closed state comes from the session clock (NSE IX's status endpoint can lag by a whole
// session, e.g. still saying "Session 2 Market Closed - As on <yesterday>" while prices move).
// GIFT Nifty is cached for 20 s so pages that refresh every 30 s see fresh prices; the index charts for 60 s.
// NSE IX's rate feed is empty between sessions and all weekend, so each good reading is saved to
// gift_nifty_last and that reading is returned (marked closed, with its time) while the feed is empty.

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

type Gift = {
  price: number; change: number; previous_close: number; change_percent: number; expiry: string; as_of: string;
  status: string | null; live: boolean; session: string | null; next_open: string | null; source_status: string | null;
};

// GIFT Nifty sessions (IST, Monday–Friday): Session 1 06:30–15:40, Session 2 16:35–02:45 next morning.
// Exchange holidays are not known here; a recent "closed" message from NSE IX covers those.
function giftSession(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60e3), d = ist.getUTCDay(), m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const wk = d >= 1 && d <= 5;
  if (wk && m >= 390 && m < 940) return { live: true, session: "Session 1", next_open: null };
  if (wk && m >= 995) return { live: true, session: "Session 2", next_open: null };
  if (d >= 2 && d <= 6 && m < 165) return { live: true, session: "Session 2", next_open: null };
  const next = wk && m < 390 ? "06:30 IST" : wk && m < 995 ? "16:35 IST" : "Monday 06:30 IST";
  return { live: false, session: null, next_open: next };
}
// "Session 2 Market Closed - As on Oct 30, 2026 02:45 IST" -> that moment (ms), or null.
function statusTime(txt: string): number | null {
  const m = txt.match(/As on ([A-Za-z]{3}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})/);
  if (!m) return null;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[1]);
  return mon < 0 ? null : Date.UTC(+m[3], mon, +m[2], +m[4], +m[5]) - 330 * 60e3;
}
let giftCache: { at: number; gift: Gift | null } | null = null;
const DB = Deno.env.get("SUPABASE_URL") + "/rest/v1/gift_nifty_last";
const DB_HEADERS = { apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", Authorization: "Bearer " + (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""), "Content-Type": "application/json" };
let savedAt = 0;
async function saveGift(g: Gift) {
  if (Date.now() - savedAt < 60e3) return; // at most once a minute
  savedAt = Date.now();
  await fetch(DB + "?on_conflict=id", { method: "POST", headers: { ...DB_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: 1, data: g, updated_at: new Date().toISOString() }) }).catch(() => {});
}
async function lastGift(): Promise<Gift | null> {
  try {
    const r = await fetch(DB + "?id=eq.1&select=data,updated_at", { headers: DB_HEADERS });
    const row = r.ok ? (await r.json())[0] : null;
    if (!row?.data?.price) return null;
    const clock = giftSession();
    return { ...row.data, live: false, session: null, next_open: clock.next_open,
      status: "Closed · last traded " + (row.data.as_of || "") + (clock.next_open ? " · opens " + clock.next_open : ""), last_session: true } as Gift;
  } catch (_) { return null; }
}
const GIFT_CACHE_MS = 20_000;

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
    if (!row) return await lastGift(); // feed empty between sessions: last saved reading
    const price = num(String(row.LASTPRICE).replace(/,/g, ""))!;
    const change = num(row.DAYCHANGE_1) ?? num(String(row.DAYCHANGE).replace(/,/g, "")) ?? 0;
    const prev = price - change;
    const src = typeof status?.marketstatus === "string" ? status.marketstatus : null;
    const clock = giftSession();
    let live = clock.live;
    if (src && /open/i.test(src) && !/clos/i.test(src)) live = true; // e.g. a special session
    else if (src && /clos/i.test(src) && live) {
      // Trust "closed" only if NSE IX said so in the last 20 minutes (e.g. a holiday), not a stale message.
      const at = statusTime(src);
      if (at !== null && Date.now() - at < 20 * 60e3) live = false;
    }
    return {
      price,
      change,
      previous_close: Math.round(prev * 100) / 100,
      change_percent: prev ? Math.round(change / prev * 10000) / 100 : 0,
      expiry: String(row.EXPIRYDATE || ""),
      as_of: String(row.TIMESTMP || ""),
      status: live ? "Open · " + (clock.session || "trading") : "Closed" + (clock.next_open ? " · opens " + clock.next_open : ""),
      live,
      session: live ? clock.session : null,
      next_open: live ? null : clock.next_open,
      source_status: src,
    };
  } catch (_) {
    return await lastGift();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const needSeries = !cache || Date.now() - cache.at > CACHE_MS;
  const needGift = !giftCache || Date.now() - giftCache.at > GIFT_CACHE_MS;
  const [fresh, gift] = await Promise.all([
    needSeries ? Promise.all(SYMBOLS.map(fetchSeries)) : null,
    needGift ? fetchGift() : giftCache!.gift,
  ]);
  if (needGift && gift) {
    giftCache = { at: Date.now(), gift };
    if (!(gift as any).last_session) saveGift(gift); // a live reading: keep it for when the feed goes empty
  }
  let series = cache ? JSON.parse(cache.body) : {};
  if (fresh) {
    series = Object.fromEntries(fresh.map((s) => [s.symbol, s]));
    // Don't cache a response where Yahoo returned nothing at all.
    if (fresh.some((s) => s.points.length)) cache = { at: Date.now(), body: JSON.stringify(series) };
  }
  const body = JSON.stringify({ success: true, updated_at: new Date().toISOString(), series, gift_nifty: gift || giftCache?.gift || null });
  return new Response(body, {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=15" },
  });
});
