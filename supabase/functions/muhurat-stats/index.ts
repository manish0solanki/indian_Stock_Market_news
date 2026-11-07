// muhurat-stats: numbers for the Muhurat trading card (muhurat.js), saved to festival_stats('muhurat-2026').
//   history  the Nifty 50 in each Diwali Muhurat session since 2016 (the session's close vs the previous close) and over
//            the Samvat year that followed (Muhurat close to the next Muhurat close, or to the latest close), from
//            Yahoo's daily ^NSEI bars, or for weekend sessions (not in Yahoo) the published close and move (PUBLISHED);
//            2026's session from NSE's index feed when run on 8 Nov after the close and Yahoo has no bar for it.
//   samvat   Samvat 2082 so far (last Muhurat close, 21 Oct 2025, to the latest close): the Nifty 50 stocks
//            (index_members) best and worst, from Yahoo, and the NSE sector indices from sector_index_history.
// POST, x-cron-secret. Run once to build it and again after Sunday's session to add 2026's Muhurat move.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const r2 = (v: number) => Math.round(v * 100) / 100;

// Diwali Muhurat sessions (IST dates) and the Samvat year each one starts.
const MUHURAT: [string, number][] = [["2016-10-30", 2073], ["2017-10-19", 2074], ["2018-11-07", 2075], ["2019-10-27", 2076], ["2020-11-14", 2077],
  ["2021-11-04", 2078], ["2022-10-24", 2079], ["2023-11-12", 2080], ["2024-11-01", 2081], ["2025-10-21", 2082], ["2026-11-08", 2083]];
const LAST = "2025-10-21";
// Weekend sessions aren't in Yahoo's daily bars: their Nifty close and % move as published (Anand Rathi, HDFC SKY,
// Finnovate, Zeebiz; each matched by at least two of them).
const PUBLISHED: Record<string, [number, number]> = { "2016-10-30": [8625.7, -0.14], "2019-10-27": [11627.15, 0.37], "2020-11-14": [12780.25, 0.47], "2023-11-12": [19525.55, 0.51] };

