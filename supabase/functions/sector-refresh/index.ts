// sector-refresh: keeps live prices for every stock in `stocks`, the NSE sector indices and a few market
// reference quotes (Nifty 50, VIX, Brent, WTI, USD/INR, Gold) up to date.
// Source: Yahoo Finance (free) for stocks and commodities. NSE indices (sector indices, Nifty 50, India VIX)
// come from NSE's own allIndices feed when it answers: Yahoo's quote API reports the close from two sessions
// back as "previous close" for indices after market hours, which made their day change wrong.
// Runs from a Supabase cron job.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const CHUNK = 100;
const TIME_BUDGET_MS = 100_000;

// NSE sector indices. Several Yahoo tickers are tried per index; the first one that returns a price is kept.
// nse: the index name in NSE's allIndices feed when it differs from `name`.
const INDEXES: { name: string; display: string; order: number; tickers: string[]; nse?: string }[] = [
  { name: "NIFTY BANK", display: "Nifty Bank", order: 1, tickers: ["^NSEBANK"] },
  { name: "NIFTY IT", display: "Nifty IT", order: 2, tickers: ["^CNXIT"] },
  { name: "NIFTY AUTO", display: "Nifty Auto", order: 3, tickers: ["^CNXAUTO"] },
  { name: "NIFTY FMCG", display: "Nifty FMCG", order: 4, tickers: ["^CNXFMCG"] },
  { name: "NIFTY PHARMA", display: "Nifty Pharma", order: 5, tickers: ["^CNXPHARMA"] },
  { name: "NIFTY METAL", display: "Nifty Metal", order: 6, tickers: ["^CNXMETAL"] },
  { name: "NIFTY REALTY", display: "Nifty Realty", order: 7, tickers: ["^CNXREALTY"] },
  { name: "NIFTY ENERGY", display: "Nifty Energy", order: 8, tickers: ["^CNXENERGY"] },
  { name: "NIFTY FINANCIAL SERVICES", display: "Nifty Financial Services", order: 9, tickers: ["NIFTY_FIN_SERVICE.NS", "^CNXFIN"] },
  { name: "NIFTY MEDIA", display: "Nifty Media", order: 10, tickers: ["^CNXMEDIA"] },
  { name: "NIFTY PSU BANK", display: "Nifty PSU Bank", order: 11, tickers: ["^CNXPSUBANK"] },
  { name: "NIFTY INFRASTRUCTURE", display: "Nifty Infrastructure", order: 12, tickers: ["^CNXINFRA"] },
  { name: "NIFTY COMMODITIES", display: "Nifty Commodities", order: 13, tickers: ["^CNXCMDT"] },
  { name: "NIFTY INDIA CONSUMPTION", display: "Nifty India Consumption", order: 14, tickers: ["^CNXCONSUM"] },
  { name: "NIFTY PRIVATE BANK", display: "Nifty Private Bank", order: 15, tickers: ["NIFTY_PVT_BANK.NS"] },
  { name: "NIFTY OIL & GAS", display: "Nifty Oil & Gas", order: 16, tickers: ["NIFTY_OIL_AND_GAS.NS"] },
  { name: "NIFTY HEALTHCARE", display: "Nifty Healthcare", order: 17, tickers: ["NIFTY_HEALTHCARE.NS"], nse: "NIFTY HEALTHCARE INDEX" },
  { name: "NIFTY CONSUMER DURABLES", display: "Nifty Consumer Durables", order: 18, tickers: ["NIFTY_CONSR_DURBL.NS"] },
  { name: "NIFTY SERVICES SECTOR", display: "Nifty Services Sector", order: 19, tickers: ["^CNXSERVICE"] },
  { name: "NIFTY PSE", display: "Nifty PSE", order: 20, tickers: ["^CNXPSE"] },
];

