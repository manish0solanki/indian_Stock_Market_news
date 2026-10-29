// crypto-bot: server-side scanner + auto trader (runs from a Supabase cron job, browser not needed).
// Same V6 strategy, thresholds and rules as crypto-signals.html, plus the V7 trade guards.
// Opening a trade is ONE atomic database call (trade row + wallet reservation) protected by the
// wallet-overdraft trigger and the one-running-trade-per-pair index.
//
// Loss circuit-breaker: when the last BREAKER_WINDOW closed trades (real and shadow) average below
// 0R, no real trades are opened. Signals that would have been traded are recorded as shadow trades
// (crypto_shadow_trades, managed by crypto-monitor, no wallet), and real trading resumes once the
// rolling average is back above BREAKER_RESUME_R.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  COINS, analyzeV6, finalizeSignals, recalcFromLive, validateLevels,
  type Candle,
} from "./analysis.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
const V6_MAX_OPEN_TRADES = 3;
const V6_MAX_OPEN_CAPITAL_PCT = 0.50;
const V6_DAILY_LOSS_PCT = 0.02;
const V6_MAX_CONSECUTIVE_LOSSES = 3;
const V6_COOLDOWN_AFTER_LOSSES_H = 4;
const V6_PAIR_LOSS_COOLDOWN_H = 6;
const MAX_NEW_TRADES_PER_RUN = 2;
const GUARD_TF_OK = ["4h", "6h", "8h", "12h", "1d", "3d", "1w"];
const GUARD_VERSION = 7;
const BREAKER_WINDOW = 30;     // closed trades in the rolling average
const BREAKER_MIN_TRADES = 20; // fewer than this: not enough evidence to trip
const BREAKER_RESUME_R = 0.05; // average R needed to switch real trading back on

