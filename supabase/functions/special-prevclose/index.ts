// special-prevclose: fills session_prev_close (supabase/special-session-prevclose.sql) for a special session, from NSE's
// cash-market bhavcopy of the last regular session. The stock_quotes trigger then uses it for quotes traded on that day.
// POST ?d=2026-11-08&prev=2026-11-06  (d = the special session's IST date, prev = the last regular session).
// Auth: x-cron-secret (app_secrets 'crypto_cron').
import { createClient } from "npm:@supabase/supabase-js@2";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SERIES = ["EQ", "BE", "BZ", "SM", "ST"]; // preferred order when a symbol trades in more than one series

Deno.serve(async (req) => {
  const { data: sec } = await sb.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
  if (!sec || req.headers.get("x-cron-secret") !== sec.value) return json({ error: "unauthorized" }, 401);
  const u = new URL(req.url), d = u.searchParams.get("d") || "", prev = u.searchParams.get("prev") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(prev)) return json({ error: "d and prev must be YYYY-MM-DD" }, 400);

  const url = `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${prev.replace(/-/g, "")}_F_0000.csv.zip`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*", Referer: "https://www.nseindia.com/" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) return json({ error: "bhavcopy HTTP " + r.status, url }, 502);
  const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const name = Object.keys(files).find((f) => f.toLowerCase().endsWith(".csv"));
  if (!name) return json({ error: "no csv in zip" }, 502);
  const lines = strFromU8(files[name]).trim().split(/\r?\n/);
  const hdr = lines.shift()!.split(",").map((h) => h.trim());
  const iS = hdr.indexOf("TckrSymb"), iR = hdr.indexOf("SctySrs"), iC = hdr.indexOf("ClsPric");
  if (iS < 0 || iC < 0) return json({ error: "unexpected columns", hdr }, 502);
  const best = new Map<string, { rank: number; close: number }>();
  for (const l of lines) {
    const c = l.split(","), sym = c[iS]?.trim(), close = Number(c[iC]), ser = (c[iR] || "").trim();
    if (!sym || !(close > 0)) continue;
    const rank = SERIES.indexOf(ser); if (rank < 0) continue;
    const cur = best.get(sym);
    if (!cur || rank < cur.rank) best.set(sym, { rank, close });
  }
  const rows = [...best].map(([symbol, v]) => ({ d, symbol, prev: v.close }));
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await sb.from("session_prev_close").upsert(rows.slice(i, i + 1000), { onConflict: "d,symbol" });
    if (error) return json({ error: error.message }, 500);
  }
  // The trigger fixes each quote on its next save. To fix that day's quotes at once:
  //   update stock_quotes set price = price where (quote_time at time zone 'Asia/Kolkata')::date = '<d>';
  return json({ ok: true, loaded: rows.length, file: name });
});
