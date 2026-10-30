// stock-fundamentals: quarterly results for the stock detail card (search on Home).
// GET ?symbol=TCS -> the last 8 quarters (revenue, net profit, PBT, EPS, margin, YoY/QoQ), read from NSE's
// integrated-filing XBRL, same parser as events-refresh. Cached per symbol in stock_fundamentals_cache
// for 6 hours (an older cache is served if NSE is unreachable). Public, no JWT.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const NSE_HEADERS = { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: "https://www.nseindia.com/companies-listing/corporate-filings-financial-results", "Accept-Language": "en-US,en;q=0.9" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const DAY = 864e5;
const TTL_MS = 6 * 3600e3;
const QUARTERS = 8;
const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function json(data: unknown, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
function parseNseDate(s: string | null | undefined): { date: string; ms: number } | null {
  const m = String(s || "").match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const mon = MON[m[2].toUpperCase()];
  if (mon === undefined) return null;
  const d = new Date(Date.UTC(+m[3], mon, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  return { date: iso(d), ms: d.getTime() };
}
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const r2 = (v: number | null) => v === null ? null : Math.round(v * 100) / 100;
const pct = (a: number | null, b: number | null) => a !== null && b !== null && b !== 0 ? (a / b - 1) * 100 * (b < 0 ? -1 : 1) : null;
const quarterEndBefore = (qeIso: string, months: number) => {
  const d = new Date(qeIso + "T00:00:00Z");
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months + 1, 0)));
};
// "2026-06-30" -> "Q1 FY27" (Indian financial year starts in April).
function fyLabel(qeIso: string) {
  const y = +qeIso.slice(0, 4), m = +qeIso.slice(5, 7);
  const q = m <= 3 ? 4 : m <= 6 ? 1 : m <= 9 ? 2 : 3;
  const fy = m <= 3 ? y : y + 1;
  return `Q${q} FY${String(fy).slice(2)}`;
}

