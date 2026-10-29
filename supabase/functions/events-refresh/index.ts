// events-refresh: keeps public.market_events (the Events calendar) current. Runs hourly from pg_cron.
//
// 1. Calendar: NSE event calendar (board meetings: results, dividends, fund raising, bonus...) and
//    corporate actions (ex-dates: dividends, bonus, split, buyback), from 21 days back to 60 ahead.
// 2. Before the event (tracked stocks): last close and typical daily move from stock_swing_cache.
// 3. After results: the quarter's numbers from NSE's integrated-filing XBRL (vs the previous quarter
//    and the same quarter last year), the share-price reaction from Yahoo daily bars, and a
//    positive / negative / mixed verdict with the reasons. A few events per run; retried until done.
// Auth: x-cron-secret header must match app_secrets 'crypto_cron'.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const NSE = "https://www.nseindia.com";
const NSE_HEADERS = { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: "https://www.nseindia.com/companies-listing/corporate-filings-event-calendar", "Accept-Language": "en-US,en;q=0.9" };
const DAY = 864e5;
const OUTCOMES_PER_RUN = 12;
const TIME_BUDGET_MS = 110_000;
const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const istToday = () => iso(new Date(Date.now() + 330 * 60e3));
const ddmmyyyy = (isoDate: string) => isoDate.slice(8, 10) + "-" + isoDate.slice(5, 7) + "-" + isoDate.slice(0, 4);
// "08-Oct-2026" / "30-SEP-2026" / "08-Oct-2026 22:07:33" -> Date (IST wall time stored as UTC fields)
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

async function nse(path: string): Promise<any> {
  const r = await fetch(NSE + path, { headers: NSE_HEADERS });
  if (!r.ok) throw new Error("NSE " + r.status + " " + path.split("?")[0]);
  return await r.json();
}

/* ───────── 1. Calendar ───────── */
function calKind(purpose: string): string {
  const p = purpose.toLowerCase();
  if (/financial result/.test(p)) return "results";
  if (/bonus/.test(p)) return "bonus";
  if (/split|sub-division/.test(p)) return "split";
  if (/buy ?back/.test(p)) return "buyback";
  if (/fund raising|raising of funds/.test(p)) return "fundraise";
  if (/dividend/.test(p)) return "dividend";
  return "board";
}
function actionKind(subject: string): string {
  const s = subject.toLowerCase();
  if (/dividend/.test(s)) return "dividend";
  if (/bonus/.test(s)) return "bonus";
  if (/split|sub-division|sub division/.test(s)) return "split";
  if (/buy ?back/.test(s)) return "buyback";
  if (/rights/.test(s)) return "rights";
  if (/annual general meeting|\bagm\b/.test(s)) return "agm";
  return "action";
}
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