async function daily(symbol: string, range: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const res = (await r.json())?.chart?.result?.[0];
        const ts: number[] = res?.timestamp || [], cl: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
        const m = new Map<string, number>();
        ts.forEach((t, i) => { const c = cl[i]; if (c && c > 0) m.set(new Date((t + 5.5 * 3600) * 1000).toISOString().slice(0, 10), c); });
        return [...m].sort((x, y) => x[0].localeCompare(y[0])); // [date, close] ascending
      }
    } catch { /* retry */ }
    await new Promise((ok) => setTimeout(ok, 600 * (a + 1)));
  }
  return [] as [string, number][];
}
// NSE's own index feed (used on the Muhurat day itself, when Yahoo may not carry a Sunday session)
async function nseNifty(): Promise<{ last: number; prev: number } | null> {
  try {
    const r = await fetch("https://www.nseindia.com/api/allIndices", { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.nseindia.com/", "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const x = ((await r.json())?.data || []).find((d: any) => String(d.index).toUpperCase() === "NIFTY 50");
    const last = Number(x?.last), prev = Number(x?.previousClose);
    return last > 0 && prev > 0 ? { last, prev } : null;
  } catch { return null; }
}
const TODAY_SESSION = "2026-11-08";
// close on or before a date (the last trading day up to it)
const onOrBefore = (bars: [string, number][], d: string) => { let v: [string, number] | null = null; for (const b of bars) { if (b[0] <= d) v = b; else break; } return v; };

Deno.serve(async (req) => {
  const { data: sec } = await sb.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
  if (!sec || req.headers.get("x-cron-secret") !== sec.value) return json({ error: "unauthorized" }, 401);

  // ---- Nifty in each Muhurat session and the Samvat year after it
  const nifty = await daily("^NSEI", "15y");
  const idx = new Map(nifty.map((b, i) => [b[0], i]));
  const latest = nifty[nifty.length - 1];
  // each session's close and move: Yahoo's bar when there is one, else the published figure
  const sess = new Map<string, { close: number; chg: number; pts: number | null; src: string }>();
  for (const [d] of MUHURAT) {
    const i = idx.get(d);
    if (i !== undefined && i > 0) sess.set(d, { close: nifty[i][1], chg: (nifty[i][1] / nifty[i - 1][1] - 1) * 100, pts: nifty[i][1] - nifty[i - 1][1], src: "yahoo" });
    else if (PUBLISHED[d]) { const [c, ch] = PUBLISHED[d]; sess.set(d, { close: c, chg: ch, pts: c - c / (1 + ch / 100), src: "published" }); }
  }
  // this year's session, from NSE when run on 8 Nov after the close and Yahoo has no bar for it
  const istNow = new Date(Date.now() + 330 * 60e3);
  if (!sess.has(TODAY_SESSION) && istNow.toISOString().slice(0, 10) === TODAY_SESSION && istNow.getUTCHours() * 60 + istNow.getUTCMinutes() >= 15 * 60 + 30) {
    const n = await nseNifty();
    if (n) sess.set(TODAY_SESSION, { close: n.last, chg: (n.last / n.prev - 1) * 100, pts: n.last - n.prev, src: "nse" });
  }
  const history = MUHURAT.map(([d, samvat], k) => {
    const row: any = { date: d, samvat }, x = sess.get(d);
    if (!x) { if (d <= latest[0]) row.missing = true; return row; }
    row.close = r2(x.close); row.chg = r2(x.chg); row.pts = x.pts === null ? null : r2(x.pts); row.src = x.src;
    // the Samvat year after: this Muhurat close to the next one (or to the latest close while the year is running)
    const nextD = MUHURAT[k + 1]?.[0], nx = nextD ? sess.get(nextD) : null;
    if (nx) { row.year = r2((nx.close / x.close - 1) * 100); row.year_to = nextD; row.year_done = true; }
    else if (latest[0] > d) { row.year = r2((latest[1] / x.close - 1) * 100); row.year_to = latest[0]; row.year_done = false; }
    return row;
  });

  // ---- Samvat 2082 so far: Nifty 50 stocks
  const { data: mem } = await sb.from("index_members").select("symbol,company").eq("index_name", "NIFTY 50");
  const stocks: any[] = [];
  const list = mem || [];
  for (let i = 0; i < list.length; i += 10) {
    const got = await Promise.all(list.slice(i, i + 10).map(async (m: any) => {
      const bars = await daily(m.symbol + ".NS", "2y");
      const a = onOrBefore(bars, LAST), b = bars[bars.length - 1];
      return a && b && b[0] > a[0] ? { s: m.symbol, n: m.company, from: r2(a[1]), to: r2(b[1]), chg: r2((b[1] / a[1] - 1) * 100) } : null;
    }));
    stocks.push(...got.filter(Boolean));
  }
  stocks.sort((x, y) => y.chg - x.chg);
  const up = stocks.filter((x) => x.chg > 0).length;

  // ---- sector indices from our own daily history
  const { data: secs } = await sb.from("sector_index_quotes").select("symbol,display_name,name");
  const sectors: any[] = [];
  for (const s of secs || []) {
    const { data: h } = await sb.from("sector_index_history").select("d,close").eq("symbol", s.symbol).order("d");
    const bars = (h || []).map((x: any) => [x.d, Number(x.close)] as [string, number]);
    const a = onOrBefore(bars, LAST), b = bars[bars.length - 1];
    if (a && b && a[0] >= "2025-10-01" && b[0] > a[0]) sectors.push({ s: s.symbol, n: (s.display_name || s.name || s.symbol).replace(/^Nifty /, ""), chg: r2((b[1] / a[1] - 1) * 100) });
  }
  sectors.sort((x, y) => y.chg - x.chg);

  const n0 = onOrBefore(nifty, LAST);
  const data = {
    built_at: new Date().toISOString(), history,
    samvat: { name: "Samvat 2082", from: LAST, to: latest[0], nifty: n0 ? { from: r2(n0[1]), to: r2(latest[1]), chg: r2((latest[1] / n0[1] - 1) * 100) } : null,
      stocks_n: stocks.length, stocks_up: up, best: stocks.slice(0, 5), worst: stocks.slice(-5).reverse(), sectors },
  };
  const { error } = await sb.from("festival_stats").upsert({ key: "muhurat-2026", data, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return json(error ? { error: error.message } : { ok: true, history, nifty_2082: data.samvat.nifty, stocks: stocks.length, sectors: sectors.length });
});