/* ───────── XBRL (same taxonomy handling as events-refresh) ───────── */
function xbrlPick(xml: string, tags: string[], ctx: string): { v: number; tag: string } | null {
  for (const tag of tags) {
    const re = new RegExp(`<[\\w-]+:${tag}\\b[^>]*contextRef="${ctx}"[^>]*>\\s*([-\\d.Ee+]+)\\s*<`, "g");
    const m = re.exec(xml);
    if (m) { const v = num(m[1]); if (v !== null) return { v, tag }; }
  }
  return null;
}
const xbrlValue = (xml: string, tags: string[], ctx: string) => xbrlPick(xml, tags, ctx)?.v ?? null;
function quarterContext(xml: string, qeIso: string): string {
  for (const m of xml.matchAll(/<xbrli:context id="([^"]+)">([\s\S]*?)<\/xbrli:context>/g)) {
    if (/segment|scenario/i.test(m[2])) continue;
    const s = m[2].match(/<xbrli:startDate>([^<]+)</)?.[1], e = m[2].match(/<xbrli:endDate>([^<]+)</)?.[1];
    if (!s || !e || e.slice(0, 10) !== qeIso) continue;
    const days = (Date.parse(e) - Date.parse(s)) / DAY;
    if (days > 80 && days < 100) return m[1];
  }
  return "OneD";
}
async function figures(url: string, qeIso: string) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const xml = await r.text();
  const ctx = quarterContext(xml, qeIso);
  const cr = (v: number | null) => v === null ? null : v / 1e7; // rupees -> crore
  const rev = xbrlPick(xml, ["RevenueFromOperations", "TotalRevenueFromOperations", "InterestEarned", "NetPremiumIncome", "NetPremiumWritten"], ctx);
  const revLabel = !rev ? "Revenue" : rev.tag === "InterestEarned" ? "Interest earned" : /Premium/.test(rev.tag) ? "Net premium" : "Revenue";
  return {
    revenue: cr(rev?.v ?? null), revLabel,
    income: cr(xbrlValue(xml, ["Income", "TotalIncome"], ctx)),
    pbt: cr(xbrlValue(xml, ["ProfitBeforeTax", "ProfitLossBeforeTax", "ProfitOrLossBeforeTax"], ctx)),
    profit: cr(xbrlValue(xml, ["ProfitOrLossAttributableToOwnersOfParent", "ProfitLossForPeriod", "ProfitLossForThePeriod", "NetProfitLossForThePeriod", "ProfitLossAfterTaxAndExtraordinaryItems", "ProfitLossAfterTax", "ProfitLossAfterTaxBeforeExtraordinaryItems"], ctx)),
    eps: xbrlValue(xml, ["BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "BasicEarningsLossPerShareFromContinuingOperations", "BasicEarningsPerShareAfterExtraordinaryItems", "BasicEarningsPerShareBeforeExtraordinaryItems", "BasicEarningsLossPerShare", "BasicAndDilutedEPSAfterExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized", "BasicAndDilutedEPSBeforeExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized"], ctx),
  };
}

async function build(symbol: string) {
  const r = await fetch(`https://www.nseindia.com/api/integrated-filing-results?index=equities&type=Integrated%20Filing-%20Financials&symbol=${encodeURIComponent(symbol)}`, { headers: NSE_HEADERS });
  if (!r.ok) throw new Error("NSE " + r.status);
  const list = (await r.json())?.data || [];
  const filings = list
    .map((f: any) => ({ ...f, bc: parseNseDate(f.broadcast_Date), qe: parseNseDate(f.qe_Date) }))
    .filter((f: any) => f.qe && f.xbrl && f.xbrl !== "null");
  if (!filings.length) return null;
  // One filing per quarter, on one basis: consolidated when the company files it, else standalone.
  const newest = Math.max(...filings.map((f: any) => f.qe.ms));
  const basis = filings.some((f: any) => f.qe.ms === newest && f.consolidated === "Consolidated") ? "Consolidated" : "Standalone";
  const byQe = new Map<string, any>();
  for (const f of filings.sort((a: any, b: any) => (b.bc?.ms || 0) - (a.bc?.ms || 0))) { // newest filing (a revision) wins
    const cur = byQe.get(f.qe.date);
    if (!cur || (cur.consolidated !== basis && f.consolidated === basis)) byQe.set(f.qe.date, f);
  }
  const picks = [...byQe.values()].sort((a, b) => b.qe.ms - a.qe.ms).slice(0, QUARTERS);
  const figs = await Promise.all(picks.map((f) => figures(f.xbrl, f.qe.date).catch(() => null)));
  const rows = picks.map((f, i) => ({ f, x: figs[i] })).filter((r) => r.x && (r.x.revenue !== null || r.x.profit !== null));
  if (!rows.length) return null;
  const at = (qe: string) => rows.find((r) => r.f.qe.date === qe)?.x || null;
  const quarterly = rows.map(({ f, x }) => {
    const qe = f.qe.date, prev = at(quarterEndBefore(qe, 3)), yoy = at(quarterEndBefore(qe, 12));
    return {
      quarter_end: qe,
      period_end: f.qe_Date, // "30-JUN-2026", the format the page already shows
      label: fyLabel(qe),
      consolidated: f.consolidated, audited: f.audited || null,
      filed_at: f.broadcast_Date || null,
      view_url: f.ixbrl && f.ixbrl !== "null" ? f.ixbrl : null,
      revenue_label: x!.revLabel,
      financials: { revenue: r2(x!.revenue), total_income: r2(x!.income), profit_before_tax: r2(x!.pbt), net_profit: r2(x!.profit) },
      eps: { basic: r2(x!.eps) },
      derived: {
        net_margin_percent: x!.profit !== null && x!.revenue ? r2(x!.profit / x!.revenue * 100) : null,
        revenue_yoy: r2(pct(x!.revenue, yoy?.revenue ?? null)), profit_yoy: r2(pct(x!.profit, yoy?.profit ?? null)),
        revenue_qoq: r2(pct(x!.revenue, prev?.revenue ?? null)), profit_qoq: r2(pct(x!.profit, prev?.profit ?? null)),
        eps_yoy: r2(pct(x!.eps, yoy?.eps ?? null)),
      },
    };
  });
  return { symbol, basis, source: "NSE integrated filings (XBRL)", units: "crore", latest: quarterly[0], quarterly, fetched_at: new Date().toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const symbol = (new URL(req.url).searchParams.get("symbol") || "").trim().toUpperCase().replace(/\.NS$/, "");
  if (!/^[A-Z0-9&.-]{1,20}$/.test(symbol)) return json({ ok: false, error: "Invalid symbol" }, 400);
  const { data: cached } = await supabase.from("stock_fundamentals_cache").select("data,fetched_at").eq("symbol", symbol).maybeSingle();
  const age = cached ? Date.now() - Date.parse(cached.fetched_at) : Infinity;
  if (cached && age < TTL_MS) return json({ ok: true, cached: true, ...cached.data }, 200, 600);
  try {
    const data = await build(symbol);
    if (!data) {
      if (cached) return json({ ok: true, cached: true, stale: true, ...cached.data }, 200, 300);
      return json({ ok: false, error: "No quarterly results filed on NSE for this symbol", symbol }, 404, 3600);
    }
    await supabase.from("stock_fundamentals_cache").upsert({ symbol, data, fetched_at: new Date().toISOString() });
    return json({ ok: true, cached: false, ...data }, 200, 600);
  } catch (e) {
    if (cached) return json({ ok: true, cached: true, stale: true, ...cached.data }, 200, 120);
    return json({ ok: false, error: (e as Error).message || "Could not load results", symbol }, 502);
  }
});