async function syncCalendar(tracked: Set<string>, summary: any) {
  const from = iso(new Date(Date.now() - 21 * DAY)), to = iso(new Date(Date.now() + 60 * DAY));
  const rows = new Map<string, any>();
  const okSources: string[] = [];
  const stamp = new Date().toISOString();
  try {
    const cal = await nse(`/api/event-calendar?index=equities&from_date=${ddmmyyyy(from)}&to_date=${ddmmyyyy(to)}`);
    for (const e of Array.isArray(cal) ? cal : []) {
      const d = parseNseDate(e.date), sym = clean(e.symbol).toUpperCase();
      if (!d || !sym) continue;
      const kind = calKind(clean(e.purpose));
      const id = `${sym}|${d.date}|${kind}`;
      const prev = rows.get(id);
      rows.set(id, {
        id, symbol: sym, company: clean(e.company), event_date: d.date, kind,
        title: prev ? prev.title : clean(e.purpose) || "Board meeting",
        detail: prev ? prev.detail : clean(e.bm_desc), tracked: tracked.has(sym), source: "nse-cal", updated_at: stamp,
      });
    }
    okSources.push("nse-cal");
    summary.calendar = rows.size;
  } catch (e) { summary.calendarError = String((e as Error).message || e); }
  let actions = 0;
  try {
    const ca = await nse(`/api/corporates-corporateActions?index=equities&from_date=${ddmmyyyy(from)}&to_date=${ddmmyyyy(to)}`);
    for (const a of Array.isArray(ca) ? ca : []) {
      const d = parseNseDate(a.exDate), sym = clean(a.symbol).toUpperCase(), subject = clean(a.subject);
      if (!d || !sym || !subject) continue;
      const kind = actionKind(subject);
      const id = `${sym}|${d.date}|${kind}-ex`;
      const amt = kind === "dividend" ? num((subject.match(/(?:rs\.?|re\.?|₹)\s*([\d.]+)/i) || [])[1]) : null;
      const prev = rows.get(id);
      rows.set(id, {
        id, symbol: sym, company: clean(a.comp), event_date: d.date, kind,
        title: prev ? prev.title + " + " + subject : subject,
        detail: "Ex-date " + clean(a.exDate) + (a.recDate && a.recDate !== "-" ? " · record date " + clean(a.recDate) : ""),
        record_date: parseNseDate(a.recDate)?.date ?? null,
        amount: amt !== null ? (prev?.amount ?? 0) + amt : prev?.amount ?? null,
        tracked: tracked.has(sym), source: "nse-ca", updated_at: stamp,
      });
      actions++;
    }
    okSources.push("nse-ca");
    summary.actions = actions;
  } catch (e) { summary.actionsError = String((e as Error).message || e); }

  const list = [...rows.values()];
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await supabase.from("market_events").upsert(list.slice(i, i + 500), { onConflict: "id" });
    if (error) throw new Error("upsert: " + error.message);
  }
  // Events NSE no longer lists (moved or cancelled) are removed, unless they already have an outcome.
  for (const src of okSources) {
    const { count } = await supabase.from("market_events").delete({ count: "exact" })
      .eq("source", src).gte("event_date", from).lte("event_date", to).lt("updated_at", stamp).is("outcome", null);
    if (count) summary["removed_" + src] = count;
  }
  // Older than the window: keep results with an outcome for 120 days, drop the rest.
  await supabase.from("market_events").delete().lt("event_date", from).is("outcome", null);
  await supabase.from("market_events").delete().lt("event_date", iso(new Date(Date.now() - 120 * DAY)));
}

/* ───────── 2. Before the event: typical move (tracked stocks) ───────── */
async function syncPre(summary: any) {
  const today = istToday();
  const { data: ev } = await supabase.from("market_events").select("id,symbol").eq("tracked", true).gte("event_date", today).limit(2000);
  const syms = [...new Set((ev || []).map((e: any) => e.symbol))];
  if (!syms.length) return;
  const { data: cache } = await supabase.from("stock_swing_cache").select("symbol,bars").in("symbol", syms);
  const pre = new Map<string, any>();
  for (const c of cache || []) {
    const b = (Array.isArray(c.bars) ? c.bars : []).filter((x: any) => Array.isArray(x) && x[4] > 0);
    if (b.length < 25) continue;
    const last = b.slice(-21);
    const moves = last.slice(1).map((x: any, i: number) => Math.abs(x[4] / last[i][4] - 1) * 100);
    const tr = last.slice(1).map((x: any, i: number) => Math.max(x[2] - x[3], Math.abs(x[2] - last[i][4]), Math.abs(x[3] - last[i][4])));
    const close = b[b.length - 1][4];
    pre.set(c.symbol, {
      lastClose: r2(close), lastDate: b[b.length - 1][0],
      avgMovePct: r2(moves.reduce((s: number, x: number) => s + x, 0) / moves.length),
      atrPct: r2(tr.reduce((s: number, x: number) => s + x, 0) / tr.length / close * 100),
    });
  }
  let n = 0;
  for (const e of ev || []) {
    const p = pre.get(e.symbol);
    if (!p) continue;
    await supabase.from("market_events").update({ pre: p }).eq("id", e.id);
    n++;
  }
  summary.pre = n;
}

/* ───────── 3. After results: numbers, reaction, verdict ───────── */
type Fig = { revenue: number | null; income: number | null; pbt: number | null; profit: number | null; eps: number | null; bank: boolean; revLabel: string };

