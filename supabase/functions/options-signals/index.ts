// options-signals: paper-trades the Stock Signals scanner's ideas on F&O stocks as defined-risk debit spreads.
//   BUY  signal -> bull call spread: buy the ATM call, sell the call at the strike nearest the signal's target 1.
//   SELL signal -> bear put spread:  buy the ATM put,  sell the put  at the strike nearest the signal's target 1.
// Rules (each skip is logged with its reason in option_signal_log):
//   - F&O stocks only (stocks.is_fno); skip signals whose sector is weak (stock_sector_state, the Sectors page filter)
//   - expiry: the nearest with at least 14 calendar days left (and at most 70)
//   - liquidity: both legs need a live bid and ask, the long leg's bid-ask spread <= 12% of its price (short leg <= 20%),
//     and open interest >= 50 contracts on each leg
//   - price: IV of the long leg <= 1.6 x the stock's 20-day historical volatility (options not unusually expensive)
//   - reward: max profit >= 0.8 x max loss
//   - fills are conservative: buy at the ask, sell at the bid (and the reverse on exit)
// Index options (NIFTY, BANKNIFTY): the scanner has no index signals, so this function makes its own from daily closes
// (sector_index_history) plus the live level, checked only from 2:45 PM IST so it decides near the close like the test:
//   BUY  "pullback in uptrend":  20-day avg > 50-day avg, the index is below its 20-day avg but above its 50-day avg,
//                                and below its lowest close of the previous 4 days
//   SELL "rally in downtrend":   the mirror image
//   stop = 1.5 x and target 1 = 2.5 x the average daily move (14 days) from the entry level
//   Tested on ~21 months of Nifty / Bank Nifty closes: 81 signals, target first 38, stop first 32, +0.71 x the daily
//   move per signal on average (a breakout rule tested the same way came out at zero, so it was not used).
//   No sector filter; one spread per index; at most one signal per index per day.
// Open spreads are marked every run and closed when: the stock hits the signal's stop, the stock reaches target 1, the
// spread is worth >= 80% of its width, or 2 days are left to expiry.
// POST/GET ?action=run   (x-cron-secret from app_secrets 'crypto_cron', or a signed-in platform admin)
//          ?dry=1         apply every rule to the current signals and report, saving nothing
//                         (&sim=NIFTY:BUY,BANKNIFTY:SELL pretends those index signals fired, to test the spread builder)
//          ?debug=SYMBOL  (admin / cron only) raw NSE fields for one stock, to check the feed
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const NSE = "https://www.nseindia.com";
const HEADERS = { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: "https://www.nseindia.com/option-chain", "Accept-Language": "en-US,en;q=0.9" };
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

const INDEX: Record<string, string> = { NIFTY: "^NSEI", BANKNIFTY: "^NSEBANK" };
const isIndex = (sym: string) => sym in INDEX;
const RULES = { minDays: 14, maxDays: 70, closeDaysLeft: 2, maxSpreadLong: 0.12, maxSpreadShort: 0.2, minOI: 50, maxIvHv: 1.6, minReward: 0.8, takeProfit: 0.8, maxNewPerRun: 12 };

async function nse(path: string) {
  const r = await fetch(NSE + path, { headers: HEADERS });
  if (!r.ok) throw new Error("NSE " + r.status + " " + path.split("?")[0]);
  return await r.json();
}
const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function expiryDate(s: string) { const [d, m, y] = s.split("-"); return new Date(Date.UTC(+y, MON[m.slice(0, 1).toUpperCase() + m.slice(1, 3).toLowerCase()], +d)); }
const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
const daysLeft = (exp: Date) => Math.round((exp.getTime() - Date.UTC(istNow().getUTCFullYear(), istNow().getUTCMonth(), istNow().getUTCDate())) / 864e5);
function marketOpen() {
  const t = istNow(), wd = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
  return wd >= 1 && wd <= 5 && m >= 9 * 60 + 20 && m <= 15 * 60 + 30;
}

