// index-refresh: Market Snapshot (Indian indices) + Global Indices for the home page and Signals.
// Runs every minute from a Supabase cron job and writes public.index_quotes.
//
// NSE indices come from NSE's own allIndices feed, so value, previous close and change match NSE.
// Everything else (Sensex, BANKEX, global indices) uses Yahoo's daily chart: the previous close is
// the close of the last finished session. (Yahoo's quote API returns the close from two sessions
// back as "previous close" after market hours, which made the evening change wrong.)
// Global indices are refreshed every 5 minutes; Indian indices every minute.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

// nse: index name in NSE's allIndices feed; tickers: Yahoo symbols, first one that returns data wins.
type Def = { grp: "snapshot" | "global"; name: string; order: number; tickers: string[]; nse?: string };
const DEFS: Def[] = [
  { grp: "snapshot", name: "NIFTY 50", order: 1, tickers: ["^NSEI"], nse: "NIFTY 50" },
  { grp: "snapshot", name: "NIFTY BANK", order: 2, tickers: ["^NSEBANK"], nse: "NIFTY BANK" },
  { grp: "snapshot", name: "SENSEX", order: 3, tickers: ["^BSESN"] },
  { grp: "snapshot", name: "BANKEX", order: 4, tickers: ["BSE-BANK.BO", "^BSEBANK"] },
  { grp: "snapshot", name: "NIFTY MIDCAP 50", order: 5, tickers: ["^NSEMDCP50", "NIFTY_MIDCAP_50.NS"], nse: "NIFTY MIDCAP 50" },
  { grp: "snapshot", name: "NIFTY FIN SERVICE", order: 6, tickers: ["NIFTY_FIN_SERVICE.NS", "^CNXFIN"], nse: "NIFTY FINANCIAL SERVICES" },
  { grp: "global", name: "S&P 500", order: 1, tickers: ["ES=F", "^GSPC"] },
  { grp: "global", name: "Nasdaq", order: 2, tickers: ["^IXIC"] },
  { grp: "global", name: "Dow Jones", order: 3, tickers: ["^DJI"] },
  { grp: "global", name: "FTSE 100", order: 4, tickers: ["^FTSE"] },
  { grp: "global", name: "Nikkei 225", order: 5, tickers: ["^N225"] },
  { grp: "global", name: "Hang Seng", order: 6, tickers: ["^HSI"] },
  { grp: "global", name: "DAX", order: 7, tickers: ["^GDAXI"] },
  { grp: "global", name: "CAC 40", order: 8, tickers: ["^FCHI"] },
  { grp: "global", name: "Crude Oil", order: 9, tickers: ["CL=F"] },
  { grp: "global", name: "Bitcoin", order: 10, tickers: ["BTC-USD"] },
];

type Quote = { price: number; prev: number | null; source: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function nseIndices(): Promise<Map<string, Quote>> {
  const r = await fetch("https://www.nseindia.com/api/allIndices", {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.nseindia.com/", "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!r.ok) throw new Error("NSE HTTP " + r.status);
  const d = await r.json();
  const out = new Map<string, Quote>();
  for (const x of d?.data || []) {
    const price = Number(x.last), prev = Number(x.previousClose);
    if (price > 0) out.set(String(x.index), { price, prev: prev > 0 ? prev : null, source: "nse" });
  }
  return out;
}

// Daily bars: previous close = close of the last finished session before the latest bar.
async function yahooChart(symbol: string): Promise<Quote | null> {
  const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=5d&interval=1d", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!r.ok) return null;
  const res = (await r.json())?.chart?.result?.[0];
  if (!res) return null;
  const meta = res.meta || {};
  const ts: number[] = res.timestamp || [];
  const closes: (number | null)[] = res.indicators?.quote?.[0]?.close || [];
  const bars = ts.map((t, i) => ({ t, c: Number(closes[i]) })).filter((b) => b.c > 0);
  const price = Number(meta.regularMarketPrice) || bars[bars.length - 1]?.c;
  if (!(price > 0)) return null;
  const prev = bars.length >= 2 ? bars[bars.length - 2].c : Number(meta.chartPreviousClose) || null;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { price: r2(price), prev: prev && prev > 0 ? r2(prev) : null, source: "yahoo-chart" };
}

Deno.serve(async (req) => {
  const started = Date.now();
  let beat = false;
  const finish = async (ok: boolean, error: string | null, summary: unknown) => {
    if (!beat) return;
    beat = false;
    try {
      await supabase.rpc("bot_job_finish", { p_job: "index", p_ok: ok, p_error: error, p_duration_ms: Date.now() - started, p_summary: summary, p_log: false });
    } catch (_e) { /* ignore */ }
  };
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: sec } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!sec || !secret || secret !== sec.value) return json({ error: "unauthorized" }, 401);
    const url = new URL(req.url);
    const test = url.searchParams.get("test") === "1";

    if (!test) {
      const { data: go } = await supabase.rpc("bot_job_start", { p_job: "index", p_interval: 60 });
      if (go === false) return json({ skipped: "previous run still in progress" });
      beat = true;
    }

    const withGlobal = test || url.searchParams.get("global") === "1" || new Date().getUTCMinutes() % 5 === 0;
    const defs = DEFS.filter((d) => d.grp === "snapshot" || withGlobal);
    const nse = await nseIndices().catch((e) => { console.warn("NSE feed unavailable:", String(e)); return new Map<string, Quote>(); });

    const nowIso = new Date().toISOString();
    const report: Record<string, string> = {};
    const rows = (await Promise.all(defs.map(async (d) => {
      let q: Quote | null = d.nse ? nse.get(d.nse) || null : null;
      let used = q ? "NSE" : "";
      for (const t of d.tickers) {
        if (q) break;
        q = await yahooChart(t).catch(() => null);
        if (q) used = t;
      }
      report[`${d.grp}:${d.name}`] = used || "NOT FOUND";
      if (!q) return null;
      const change = q.prev ? q.price - q.prev : 0;
      return {
        grp: d.grp, symbol: d.tickers[0], display_name: d.name, sort_order: d.order,
        price: q.price, previous_close: q.prev, change, change_percent: q.prev ? change / q.prev * 100 : 0, updated_at: nowIso,
      };
    }))).filter(Boolean);
    if (test) return json({ test: true, found: rows.length, of: defs.length, report, rows });

    if (rows.length) {
      const { error } = await supabase.from("index_quotes").upsert(rows, { onConflict: "grp,symbol" });
      if (error) throw new Error("upsert: " + error.message);
    }
    const summary = { found: rows.length, of: defs.length, missing: defs.length - rows.length, nse: nse.size > 0 };
    await finish(rows.length > 0, rows.length ? null : "no index returned a price", summary);
    return json({ ...summary, report });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    await finish(false, msg, { error: msg });
    console.error("INDEX_REFRESH_FATAL", e);
    return json({ error: msg }, 500);
  }
});
