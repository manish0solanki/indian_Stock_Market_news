// econ-actuals: fills in the released figures on the Events page's economy dates (public.econ_events).
// US CPI: the official numbers from the US Bureau of Labor Statistics public API (no key; v1 allows 25 calls a day,
// and pg_cron only calls this on a CPI day until the figure is in). Headline CPI-U (CUUR0000SA0) and core
// (CUUR0000SA0L1E), not seasonally adjusted, as year-on-year % — the number the market quotes.
//   actual   "3.0% y/y (core 3.1%)"   previous  the month before, same format
// India CPI, RBI and Fed decisions are not fetched yet (filled by hand when needed).
// Auth: x-cron-secret header must match app_secrets 'crypto_cron'.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function bls(series: string[]) {
  const r = await fetch("https://api.bls.gov/publicAPI/v1/timeseries/data/", {
    method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (compatible; market-calendar)" },
    body: JSON.stringify({ seriesid: series }),
  });
  if (!r.ok) throw new Error("BLS " + r.status);
  const d = await r.json();
  if (d.status !== "REQUEST_SUCCEEDED") throw new Error("BLS: " + (d.message || []).join(" "));
  const out: Record<string, Map<string, number>> = {};
  for (const s of d.Results?.series || []) {
    const m = new Map<string, number>();
    for (const x of s.data || []) if (/^M(0[1-9]|1[0-2])$/.test(x.period) && Number(x.value) > 0) m.set(x.year + "-" + x.period.slice(1), Number(x.value));
    out[s.seriesID] = m;
  }
  return out;
}
const prevMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 - n, 1)); return d.toISOString().slice(0, 7); };
const yoy = (m: Map<string, number> | undefined, ym: string) => {
  const a = m?.get(ym), b = m?.get(prevMonth(ym, 12));
  return a && b ? Math.round((a / b - 1) * 1000) / 10 : null;
};
const mom = (m: Map<string, number> | undefined, ym: string) => {
  const a = m?.get(ym), b = m?.get(prevMonth(ym, 1));
  return a && b ? Math.round((a / b - 1) * 1000) / 10 : null;
};
const sg = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%";
// "3.0% y/y, +0.2% m/m (core 3.1% y/y)". When the year-ago month was never published (the October 2025 US
// shutdown), only the month-on-month change can be given.
function fmt(head: Map<string, number> | undefined, core: Map<string, number> | undefined, ym: string): string | null {
  const hy = yoy(head, ym), hm = mom(head, ym), cy = yoy(core, ym), cm = mom(core, ym);
  if (hy !== null) return hy.toFixed(1) + "% y/y" + (hm !== null ? ", " + sg(hm) + " m/m" : "") + (cy !== null ? " (core " + cy.toFixed(1) + "% y/y)" : "");
  if (hm !== null) return sg(hm) + " m/m" + (cm !== null ? " (core " + sg(cm) + " m/m)" : "");
  return null;
}

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: s } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!s || !secret || secret !== s.value) return json({ error: "unauthorized" }, 401);
    const today = new Date(Date.now() + 330 * 60e3).toISOString().slice(0, 10);
    // US CPI rows already released (date reached) but missing the figure, from the last 400 days.
    const { data: rows } = await supabase.from("econ_events").select("id,event_date,period,actual,previous").eq("kind", "uscpi")
      .lte("event_date", today).gte("event_date", new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)).order("event_date");
    const todo = (rows || []).filter((r: any) => !r.actual || !r.previous);
    if (!todo.length) return json({ uscpi: "nothing to fill" });
    const data = await bls(["CUUR0000SA0", "CUUR0000SA0L1E"]);
    const head = data["CUUR0000SA0"], core = data["CUUR0000SA0L1E"];
    const filled: string[] = [], waiting: string[] = [];
    for (const r of todo) {
      // period "October 2026" -> "2026-10"
      const m = String(r.period || "").match(/^([A-Za-z]+)\s+(\d{4})$/);
      const mi = m ? MONTHS.indexOf(m[1]) : -1;
      if (mi < 0) continue;
      const ym = m![2] + "-" + String(mi + 1).padStart(2, "0");
      if (!head?.has(ym)) { waiting.push(r.id); continue; }
      const actual = fmt(head, core, ym);
      const previous = fmt(head, core, prevMonth(ym, 1));
      if (!actual) { waiting.push(r.id); continue; }
      const noYoY = yoy(head, ym) === null;
      const upd: any = { actual, previous: r.previous || previous, updated_at: new Date().toISOString() };
      if (noYoY) upd.note = "No year-on-year figure: BLS did not collect " + MONTHS[+prevMonth(ym, 12).slice(5) - 1] + " " + prevMonth(ym, 12).slice(0, 4) + " prices (2025 US government shutdown), so only the change from the month before is shown.";
      const { error } = await supabase.from("econ_events").update(upd).eq("id", r.id);
      if (error) throw new Error(error.message);
      filled.push(r.id + ": " + actual);
    }
    const out = { filled, waiting, latest: [...(head?.keys() || [])].sort().pop() };
    console.log("ECON_ACTUALS", JSON.stringify(out));
    return json(out);
  } catch (e) {
    console.error("ECON_ACTUALS_FATAL", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
