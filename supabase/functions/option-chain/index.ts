// Option chain for an NSE index or F&O stock, from NSE's option-chain API, with the basics worked out:
// put-call ratio, max pain, the strikes with the most call / put open interest, ATM IV and the
// expected move from the ATM straddle.
//   GET ?symbol=NIFTY[&expiry=03-Nov-2026]   (default expiry: the nearest)
// Rows: [strike, ceOI, ceChgOI, ceVol, ceIV, ceLTP, ceChg, peOI, peChgOI, peVol, peIV, peLTP, peChg]
// Responses are cached for a minute per symbol + expiry, so NSE sees at most one call a minute each.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const NSE = "https://www.nseindia.com";
const HEADERS = { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: "https://www.nseindia.com/option-chain", "Accept-Language": "en-US,en;q=0.9" };
const INDICES = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };

const cache = new Map<string, { at: number; body: string }>();
const expiryCache = new Map<string, { at: number; list: string[] }>();

function reply(body: string, status = 200, maxAge = 60) {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` } });
}
async function nse(path: string) {
  const r = await fetch(NSE + path, { headers: HEADERS });
  if (!r.ok) throw new Error("NSE " + r.status);
  return await r.json();
}
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

async function expiries(symbol: string): Promise<string[]> {
  const hit = expiryCache.get(symbol);
  if (hit && Date.now() - hit.at < 3600e3) return hit.list;
  const d = await nse("/api/option-chain-contract-info?symbol=" + encodeURIComponent(symbol));
  const list: string[] = Array.isArray(d?.expiryDates) ? d.expiryDates : [];
  if (list.length) expiryCache.set(symbol, { at: Date.now(), list });
  return list;
}

function analyse(rows: number[][], spot: number) {
  let ceOI = 0, peOI = 0, ceVol = 0, peVol = 0, ceChg = 0, peChg = 0;
  for (const r of rows) { ceOI += r[1]; ceChg += r[2]; ceVol += r[3]; peOI += r[7]; peChg += r[8]; peVol += r[9]; }
  // Max pain: the expiry price at which option buyers, in total, would get the least.
  let maxPain = null as number | null, least = Infinity;
  for (const [k] of rows) {
    let pain = 0;
    for (const r of rows) pain += r[1] * Math.max(0, k - r[0]) + r[7] * Math.max(0, r[0] - k);
    if (pain < least) { least = pain; maxPain = k; }
  }
  // Resistance: the call strike at or above spot with the most OI; support: the put strike at or below it.
  const top = (i: number, ok: (k: number) => boolean) => rows.reduce((a, r) => (ok(r[0]) && r[i] > (a ? a[i] : 0) ? r : a), null as number[] | null);
  const ceTop = top(1, (k) => k >= spot), peTop = top(7, (k) => k <= spot);
  const atm = rows.reduce((a, r) => (a === null || Math.abs(r[0] - spot) < Math.abs(a[0] - spot) ? r : a), null as number[] | null);
  const straddle = atm && atm[5] > 0 && atm[11] > 0 ? atm[5] + atm[11] : null;
  const ivs = atm ? [atm[4], atm[10]].filter((x) => x > 0) : [];
  return {
    totals: { ceOI, peOI, ceVol, peVol, ceChgOI: ceChg, peChgOI: peChg },
    pcr: ceOI > 0 ? r2(peOI / ceOI) : null,
    pcrVol: ceVol > 0 ? r2(peVol / ceVol) : null,
    maxPain,
    resistance: ceTop ? ceTop[0] : null,
    support: peTop ? peTop[0] : null,
    atm: atm ? atm[0] : null,
    atmIV: ivs.length ? r2(ivs.reduce((a, b) => a + b, 0) / ivs.length) : null,
    straddle: straddle === null ? null : r2(straddle),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const u = new URL(req.url);
  const symbol = (u.searchParams.get("symbol") || "NIFTY").toUpperCase().trim();
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) return reply(JSON.stringify({ error: "Bad symbol" }), 400);
  let expiry = u.searchParams.get("expiry") || "";
  if (expiry && !/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(expiry)) return reply(JSON.stringify({ error: "Bad expiry" }), 400);
  try {
    const list = await expiries(symbol);
    if (!list.length) return reply(JSON.stringify({ error: symbol + " has no options on NSE" }), 404, 300);
    if (!expiry || !list.includes(expiry)) expiry = list[0];
    const key = symbol + "|" + expiry;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 60e3) return reply(hit.body);

    const type = INDICES.has(symbol) ? "Indices" : "Equity";
    const d = await nse(`/api/option-chain-v3?type=${type}&symbol=${encodeURIComponent(symbol)}&expiry=${expiry}`);
    const rec = d?.records || {};
    const data: any[] = Array.isArray(rec.data) ? rec.data : [];
    let spot = n(rec.underlyingValue);
    const rows: number[][] = [];
    for (const x of data) {
      const ce = x.CE || {}, pe = x.PE || {};
      const k = n(x.strikePrice ?? ce.strikePrice ?? pe.strikePrice);
      if (!k) continue;
      if (!spot) spot = n(ce.underlyingValue || pe.underlyingValue);
      rows.push([k,
        n(ce.openInterest), n(ce.changeinOpenInterest), n(ce.totalTradedVolume), r2(n(ce.impliedVolatility)), r2(n(ce.lastPrice)), r2(n(ce.change)),
        n(pe.openInterest), n(pe.changeinOpenInterest), n(pe.totalTradedVolume), r2(n(pe.impliedVolatility)), r2(n(pe.lastPrice)), r2(n(pe.change))]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    const body = JSON.stringify({
      symbol, type, expiry, expiries: list, spot, timestamp: rec.timestamp || null, fetched_at: new Date().toISOString(),
      ...analyse(rows, spot), rows,
    });
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return reply(body);
  } catch (e) {
    console.error("[option-chain]", symbol, expiry, e);
    return reply(JSON.stringify({ error: "Could not load the option chain from NSE right now." }), 502, 0);
  }
});
