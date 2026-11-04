// sector-history: daily closes for the NSE sector indices (sector_index_quotes) and the Nifty 50, kept in
// sector_index_history for the Sectors page (returns over 1W–1Y, trend, relative strength and the rotation map).
// Source: Yahoo Finance daily chart (the same source as the live sector quotes).
// POST [?range=2y]  default: 2 years when a symbol has no history yet, otherwise the last month.
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
  return json({ ok: true, symbols: symbols.length, rows, empty });
});