type Leg = { strike: number; bid: number; ask: number; ltp: number; oi: number; vol: number; iv: number };
type Chain = { spot: number; expiry: string; ce: Map<number, Leg>; pe: Map<number, Leg>; strikes: number[] };
function leg(x: any, k: number): Leg {
  return { strike: k, bid: n(x?.buyPrice1 ?? x?.bidprice ?? x?.bidPrice), ask: n(x?.sellPrice1 ?? x?.askPrice ?? x?.askprice), ltp: n(x?.lastPrice),
    oi: n(x?.openInterest), vol: n(x?.totalTradedVolume), iv: n(x?.impliedVolatility) };
}
async function expiries(sym: string): Promise<string[]> {
  const d = await nse("/api/option-chain-contract-info?symbol=" + encodeURIComponent(sym));
  return Array.isArray(d?.expiryDates) ? d.expiryDates : [];
}
async function chain(sym: string, expiry: string): Promise<Chain> {
  const d = await nse(`/api/option-chain-v3?type=${isIndex(sym) ? "Indices" : "Equity"}&symbol=${encodeURIComponent(sym)}&expiry=${expiry}`);
  const rec = d?.records || {}, data: any[] = Array.isArray(rec.data) ? rec.data : [];
  const ce = new Map<number, Leg>(), pe = new Map<number, Leg>();
  let spot = n(rec.underlyingValue);
  for (const x of data) {
    const k = n(x.strikePrice ?? x.CE?.strikePrice ?? x.PE?.strikePrice); if (!k) continue;
    if (!spot) spot = n(x.CE?.underlyingValue || x.PE?.underlyingValue);
    if (x.CE) ce.set(k, leg(x.CE, k));
    if (x.PE) pe.set(k, leg(x.PE, k));
  }
  return { spot, expiry, ce, pe, strikes: [...new Set([...ce.keys(), ...pe.keys()])].sort((a, b) => a - b) };
}
// Lot sizes per expiry month from NSE's daily F&O lot file; refreshed when the stored copy is older than a day.
async function refreshLots() {
  const r = await fetch("https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv", { headers: { "User-Agent": UA, Accept: "text/csv,*/*" } });
  if (!r.ok) throw new Error("NSE lots " + r.status);
  const lines = (await r.text()).split(/\r?\n/).map((l) => l.split(",").map((x) => x.trim()));
  const head = lines[0] || [], now = new Date().toISOString(), rows: any[] = [];
  for (const c of lines.slice(1)) {
    if (!c[1] || c[1] === "Symbol" || c[1] === "SYMBOL") continue;
    const months: Record<string, number> = {};
    for (let i = 2; i < c.length; i++) { const v = n(c[i]); if (v > 0 && head[i]) months[head[i].toUpperCase()] = v; }
    const first = Object.values(months)[0];
    if (first) rows.push({ symbol: c[1].toUpperCase(), lot: first, months, updated_at: now });
  }
  if (rows.length > 50) await db.from("fno_lots").upsert(rows);
  return rows.length;
}
async function lotSize(sym: string, expiry: string): Promise<number | null> {
  let { data } = await db.from("fno_lots").select("lot, months, updated_at").eq("symbol", sym).maybeSingle();
  if (!data || Date.now() - Date.parse(data.updated_at) > 864e5) {
    try { await refreshLots(); ({ data } = await db.from("fno_lots").select("lot, months, updated_at").eq("symbol", sym).maybeSingle()); } catch (e) { console.log("[lots]", String(e)); }
  }
  if (!data) return null;
  const [, m, y] = expiry.split("-"); // 23-Nov-2026 -> NOV-26
  const key = (m || "").toUpperCase() + "-" + (y || "").slice(2);
  return n(data.months?.[key]) || data.lot || null;
}
const mid = (l: Leg) => (l.bid > 0 && l.ask >= l.bid ? (l.bid + l.ask) / 2 : 0);
const spreadPct = (l: Leg) => { const m = mid(l); return m > 0 ? (l.ask - l.bid) / m : Infinity; };
// 20-day historical volatility (annualised %, from the scanner's daily bars)
async function histVol(sym: string): Promise<number | null> {
  let c: number[];
  if (isIndex(sym)) {
    const { data } = await db.from("sector_index_history").select("close").eq("symbol", INDEX[sym]).order("d", { ascending: false }).limit(21);
    c = (data || []).map((r: any) => n(r.close)).filter((x) => x > 0).reverse();
  } else {
    const { data } = await db.from("stock_swing_cache").select("bars").eq("symbol", sym).maybeSingle();
    c = ((data?.bars as any[]) || []).map((b) => n(b[4])).filter((x) => x > 0).slice(-21);
  }
  if (c.length < 15) return null;
  const r = c.slice(1).map((x, i) => Math.log(x / c[i])), m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100;
}
async function log(symbol: string | null, action: string, reason: string, detail: unknown = null) {
  await db.from("option_signal_log").insert({ symbol, action, reason, detail });
}

