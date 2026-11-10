// econ-actuals: fills in the released figures on the Events page's economy dates (public.econ_events).
// US CPI: the official numbers from the US Bureau of Labor Statistics public API (no key; v1 allows 25 calls a day,
// and pg_cron only calls this on a CPI day until the figure is in). Headline CPI-U (CUUR0000SA0) and core
// (CUUR0000SA0L1E) not seasonally adjusted for the year-on-year %, and the seasonally adjusted series (CUSR0000SA0,
// CUSR0000SA0L1E) for the month-on-month % — as BLS's release and the headlines quote them ("CPI rose 0.4%").
//   actual   "+0.4% m/m, 3.0% y/y (core +0.3% m/m, 3.1% y/y)"   previous  the month before, same format
// India CPI: MoSPI's eSankhyiki API (api.mospi.gov.in/api/cpi/getCPIData, base 2024=100, no key), All India,
// Combined, "CPI (General)" year-on-year inflation, with food ("Food and beverages") alongside:
//   actual   "5.54% y/y (food 7.36%)"   previous  the month before
// RBI policy: the policy repo rate from the "Current Rates" panel on rbi.org.in. On a decision day the rate there is
// compared with the last recorded one: a change is recorded at once; "unchanged" only from 12:00 IST, after the
// 10:00 announcement has had time to reach the page. The latest past decision is filled with the current rate.
// Fed (FOMC): the federal funds target range from the Fed's own table of changes (federalreserve.gov/monetarypolicy/
// openmarket.htm, newest year first; it lists changes only). A change dated on the decision day is recorded at once;
// "unchanged" once 2 hours have passed since the announcement with no new row.
// India GDP: MoSPI's eSankhyiki NAS API (getNASData, base 2022-23, quarterly, indicator 22 "GDP Growth Rate"),
// real (constant price) growth with nominal alongside: "7.8% real (10.3% nominal)", previous = the quarter before.
// The Budget has no single number to fetch; econ-summary writes what happened from the news.
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
// "+0.4% m/m, 3.0% y/y (core +0.3% m/m, 3.1% y/y)": m/m from the seasonally adjusted index (headSA/coreSA), y/y
// from the unadjusted one. When the year-ago month was never published (the October 2025 US shutdown), y/y is left out.
type S = Map<string, number> | undefined;
function fmt(head: S, core: S, headSA: S, coreSA: S, ym: string): string | null {
  const hy = yoy(head, ym), cy = yoy(core, ym), hm = mom(headSA, ym) ?? mom(head, ym), cm = mom(coreSA, ym) ?? mom(core, ym);
  if (hy === null && hm === null) return null;
  const part = (m: number | null, y: number | null) => [m !== null ? sg(m) + " m/m" : null, y !== null ? y.toFixed(1) + "% y/y" : null].filter(Boolean).join(", ");
  const c = part(cm, cy);
  return part(hm, hy) + (c ? " (core " + c + ")" : "");
}

// India CPI headline and food rows (All India, Combined) for one month from MoSPI (the API allows at most 100 rows a page).
async function mospiMonth(year: string, month: number): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 6; page++) {
    const u = `https://api.mospi.gov.in/api/cpi/getCPIData?base_year=2024&series=Current&year=${year}&month_code=${month}&Format=JSON&limit=100&page=${page}`;
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; market-calendar)", Accept: "application/json" } });
    if (!r.ok) throw new Error("MoSPI " + r.status);
    const d = await r.json();
    const rows = Array.isArray(d?.data) ? d.data : [];
    out.push(...rows.filter((x: any) => x.state === "All India" && x.sector === "Combined" && (x.division === "CPI (General)" || x.division === "Food and beverages")));
    if (out.length >= 2 || !rows.length || page >= Number(d?.meta_data?.totalPages || 1)) break;
  }
  return out;
}
async function fillIndia(today: string) {
  const { data: rows } = await supabase.from("econ_events").select("id,event_date,period,actual,previous").eq("kind", "cpi").eq("country", "IN")
    .lte("event_date", today).gte("event_date", new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)).order("event_date");
  const todo = (rows || []).filter((r: any) => !r.actual || !r.previous);
  if (!todo.length) return { india: "nothing to fill" };
  const cache = new Map<string, any[]>();
  const pick = async (y: string, month: string) => {
    const key = y + "-" + month;
    if (!cache.has(key)) cache.set(key, await mospiMonth(y, MONTHS.indexOf(month) + 1));
    const rs = cache.get(key)!;
    const g = rs.find((x: any) => x.month === month && x.division === "CPI (General)"), f = rs.find((x: any) => x.month === month && x.division === "Food and beverages");
    const n = (v: any) => v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
    return g && n(g.inflation) !== null ? n(g.inflation)!.toFixed(2) + "% y/y" + (f && n(f.inflation) !== null ? " (food " + n(f.inflation)!.toFixed(2) + "%)" : "") : null;
  };
  const filled: string[] = [], waiting: string[] = [];
  for (const r of todo) {
    const m = String(r.period || "").match(/^([A-Za-z]+)\s+(\d{4})$/);
    const mi = m ? MONTHS.indexOf(m[1]) : -1;
    if (mi < 0) continue;
    const actual = await pick(m![2], MONTHS[mi]);
    if (!actual) { waiting.push(r.id); continue; }
    const py = mi === 0 ? String(+m![2] - 1) : m![2], pm = MONTHS[(mi + 11) % 12];
    const previous = r.previous || await pick(py, pm).catch(() => null);
    const { error } = await supabase.from("econ_events").update({ actual, previous, confirmed: true, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) throw new Error(error.message);
    filled.push(r.id + ": " + actual);
  }
  return { indiaFilled: filled, indiaWaiting: waiting };
}

