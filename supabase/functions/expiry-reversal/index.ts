// expiry-reversal: one cheap-option reversal trade on expiry day (platform admin only, paper only).
// Runs every minute 11:30 AM – 3:29 PM IST (pg_cron 'expiry-reversal'); does nothing unless an index expires today:
//   NIFTY weekly (Tuesday), BANKNIFTY monthly (NSE's own expiry list), SENSEX weekly (Thursday; holidays move it back).
// Trigger (5-minute bars from Yahoo, completed bars only), checked 12:00 – 2:00 PM IST:
//   CE after a selloff: the day's low came after the day's high, high-to-low >= 0.6%, the low was made 5–60 minutes
//      ago, price has won back >= 20% of the fall, and the last three closes rose one after another.
//   PE after a rally: the mirror image.
// Option: the out-of-the-money strike nearest the index whose price is within the premium range (₹4–12 by default) and
// whose one lot costs no more than the budget (₹1,000); as many lots as the budget allows. Bought at the ask.
// Exits (checked every minute): the bid reaches 3x the entry (target), the price falls to half the entry or the index
// goes back through the day's low / high (stop), or 3:00 PM (time). Sold at the bid.
// One trade a day across all three indices. Sensex options trade on BSE, which blocks automated requests, so a Sensex
// signal is priced with Black-Scholes (volatility from the last 5 days of 5-minute moves x 1.25) and marked "estimate":
// shown and followed, never paper traded, and left out of the stats.
// Tested on 60 days of 5-minute bars (31 expiry days, option prices modelled): 9 trades, 5 winners, about +0.8x the
// premium per trade on average. A small sample: the paper record here is what decides whether it is any good.
// Actions: ?action=run (cron or admin), ?action=exit (admin: close today's open trade now), ?action=take (admin: paper
// trade today's signal when auto paper trading is off), ?action=check&idx=NIFTY[&day=YYYY-MM-DD&at=HH:MM] (admin: the
// trigger state now, or on one of the last 5 days at a given time; a day with no time reports its first signal).
// Auth: x-cron-secret (app_secrets 'crypto_cron') or a signed-in platform admin.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const NSE_H = { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: "https://www.nseindia.com/option-chain", "Accept-Language": "en-US,en;q=0.9" };
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

type Idx = "NIFTY" | "BANKNIFTY" | "SENSEX";
const IDX: Record<Idx, { y: string; step: number; live: boolean; lot?: number }> = {
  NIFTY: { y: "^NSEI", step: 50, live: true },
  BANKNIFTY: { y: "^NSEBANK", step: 100, live: true },
  SENSEX: { y: "^BSESN", step: 100, live: false, lot: 20 },
};
const RULE = { drop: 0.006, freshBars: 12, bounce: 0.2, start: 12 * 60, end: 14 * 60, target: 3, stop: 0.5, timeExit: 15 * 60 };
const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

const istNow = () => new Date(Date.now() + 330 * 60e3);
const istDay = () => istNow().toISOString().slice(0, 10);
const istMin = () => { const t = istNow(); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
const addDays = (d: string, k: number) => new Date(Date.parse(d + "T00:00:00Z") + k * 864e5).toISOString().slice(0, 10);
const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();

async function nse(path: string) {
  const r = await fetch("https://www.nseindia.com" + path, { headers: NSE_H });
  if (!r.ok) throw new Error("NSE " + r.status);
  return await r.json();
}
// "25-Nov-2026" -> "2026-11-25"
const nseDate = (s: string) => { const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s); return m ? new Date(Date.UTC(+m[3], MON[m[2].toUpperCase()], +m[1])).toISOString().slice(0, 10) : null; };

async function holidays() {
  const { data } = await db.from("market_holidays").select("d").gte("d", addDays(istDay(), -10)).lte("d", addDays(istDay(), 10));
  return new Set((data || []).map((h: any) => String(h.d)));
}
const trading = (d: string, hol: Set<string>) => dow(d) >= 1 && dow(d) <= 5 && !hol.has(d);