// Value of a spread if closed now (conservative: sell the long at the bid, buy back the short at the ask).
function closeValue(c: Chain, t: any) {
  const side = t.opt_type === "CE" ? c.ce : c.pe;
  const L = side.get(Number(t.long_strike)), S = side.get(Number(t.short_strike));
  if (!L || !S) return null;
  const lb = L.bid > 0 ? L.bid : 0, sa = S.ask > 0 ? S.ask : S.ltp; // no bid on the long = worth nothing to us right now
  if (!(sa > 0) && lb === 0) return null;
  return { long: lb, short: sa, value: Math.max(0, Math.min(Number(t.width), lb - sa)) };
}

async function markOpen(summary: any) {
  const { data: open } = await db.from("option_paper_trades").select("*").eq("status", "OPEN");
  for (const t of open || []) {
    try {
      const exp = new Date(t.expiry + "T00:00:00Z");
      const nseExp = `${String(exp.getUTCDate()).padStart(2, "0")}-${Object.keys(MON)[exp.getUTCMonth()]}-${exp.getUTCFullYear()}`;
      const c = await chain(t.symbol, nseExp); await sleep(250);
      const cv = closeValue(c, t);
      if (!cv) { await log(t.symbol, "mark", "no quote for one of the legs", { expiry: nseExp }); continue; }
      const per = Number(t.lot_size) * Number(t.lots);
      const pnl = r2((cv.value - Number(t.net_debit)) * per);
      const bull = t.opt_type === "CE", spot = c.spot, what = isIndex(t.symbol) ? "index" : "stock";
      let reason = "";
      if (Number(t.stop) > 0 && (bull ? spot <= Number(t.stop) : spot >= Number(t.stop))) reason = what + " hit the signal's stop";
      else if (Number(t.target) > 0 && (bull ? spot >= Number(t.target) : spot <= Number(t.target))) reason = what + " reached target 1";
      else if (cv.value >= RULES.takeProfit * Number(t.width)) reason = "spread reached 80% of its maximum value";
      else if (daysLeft(exp) <= RULES.closeDaysLeft) reason = "2 days to expiry";
      const now = new Date().toISOString();
      if (reason) {
        await db.from("option_paper_trades").update({ status: "CLOSED", exit_long: cv.long, exit_short: cv.short, exit_value: r2(cv.value), exit_spot: spot,
          exit_reason: reason, closed_at: now, pnl, mark_long: cv.long, mark_short: cv.short, mark_value: r2(cv.value), mark_spot: spot, marked_at: now }).eq("id", t.id);
        await log(t.symbol, "closed", reason, { pnl, value: r2(cv.value), spot });
        summary.closed++;
      } else {
        await db.from("option_paper_trades").update({ mark_long: cv.long, mark_short: cv.short, mark_value: r2(cv.value), mark_spot: spot, marked_at: now, pnl }).eq("id", t.id);
        summary.marked++;
      }
    } catch (e) { await log(t.symbol, "error", "could not mark: " + String((e as Error).message || e)); summary.errors++; }
  }
}

