// market-holidays: keeps public.market_holidays in line with NSE's official trading-holiday list
// (https://www.nseindia.com/api/holiday-master?type=trading, equity segment "CM"). Runs weekly from pg_cron
// and can be called by hand. Holidays NSE stops listing (rare: a holiday moved) are removed for the years
// it returned, so the list never drifts. Weekends are not stored: NSE lists only weekday holidays.
// Auth: x-cron-secret header must match app_secrets 'crypto_cron'.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

// "26-Jan-2026" -> "2026-01-26"
function parse(s: string): string | null {
  const m = String(s || "").match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m || MON[m[2].toUpperCase()] === undefined) return null;
  return new Date(Date.UTC(+m[3], MON[m[2].toUpperCase()], +m[1])).toISOString().slice(0, 10);
}

async function nseHolidays(): Promise<any> {
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.nseindia.com/resources/exchange-communication-holidays" };
  let r = await fetch("https://www.nseindia.com/api/holiday-master?type=trading", { headers });
  if (!r.ok) {
    // Some NSE APIs want the site's cookies first.
    const home = await fetch("https://www.nseindia.com/", { headers: { "User-Agent": UA, Accept: "text/html" } });
    const cookie = (home.headers.get("set-cookie") || "").split(/,(?=\s*\w+=)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
    r = await fetch("https://www.nseindia.com/api/holiday-master?type=trading", { headers: { ...headers, Cookie: cookie } });
  }
  if (!r.ok) throw new Error("NSE " + r.status);
  return await r.json();
}

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: s } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!s || !secret || secret !== s.value) return json({ error: "unauthorized" }, 401);
    const data = await nseHolidays();
    const list = Array.isArray(data?.CM) ? data.CM : [];
    const rows = list.map((h: any) => ({ d: parse(h.tradingDate), name: String(h.description || "Market holiday").replace(/\s+/g, " ").trim(), source: "nse" }))
      .filter((h: any) => h.d);
    if (rows.length < 5) return json({ error: "NSE returned " + rows.length + " holidays; nothing changed", keys: Object.keys(data || {}) }, 502);
    const { error } = await supabase.from("market_holidays").upsert(rows, { onConflict: "d" });
    if (error) throw new Error(error.message);
    // Drop NSE-sourced dates in those years that NSE no longer lists.
    const years = [...new Set(rows.map((r: any) => r.d.slice(0, 4)))];
    let removed = 0;
    for (const y of years) {
      const keep = rows.filter((r: any) => r.d.startsWith(y)).map((r: any) => r.d);
      const { count } = await supabase.from("market_holidays").delete({ count: "exact" })
        .eq("source", "nse").gte("d", y + "-01-01").lte("d", y + "-12-31").not("d", "in", "(" + keep.join(",") + ")");
      removed += count || 0;
    }
    const out = { holidays: rows.length, years, removed, list: rows.map((r: any) => r.d + " " + r.name) };
    console.log("MARKET_HOLIDAYS", JSON.stringify(out));
    return json(out);
  } catch (e) {
    console.error("MARKET_HOLIDAYS_FATAL", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