// RBI: the policy repo rate now, from the rbi.org.in home page's "Current Rates" panel.
async function repoNow(): Promise<number> {
  const r = await fetch("https://www.rbi.org.in/", { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", Accept: "text/html" } });
  if (!r.ok) throw new Error("RBI " + r.status);
  const m = (await r.text()).match(/Policy Repo Rate[\s\S]{0,250}?(\d{1,2}\.\d{1,2})\s*%/i);
  const v = m ? Number(m[1]) : NaN;
  if (!(v > 0 && v < 20)) throw new Error("RBI: repo rate not found on the page");
  return v;
}
const repoOf = (t: string | null) => { const m = String(t || "").match(/Repo\s+(\d{1,2}\.\d{1,2})%/); return m ? Number(m[1]) : null; };
async function fillRbi(today: string) {
  const { data: rows } = await supabase.from("econ_events").select("id,event_date,actual,previous").eq("kind", "rbi").lte("event_date", today).order("event_date");
  const all = rows || [];
  const pending = all.filter((r: any) => !r.actual);
  if (!pending.length) return { rbi: "nothing to fill" };
  const now = await repoNow();
  const istMin = (() => { const t = new Date(Date.now() + 330 * 60e3); return t.getUTCHours() * 60 + t.getUTCMinutes(); })();
  const out: string[] = [];
  const latest = all[all.length - 1];
  for (const r of pending) {
    const before = all.filter((x: any) => x.event_date < r.event_date && repoOf(x.actual) !== null).pop();
    const prevRate = before ? repoOf(before.actual) : null;
    let rate: number | null = null;
    if (r.event_date === today) {
      // Decision day: a changed rate is in; the same rate only counts once the page has had time to update.
      if (prevRate !== null && now !== prevRate) rate = now;
      else if (istMin >= 12 * 60) rate = now;
    } else if (r.id === latest.id) {
      rate = now; // the latest past decision: the rate in force now is the one it set
    }
    if (rate === null) continue;
    const diff = prevRate !== null ? Math.round((rate - prevRate) * 100) : null;
    const actual = "Repo " + rate.toFixed(2) + "%" + (diff === null ? "" : diff === 0 ? " (unchanged)" : diff < 0 ? " (cut " + Math.abs(diff) + " bp)" : " (hiked " + diff + " bp)");
    const upd: any = { actual, updated_at: new Date().toISOString() };
    if (!r.previous && prevRate !== null) upd.previous = "Repo " + prevRate.toFixed(2) + "%";
    const { error } = await supabase.from("econ_events").update(upd).eq("id", r.id);
    if (error) throw new Error(error.message);
    out.push(r.id + ": " + actual);
  }
  return { rbiFilled: out, repoNow: now };
}

// Fed: every change in the target range, newest first: { d: "YYYY-MM-DD", up, down (bp), level: "3.75-4.00" }.
const MON3: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
async function fedChanges() {
  const r = await fetch("https://www.federalreserve.gov/monetarypolicy/openmarket.htm", { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", Accept: "text/html" } });
  if (!r.ok) throw new Error("Fed " + r.status);
  const html = await r.text();
  const out: { d: string; up: number; down: number; level: string }[] = [];
  // Walk the page in order, keeping the latest <h4>YEAR</h4> seen; the first table (the current year) may come before any h4.
  const tokens = [...html.matchAll(/<h4>\s*(\d{4})\s*<\/h4>|<tr>([\s\S]*?)<\/tr>/g)];
  let year: number | null = null, firstYear: number | null = null;
  const h4s = [...html.matchAll(/<h4>\s*(\d{4})\s*<\/h4>/g)].map((m) => +m[1]);
  if (h4s.length) firstYear = Math.max(...h4s) + (/<tr>[\s\S]*?<\/tr>/.test(html.slice(0, html.indexOf("<h4>"))) ? 1 : 0);
  year = firstYear;
  for (const t of tokens) {
    if (t[1]) { year = +t[1]; continue; }
    const cells = [...t[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    if (cells.length < 4 || !year) continue;
    const dm = cells[0].match(/^([A-Za-z]+)\s+(\d{1,2})/), lv = cells[3].match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (!dm || !lv || MON3[dm[1].slice(0, 3).toLowerCase()] === undefined) continue;
    const d = new Date(Date.UTC(year, MON3[dm[1].slice(0, 3).toLowerCase()], +dm[2])).toISOString().slice(0, 10);
    out.push({ d, up: Number(cells[1]) || 0, down: Number(cells[2]) || 0, level: lv[1] + "-" + lv[2] });
  }
  return out.sort((a, b) => b.d.localeCompare(a.d));
}
async function fillFed(today: string) {
  const { data: rows } = await supabase.from("econ_events").select("id,event_date,time_ist,period,actual,previous").eq("kind", "fomc")
    .is("actual", null).lte("event_date", today).gte("event_date", new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10)).order("event_date");
  if (!rows?.length) return { fed: "nothing to fill" };
  const ch = await fedChanges();
  if (!ch.length) throw new Error("Fed: no rate table found");
  const out: string[] = [];
  const fmtLv = (l: string) => l.replace("-", "–") + "%";
  for (const r of rows) {
    // US decision day: the last date in the period, e.g. "FOMC 27–28 Oct 2026" -> 2026-10-28.
    const m = String(r.period || "").match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s*$/);
    if (!m || MON3[m[2].toLowerCase()] === undefined) continue;
    const d = new Date(Date.UTC(+m[3], MON3[m[2].toLowerCase()], +m[1])).toISOString().slice(0, 10);
    const hit = ch.find((c) => Math.abs(Date.parse(c.d) - Date.parse(d)) <= 864e5);
    const before = ch.find((c) => c.d < d && (!hit || c.d < hit.d));
    let actual: string | null = null;
    if (hit) actual = "Target " + fmtLv(hit.level) + (hit.up ? " (hiked " + hit.up + " bp)" : hit.down ? " (cut " + hit.down + " bp)" : "");
    else {
      const at = Date.parse(r.event_date + "T" + (r.time_ist || "00:30") + ":00+05:30");
      if (Date.now() > at + 2 * 3600e3 && before) actual = "Target " + fmtLv(before.level) + " (unchanged)";
    }
    if (!actual) continue;
    const upd: any = { actual, updated_at: new Date().toISOString() };
    if (!r.previous && before) upd.previous = "Target " + fmtLv(before.level);
    const { error } = await supabase.from("econ_events").update(upd).eq("id", r.id);
    if (error) throw new Error(error.message);
    out.push(r.id + ": " + actual);
  }
  return { fedFilled: out };
}

// India GDP: quarterly real growth from MoSPI. Period "Apr–Jun 2026 (Q1 FY27)" -> year 2026-27, Q1.
async function gdpYear(fy: string): Promise<any[]> {
  const u = `https://api.mospi.gov.in/api/nas/getNASData?base_year=2022-23&series=Current&frequency_code=Quarterly&indicator_code=22&year=${fy}&Format=JSON`;
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; market-calendar)", Accept: "application/json" } });
  if (!r.ok) throw new Error("MoSPI NAS " + r.status);
  const d = await r.json();
  return Array.isArray(d?.data) ? d.data : [];
}
async function fillGdp(today: string) {
  const { data: rows } = await supabase.from("econ_events").select("id,event_date,period,actual,previous").eq("kind", "gdp")
    .lte("event_date", today).gte("event_date", new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)).order("event_date");
  const todo = (rows || []).filter((r: any) => !r.actual || !r.previous);
  if (!todo.length) return { gdp: "nothing to fill" };
  const cache = new Map<string, any[]>();
  const get = async (fy: string) => { if (!cache.has(fy)) cache.set(fy, await gdpYear(fy)); return cache.get(fy)!; };
  const fyOf = (yy: number) => (2000 + yy - 1) + "-" + String(yy).padStart(2, "0"); // FY27 -> "2026-27"
  const pick = async (fy: string, q: number) => {
    const x = (await get(fy)).find((r: any) => r.quarter === "Q" + q);
    const real = x && Number.isFinite(Number(x.constant_price)) ? Number(x.constant_price) : null;
    const nom = x && Number.isFinite(Number(x.current_price)) ? Number(x.current_price) : null;
    return real === null ? null : real.toFixed(1) + "% real" + (nom !== null ? " (" + nom.toFixed(1) + "% nominal)" : "");
  };
  const out: string[] = [], waiting: string[] = [];
  for (const r of todo) {
    const q = String(r.period || "").match(/Q([1-4])/), fy = String(r.period || "").match(/FY(\d{2})/);
    if (!q || !fy) continue;
    const yy = +fy[1], qq = +q[1];
    const actual = await pick(fyOf(yy), qq);
    if (!actual) { waiting.push(r.id); continue; }
    const previous = r.previous || await pick(qq === 1 ? fyOf(yy - 1) : fyOf(yy), qq === 1 ? 4 : qq - 1).catch(() => null);
    const { error } = await supabase.from("econ_events").update({ actual, previous, confirmed: true, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) throw new Error(error.message);
    out.push(r.id + ": " + actual);
  }
  return { gdpFilled: out, gdpWaiting: waiting };
}

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: s } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!s || !secret || secret !== s.value) return json({ error: "unauthorized" }, 401);
    const today = new Date(Date.now() + 330 * 60e3).toISOString().slice(0, 10);
    const india = await fillIndia(today).catch((e) => ({ indiaError: String((e as Error)?.message || e) }));
    const rbi = await fillRbi(today).catch((e) => ({ rbiError: String((e as Error)?.message || e) }));
    const fed = await fillFed(today).catch((e) => ({ fedError: String((e as Error)?.message || e) }));
    const gdp = await fillGdp(today).catch((e) => ({ gdpError: String((e as Error)?.message || e) }));
    Object.assign(rbi, fed, gdp);
    // US CPI rows already released (date reached) but missing the figure, from the last 400 days.
    const { data: rows } = await supabase.from("econ_events").select("id,event_date,period,actual,previous").eq("kind", "uscpi")
      .lte("event_date", today).gte("event_date", new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)).order("event_date");
    const refill = new URL(req.url).searchParams.get("refill") === "1";
    const todo = (rows || []).filter((r: any) => refill || !r.actual || !r.previous).map((r: any) => ({ ...r, force: refill }));
    if (!todo.length) return json({ ...india, ...rbi, uscpi: "nothing to fill" });
    const data = await bls(["CUUR0000SA0", "CUUR0000SA0L1E", "CUSR0000SA0", "CUSR0000SA0L1E"]);
    const head = data["CUUR0000SA0"], core = data["CUUR0000SA0L1E"], headSA = data["CUSR0000SA0"], coreSA = data["CUSR0000SA0L1E"];
    const filled: string[] = [], waiting: string[] = [];
    for (const r of todo) {
      // period "October 2026" -> "2026-10"
      const m = String(r.period || "").match(/^([A-Za-z]+)\s+(\d{4})$/);
      const mi = m ? MONTHS.indexOf(m[1]) : -1;
      if (mi < 0) continue;
      const ym = m![2] + "-" + String(mi + 1).padStart(2, "0");
      if (!head?.has(ym)) { waiting.push(r.id); continue; }
      const actual = fmt(head, core, headSA, coreSA, ym);
      const previous = fmt(head, core, headSA, coreSA, prevMonth(ym, 1));
      if (!actual) { waiting.push(r.id); continue; }
      const noYoY = yoy(head, ym) === null;
      const upd: any = { actual, previous: r.force ? previous : r.previous || previous, updated_at: new Date().toISOString() };
      if (noYoY) upd.note = "No year-on-year figure: BLS did not collect " + MONTHS[+prevMonth(ym, 12).slice(5) - 1] + " " + prevMonth(ym, 12).slice(0, 4) + " prices (2025 US government shutdown), so only the change from the month before is shown.";
      const { error } = await supabase.from("econ_events").update(upd).eq("id", r.id);
      if (error) throw new Error(error.message);
      filled.push(r.id + ": " + actual);
    }
    const out = { ...india, ...rbi, filled, waiting, latest: [...(head?.keys() || [])].sort().pop() };
    console.log("ECON_ACTUALS", JSON.stringify(out));
    return json(out);
  } catch (e) {
    console.error("ECON_ACTUALS_FATAL", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