// Index signals from daily closes + the live level (see the header). Returns a stock_signals-shaped row, or a reason.
const istDateStr = () => istNow().toISOString().slice(0, 10);
const afterIndexCheckTime = () => { const t = istNow(); return t.getUTCHours() * 60 + t.getUTCMinutes() >= 14 * 60 + 45; };
async function indexSignal(sym: string, force?: string): Promise<{ sig?: any; why?: string }> {
  const today = istDateStr();
  const { data: rows } = await db.from("sector_index_history").select("d, close").eq("symbol", INDEX[sym]).lt("d", today).order("d", { ascending: false }).limit(60);
  const { data: q } = await db.from("index_quotes").select("price, updated_at").eq("symbol", INDEX[sym]).eq("grp", "snapshot").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const spot = n(q?.price);
  const past = (rows || []).map((r: any) => n(r.close)).filter((x) => x > 0).reverse();
  if (past.length < 50 || !(spot > 0)) return { why: "not enough index history or no live level" };
  const c = past.concat(spot);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const s20 = avg(c.slice(-20)), s50 = avg(c.slice(-50));
  const prev4 = past.slice(-4), lo4 = Math.min(...prev4), hi4 = Math.max(...prev4);
  const moves = c.slice(-15).map((x, i, a) => (i ? Math.abs(x - a[i - 1]) : 0)).slice(1), atr = avg(moves);
  const at = `${today}T03:45:00.000Z`; // one signal per index per day (9:15 IST)
  const lv = (x: number) => Math.round(x);
  if (force === "BUY" || (!force && s20 > s50 && spot < s20 && spot > s50 && spot < lo4))
    return { sig: { symbol: sym, side: "BUY", setup: "Index pullback in uptrend", score: null, entry: spot, stop: r2(spot - 1.5 * atr), target1: r2(spot + 2.5 * atr), generated_at: at } };
  if (force === "SELL" || (!force && s20 < s50 && spot > s20 && spot < s50 && spot > hi4))
    return { sig: { symbol: sym, side: "SELL", setup: "Index rally in downtrend", score: null, entry: spot, stop: r2(spot + 1.5 * atr), target1: r2(spot - 2.5 * atr), generated_at: at } };
  const trend = s20 > s50 ? "uptrend" : "downtrend";
  return { why: `no setup: ${lv(spot)} vs 20-day avg ${lv(s20)}, 50-day avg ${lv(s50)} (${trend}); previous 4-day range ${lv(lo4)}–${lv(hi4)}` };
}