// Which indices expire today, with NSE's expiry string for the chain request.
async function expiringToday(today: string, hol: Set<string>) {
  const out: { idx: Idx; nseExpiry?: string }[] = [];
  for (const idx of ["NIFTY", "BANKNIFTY"] as Idx[]) {
    try {
      const d = await nse("/api/option-chain-contract-info?symbol=" + idx);
      const list: string[] = Array.isArray(d?.expiryDates) ? d.expiryDates : [];
      const hit = list.find((e) => nseDate(e) === today);
      if (hit) out.push({ idx, nseExpiry: hit });
    } catch (e) { console.log("[expiries]", idx, String(e)); }
  }
  // Sensex: this week's Thursday, moved back to the trading day before it when it is a holiday.
  let thu = addDays(today, (4 - dow(today) + 7) % 7);
  while (!trading(thu, hol) && thu > addDays(today, -1)) thu = addDays(thu, -1);
  if (thu === today) out.push({ idx: "SENSEX" });
  return out;
}

// 5-minute bars: today's completed bars [minuteOfDay, high, low, close] and the last 5 days' 5-minute returns (volatility).
async function bars(idx: Idx, day?: string, atMin?: number) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(IDX[idx].y)}?range=5d&interval=5m`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("Yahoo " + r.status);
  const res = (await r.json())?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0] || {}, ts: number[] = res?.timestamp || [];
  const today = day || istDay(), now = Date.now() / 1000;
  const all: { day: string; m: number; h: number; l: number; c: number }[] = [];
  ts.forEach((t, i) => {
    if (!(q.close?.[i] > 0) || t + 300 > now) return; // completed bars only
    const d = new Date((t + 19800) * 1000);
    all.push({ day: d.toISOString().slice(0, 10), m: d.getUTCHours() * 60 + d.getUTCMinutes(), h: q.high?.[i] || q.close[i], l: q.low?.[i] || q.close[i], c: q.close[i] });
  });
  const tb = all.filter((b) => b.day === today && (atMin == null || b.m + 5 <= atMin));
  const prev = all.filter((b) => b.day < today);
  let ss = 0, k = 0;
  for (let i = 1; i < prev.length; i++) if (prev[i].day === prev[i - 1].day) { const x = Math.log(prev[i].c / prev[i - 1].c); ss += x * x; k++; }
  const vol = k > 20 ? Math.max(0.1, Math.sqrt(ss / k) * Math.sqrt(75 * 252) * 1.25) : 0.15;
  return { tb, vol, spot: n(res?.meta?.regularMarketPrice) || (tb.length ? tb[tb.length - 1].c : 0) };
}

// The trigger on today's bars up to bar t (inclusive). Returns the setup state for the desk, and a signal when it fires.
function check(tb: { m: number; h: number; l: number; c: number }[]) {
  if (tb.length < 4) return { state: "waiting for bars" } as any;
  const t = tb.length - 1, close = tb[t].m + 5;
  let hi = 0, lo = 0;
  tb.forEach((b, i) => { if (b.h > tb[hi].h) hi = i; if (b.l < tb[lo].l) lo = i; });
  const H = tb[hi].h, L = tb[lo].l, C = tb[t].c, rng = H - L;
  const up = lo > hi, dropPct = (up ? rng / H : rng / L) * 100, since = (t - (up ? lo : hi)) * 5, back = rng ? (up ? (C - L) : (H - C)) / rng : 0;
  const three = up ? tb[t].c > tb[t - 1].c && tb[t - 1].c > tb[t - 2].c : tb[t].c < tb[t - 1].c && tb[t - 1].c < tb[t - 2].c;
  const base = { dayHigh: H, dayLow: L, last: C, dir: up ? "fell" : "rose", movePct: r2(dropPct), sinceMin: since, wonBackPct: Math.round(back * 100), three, barClose: close };
  const inWindow = close >= RULE.start && close <= RULE.end;
  const ok = dropPct / 100 >= RULE.drop && since >= 5 && since <= RULE.freshBars * 5 && back >= RULE.bounce && three;
  const need: string[] = [];
  if (dropPct / 100 < RULE.drop) need.push(`a ${(RULE.drop * 100).toFixed(1)}% move (now ${dropPct.toFixed(2)}%)`);
  if (since > RULE.freshBars * 5) need.push("a fresh " + (up ? "low" : "high") + " within the last hour");
  if (back < RULE.bounce) need.push(`a ${RULE.bounce * 100}% bounce back (now ${Math.round(back * 100)}%)`);
  if (!three) need.push("three " + (up ? "rising" : "falling") + " 5-minute closes");
  return { ...base, inWindow, need, signal: ok && inWindow ? { side: up ? "CE" : "PE", pivot: up ? L : H, spot: C } : null };
}

// Black-Scholes (r = 0) for the estimated Sensex premium.
const Nc = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x: number) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
function bs(S: number, K: number, minsLeft: number, vol: number, cp: string) {
  const T = Math.max(minsLeft, 0) / (365 * 24 * 60);
  if (T <= 0) return Math.max(0, cp === "CE" ? S - K : K - S);
  const sd = vol * Math.sqrt(T), d1 = (Math.log(S / K) + 0.5 * sd * sd) / sd, d2 = d1 - sd;
  return cp === "CE" ? S * Nc(d1) - K * Nc(d2) : K * Nc(-d2) - S * Nc(-d1);
}

async function lotSize(idx: Idx) {
  if (IDX[idx].lot) return IDX[idx].lot!;
  const { data } = await db.from("fno_lots").select("lot, months").eq("symbol", idx).maybeSingle();
  const key = istNow().toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase() + "-" + String(istNow().getUTCFullYear()).slice(2);
  return n(data?.months?.[key]) || n(data?.lot) || (idx === "NIFTY" ? 65 : 30);
}
async function chain(idx: Idx, expiry: string) {
  const d = await nse(`/api/option-chain-v3?type=Indices&symbol=${idx}&expiry=${expiry}`);
  const rows = (d?.records?.data || []) as any[];
  const q = (x: any) => ({ bid: n(x?.buyPrice1 ?? x?.bidprice ?? x?.bidPrice), ask: n(x?.sellPrice1 ?? x?.askPrice ?? x?.askprice), ltp: n(x?.lastPrice) });
  return { spot: n(d?.records?.underlyingValue), rows: rows.map((x) => ({ k: n(x.strikePrice ?? x.CE?.strikePrice ?? x.PE?.strikePrice), CE: q(x.CE), PE: q(x.PE) })).filter((x) => x.k > 0).sort((a, b) => a.k - b.k) };
}

async function admins(): Promise<string[]> {
  const { data } = await db.from("profiles").select("id").eq("role", "admin");
  return (data || []).map((p: any) => p.id);
}
async function alert(key: string, icon: string, title: string, body: string) {
  const ids = await admins();
  if (ids.length) await db.from("user_alerts").upsert(ids.map((user_id) => ({ user_id, key, kind: "option", icon, title, body, url: "/stock-signals.html#options" })), { onConflict: "user_id,key", ignoreDuplicates: true });
}
const label = (t: any) => `${t.idx} ${t.strike} ${t.side}`;

// Open (or, for Sensex / auto paper off, only record) today's trade from a signal.
async function open(today: string, idx: Idx, nseExpiry: string | undefined, sig: any, st: any, settings: any, vol: number, force = false) {
  const lot = await lotSize(idx), side = sig.side as "CE" | "PE", step = IDX[idx].step, minsLeft = 15 * 60 + 30 - istMin();
  let pick: { k: number; price: number } | null = null, estimate = !IDX[idx].live;
  if (IDX[idx].live && nseExpiry) {
    const ch = await chain(idx, nseExpiry);
    const otm = ch.rows.filter((r) => side === "CE" ? r.k > sig.spot : r.k < sig.spot);
    if (side === "PE") otm.reverse();
    for (const r of otm) {
      const o = r[side], price = o.ask > 0 ? o.ask : o.ltp;
      if (!(price > 0)) continue;
      if (price > settings.max_prem || price * lot > settings.budget) continue;
      if (price < settings.min_prem) break;
      pick = { k: r.k, price }; break;
    }
  } else {
    const base = side === "CE" ? Math.ceil(sig.spot / step) * step : Math.floor(sig.spot / step) * step;
    for (let i = 0; i < 80; i++) {
      const k = side === "CE" ? base + i * step : base - i * step, p = bs(sig.spot, k, minsLeft, vol, side);
      if (p > settings.max_prem || p * lot > settings.budget) continue;
      if (p < settings.min_prem) break;
      pick = { k, price: r2(p) }; break;
    }
  }
  if (!pick) return { skipped: `no ${side} priced ₹${settings.min_prem}–${settings.max_prem} within ₹${settings.budget} a lot` };
  const lots = Math.max(1, Math.floor(settings.budget / (pick.price * lot))), qty = lots * lot;
  const paper = !estimate && (settings.auto_paper || force);
  const row = {
    day: today, idx, side, expiry: today, strike: pick.k, lot_size: lot, lots, qty, entry: pick.price,
    stop: r2(pick.price * RULE.stop), target: r2(pick.price * RULE.target), spot_entry: sig.spot, pivot: sig.pivot,
    day_high: st.dayHigh, day_low: st.dayLow, move_pct: st.movePct, estimate, status: paper ? "OPEN" : "SIGNAL",
    reasons: { dir: st.dir, movePct: st.movePct, sinceMin: st.sinceMin, wonBackPct: st.wonBackPct, vol: r2(vol), barClose: st.barClose },
    mark: pick.price, mark_spot: sig.spot, marked_at: new Date().toISOString(), pnl: 0,
  };
  const { data, error } = await db.from("expiry_trades").insert(row).select().single();
  if (error) return { skipped: error.code === "23505" ? "already a trade today" : error.message };
  const what = (side === "CE" ? "Buy " : "Buy ") + `${idx} ${pick.k} ${side} at ₹${pick.price}` + ` × ${qty} (₹${Math.round(pick.price * qty)})`;
  await alert(`exp|${today}|open`, "⚡", (estimate ? "Signal (estimate): " : paper ? "Paper trade: " : "Signal: ") + what,
    `${idx} ${st.dir} ${st.movePct}% and is turning ${side === "CE" ? "up" : "down"}. Target ₹${row.target}, stop ₹${row.stop} or ${idx} back past ${Math.round(sig.pivot)}; out by 3:00 PM.` + (estimate ? " Sensex price is an estimate: check it in your trading app." : ""));
  return { opened: data };
}

// Mark and, when due, close today's open trade (or follow today's signal).
async function manage(t: any, reason?: string) {
  const idx = t.idx as Idx, now = istMin();
  let bid = 0, ltp = 0, spot = 0;
  if (!t.estimate) {
    const { data: ex } = await db.from("expiry_watch").select("data").eq("idx", idx).maybeSingle();
    const list = await nse("/api/option-chain-contract-info?symbol=" + idx).then((d) => (d?.expiryDates || []) as string[]).catch(() => [] as string[]);
    const exp = list.find((e) => nseDate(e) === t.expiry) || ex?.data?.nseExpiry;
    if (!exp) return { note: "expiry not found" };
    const ch = await chain(idx, exp), row = ch.rows.find((r) => r.k === Number(t.strike));
    if (!row) return { note: "strike not in chain" };
    const o = row[t.side as "CE" | "PE"]; ltp = o.ltp; bid = o.bid > 0 ? o.bid : o.ltp; spot = ch.spot;
  } else {
    const b = await bars(idx); spot = b.spot;
    ltp = bid = r2(bs(spot, Number(t.strike), 15 * 60 + 30 - now, Number(t.reasons?.vol) || 0.15, t.side));
  }
  const broke = t.side === "CE" ? spot > 0 && spot < Number(t.pivot) : spot > Number(t.pivot);
  let why = reason || null;
  if (!why && bid >= Number(t.target)) why = "target";
  else if (!why && (ltp > 0 && ltp <= Number(t.stop))) why = "stop";
  else if (!why && broke) why = "index back past " + Math.round(Number(t.pivot));
  else if (!why && now >= RULE.timeExit) why = "3:00 PM exit";
  const pnl = Math.round((bid - Number(t.entry)) * Number(t.qty));
  if (!why) {
    await db.from("expiry_trades").update({ mark: ltp, mark_spot: spot, marked_at: new Date().toISOString(), pnl }).eq("id", t.id);
    return { marked: { ltp, bid, spot, pnl } };
  }
  await db.from("expiry_trades").update({ status: "CLOSED", exit: bid, exit_spot: spot, exit_reason: why, closed_at: new Date().toISOString(), mark: ltp, mark_spot: spot, marked_at: new Date().toISOString(), pnl }).eq("id", t.id);
  await alert(`exp|${t.day}|close`, pnl >= 0 ? "✅" : "⛔", `${t.estimate ? "Signal ended" : "Paper trade closed"}: ${label(t)} ${pnl >= 0 ? "+" : "−"}₹${Math.abs(pnl)}`,
    `Out at ₹${bid} (in at ₹${t.entry}): ${why}.` + (t.estimate ? " Estimated (Sensex)." : ""));
  return { closed: { why, bid, pnl } };
}

async function isAdmin(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return false;
  const { data: p } = await db.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return p?.role === "admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const u = new URL(req.url), action = u.searchParams.get("action") || "run";
    const { data: s } = await db.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    const cron = !!s && req.headers.get("x-cron-secret") === s.value;
    if (!cron && !(await isAdmin(req))) return json({ error: "unauthorized" }, 401);
    const today = istDay(), now = istMin(), hol = await holidays();
    const { data: settings } = await db.from("expiry_settings").select("*").eq("id", 1).maybeSingle();
    const { data: t } = await db.from("expiry_trades").select("*").eq("day", today).maybeSingle();

    if (action === "exit") {
      if (!t || !["OPEN", "SIGNAL"].includes(t.status)) return json({ error: "no open trade today" }, 400);
      return json(await manage(t, "closed by hand"));
    }
    if (action === "check") {
      const idx = (u.searchParams.get("idx") || "NIFTY").toUpperCase() as Idx;
      if (!IDX[idx]) return json({ error: "idx must be NIFTY, BANKNIFTY or SENSEX" }, 400);
      // Replay a past day (last 5 trading days) as it stood at a time: &day=2026-11-17&at=13:30
      const day = u.searchParams.get("day") || undefined, at = /^(\d{1,2}):(\d{2})$/.exec(u.searchParams.get("at") || "");
      const b = await bars(idx, day, at ? +at[1] * 60 + +at[2] : undefined);
      let nseExp: unknown = null;
      if (IDX[idx].live) nseExp = await nse("/api/option-chain-contract-info?symbol=" + idx).then((d) => (d?.expiryDates || []).slice(0, 4)).catch((e) => String(e));
      // A past day without a time: walk 12:00 – 2:00 PM bar by bar and report the first signal, as the cron would have.
      let first: unknown = null;
      if (day && !at) for (let m = RULE.start; m <= RULE.end && !first; m += 5) { const c = check(b.tb.filter((x) => x.m + 5 <= m)); if (c.signal) first = { at: m, ...c }; }
      return json({ idx, day: day || today, bars: b.tb.length, vol: r2(b.vol), ...check(b.tb), firstSignal: first, expiringToday: await expiringToday(today, hol), nseExpiries: nseExp });
    }
    if (!trading(today, hol)) return json({ skipped: "not a trading day" });
    const exp = await expiringToday(today, hol);
    if (!exp.length) return json({ skipped: "no index expires today" });

    if (action === "take") {
      if (!t || t.status !== "SIGNAL" || t.estimate) return json({ error: "no live signal to paper trade today" }, 400);
      if (now >= RULE.timeExit) return json({ error: "too late: trades close at 3:00 PM" }, 400);
      // Re-price at the current ask.
      const e = exp.find((x) => x.idx === t.idx);
      const ch = await chain(t.idx, e!.nseExpiry!), row = ch.rows.find((r) => r.k === Number(t.strike));
      const o = row?.[t.side as "CE" | "PE"]; const price = o ? (o.ask > 0 ? o.ask : o.ltp) : 0;
      if (!(price > 0)) return json({ error: "no price for the strike now" }, 400);
      const qty = Math.max(1, Math.floor(settings.budget / (price * t.lot_size))) * t.lot_size;
      await db.from("expiry_trades").update({ status: "OPEN", entry: price, stop: r2(price * RULE.stop), target: r2(price * RULE.target), qty, lots: qty / t.lot_size, mark: price, pnl: 0 }).eq("id", t.id);
      return json({ taken: { price, qty } });
    }

    const out: Record<string, unknown> = { expiring: exp.map((e) => e.idx) };
    if (t && ["OPEN", "SIGNAL"].includes(t.status) && now >= RULE.start) out.manage = await manage(t);

    // Watch each expiring index; open today's trade on the first signal.
    const watch: Record<string, unknown> = {};
    let opened = !!t;
    for (const e of exp) {
      try {
        const b = await bars(e.idx), c = check(b.tb);
        watch[e.idx] = { ...c, vol: r2(b.vol), live: IDX[e.idx].live, nseExpiry: e.nseExpiry || null };
        if (!opened && c.signal && now >= RULE.start && now <= RULE.end + 2) {
          const r = await open(today, e.idx, e.nseExpiry, c.signal, c, settings, b.vol);
          watch[e.idx] = { ...(watch[e.idx] as object), result: r };
          if ((r as any).opened) opened = true;
        }
      } catch (err) { watch[e.idx] = { error: String((err as Error).message || err) }; }
      await db.from("expiry_watch").upsert({ idx: e.idx, day: today, data: watch[e.idx], updated_at: new Date().toISOString() });
    }
    out.watch = watch;
    return json(out);
  } catch (e) {
    console.error("[expiry-reversal]", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