// First of the tags present for the context; companies, banks and insurers use different taxonomies.
function xbrlPick(xml: string, tags: string[], ctx: string): { v: number; tag: string } | null {
  for (const tag of tags) {
    const re = new RegExp(`<[\\w-]+:${tag}\\b[^>]*contextRef="${ctx}"[^>]*>\\s*([-\\d.Ee+]+)\\s*<`, "g");
    const m = re.exec(xml);
    if (m) { const v = num(m[1]); if (v !== null) return { v, tag }; }
  }
  return null;
}
const xbrlValue = (xml: string, tags: string[], ctx: string) => xbrlPick(xml, tags, ctx)?.v ?? null;
// The quarter's context: start..end spanning ~3 months and ending on the quarter-end date.
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
async function figures(url: string, qeIso: string): Promise<Fig | null> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const xml = await r.text();
  const ctx = quarterContext(xml, qeIso);
  const cr = (v: number | null) => v === null ? null : v / 1e7; // rupees -> crore
  // Banks report interest earned; life insurers net premium income; general insurers net premium written.
  const rev = xbrlPick(xml, ["RevenueFromOperations", "TotalRevenueFromOperations", "InterestEarned", "NetPremiumIncome", "NetPremiumWritten"], ctx);
  const revLabel = !rev ? "Revenue" : rev.tag === "InterestEarned" ? "Interest earned" : /Premium/.test(rev.tag) ? "Net premium" : "Revenue";
  return {
    revenue: cr(rev?.v ?? null), revLabel, bank: rev?.tag === "InterestEarned",
    income: cr(xbrlValue(xml, ["Income", "TotalIncome"], ctx)),
    pbt: cr(xbrlValue(xml, ["ProfitBeforeTax", "ProfitLossBeforeTax", "ProfitOrLossBeforeTax"], ctx)),
    profit: cr(xbrlValue(xml, ["ProfitOrLossAttributableToOwnersOfParent", "ProfitLossForPeriod", "ProfitLossForThePeriod", "NetProfitLossForThePeriod", "ProfitLossAfterTaxAndExtraordinaryItems", "ProfitLossAfterTax", "ProfitLossAfterTaxBeforeExtraordinaryItems"], ctx)),
    eps: xbrlValue(xml, ["BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "BasicEarningsLossPerShareFromContinuingOperations", "BasicEarningsPerShareAfterExtraordinaryItems", "BasicEarningsPerShareBeforeExtraordinaryItems", "BasicEarningsLossPerShare", "BasicAndDilutedEPSAfterExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized", "BasicAndDilutedEPSBeforeExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized"], ctx),
  };
}
const quarterEndBefore = (qeIso: string, months: number) => {
  const d = new Date(qeIso + "T00:00:00Z");
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months + 1, 0)));
};