let fxCache: { rate: number; at: number } | null = null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function binanceGet(path: string): Promise<any> {
  let lastErr = "";
  for (const host of HOSTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(host + path, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`${host} HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = String((e as Error)?.message || e);
    }
  }
  throw new Error(lastErr || "Binance unreachable");
}

async function getUsdInr(): Promise<number> {
  const now = Date.now();
  if (fxCache && now - fxCache.at < 6 * 3600_000) return fxCache.rate;
  const r = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!r.ok) throw new Error("USD/INR HTTP " + r.status);
  const d = await r.json();
  const rate = Number(d?.rates?.INR);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("USD/INR unavailable");
  fxCache = { rate, at: now };
  return rate;
}

const DEFAULT_CFG = {
  tf: "4h", quotes: ["USDT"], scanMode: "all", pairs: [] as string[], currencies: [] as string[],
  direction: "BOTH", risk: 1, reward: 2, confidence: 75, amount: 1000, leverage: 5,
  feeMode: "taker", v6Limits: true, tzOffsetMin: 330,
  schedule: { mode: "default", start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] },
  guards: { maxOpen: 8, maxPerDir: 3, minSlPct: 1.3, maxDriftR: 0.25, minRR: 1.5, tfMode: "4h_plus", allowShorts: false },
};

function mergeCfg(raw: any) {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    ...DEFAULT_CFG, ...c,
    schedule: { ...DEFAULT_CFG.schedule, ...(c.schedule || {}) },
    guards: { ...DEFAULT_CFG.guards, ...(c.guards || {}) },
  };
}

function scheduleAllowed(cfg: any): boolean {
  if (cfg.schedule.mode !== "custom") return true;
  const local = new Date(Date.now() + (Number(cfg.tzOffsetMin) || 0) * 60_000);
  const day = local.getUTCDay();
  if (!Array.isArray(cfg.schedule.days) || !cfg.schedule.days.includes(day)) return false;
  const p = (s: string) => { const m = String(s || "").match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  const now = local.getUTCHours() * 60 + local.getUTCMinutes();
  const a = p(cfg.schedule.start), b = p(cfg.schedule.end);
  if (a === b) return true;
  return a < b ? now >= a && now <= b : now >= a || now <= b;
}

type Klines = Candle[];
async function fetchKlines(symbol: string, tf: string, fx: number): Promise<Klines> {
  const raw = await binanceGet(`/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=160`);
  if (!Array.isArray(raw) || raw.length < 120) throw new Error("Not enough candles");
  raw.pop(); // drop the candle that is still forming
  return raw.map((k: any) => ({ t: +k[0], o: +k[1] * fx, h: +k[2] * fx, l: +k[3] * fx, c: +k[4] * fx, v: +k[5] }));
}

async function scanQuote(q: string, cfg: any, fx: number, tickers: Map<string, any>, blockedPairs: Set<string>, diag: Record<string, number>) {
  const sourceQuote = q === "INR" ? "USDT" : q;
  let targets = COINS
    .filter((b) => !(sourceQuote === "BTC" && b === "BTC"))
    .map((b) => b + sourceQuote)
    .filter((s) => tickers.has(s));
  if (cfg.scanMode === "pairs") targets = targets.filter((s) => (cfg.pairs || []).includes(s));
  if (cfg.scanMode === "currencies") targets = targets.filter((s) => (cfg.currencies || []).includes(s.slice(0, -sourceQuote.length)));

  const rrRatio = Math.max(1, Number(cfg.reward) || 2) / Math.max(1, Number(cfg.risk) || 1);
  const scale = q === "INR" ? fx : 1;
  const results: any[] = [];
  let ok = 0, fail = 0;

  for (let i = 0; i < targets.length; i += 8) {
    const batch = targets.slice(i, i + 8);
    const res = await Promise.all(batch.map(async (src) => {
      try {
        const [candles, htf] = await Promise.all([
          fetchKlines(src, cfg.tf, scale),
          cfg.tf !== "4h" ? fetchKlines(src, "4h", scale) : Promise.resolve(null),
        ]);
        ok++;
        const t = tickers.get(src);
        const display = q === "INR" ? src.replace(/USDT$/, "") + "INR" : src;
        const signal = analyzeV6(
          candles, display, { chg: Number(t.priceChangePercent) }, { ratio: rrRatio },
          cfg.direction, htf, blockedPairs.has(display), diag,
        );
        if (!signal) return null;
        signal.sourcePair = src;
        signal.quote = q;
        const price = Number(t.lastPrice) * scale;
        if (Number.isFinite(price) && price > 0) recalcFromLive(signal, price, rrRatio);
        if (!validateLevels(signal)) return null;
        signal.price = price; signal.currentPrice = price;
        return signal;
      } catch (_e) {
        fail++;
        return null;
      }
    }));
    results.push(...res);
  }
  return { signals: finalizeSignals(results, cfg.direction, rrRatio), ok, fail, scanned: targets.length };
}

// R multiple of a closed real trade. The stored stop may have been trailed, so the original risk is
// rebuilt from the untouched target: risk = |target - entry| / rr.
function realR(t: any): number | null {
  const entry = Number(t.entry_price), tp = Number(t.take_profit), rr = Number(t.rr) || 2;
  const amt = Number(t.amount_inr), lev = Number(t.leverage) || 1, pnl = Number(t.pnl_inr);
  const riskInr = amt * lev * (Math.abs(tp - entry) / rr) / entry;
  return riskInr > 0 && Number.isFinite(pnl) ? pnl / riskInr : null;
}

// Rolling expectancy over the most recent closed trades, real and shadow together.
async function breakerState(uid: string, prevActive: boolean) {
  const [realQ, shadowQ] = await Promise.all([
    supabase.from("crypto_trades").select("entry_price,take_profit,rr,amount_inr,leverage,pnl_inr,closed_at,status")
      .eq("user_id", uid).not("closed_at", "is", null).neq("status", "CANCELLED").order("closed_at", { ascending: false }).limit(BREAKER_WINDOW),
    supabase.from("crypto_shadow_trades").select("r_multiple,closed_at")
      .eq("user_id", uid).not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(BREAKER_WINDOW),
  ]);
  if (realQ.error || shadowQ.error) throw new Error("breaker load failed: " + (realQ.error || shadowQ.error)!.message);
  const recent = [
    ...(realQ.data || []).map((t: any) => ({ at: t.closed_at, r: realR(t), shadow: false })),
    ...(shadowQ.data || []).map((t: any) => ({ at: t.closed_at, r: Number(t.r_multiple), shadow: true })),
  ].filter((x) => x.r !== null && Number.isFinite(x.r))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, BREAKER_WINDOW);
  const n = recent.length;
  const expR = n ? recent.reduce((s, x) => s + (x.r as number), 0) / n : 0;
  const active = n >= BREAKER_MIN_TRADES && (prevActive ? expR < BREAKER_RESUME_R : expR < 0);
  return {
    active, n, expR: Math.round(expR * 1000) / 1000, window: BREAKER_WINDOW, minTrades: BREAKER_MIN_TRADES,
    resumeAtR: BREAKER_RESUME_R, shadowInWindow: recent.filter((x) => x.shadow).length,
    since: active ? (prevActive ? undefined : new Date().toISOString()) : undefined,
  };
}

// The per-signal guards that apply to real and shadow trades alike. Returns the reason to skip, or "".
function guardReason(s: any, cfg: any, dirCount: Record<string, number>): string {
  const g = cfg.guards, tfLow = String(cfg.tf).toLowerCase();
  if (s.dir === "SHORT" && !g.allowShorts) return `${s.sym} SHORT: auto SHORT trades are off`;
  if (g.tfMode === "4h_plus" && !GUARD_TF_OK.includes(tfLow)) return `${s.sym}: timeframe ${tfLow} is below 4h`;
  if ((dirCount[s.dir] || 0) >= g.maxPerDir) return `${s.sym} ${s.dir}: already ${dirCount[s.dir]} open in that direction (max ${g.maxPerDir})`;
  const slPct = Math.abs(s.entry - s.sl) / s.entry * 100;
  if (slPct < g.minSlPct) return `${s.sym}: stop only ${slPct.toFixed(2)}% away (min ${g.minSlPct}%)`;
  const liveRisk = s.dir === "LONG" ? s.entry - s.sl : s.sl - s.entry;
  const liveReward = s.dir === "LONG" ? s.tp - s.entry : s.entry - s.tp;
  if (!(liveRisk > 0) || !(liveReward > 0) || liveReward / liveRisk < g.minRR) return `${s.sym}: reward:risk below ${g.minRR}`;
  return "";
}

async function scanAll(cfg: any, pairCooldown: Set<string>, summary: any) {
  const tickerArr = await binanceGet("/api/v3/ticker/24hr");
  const tickers = new Map<string, any>();
  for (const t of tickerArr) tickers.set(t.symbol, t);
  const quotes: string[] = (Array.isArray(cfg.quotes) && cfg.quotes.length ? cfg.quotes : ["USDT"]).filter((q: string) => ["USDT", "BTC", "INR"].includes(q));
  const fx = quotes.includes("INR") ? await getUsdInr() : 1;
  const all: any[] = [];
  const gates: Record<string, number> = {};
  let scanned = 0, okReq = 0, failReq = 0;
  for (const q of quotes) {
    const r = await scanQuote(q, cfg, fx, tickers, pairCooldown, gates);
    all.push(...r.signals);
    scanned += r.scanned; okReq += r.ok; failReq += r.fail;
  }
  summary.gates = gates; // how many (coin, direction) checks failed each rule
  summary.scanned = scanned; summary.requestsOk = okReq; summary.requestsFailed = failReq; summary.signals = all.length;
  summary.best = all.slice(0, 5).map((s) => `${s.sym} ${s.dir} score ${s.score} conf ${s.conf}`);
  return all;
}

function tradeNotes(s: any, cfg: any, extra: Record<string, unknown> = {}) {
  const feeRate = (cfg.feeMode === "maker_bnb" || cfg.feeMode === "taker_bnb") ? 0.00075 : 0.001;
  return JSON.stringify({
    strategy: "V6", engine: "SERVER_BOT", direction: s.dir, version: 6, guardVersion: GUARD_VERSION,
    signalEntry: s.entry, fillPrice: s.entry, replayedUntil: Date.now(), initialStop: s.sl,
    feeMode: cfg.feeMode || "taker", feeRate, score: s.score, conf: s.conf, reasons: s.reasons,
    serverOpenedAt: new Date().toISOString(), ...extra,
  });
}

// Breaker on: record what would have been traded, without touching the wallet.
async function runShadow(uid: string, cfg: any, open: any[], summary: any, dry: boolean) {
  const block = (m: string) => summary.blocked.push(m);
  const b = summary.breaker;
  block(`circuit breaker: last ${b.n} trades average ${b.expR >= 0 ? "+" : ""}${b.expR.toFixed(2)}R; signals are paper-tracked until it is back above +${BREAKER_RESUME_R}R`);
  const { data: runningShadow, error } = await supabase.from("crypto_shadow_trades").select("pair,direction").eq("user_id", uid).eq("status", "RUNNING");
  if (error) throw new Error("shadow load failed: " + error.message);
  const all = await scanAll(cfg, new Set(), summary);
  const confidenceMin = Math.min(95, Math.max(0, Number(cfg.confidence) || 75));
  const busy = new Set([...open.map((t: any) => t.pair), ...(runningShadow || []).map((t: any) => t.pair)]);
  const qualified = all.filter((s) => s.dir && Number(s.conf ?? s.score ?? 0) >= confidenceMin && validateLevels(s) && !busy.has(s.sym));
  summary.qualified = qualified.length;
  const dirCount: Record<string, number> = { LONG: 0, SHORT: 0 };
  for (const t of runningShadow || []) dirCount[t.direction] = (dirCount[t.direction] || 0) + 1;
  summary.shadowOpened = [] as string[];
  for (const s of qualified) {
    if (summary.shadowOpened.length >= MAX_NEW_TRADES_PER_RUN) break;
    const why = guardReason(s, cfg, dirCount);
    if (why) { if (summary.blocked.length < 4) block(why); continue; }
    if (!dry) {
      const { error: e } = await supabase.from("crypto_shadow_trades").insert({
        user_id: uid, pair: s.sym, symbol: String(s.sym).replace(/(USDT|INR|BTC)$/, ""), quote: s.quote, direction: s.dir,
        timeframe: cfg.tf, entry_price: s.entry, stop_loss: s.sl, take_profit: s.tp, rr: s.rr,
        amount_inr: Math.max(1, Number(cfg.amount) || 1000), leverage: Math.max(1, Number(cfg.leverage) || 5),
        score: s.score, notes: tradeNotes(s, cfg, { shadow: true }), current_price: s.entry,
      });
      if (e) { block(`${s.sym} ${s.dir}: shadow not recorded (${e.message})`); continue; }
    }
    summary.shadowOpened.push(`${s.sym} ${s.dir}`);
    dirCount[s.dir] = (dirCount[s.dir] || 0) + 1;
  }
  return summary;
}

async function runUser(row: any, dry: boolean) {
  const uid: string = row.user_id;
  const cfg = mergeCfg(row.config);
  const summary: any = { user: uid, dry, opened: [] as any[], blocked: [] as string[], signals: 0, qualified: 0 };
  const block = (m: string) => summary.blocked.push(m);

  if (!row.enabled && !dry) { summary.skipped = "server mode off"; return summary; }
  if (!scheduleAllowed(cfg)) { summary.skipped = "outside the allowed trading schedule"; return summary; }

  // ---- user state --------------------------------------------------------
  const [openQ, closedQ, walletQ] = await Promise.all([
    supabase.from("crypto_trades").select("id,pair,direction,amount_inr").eq("user_id", uid).eq("status", "RUNNING").is("closed_at", null),
    supabase.from("crypto_trades").select("pair,pnl_inr,closed_at").eq("user_id", uid).not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(200),
    supabase.from("crypto_wallet_transactions").select("txn_type,amount_inr").eq("user_id", uid),
  ]);
  if (openQ.error || closedQ.error || walletQ.error) throw new Error("state load failed: " + (openQ.error || closedQ.error || walletQ.error)!.message);
  const open = openQ.data || [];
  const closed = closedQ.data || [];
  const cash0 = (walletQ.data || []).reduce((s: number, x: any) => s + Number(x.amount_inr || 0), 0);
  const deposits = (walletQ.data || []).filter((x: any) => x.txn_type === "DEPOSIT").reduce((s: number, x: any) => s + Number(x.amount_inr || 0), 0);
  const withdrawals = Math.abs((walletQ.data || []).filter((x: any) => x.txn_type === "WITHDRAWAL").reduce((s: number, x: any) => s + Number(x.amount_inr || 0), 0));
  summary.openTrades = open.length;
  summary.cash = Math.round(cash0 * 100) / 100;

  // ---- loss circuit-breaker ----------------------------------------------------
  const prev = row.last_summary?.breaker;
  summary.breaker = await breakerState(uid, prev?.active === true);
  if (summary.breaker.active && prev?.active === true && prev.since) summary.breaker.since = prev.since;
  if (summary.breaker.active) return await runShadow(uid, cfg, open, summary, dry);

  const amount = Math.max(1, Number(cfg.amount) || 1000);
  const leverage = Math.max(1, Number(cfg.leverage) || 5);
  const confidenceMin = Math.min(95, Math.max(0, Number(cfg.confidence) || 75));
  const g = cfg.guards;

  // ---- V6 limits (only when the page has Limits ON) -------------------------
  const nowMs = Date.now();
  const pairCooldown = new Set<string>();
  let limitsReason = "";
  if (cfg.v6Limits) {
    for (const t of closed) {
      if (Number(t.pnl_inr) < 0 && nowMs - new Date(t.closed_at).getTime() < V6_PAIR_LOSS_COOLDOWN_H * 3600e3) pairCooldown.add(t.pair);
    }
    const realized = closed.reduce((s: number, t: any) => s + Number(t.pnl_inr || 0), 0);
    const equity = Math.max(0, deposits - withdrawals + realized);
    const openCapital = open.reduce((s: number, t: any) => s + Number(t.amount_inr || 0), 0);
    const localDay = (ms: number) => Number.isFinite(ms) ? new Date(ms + (Number(cfg.tzOffsetMin) || 0) * 60_000).toISOString().slice(0, 10) : "";
    const todayKey = localDay(nowMs);
    const todayPnl = closed.filter((t: any) => localDay(new Date(t.closed_at).getTime()) === todayKey).reduce((s: number, t: any) => s + Number(t.pnl_inr || 0), 0);
    const dailyLimit = Math.max(1, deposits * V6_DAILY_LOSS_PCT);
    let streak = 0;
    for (const t of closed) { if (Number(t.pnl_inr) < 0) streak++; else break; }
    const lastLoss = closed.length ? new Date(closed[0].closed_at).getTime() : 0;
    if (open.length >= V6_MAX_OPEN_TRADES) limitsReason = `maximum ${V6_MAX_OPEN_TRADES} open trades reached`;
    else if (equity <= 0) limitsReason = "paper equity is zero or negative";
    else if (openCapital >= equity * V6_MAX_OPEN_CAPITAL_PCT) limitsReason = "open capital is already at 50% of paper equity";
    else if (todayPnl <= -dailyLimit) limitsReason = "daily loss limit reached";
    else if (streak >= V6_MAX_CONSECUTIVE_LOSSES && nowMs - lastLoss < V6_COOLDOWN_AFTER_LOSSES_H * 3600e3) limitsReason = `cooldown after ${streak} consecutive losses`;
    summary.limits = { openCapital, equity: Math.round(equity), todayPnl: Math.round(todayPnl), streak };
  }
  if (limitsReason) { block("V6 limits: " + limitsReason); return summary; }
  if (open.length >= g.maxOpen) { block(`guard: already ${open.length} open trades (max ${g.maxOpen})`); return summary; }
  if (cash0 + 0.000001 < amount) { block(`wallet: need ₹${amount}, available ₹${summary.cash}`); return summary; }

  // ---- scan --------------------------------------------------------------
  const all = await scanAll(cfg, pairCooldown, summary);

  // ---- select + open -------------------------------------------------------
  const threshold = all.filter((s) => s.dir && Number(s.conf ?? s.score ?? 0) >= confidenceMin && validateLevels(s));
  const openPairs = new Set(open.map((t: any) => t.pair));
  const qualified = threshold.filter((s) => !openPairs.has(s.sym));
  summary.qualified = qualified.length;
  if (!qualified.length) {
    block(threshold.length ? `${threshold.length} signal(s) meet ${confidenceMin}% but already have an open trade` : `no signal reached ${confidenceMin}% confidence`);
    return summary;
  }

  let cash = cash0;
  const dirCount: Record<string, number> = { LONG: 0, SHORT: 0 };
  for (const t of open) dirCount[t.direction] = (dirCount[t.direction] || 0) + 1;
  let openCount = open.length;

  for (const s of qualified) {
    if (summary.opened.length >= MAX_NEW_TRADES_PER_RUN) break;
    if (cash + 0.000001 < amount) { block(`wallet: need ₹${amount}, available ₹${Math.round(cash)}`); break; }
    if (openCount >= g.maxOpen) { block(`guard: max ${g.maxOpen} open trades`); break; }
    if (cfg.v6Limits && openCount >= V6_MAX_OPEN_TRADES) { block(`V6 limits: max ${V6_MAX_OPEN_TRADES} open trades`); break; }
    const why = guardReason(s, cfg, dirCount);
    if (why) { block(why); continue; }

    const notes = tradeNotes(s, cfg);
    const base = String(s.sym).replace(/(USDT|INR|BTC)$/, "");
    if (dry) {
      summary.opened.push({ pair: s.sym, dir: s.dir, entry: s.entry, sl: s.sl, tp: s.tp, conf: s.conf, score: s.score, dryRun: true });
      cash -= amount; openCount++; dirCount[s.dir] = (dirCount[s.dir] || 0) + 1;
      continue;
    }
    const { data: tradeId, error } = await supabase.rpc("server_open_trade", {
      p_user: uid, p_pair: s.sym, p_symbol: base, p_quote: s.quote, p_direction: s.dir, p_timeframe: cfg.tf,
      p_entry: s.entry, p_sl: s.sl, p_tp: s.tp, p_amount: amount, p_leverage: leverage,
      p_rr: s.rr, p_score: s.score, p_notes: notes,
    });
    if (error) { block(`${s.sym} ${s.dir}: not opened (${error.message})`); continue; }
    summary.opened.push({ id: tradeId, pair: s.sym, dir: s.dir, entry: s.entry, sl: s.sl, tp: s.tp, conf: s.conf, score: s.score });
    cash -= amount; openCount++; dirCount[s.dir] = (dirCount[s.dir] || 0) + 1;
  }
  return summary;
}

/* Public, redacted run summary (no balances, no user ids) for the heartbeat shown in the pages. */
function publicSummary(out: any[], enabledAccounts: number) {
  const o = out[0] || {};
  return {
    accounts: enabledAccounts,
    scanned: o.scanned ?? 0,
    signals: o.signals ?? 0,
    qualified: o.qualified ?? 0,
    openTrades: o.openTrades ?? 0,
    opened: (o.opened || []).map((x: any) => `${x.pair} ${x.dir}`),
    shadowOpened: o.shadowOpened || [],
    breaker: o.breaker ? { active: o.breaker.active, expR: o.breaker.expR, n: o.breaker.n } : null,
    blocked: (o.blocked || []).slice(0, 2),
    skipped: o.skipped ?? (enabledAccounts === 0 ? "no account has Server mode ON" : null),
    error: o.error ?? null,
  };
}

Deno.serve(async (req) => {
  const started = Date.now();
  let beat = false;
  const finish = async (ok: boolean, error: string | null, summary: any) => {
    if (!beat) return;
    beat = false;
    try {
      await supabase.rpc("bot_job_finish", {
        p_job: "bot", p_ok: ok, p_error: error, p_duration_ms: Date.now() - started, p_summary: summary, p_log: true,
      });
    } catch (_e) { /* the heartbeat must never break a run */ }
  };
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: s } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!s || !secret || secret !== s.value) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";
    if (!dry) {
      const { data: go } = await supabase.rpc("bot_job_start", { p_job: "bot", p_interval: 60 });
      if (go === false) return json({ skipped: "previous run still in progress" });
      beat = true;
    }

    let q = supabase.from("crypto_bot_settings").select("*");
    if (!dry) q = q.eq("enabled", true);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const out: any[] = [];
    for (const row of rows || []) {
      let summary: any;
      try { summary = await runUser(row, dry); }
      catch (e) { summary = { user: row.user_id, error: String((e as Error)?.message || e) }; }
      out.push(summary);
      if (!dry) {
        await supabase.from("crypto_bot_settings")
          .update({ last_run_at: new Date().toISOString(), last_summary: summary })
          .eq("user_id", row.user_id);
      }
    }
    const pub = publicSummary(out, rows?.length || 0);
    await finish(!pub.error, pub.error, pub);
    console.log("CRYPTO_BOT", JSON.stringify({ dry, users: out.length, out }));
    return json({ dry, users: out.length, out });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    await finish(false, msg, { error: msg });
    console.error("CRYPTO_BOT_FATAL", e);
    return json({ error: msg }, 500);
  }
});
