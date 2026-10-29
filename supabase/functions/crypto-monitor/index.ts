// crypto-monitor: server-side SL / TP / trailing-stop monitor for RUNNING paper trades.
// Runs from a Supabase cron job (every minute) so trades are managed even when the browser is closed.
// Logic mirrors crypto-signals.html: candles are replayed in order, the stop is checked
// BEFORE the target inside one candle (conservative), stops/targets fill at their exact level,
// and the wallet is refunded once (capital + net P&L after fees).
// Shadow trades (crypto_shadow_trades, recorded while the bot's loss circuit-breaker is on) follow
// the same rules but never touch the wallet; their result is stored as an R multiple.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const TRAIL_TRIGGER = 30;
const TRAIL_STEP = 10;
const TRAIL_START = 10;
const MIN_GAP_MS = 150_000; // page is considered alive if it stamped the trade within 2.5 min
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

let fxCache: { rate: number; at: number } | null = null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseNotes(raw: unknown): Record<string, any> {
  try {
    const n = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
    return n && typeof n === "object" ? n : {};
  } catch {
    return {};
  }
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

type Candle = { openT: number; closeT: number; h: number; l: number; c: number };

async function fetchCandles(source: string, fromMs: number, fx: number): Promise<{ candles: Candle[]; host: string }> {
  const now = Date.now();
  const gap = now - fromMs;
  const iv = gap <= 16 * 3600e3 ? "1m" : gap <= 3.4 * 86400e3 ? "5m" : "15m";
  let lastErr = "";
  for (const host of HOSTS) {
    try {
      const out: Candle[] = [];
      let start = Math.floor(fromMs);
      for (let page = 0; page < 6; page++) {
        const url = `${host}/api/v3/klines?symbol=${encodeURIComponent(source)}&interval=${iv}&startTime=${start}&limit=1000`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${host} HTTP ${r.status}`);
        const raw = await r.json();
        if (!Array.isArray(raw) || raw.length === 0) break;
        for (const k of raw) {
          const openT = +k[0], closeT = +k[6];
          if (openT < fromMs) continue; // skip partial candle containing "from"
          if (closeT > now) continue; // skip candle still forming
          out.push({ openT, closeT, h: +k[2] * fx, l: +k[3] * fx, c: +k[4] * fx });
        }
        if (raw.length < 1000) break;
        start = +raw[raw.length - 1][6] + 1;
      }
      return { candles: out, host };
    } catch (e) {
      lastErr = String((e as Error)?.message || e);
    }
  }
  throw new Error(lastErr || "Binance unreachable");
}

// Port of manageProfitProtection() from the page. Mutates t.sl and t.notes.
function manageProfit(t: any, cp: number) {
  const entry = t.entry, tp = t.tp, dir = t.dir;
  if (![entry, tp, cp].every(Number.isFinite)) return;
  const targetDistance = Math.abs(tp - entry);
  if (!(targetDistance > 0)) return;
  const favorable = dir === "LONG" ? cp - entry : entry - cp;
  const progress = (favorable / targetDistance) * 100;
  const n = t.notes;
  let activated = n.profitTrailActivated === true && n.profitTrailVersion === 2;
  let step = Math.max(0, Number(n.profitTrailStep) || 0);
  let protectedPct = Math.max(0, Number(n.profitTrailProtectedPct) || 0);
  const stamp = new Date().toISOString();

  if (!activated && progress >= TRAIL_TRIGGER) {
    step = Math.floor((progress - TRAIL_TRIGGER) / TRAIL_STEP) + 1;
    protectedPct = Math.min(90, TRAIL_START + (step - 1) * TRAIL_STEP);
    const dist = targetDistance * (protectedPct / 100);
    const stop = dir === "LONG" ? entry + dist : entry - dist;
    Object.assign(n, {
      profitTrailVersion: 2, profitTrailActivated: true, profitTrailTriggerPct: TRAIL_TRIGGER,
      profitTrailStep: step, profitTrailProtectedPct: protectedPct,
      profitTrailTargetDistance: targetDistance, profitTrailStop: stop,
      profitTrailActivatedAt: stamp, profitTrailLastUpdatedAt: stamp,
    });
    t.sl = stop;
    return;
  }
  if (!activated) return;

  const desired = progress >= TRAIL_TRIGGER ? Math.floor((progress - TRAIL_TRIGGER) / TRAIL_STEP) + 1 : step;
  const nextStep = Math.max(step, desired);
  const nextPct = Math.min(90, Math.max(protectedPct, TRAIL_START + (nextStep - 1) * TRAIL_STEP));
  const dist = targetDistance * (nextPct / 100);
  const cand = dir === "LONG" ? entry + dist : entry - dist;
  const old = t.sl;
  const shouldMove = dir === "LONG" ? cand > old : cand < old;
  if (shouldMove || nextStep > step || nextPct > protectedPct) {
    t.sl = shouldMove ? cand : old;
    Object.assign(n, {
      profitTrailVersion: 2, profitTrailActivated: true, profitTrailStep: nextStep,
      profitTrailProtectedPct: nextPct, profitTrailStop: t.sl, profitTrailLastUpdatedAt: stamp,
    });
  }
}

function netPnl(t: any, exit: number, feeRate: number) {
  const position = Math.max(0, t.amt * t.lev);
  const move = t.dir === "LONG" ? (exit - t.entry) / t.entry : (t.entry - exit) / t.entry;
  const gross = position * move;
  const fees = position * feeRate + position * (exit / t.entry) * feeRate;
  return gross - fees;
}

async function processTrade(row: any, dry: boolean, shadow = false) {
  const table = shadow ? "crypto_shadow_trades" : "crypto_trades";
  const pair: string = row.pair || ((row.symbol || "") + (row.quote || "USDT"));
  const isInr = pair.endsWith("INR") || String(row.quote || "").toUpperCase() === "INR";
  let source = pair;
  if (isInr) source = pair.slice(0, -3) + "USDT";

  const notes = parseNotes(row.notes);
  const t: any = {
    id: row.id, pair, dir: row.direction,
    entry: Number(row.entry_price), sl: Number(row.stop_loss), tp: Number(row.take_profit),
    amt: Number(row.amount_inr) || 0, lev: Number(row.leverage) || 1, notes,
  };
  const feeRate = Number.isFinite(Number(notes.feeRate)) && Number(notes.feeRate) >= 0 ? Number(notes.feeRate) : 0.001;
  const opened = new Date(row.created_at).getTime();
  const now = Date.now();

  let fromBase = Number(notes.replayedUntil);
  if (!Number.isFinite(fromBase) || fromBase <= 0) {
    if (now - opened < 10 * 60_000) fromBase = opened;
    else if (dry) fromBase = Math.max(opened, now - 6 * 3600e3);
    else {
      // Legacy trade: start tracking from now rather than re-applying a trailed stop to old candles.
      notes.replayedUntil = now;
      await supabase.from(table).update({ notes: JSON.stringify(notes) }).eq("id", row.id).eq("status", "RUNNING");
      return { id: row.id, pair, shadow, action: "stamped-legacy" };
    }
  }
  const from = Math.max(fromBase, opened);
  if (!dry && now - from < MIN_GAP_MS) return { id: row.id, pair, shadow, action: "page-active" };

  const fx = isInr ? await getUsdInr() : 1;
  const { candles, host } = await fetchCandles(source, from, fx);
  let lastT = from;
  const startSl = t.sl;

  for (const k of candles) {
    const hitSL = t.dir === "LONG" ? k.l <= t.sl : k.h >= t.sl;
    const hitTP = t.dir === "LONG" ? k.h >= t.tp : k.l <= t.tp;
    if (hitSL || hitTP) {
      const tpFirst = hitTP && !hitSL;
      const exit = tpFirst ? t.tp : t.sl;
      const trailing = !tpFirst && notes.profitTrailActivated === true;
      const pnl = netPnl(t, exit, feeRate);
      const closedAt = new Date(k.closeT).toISOString();
      const summary = {
        id: row.id, pair, shadow, action: "close", status: tpFirst ? "TP_HIT" : "SL_HIT",
        exit, pnl: Math.round(pnl * 100) / 100, at: closedAt, trailing, candles: candles.length, host,
      };
      if (dry) return { ...summary, action: "would-close" };
      Object.assign(notes, {
        closeReason: tpFirst ? "take_profit" : trailing ? "trailing_stop" : "stop_loss",
        trailingStopHit: trailing, closedBy: "server", replayedUntil: k.closeT,
      });
      if (shadow) {
        // R against the original risk (the target is never moved: risk = |target - entry| / rr).
        const riskInr = t.amt * t.lev * (Math.abs(t.tp - t.entry) / (Number(row.rr) || 2)) / t.entry;
        const r = riskInr > 0 ? pnl / riskInr : 0;
        const { error } = await supabase.from(table).update({
          status: tpFirst ? "TP_HIT" : "SL_HIT", close_price: exit, current_price: exit, closed_at: closedAt,
          pnl_inr: Math.round(pnl * 100) / 100, r_multiple: Math.round(r * 1000) / 1000,
          stop_loss: t.sl, notes: JSON.stringify(notes),
        }).eq("id", row.id).eq("status", "RUNNING");
        if (error) throw new Error("shadow close failed: " + error.message);
        return { ...summary, r: Math.round(r * 100) / 100, applied: true };
      }
      const { data, error } = await supabase.rpc("server_close_trade", {
        p_trade_id: row.id,
        p_status: tpFirst ? "TP_HIT" : "SL_HIT",
        p_close_price: exit,
        p_closed_at: closedAt,
        p_pnl: pnl,
        p_notes: JSON.stringify(notes),
        p_stop_loss: t.sl,
        p_credit: Math.max(0, t.amt + pnl),
      });
      if (error) throw new Error("close failed: " + error.message);
      return { ...summary, applied: data === true };
    }
    manageProfit(t, t.dir === "LONG" ? k.h : k.l); // new stop applies from the NEXT candle
    lastT = k.closeT;
  }

  const last = candles.length ? candles[candles.length - 1].c : null;
  if (!dry) {
    notes.replayedUntil = Math.max(lastT, from);
    const patch: Record<string, unknown> = { notes: JSON.stringify(notes) };
    if (t.sl !== startSl) patch.stop_loss = t.sl;
    if (last !== null) patch.current_price = last;
    let upd = supabase.from(table).update(patch).eq("id", row.id).eq("status", "RUNNING");
    if (!shadow) upd = upd.is("closed_at", null);
    await upd;
  }
  return {
    id: row.id, pair, shadow, action: dry ? "dry-open" : "updated", candles: candles.length, host,
    last, slMoved: t.sl !== startSl, sl: t.sl,
  };
}

Deno.serve(async (req) => {
  const started = Date.now();
  let beat = false;
  const finish = async (ok: boolean, error: string | null, summary: any, log: boolean) => {
    if (!beat) return;
    beat = false;
    try {
      await supabase.rpc("bot_job_finish", {
        p_job: "monitor", p_ok: ok, p_error: error, p_duration_ms: Date.now() - started, p_summary: summary, p_log: log,
      });
    } catch (_e) { /* the heartbeat must never break a run */ }
  };
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: s } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!s || !secret || secret !== s.value) return json({ error: "unauthorized" }, 401);

    const dry = new URL(req.url).searchParams.get("dry") === "1";
    if (!dry) {
      const { data: go } = await supabase.rpc("bot_job_start", { p_job: "monitor", p_interval: 60 });
      if (go === false) return json({ skipped: "previous run still in progress" });
      beat = true;
    }

    const [realQ, shadowQ] = await Promise.all([
      supabase.from("crypto_trades").select("*").eq("status", "RUNNING").is("closed_at", null),
      supabase.from("crypto_shadow_trades").select("*").eq("status", "RUNNING"),
    ]);
    if (realQ.error) throw new Error(realQ.error.message);
    const rows = (realQ.data || []).map((r: any) => ({ r, shadow: false }))
      .concat((shadowQ.error ? [] : shadowQ.data || []).map((r: any) => ({ r, shadow: true })));

    const results: any[] = [];
    const errors: any[] = [];
    await Promise.all(rows.map(async ({ r: row, shadow }) => {
      try {
        results.push(await processTrade(row, dry, shadow));
      } catch (e) {
        errors.push({ id: row.id, pair: row.pair, shadow, error: String((e as Error)?.message || e) });
      }
    }));

    const closedTrades = results.filter((r) => r.action === "close" && r.applied && !r.shadow);
    const closedShadow = results.filter((r) => r.action === "close" && r.applied && r.shadow);
    const summary = {
      dry, checked: rows.length,
      closed: closedTrades.length,
      errors: errors.length,
    };
    await finish(errors.length === 0, errors[0]?.error ?? null, {
      checked: summary.checked,
      closed: summary.closed,
      closedTrades: closedTrades.map((r: any) => `${r.pair} ${r.status} ${r.pnl >= 0 ? "+" : ""}${r.pnl}`),
      shadowClosed: closedShadow.map((r: any) => `${r.pair} ${r.status} ${r.r >= 0 ? "+" : ""}${r.r}R`),
      watching: results.filter((r) => r.action === "updated").length,
      pageActive: results.filter((r) => r.action === "page-active").length,
      errors: errors.length,
    }, closedTrades.length > 0 || closedShadow.length > 0 || errors.length > 0);
    console.log("CRYPTO_MONITOR", JSON.stringify({ ...summary, results, errors }));
    return json({ ...summary, results, errors });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    await finish(false, msg, { error: msg }, true);
    console.error("CRYPTO_MONITOR_FATAL", e);
    return json({ error: msg }, 500);
  }
});