// Daily bars from Yahoo, dated in IST.
async function dailyBars(symbol: string) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=6mo&interval=1d`, { headers: { "User-Agent": UA } });
  if (!r.ok) return [];
  const res = (await r.json())?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0] || {};
  return (res?.timestamp || []).map((t: number, i: number) => ({ date: iso(new Date(t * 1000 + 330 * 60e3)), o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] }))
    .filter((b: any) => b.c > 0 && b.o > 0);
}

function reaction(bars: any[], broadcastMs: number) {
  // Filed before 3:30 PM IST: that session reacts; otherwise the next one.
  const bd = new Date(broadcastMs), dayIso = iso(bd), mins = bd.getUTCHours() * 60 + bd.getUTCMinutes();
  const idx = bars.findIndex((x) => mins < 15 * 60 + 30 ? x.date >= dayIso : x.date > dayIso);
  if (idx < 1) return null;
  const day = bars[idx], prev = bars[idx - 1], last = bars[bars.length - 1];
  const vols = bars.slice(Math.max(0, idx - 20), idx).map((x) => x.v).filter((v) => v > 0);
  const avgVol = vols.length ? vols.reduce((s, v) => s + v, 0) / vols.length : 0;
  return {
    day: day.date, prevClose: r2(prev.c), open: r2(day.o), high: r2(day.h), low: r2(day.l), close: r2(day.c),
    pct: r2((day.c / prev.c - 1) * 100), gapPct: r2((day.o / prev.c - 1) * 100),
    volRatio: avgVol ? r2(day.v / avgVol) : null,
    lastDate: last.date, lastClose: r2(last.c), sincePct: r2((last.c / prev.c - 1) * 100),
  };
}

function verdict(cur: Fig, ch: any, react: any) {
  const reasons: string[] = [];
  let fund = 0;
  const p = cur.profit, py = ch.profitYearAgo;
  if (p !== null && py !== null) {
    if (py > 0 && p > 0) {
      const g = (p / py - 1) * 100;
      if (g >= 15) { fund += 2; reasons.push(`Net profit up ${g.toFixed(0)}% on the year`); }
      else if (g > 0) { fund += 1; reasons.push(`Net profit up ${g.toFixed(1)}% on the year`); }
      else if (g <= -15) { fund -= 2; reasons.push(`Net profit down ${Math.abs(g).toFixed(0)}% on the year`); }
      else { fund -= 1; reasons.push(`Net profit down ${Math.abs(g).toFixed(1)}% on the year`); }
    } else if (py <= 0 && p > 0) { fund += 2; reasons.push("Turned profitable versus a loss a year ago"); }
    else if (py > 0 && p <= 0) { fund -= 2; reasons.push("Swung to a loss from a profit a year ago"); }
    else if (p > py) { fund += 1; reasons.push("Loss narrowed on the year"); }
    else { fund -= 1; reasons.push("Loss widened on the year"); }
  }
  if (ch.revYoY !== null) {
    const rl = cur.revLabel;
    if (ch.revYoY >= 10) { fund += 1; reasons.push(`${rl} up ${ch.revYoY.toFixed(0)}% on the year`); }
    else if (ch.revYoY < 0) { fund -= 1; reasons.push(`${rl} down ${Math.abs(ch.revYoY).toFixed(1)}% on the year`); }
    else reasons.push(`${rl} up ${ch.revYoY.toFixed(1)}% on the year`);
  }
  if (ch.marginNow !== null && ch.marginYearAgo !== null) {
    const d = ch.marginNow - ch.marginYearAgo;
    if (d >= 1) { fund += 0.5; reasons.push(`Profit margin improved to ${ch.marginNow.toFixed(1)}% (from ${ch.marginYearAgo.toFixed(1)}%)`); }
    else if (d <= -1) { fund -= 0.5; reasons.push(`Profit margin slipped to ${ch.marginNow.toFixed(1)}% (from ${ch.marginYearAgo.toFixed(1)}%)`); }
  }
  if (ch.profitQoQ !== null && Math.abs(ch.profitQoQ) >= 10) {
    fund += ch.profitQoQ > 0 ? 0.5 : -0.5;
    reasons.push(`Net profit ${ch.profitQoQ > 0 ? "up" : "down"} ${Math.abs(ch.profitQoQ).toFixed(0)}% on the previous quarter`);
  }
  const numbers = fund >= 2 ? "strong" : fund >= 0.5 ? "good" : fund <= -2 ? "weak" : fund <= -0.5 ? "soft" : "in line";
  let market = 0, marketLabel = "pending";
  if (react) {
    const x = react.pct;
    market = x >= 3 ? 2 : x >= 1 ? 1 : x <= -3 ? -2 : x <= -1 ? -1 : 0;
    marketLabel = market === 2 ? "rallied" : market === 1 ? "rose" : market === -2 ? "fell sharply" : market === -1 ? "fell" : "were flat";
    const day = new Date(react.day + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
    reasons.push(`Shares ${marketLabel}${market === 0 ? ` (${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%)` : ` ${Math.abs(x).toFixed(1)}%`} on ${day}` + (react.volRatio ? `, on ${react.volRatio.toFixed(1)}× normal volume` : ""));
  }
  let label: string;
  if (!react) label = fund >= 0.5 ? "positive" : fund <= -0.5 ? "negative" : "mixed";
  else if ((fund >= 0.5 && market >= 0) || (market >= 1 && fund >= -0.5)) label = "positive";
  else if ((fund <= -0.5 && market <= 0) || (market <= -1 && fund <= 0.5)) label = "negative";
  else label = "mixed";
  const summary = !react
    ? `Numbers look ${numbers}; the market has not traded on them yet.`
    : label === "mixed"
      ? (fund > 0 ? `Numbers looked ${numbers}, but the shares ${marketLabel}: the market expected more.` : `Numbers looked ${numbers}, yet the shares ${marketLabel}: the market looked past them.`)
      : `Numbers looked ${numbers} and the shares ${marketLabel}.`;
  return { label, numbers, market: marketLabel, fundScore: fund, marketScore: market, summary, reasons, early: !react };
}

async function outcomeFor(ev: any) {
  const list = (await nse(`/api/integrated-filing-results?index=equities&type=Integrated%20Filing-%20Financials&symbol=${encodeURIComponent(ev.symbol)}`))?.data || [];
  const evMs = Date.parse(ev.event_date + "T00:00:00Z");
  const filings = list.map((f: any) => ({ ...f, bc: parseNseDate(f.broadcast_Date), qe: parseNseDate(f.qe_Date) })).filter((f: any) => f.bc && f.qe && f.xbrl && f.xbrl !== "null");
  const near = filings.filter((f: any) => f.bc.ms >= evMs - 2 * DAY && f.bc.ms <= evMs + 4 * DAY);
  const pick = near.find((f: any) => f.consolidated === "Consolidated") || near[0];
  if (!pick) {
    const late = Date.now() - evMs > 5 * DAY;
    return { status: late ? "not_found" : "awaiting", checkedAt: new Date().toISOString() };
  }
  const sameType = (qe: string) => filings.find((f: any) => f.qe.date === qe && f.consolidated === pick.consolidated) || filings.find((f: any) => f.qe.date === qe);
  const qe = pick.qe.date, prevQe = quarterEndBefore(qe, 3), yoyQe = quarterEndBefore(qe, 12);
  const prevF = sameType(prevQe), yoyF = sameType(yoyQe);
  const [cur, prev, yoy, bars] = await Promise.all([
    figures(pick.xbrl, qe),
    prevF ? figures(prevF.xbrl, prevQe) : Promise.resolve(null),
    yoyF ? figures(yoyF.xbrl, yoyQe) : Promise.resolve(null),
    dailyBars(ev.symbol).catch(() => []),
  ]);
  if (!cur || (cur.profit === null && cur.revenue === null)) return { status: "error", error: "could not read the filing", filing: { xbrl: pick.xbrl } };
  const margin = (f: Fig | null) => f && f.profit !== null && f.revenue ? f.profit / f.revenue * 100 : null;
  const ch = {
    revYoY: r2(pct(cur.revenue, yoy?.revenue ?? null)), profitYoY: r2(pct(cur.profit, yoy?.profit ?? null)),
    revQoQ: r2(pct(cur.revenue, prev?.revenue ?? null)), profitQoQ: r2(pct(cur.profit, prev?.profit ?? null)),
    epsYoY: r2(pct(cur.eps, yoy?.eps ?? null)), marginNow: r2(margin(cur)), marginYearAgo: r2(margin(yoy)),
    profitYearAgo: yoy?.profit ?? null,
  };
  // Yahoo's newest daily bar often has no close until the next day; stock_quotes has that session.
  const { data: q } = await supabase.from("stock_quotes").select("price,open,high,low,volume,quote_time").eq("symbol", ev.symbol).maybeSingle();
  const qDate = q?.quote_time ? iso(new Date(Date.parse(q.quote_time) + 330 * 60e3)) : null;
  if (qDate && q.price > 0 && q.open > 0 && (!bars.length || bars[bars.length - 1].date < qDate)) {
    bars.push({ date: qDate, o: Number(q.open), h: Number(q.high), l: Number(q.low), c: Number(q.price), v: Number(q.volume) || 0 });
  }
  const react = bars.length ? reaction(bars, pick.bc.ms) : null;
  const rnd = (f: Fig | null) => f && { revenue: r2(f.revenue), income: r2(f.income), pbt: r2(f.pbt), profit: r2(f.profit), eps: r2(f.eps) };
  return {
    status: react ? "done" : "partial",
    filing: {
      quarterEnd: qe, filedAt: pick.broadcast_Date, consolidated: pick.consolidated, audited: pick.audited,
      xbrl: pick.xbrl, view: pick.ixbrl && pick.ixbrl !== "null" ? pick.ixbrl : null,
    },
    bank: cur.bank, revLabel: cur.revLabel,
    cur: rnd(cur), prev: prevF ? { quarterEnd: prevQe, ...rnd(prev) } : null, yoy: yoyF ? { quarterEnd: yoyQe, ...rnd(yoy) } : null,
    changes: { ...ch, profitYearAgo: undefined },
    reaction: react,
    verdict: verdict(cur, ch, react),
    checkedAt: new Date().toISOString(),
  };
}

async function syncOutcomes(summary: any, started: number) {
  const today = istToday(), since = iso(new Date(Date.now() - 21 * DAY));
  const { data: held } = await supabase.from("portfolio_transactions").select("symbol").limit(5000);
  const heldSet = new Set((held || []).map((h: any) => String(h.symbol || "").toUpperCase()));
  const { data: due } = await supabase.from("market_events")
    .select("id,symbol,event_date,tracked,outcome,outcome_at")
    .eq("kind", "results").gte("event_date", since).lte("event_date", today)
    .order("event_date", { ascending: false }).limit(1500);
  const sixHours = Date.now() - 6 * 3600e3;
  const todo = (due || []).filter((e: any) => {
    if (!e.tracked && !heldSet.has(e.symbol)) return false;
    const st = e.outcome?.status;
    if (!st) return true;
    if (st === "awaiting" || st === "partial" || st === "error") return !e.outcome_at || Date.parse(e.outcome_at) < Date.now() - 50 * 60e3;
    // Done: refresh the reaction ("since results") for a week, at most every 6 hours.
    return st === "done" && Date.parse(e.event_date) > Date.now() - 7 * DAY && (!e.outcome_at || Date.parse(e.outcome_at) < sixHours);
  })
    // Never-checked events first, then the rest; today's meetings (usually not filed yet) last.
    .sort((a: any, b: any) => (a.event_date === today ? 1 : 0) - (b.event_date === today ? 1 : 0) || (a.outcome ? 1 : 0) - (b.outcome ? 1 : 0))
    .slice(0, OUTCOMES_PER_RUN);
  const done: string[] = [];
  for (const ev of todo) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    let outcome: any;
    try { outcome = await outcomeFor(ev); } catch (e) { outcome = { status: "error", error: String((e as Error).message || e) }; }
    await supabase.from("market_events").update({ outcome, outcome_at: new Date().toISOString() }).eq("id", ev.id);
    done.push(`${ev.symbol}:${outcome.status}${outcome.verdict ? ":" + outcome.verdict.label : ""}`);
  }
  summary.outcomes = done;
  summary.outcomesQueued = todo.length;
}

Deno.serve(async (req) => {
  const started = Date.now();
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: s } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!s || !secret || secret !== s.value) return json({ error: "unauthorized" }, 401);
    const url = new URL(req.url);
    const only = url.searchParams.get("only"); // "calendar" | "outcomes" for testing
    const { data: uni } = await supabase.from("stock_swing_cache").select("symbol");
    const tracked = new Set<string>((uni || []).map((u: any) => String(u.symbol).toUpperCase()));
    const summary: any = { tracked: tracked.size };
    if (only !== "outcomes") { await syncCalendar(tracked, summary); await syncPre(summary); }
    if (only !== "calendar") await syncOutcomes(summary, started);
    summary.ms = Date.now() - started;
    console.log("EVENTS_REFRESH", JSON.stringify(summary));
    return json(summary);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.error("EVENTS_REFRESH_FATAL", e);
    return json({ error: msg }, 500);
  }
});