async function openNew(summary: any, dry = false, out: any[] = [], sim: Record<string, string> = {}) {
  // dry run: apply every rule, save nothing, report what would happen
  const note = dry ? async (symbol: string | null, action: string, reason: string, detail: unknown = null) => { out.push({ symbol, action, reason, detail }); } : log;
  const { data: stockSigs } = await db.from("stock_signals").select("symbol, side, setup, score, entry, stop, target1, target2, generated_at").in("side", ["BUY", "SELL"]).order("score", { ascending: false });
  const sigs: any[] = [];
  // Index signals first (they are checked only from 2:45 PM IST, or any time in a dry run).
  for (const sym of Object.keys(INDEX)) {
    if (!dry && !afterIndexCheckTime()) continue;
    try {
      const r = await indexSignal(sym, dry ? sim[sym] : undefined);
      if (r.sig && dry && sim[sym]) { r.sig.setup += " (simulated for testing)"; await note(sym, "simulated", `pretending a ${sim[sym]} signal fired, to test the spread builder`); }
      if (r.sig) sigs.push(r.sig);
      else if (dry) await note(sym, "no signal", r.why || "");
    } catch (e) { await note(sym, "error", "index signal: " + String((e as Error).message || e)); }
  }
  sigs.push(...(stockSigs || []));
  const syms = [...new Set(sigs.map((s) => s.symbol))];
  if (!syms.length) return out;
  const { data: st } = await db.from("stocks").select("symbol, is_fno").in("symbol", syms);
  const fno = new Set((st || []).filter((s) => s.is_fno).map((s) => s.symbol).concat(Object.keys(INDEX)));
  const { data: open } = await db.from("option_paper_trades").select("symbol").eq("status", "OPEN");
  const busy = new Set((open || []).map((t) => t.symbol));
  const { data: done } = await db.from("option_paper_trades").select("symbol, signal_at").in("symbol", syms);
  const seen = new Set((done || []).map((t) => t.symbol + "|" + new Date(t.signal_at).toISOString()));
  // Signals already skipped for a reason that won't change soon are not re-checked for 2 hours.
  const { data: recent } = await db.from("option_signal_log").select("symbol, detail").eq("action", "skipped").gt("at", new Date(Date.now() - 2 * 3600e3).toISOString());
  const recentSkip = new Set(dry ? [] : (recent || []).map((l: any) => l.symbol + "|" + (l.detail?.signal_at || "")));
  let tried = 0;
  for (const s of sigs || []) {
    const sigAt = new Date(s.generated_at).toISOString(), key = s.symbol + "|" + sigAt;
    if (!fno.has(s.symbol) || busy.has(s.symbol) || seen.has(key) || recentSkip.has(key)) continue;
    if (tried >= RULES.maxNewPerRun) break;
    const skip = async (reason: string, detail: Record<string, unknown> = {}) => { await note(s.symbol, "skipped", reason, { signal_at: sigAt, side: s.side, ...detail }); summary.skipped++; };
    const { data: ss } = isIndex(s.symbol) ? { data: null as any } : await db.rpc("stock_sector_state", { p_symbol: s.symbol });
    if (ss?.state === "weak") { await skip("sector is weak (" + (ss.grp || "") + ")"); continue; }
    tried++;
    try {
      const bull = s.side === "BUY", target = n(s.target1), stop = n(s.stop);
      if (!(target > 0)) { await skip("signal has no target"); continue; }
      const list = await expiries(s.symbol); await sleep(250);
      const exp = list.find((e) => { const d = daysLeft(expiryDate(e)); return d >= RULES.minDays && d <= RULES.maxDays; });
      if (!exp) { await skip("no expiry 14–70 days out", { expiries: list.slice(0, 3) }); continue; }
      const c = await chain(s.symbol, exp); await sleep(250);
      if (!(c.spot > 0) || !c.strikes.length) { await skip("option chain empty"); continue; }
      const side = bull ? c.ce : c.pe;
      const ks = c.strikes.filter((k) => side.has(k));
      const atm = ks.reduce((a, k) => (Math.abs(k - c.spot) < Math.abs(a - c.spot) ? k : a), ks[0]);
      if (bull ? target <= atm : target >= atm) { await skip("target is too close to the current price for a spread", { spot: c.spot, atm, target }); continue; }
      const beyond = ks.filter((k) => (bull ? k > atm : k < atm));
      if (!beyond.length) { await skip("no strike beyond the at-the-money one", { spot: c.spot, atm }); continue; }
      const shortK = beyond.reduce((a, k) => (Math.abs(k - target) < Math.abs(a - target) ? k : a), beyond[0]);
      const L = side.get(atm)!, S = side.get(shortK)!;
      const detail = { expiry: exp, spot: c.spot, long: L, short: S };
      if (!(L.bid > 0 && L.ask > 0 && S.bid > 0 && S.ask > 0)) { await skip("no live bid/ask on a leg", detail); continue; }
      if (spreadPct(L) > RULES.maxSpreadLong || spreadPct(S) > RULES.maxSpreadShort) { await skip("bid-ask spread too wide", { ...detail, long_spread: r2(spreadPct(L) * 100), short_spread: r2(spreadPct(S) * 100) }); continue; }
      if (L.oi < RULES.minOI || S.oi < RULES.minOI) { await skip("open interest too low", detail); continue; }
      const hv = await histVol(s.symbol);
      if (hv && L.iv > 0 && L.iv > RULES.maxIvHv * hv) { await skip("options are expensive (IV " + r2(L.iv) + "% vs 20-day HV " + r2(hv) + "%)", detail); continue; }
      const width = Math.abs(shortK - atm), debit = r2(L.ask - S.bid);
      if (!(debit > 0) || debit >= width) { await skip("spread prices don't make sense", { ...detail, debit, width }); continue; }
      const maxProfitPS = width - debit;
      if (maxProfitPS < RULES.minReward * debit) { await skip("reward too small (max profit < 0.8 × max loss)", { ...detail, debit, width }); continue; }
      const lot = await lotSize(s.symbol, exp);
      if (!lot) { await skip("lot size unknown", detail); continue; }
      const row = {
        symbol: s.symbol, signal_side: s.side, signal_at: sigAt, signal_setup: s.setup, signal_score: s.score,
        strategy: bull ? "bull_call_spread" : "bear_put_spread", opt_type: bull ? "CE" : "PE",
        expiry: expiryDate(exp).toISOString().slice(0, 10), long_strike: atm, short_strike: shortK, lot_size: lot, lots: 1,
        entry_long: L.ask, entry_short: S.bid, net_debit: debit, width,
        max_loss: r2(debit * lot), max_profit: r2(maxProfitPS * lot), breakeven: r2(bull ? atm + debit : atm - debit),
        spot_entry: c.spot, stop, target, iv: L.iv || null, hv: hv ? r2(hv) : null, sector_state: ss?.state || null, sector_group: ss?.grp || null,
        mark_long: L.bid, mark_short: S.ask, mark_value: r2(Math.max(0, L.bid - S.ask)), mark_spot: c.spot, marked_at: new Date().toISOString(),
        pnl: r2((Math.max(0, L.bid - S.ask) - debit) * lot),
      };
      if (dry) { await note(s.symbol, "would open", `${bull ? "Bull call" : "Bear put"} spread ${atm}/${shortK} ${exp}, debit ₹${debit} × ${lot}`, row); summary.opened++; continue; }
      const { error } = await db.from("option_paper_trades").insert(row);
      if (error) { await log(s.symbol, "error", "could not save: " + error.message); summary.errors++; continue; }
      busy.add(s.symbol);
      await log(s.symbol, "opened", `${bull ? "Bull call" : "Bear put"} spread ${atm}/${shortK} ${exp}, debit ₹${debit} × ${lot}`, { signal_at: sigAt, ...row });
      summary.opened++;
    } catch (e) { await note(s.symbol, "error", String((e as Error).message || e), { signal_at: sigAt }); summary.errors++; }
  }
  return out;
}

