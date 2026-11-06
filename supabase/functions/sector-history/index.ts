// sector-history: daily closes for the NSE sector indices (sector_index_quotes) and the Nifty 50, kept in
// sector_index_history for the Sectors page (returns over 1W–1Y, trend, relative strength and the rotation map).
// Source: Yahoo Finance daily chart (the same source as the live sector quotes).
// POST [?range=2y]  default: 2 years when a symbol has no history yet, otherwise the last month.
// Also refreshes index_members (Nifty 50 and Nifty Bank constituents, from NSE's index lists) for market_why().
// Auth: x-cron-secret (app_secrets 'crypto_cron'); run by pg_cron 'sector-history' after the close.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

async function closes(symbol: string, range: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
      if (r.ok) {
        const res = (await r.json())?.chart?.result?.[0];
        const ts: number[] = res?.timestamp || [];
        const cl: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
        const out = new Map<string, number>();
        ts.forEach((t, i) => {
          const c = cl[i];
          if (c && c > 0) out.set(new Date((t + 5.5 * 3600) * 1000).toISOString().slice(0, 10), Math.round(c * 100) / 100); // IST date
        });
        return [...out].map(([d, close]) => ({ symbol, d, close }));
      }
    } catch { /* retry */ }
    await new Promise((ok) => setTimeout(ok, 700 * (a + 1)));
  }
  return [];
}

// NSE index constituents -> index_members. CSV columns: Company Name, Industry, Symbol, Series, ISIN Code.
// A list is replaced only when it parses to a sensible size, so a bad download never empties it.
const LISTS: [string, string, number][] = [["NIFTY 50", "ind_nifty50list.csv", 45], ["NIFTY BANK", "ind_niftybanklist.csv", 10]];
async function refreshMembers() {
  const out: Record<string, number | string> = {};
  for (const [name, file, min] of LISTS) {
    try {
      const r = await fetch(`https://nsearchives.nseindia.com/content/indices/${file}`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv,*/*" } });
      if (!r.ok) { out[name] = "http " + r.status; continue; }
      const lines = (await r.text()).trim().split(/\r?\n/);
      const hdr = lines.shift()!.split(",").map((h) => h.trim().toLowerCase());
      const iS = hdr.indexOf("symbol"), iC = hdr.indexOf("company name"), iI = hdr.indexOf("industry");
      if (iS < 0) { out[name] = "bad header"; continue; }
      const rows = lines.map((l) => l.split(",")).filter((c) => c[iS]?.trim())
        .map((c) => ({ index_name: name, symbol: c[iS].trim(), company: c[iC]?.trim() || null, industry: c[iI]?.trim() || null, updated_at: new Date().toISOString() }));
      if (rows.length < min) { out[name] = "only " + rows.length; continue; }
      const { error } = await sb.from("index_members").upsert(rows, { onConflict: "index_name,symbol" });
      if (error) { out[name] = error.message; continue; }
      // drop stocks that have left the index
      await sb.from("index_members").delete().eq("index_name", name).not("symbol", "in", `(${rows.map((x) => `"${x.symbol}"`).join(",")})`);
      out[name] = rows.length;
    } catch (e) { out[name] = String(e); }
  }
  return out;
}

Deno.serve(async (req) => {
  const { data: sec } = await sb.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
  if (!sec || req.headers.get("x-cron-secret") !== sec.value) return json({ error: "unauthorized" }, 401);
  const force = new URL(req.url).searchParams.get("range");
  const { data: idx } = await sb.from("sector_index_quotes").select("symbol");
  const symbols = [...new Set(["^NSEI", ...(idx || []).map((r) => r.symbol)])];
  const { data: have } = await sb.from("sector_index_history").select("symbol").limit(5000);
  const known = new Set((have || []).map((r) => r.symbol));
  let rows = 0; const empty: string[] = [];
  for (let i = 0; i < symbols.length; i += 5) {
    const got = await Promise.all(symbols.slice(i, i + 5).map((s) => closes(s, force || (known.has(s) ? "1mo" : "2y"))));
    for (const g of got) {
      if (!g.length) continue;
      const { error } = await sb.from("sector_index_history").upsert(g, { onConflict: "symbol,d" });
      if (error) return json({ error: error.message }, 500);
      rows += g.length;
    }
    got.forEach((g, k) => { if (!g.length) empty.push(symbols[i + k]); });
  }
  const members = await refreshMembers();
  return json({ ok: true, symbols: symbols.length, rows, empty, members });
});