// Reference quotes used by the Sectors insight panels (crude sensitivity, defensive rotation)
const MARKETS: { symbol: string; key: string; name: string; nse?: string }[] = [
  { symbol: "^NSEI", key: "nifty", name: "Nifty 50", nse: "NIFTY 50" },
  { symbol: "^INDIAVIX", key: "vix", name: "India VIX", nse: "INDIA VIX" },
  { symbol: "BZ=F", key: "brent", name: "Brent Crude" },
  { symbol: "CL=F", key: "wti", name: "WTI Crude" },
  { symbol: "INR=X", key: "usdinr", name: "USD/INR" },
  { symbol: "GC=F", key: "gold", name: "Gold" },
];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) && n !== 0 ? n : (v === 0 ? 0 : null); };

function extractCookie(setCookie: string): string {
  if (!setCookie) return "";
  const matches = setCookie.match(/(?:^|,\s*)([A-Za-z0-9_-]+)=[^;,]+/g);
  if (!matches) return "";
  return matches.map((m) => m.replace(/^,\s*/, "").split(";")[0]).join("; ");
}

async function getYahooSession(): Promise<{ cookie: string; crumb: string }> {
  const c = await fetch("https://fc.yahoo.com/", { redirect: "manual", headers: { "User-Agent": UA, Accept: "*/*" } });
  const cookie = extractCookie(c.headers.get("set-cookie") || "");
  if (!cookie) throw new Error("Yahoo cookie unavailable");
  const r = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Accept: "text/plain", Cookie: cookie } });
  if (!r.ok) throw new Error("Yahoo crumb HTTP " + r.status);
  const crumb = (await r.text()).trim();
  if (!crumb || crumb.includes("<html")) throw new Error("Yahoo crumb invalid");
  return { cookie, crumb };
}

class Throttled extends Error {}

async function fetchQuotes(symbols: string[], s: { cookie: string; crumb: string }): Promise<any[]> {
  const url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(symbols.join(",")) + "&crumb=" + encodeURIComponent(s.crumb);
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Cookie: s.cookie } });
  if (r.status === 429) throw new Throttled("Yahoo rate limit (429)");
  if (!r.ok) throw new Error("Yahoo quote HTTP " + r.status);
  const d = await r.json();
  return d?.quoteResponse?.result || [];
}

// NSE index values: { last, previousClose } by index name. Empty map when NSE doesn't answer.
async function nseIndices(): Promise<Map<string, { price: number; prev: number | null }>> {
  const out = new Map<string, { price: number; prev: number | null }>();
  try {
    const r = await fetch("https://www.nseindia.com/api/allIndices", {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.nseindia.com/", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!r.ok) return out;
    for (const x of (await r.json())?.data || []) {
      const price = Number(x.last), prev = Number(x.previousClose);
      if (price > 0) out.set(String(x.index), { price, prev: prev > 0 ? prev : null });
    }
  } catch (e) { console.warn("NSE feed unavailable:", String(e)); }
  return out;
}

function isMarketHoursIST(): boolean {
  const t = new Date(Date.now() + 330 * 60_000);
  const dow = t.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const m = t.getUTCHours() * 60 + t.getUTCMinutes();
  return m >= 9 * 60 && m <= 16 * 60;
}

async function allSymbols(): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("stocks").select("symbol").order("symbol").range(from, from + 999);
    if (error) throw new Error("stocks read: " + error.message);
    if (!data || !data.length) break;
    out.push(...data.map((x: any) => x.symbol));
    if (data.length < 1000) break;
  }
  return out;
}

async function quoteAges(): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("stock_quotes").select("symbol,updated_at").order("symbol").range(from, from + 999);
    if (!data || !data.length) break;
    for (const r of data) m.set(r.symbol, new Date(r.updated_at).getTime());
    if (data.length < 1000) break;
  }
  return m;
}

