// index-history: daily closes of a benchmark index, for the Portfolio "vs Nifty" comparison.
// GET ?index=NIFTY50 (default) | SENSEX | NIFTYBANK  ->  { index, symbol, closes: [["2016-11-01", 8625.7], ...] }
// Up to 10 years of daily closes from Yahoo Finance, dated in IST. Whitelisted symbols only; cached 6 hours.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const INDICES: Record<string, string> = { NIFTY50: "^NSEI", SENSEX: "^BSESN", NIFTYBANK: "^NSEBANK" };
const cache = new Map<string, { at: number; body: string }>();
const TTL = 6 * 3600e3;

function json(body: string, status = 200) {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": status === 200 ? "public, max-age=3600" : "no-store" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const index = (new URL(req.url).searchParams.get("index") || "NIFTY50").toUpperCase();
  const symbol = INDICES[index];
  if (!symbol) return json(JSON.stringify({ ok: false, error: "index must be one of " + Object.keys(INDICES).join(", ") }), 400);
  const hit = cache.get(index);
  if (hit && Date.now() - hit.at < TTL) return json(hit.body);
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d&includePrePost=false`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!r.ok) throw new Error("Yahoo HTTP " + r.status);
    const res = (await r.json())?.chart?.result?.[0];
    const ts: number[] = res?.timestamp || [];
    const cl: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
    const byDay = new Map<string, number>();
    ts.forEach((t, i) => {
      const c = cl[i];
      if (c === null || c === undefined || !Number.isFinite(c) || c <= 0) return;
      byDay.set(new Date((t + 19800) * 1000).toISOString().slice(0, 10), Math.round(c * 100) / 100); // IST date
    });
    // The live price fills in today's session when the daily bar has no close yet.
    const live = Number(res?.meta?.regularMarketPrice), liveT = Number(res?.meta?.regularMarketTime);
    if (live > 0 && liveT > 0) byDay.set(new Date((liveT + 19800) * 1000).toISOString().slice(0, 10), Math.round(live * 100) / 100);
    const closes = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (closes.length < 10) throw new Error("no data");
    const body = JSON.stringify({ ok: true, index, symbol, closes, fetched_at: new Date().toISOString() });
    cache.set(index, { at: Date.now(), body });
    return json(body);
  } catch (e) {
    if (hit) return json(hit.body);
    return json(JSON.stringify({ ok: false, error: (e as Error).message }), 502);
  }
});