async function authorised(req: Request) {
  const { data: sec } = await db.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
  if (sec && req.headers.get("x-cron-secret") === sec.value) return true;
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const r = await fetch(SB_URL + "/rest/v1/rpc/mp_is_platform_admin", { method: "POST", headers: { apikey: anon, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
  return r.ok && (await r.json()) === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!(await authorised(req))) return json({ error: "unauthorized" }, 401);
  const u = new URL(req.url);
  const dbg = u.searchParams.get("debug");
  if (dbg) {
    const sym = dbg.toUpperCase();
    try {
      const list = await expiries(sym); await sleep(250);
      const raw = await nse(`/api/option-chain-v3?type=${isIndex(sym) ? "Indices" : "Equity"}&symbol=${encodeURIComponent(sym)}&expiry=${list[0]}`);
      const row = (raw?.records?.data || []).find((x: any) => x.CE && x.PE) || null;
      return json({ expiries: list, ceKeys: row ? Object.keys(row.CE) : null, ce: row?.CE, lot: await lotSize(sym, list[0]), hv: await histVol(sym), index: isIndex(sym) ? await indexSignal(sym) : undefined });
    } catch (e) { return json({ error: String(e) }, 502); }
  }
  if (u.searchParams.get("dry") === "1") {
    const summary = { opened: 0, skipped: 0, marked: 0, closed: 0, errors: 0 };
    // ?sim=NIFTY:BUY,BANKNIFTY:SELL pretends those index signals fired (dry run only), to test the spread builder
    const sim: Record<string, string> = {};
    for (const p of (u.searchParams.get("sim") || "").split(",")) { const [k, v] = p.split(":"); if (k && isIndex(k.toUpperCase()) && (v === "BUY" || v === "SELL")) sim[k.toUpperCase()] = v; }
    const out = await openNew(summary, true, [], sim);
    return json({ dry: true, market_open: marketOpen(), ...summary, results: out });
  }
  const force = u.searchParams.get("force") === "1";
  if (!marketOpen() && !force) return json({ ok: true, skipped: "market closed" });
  const summary = { opened: 0, skipped: 0, marked: 0, closed: 0, errors: 0 };
  await markOpen(summary);
  if (marketOpen()) await openNew(summary); // new trades only while the market is open, even when forced
  else await log(null, "note", "market closed: open spreads marked, no new trades");
  await log(null, "run", `opened ${summary.opened}, closed ${summary.closed}, marked ${summary.marked}, skipped ${summary.skipped}, errors ${summary.errors}`, summary);
  await db.from("option_signal_log").delete().lt("at", new Date(Date.now() - 14 * 864e5).toISOString());
  return json({ ok: true, ...summary });
});