Deno.serve(async (req) => {
  const started = Date.now();
  let beat = false;
  const finish = async (ok: boolean, error: string | null, summary: any) => {
    if (!beat) return;
    beat = false;
    try {
      await supabase.rpc("bot_job_finish", { p_job: "sector", p_ok: ok, p_error: error, p_duration_ms: Date.now() - started, p_summary: summary, p_log: false });
    } catch (_e) { /* ignore */ }
  };
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: sec } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!sec || !secret || secret !== sec.value) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const test = url.searchParams.get("test") === "1"; // diagnostics only: resolve tickers, write nothing

    if (!test) {
      // Off-hours: refresh at most once an hour (prices don't move, but the first run after close matters).
      if (!force && !isMarketHoursIST()) {
        const { data: st } = await supabase.from("crypto_bot_status").select("last_run_at").eq("job", "sector").maybeSingle();
        if (st?.last_run_at && Date.now() - new Date(st.last_run_at).getTime() < 55 * 60_000) return json({ skipped: "market closed, refreshed recently" });
      }
      const { data: go } = await supabase.rpc("bot_job_start", { p_job: "sector", p_interval: 180 });
      if (go === false) return json({ skipped: "previous run still in progress" });
      beat = true;
    }

    let session = await getYahooSession();
    const nowIso = new Date().toISOString();

    // ---------- sector indices + market reference quotes ----------
    const allTickers = [...INDEXES.flatMap((i) => i.tickers), ...MARKETS.map((m) => m.symbol)];
    let idxQuotes: any[] = [];
    const nse = await nseIndices();
    try { idxQuotes = await fetchQuotes(allTickers, session); }
    catch (e) {
      if (e instanceof Throttled && !nse.size) throw e;
      try { session = await getYahooSession(); idxQuotes = await fetchQuotes(allTickers, session); }
      catch (e2) { if (!nse.size) throw e2; }
    }
    const byTicker = new Map<string, any>(idxQuotes.map((q) => [q.symbol, q]));
    const idxRows: any[] = [];
    const idxReport: Record<string, string> = {};
    for (const ix of INDEXES) {
      const n = nse.get(ix.nse || ix.name);
      if (n) {
        const ch = n.prev ? n.price - n.prev : 0;
        idxRows.push({ symbol: ix.tickers[0], name: ix.name, display_name: ix.display, sort_order: ix.order, price: n.price, previous_close: n.prev, change: ch, change_percent: n.prev ? ch / n.prev * 100 : 0, updated_at: nowIso });
        idxReport[ix.name] = "NSE";
        continue;
      }
      let used: string | null = null;
      for (const t of ix.tickers) {
        const q = byTicker.get(t);
        const price = Number(q?.regularMarketPrice), prev = Number(q?.regularMarketPreviousClose);
        if (q && price > 0) {
          used = t;
          const ch = prev > 0 ? price - prev : Number(q.regularMarketChange) || 0;
          const pct = prev > 0 ? (ch / prev) * 100 : Number(q.regularMarketChangePercent) || 0;
          idxRows.push({ symbol: t, name: ix.name, display_name: ix.display, sort_order: ix.order, price, previous_close: prev > 0 ? prev : null, change: ch, change_percent: pct, updated_at: nowIso });
          break;
        }
      }
      idxReport[ix.name] = used || "NOT FOUND";
    }
    const mktRows: any[] = [];
    for (const m of MARKETS) {
      const n = m.nse ? nse.get(m.nse) : undefined;
      const q = byTicker.get(m.symbol);
      const price = n ? n.price : Number(q?.regularMarketPrice);
      const prev = n ? Number(n.prev) : Number(q?.regularMarketPreviousClose);
      if ((n || q) && price > 0) {
        const ch = prev > 0 ? price - prev : Number(q?.regularMarketChange) || 0;
        const pct = prev > 0 ? (ch / prev) * 100 : Number(q?.regularMarketChangePercent) || 0;
        mktRows.push({ symbol: m.symbol, key: m.key, name: m.name, price, previous_close: prev > 0 ? prev : null, change: ch, change_percent: pct, updated_at: nowIso });
        idxReport[m.name] = n ? "NSE" : m.symbol;
      } else idxReport[m.name] = "NOT FOUND";
    }
    if (test) return json({ test: true, found: idxRows.length, of: INDEXES.length, markets: mktRows.length, nse: nse.size, report: idxReport });

    if (idxRows.length) {
      const { error } = await supabase.from("sector_index_quotes").upsert(idxRows, { onConflict: "symbol" });
      if (error) throw new Error("index upsert: " + error.message);
    }
    if (mktRows.length) {
      const { error } = await supabase.from("market_quotes").upsert(mktRows, { onConflict: "symbol" });
      if (error) throw new Error("market upsert: " + error.message);
    }

    // ---------- every stock (stalest first, so a throttled run still improves things) ----------
    const [symbols, ages] = await Promise.all([allSymbols(), quoteAges()]);
    symbols.sort((a, b) => (ages.get(a) || 0) - (ages.get(b) || 0));
    const known = new Set(symbols);
    let updated = 0, requested = 0, throttled = false, failedChunks = 0;
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));

    const processChunk = async (chunk: string[]) => {
      const ys = chunk.map((s) => s + ".NS");
      requested += chunk.length;
      let res: any[];
      try { res = await fetchQuotes(ys, session); }
      catch (e) {
        if (e instanceof Throttled) { throttled = true; return; }
        failedChunks++; return;
      }
      const rows: any[] = [];
      for (const q of res) {
        const sym = String(q.symbol || "").replace(/\.NS$/, "");
        if (!known.has(sym)) continue;
        const price = Number(q.regularMarketPrice);
        if (!(price > 0)) continue;
        const prev = Number(q.regularMarketPreviousClose);
        const change = prev > 0 ? price - prev : (Number(q.regularMarketChange) || 0);
        const pct = prev > 0 ? (change / prev) * 100 : (Number(q.regularMarketChangePercent) || 0);
        rows.push({
          symbol: sym, price, previous_close: prev > 0 ? prev : null,
          open: num(q.regularMarketOpen), high: num(q.regularMarketDayHigh), low: num(q.regularMarketDayLow),
          change, change_percent: pct,
          high_52w: num(q.fiftyTwoWeekHigh), low_52w: num(q.fiftyTwoWeekLow),
          market_cap: num(q.marketCap), volume: num(q.regularMarketVolume),
          fifty_day_avg: num(q.fiftyDayAverage), two_hundred_day_avg: num(q.twoHundredDayAverage),
          avg_volume_3m: num(q.averageDailyVolume3Month),
          source: "yahoo",
          quote_time: q.regularMarketTime ? new Date(Number(q.regularMarketTime) * 1000).toISOString() : null,
          updated_at: nowIso,
        });
      }
      if (rows.length) {
        const { error } = await supabase.from("stock_quotes").upsert(rows, { onConflict: "symbol" });
        if (error) { failedChunks++; return; }
        updated += rows.length;
      }
    };

    let next = 0;
    const worker = async () => {
      while (next < chunks.length && !throttled && Date.now() - started < TIME_BUDGET_MS) {
        const c = chunks[next++];
        await processChunk(c);
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    const summary = {
      stocks: symbols.length, requested, updated, indexes: idxRows.length, indexesTotal: INDEXES.length,
      markets: mktRows.length, throttled, failedChunks, partial: next < chunks.length, nse: nse.size > 0,
    };
    await finish(!throttled || updated > 0, throttled ? "Yahoo rate limit hit (partial refresh)" : null, summary);
    console.log("SECTOR_REFRESH", JSON.stringify(summary));
    return json({ ...summary, report: idxReport });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    await finish(false, msg, { error: msg });
    console.error("SECTOR_REFRESH_FATAL", e);
    return json({ error: msg }, 500);
  }
});
