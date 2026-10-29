// Straight port of the V6 signal engine from crypto-signals.html (same maths, same thresholds).
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export const V6_MIN_SCORE = 75;
export const V6_ALLOW_SHORTS = true;
export const V6_MIN_RSI = 50;
export const V6_MAX_RSI = 74;
export const V6_MIN_VOLUME = 1.10;
export const V6_MAX_EMA_EXTENSION_ATR = 1.00;
export const V6_MIN_STOP_PCT = 0.008;
export const V6_MAX_STOP_PCT = 0.035;

export const COINS = ["BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX","LINK","MATIC","DOT","LTC","TRX","ATOM","UNI","NEAR","APT","ARB","OP","INJ","SUI","SEI","TIA","JUP","PYTH"];

export function clampNum(v: any, lo: number, hi: number) { return Math.min(hi, Math.max(lo, Number(v) || 0)); }

export function ema(data: number[], period: number): number[] {
  if (!data.length) return [];
  const m = 2 / (period + 1); let v = data[0]; const r = [v];
  for (let i = 1; i < data.length; i++) { v = data[i] * m + v * (1 - m); r.push(v); }
  return r;
}
export function rsi(data: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  if (data.length <= period) return result;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = data[i] - data[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
  let ag = g / period, al = l / period;
  result[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    result[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return result;
}
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { tr.push(candles[i].h - candles[i].l); continue; }
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  if (tr.length < period) return new Array(tr.length).fill(null);
  const result: (number | null)[] = new Array(tr.length).fill(null);
  let a = 0;
  for (let i = 0; i < period; i++) a += tr[i];
  a /= period; result[period - 1] = a;
  for (let i = period; i < tr.length; i++) { a = (a * (period - 1) + tr[i]) / period; result[i] = a; }
  return result;
}
export function macd(data: number[]) {
  const f = ema(data, 12), s = ema(data, 26);
  const line = data.map((_, i) => f[i] - s[i]);
  const sig = ema(line, 9);
  return { line, sig, hist: line.map((v, i) => v - sig[i]) };
}
export function volumeRatio(candles: Candle[], index: number, lookback = 20) {
  if (index < lookback) return 1;
  let t = 0;
  for (let i = index - lookback; i < index; i++) t += candles[i].v;
  const avg = t / lookback;
  return avg > 0 ? candles[index].v / avg : 1;
}

export function calculateSetupConfidence(a: any) {
  const { dir, score, rsiValue, volumeRatio: vr, e20, e50, e100, atrValue, hist, prevHist, rr } = a;
  let confidence = 58 + clampNum(score, 0, 100) * 0.30;
  const trendSpread = dir === "LONG"
    ? ((e20 - e50) / e50 + (e50 - e100) / e100) * 100
    : ((e50 - e20) / e50 + (e100 - e50) / e100) * 100;
  confidence += clampNum(trendSpread * 1.5, 0, 5);
  const rsiIdeal = dir === "LONG" ? 63 : 37;
  const rsiDistance = Math.abs(Number(rsiValue) - rsiIdeal);
  confidence += clampNum(3 - rsiDistance * 0.12, 0, 3);
  confidence += clampNum((Number(vr) - 1.2) * 1.7, 0, 3);
  if (Number.isFinite(hist) && Number.isFinite(atrValue) && atrValue > 0) {
    const macdStrength = Math.abs(hist) / atrValue;
    confidence += clampNum(macdStrength * 2.0, 0, 2);
  }
  if (Number.isFinite(hist) && Number.isFinite(prevHist)) {
    const momentumOk = dir === "LONG" ? hist >= prevHist : hist <= prevHist;
    if (momentumOk) confidence += 1.5;
  }
  confidence += clampNum((Number(rr) - 2) * 1.0, 0, 1.5);
  return Math.round(clampNum(confidence, 50, 95));
}

export function getV6HTFRegime(candles: Candle[] | null) {
  if (!Array.isArray(candles) || candles.length < 110) return { long: false, short: false, trend: "unknown" };
  const closes = candles.map((c) => Number(c.c));
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e100 = ema(closes, 100);
  const i = closes.length - 1, price = closes[i];
  if (![price, e20[i], e50[i], e100[i]].every(Number.isFinite)) return { long: false, short: false, trend: "unknown" };
  const long = e20[i] > e50[i] && e50[i] > e100[i] && price > e50[i];
  const short = e20[i] < e50[i] && e50[i] < e100[i] && price < e50[i];
  return { long, short, trend: long ? "strong_up" : short ? "strong_down" : "neutral" };
}

export function analyzeV6(
  candles: Candle[], symbol: string, ticker: { chg: number }, rrCfg: { ratio: number },
  direction: string, htfCandles: Candle[] | null, pairBlocked: boolean,
  diag?: Record<string, number>,
): any | null {
  const closes = candles.map((c) => Number(c.c)), highs = candles.map((c) => Number(c.h)), lows = candles.map((c) => Number(c.l));
  if (candles.length < 110) return null;
  if (pairBlocked) return null;

  const e20 = ema(closes, 20), e50 = ema(closes, 50), e100 = ema(closes, 100), rsiV = rsi(closes), atrV = atr(candles), macdV = macd(closes);
  const i = closes.length - 1, p = i - 1, price = closes[i];
  if (i < 4 || ![price, e20[i], e50[i], e100[i], rsiV[i], atrV[i]].every((x) => Number.isFinite(x as number))) return null;

  const cur = candles[i], prev = candles[p], volRatio = volumeRatio(candles, i), hist = macdV.hist[i], prevHist = macdV.hist[p];
  const range = Math.max(0, Number(cur.h) - Number(cur.l)), body = Math.abs(Number(cur.c) - Number(cur.o));
  const A = atrV[i] as number, Ap = atrV[p] as number, R = rsiV[i] as number;
  const bodyAtr = A > 0 ? body / A : 0;
  const bodyRatio = range > 0 ? body / range : 0;
  const closeLocation = range > 0 ? (Number(cur.c) - Number(cur.l)) / range : 0.5;

  const rrRatio = Math.max(0.1, Number(rrCfg.ratio) || 2);
  const regime = getV6HTFRegime(htfCandles || candles);

  const evaluate = (dir: string) => {
    const long = dir === "LONG";
    const fail = (k: string) => { if (diag) { const key = (long ? "L_" : "S_") + k; diag[key] = (diag[key] || 0) + 1; } return null; };
    const localTrend = long ? e20[i] > e50[i] && e50[i] > e100[i] : e20[i] < e50[i] && e50[i] < e100[i];
    const htfAligned = long ? (regime.long || regime.trend === "neutral") : (regime.short || regime.trend === "neutral");
    const rsiOk = long ? R >= V6_MIN_RSI && R <= V6_MAX_RSI : R >= 100 - V6_MAX_RSI && R <= 100 - V6_MIN_RSI;
    const volumeOk = volRatio >= V6_MIN_VOLUME;
    const macdOk = long ? hist > 0 : hist < 0;
    const momentumOk = long ? hist > prevHist : hist < prevHist;
    const macdStrength = A > 0 ? Math.abs(hist) / A : 0;
    const macdStrengthOk = macdStrength >= 0.015;
    const separation20_50 = A > 0 ? (long ? (e20[i] - e50[i]) : (e50[i] - e20[i])) / A : 0;
    const separation50_100 = A > 0 ? (long ? (e50[i] - e100[i]) : (e100[i] - e50[i])) / A : 0;
    const separationOk = separation20_50 >= 0.10 && separation50_100 >= 0.06;
    const pullback = long
      ? prev.l <= e20[p] + Ap * 0.90 && prev.l >= e20[p] - Ap * 1.00
      : prev.h >= e20[p] - Ap * 0.90 && prev.h <= e20[p] + Ap * 1.00;
    const reclaim = long
      ? price > e20[i] && (Number(prev.c) <= e20[p] + Ap * 0.35)
      : price < e20[i] && (Number(prev.c) >= e20[p] - Ap * 0.35);
    const strongCandle = bodyAtr >= 0.20 && bodyRatio >= 0.35 && (long ? closeLocation >= 0.55 : closeLocation <= 0.45);
    const extension = long ? (price - e20[i]) / A : (e20[i] - price) / A;
    const notExtended = Number.isFinite(extension) && extension >= -0.25 && extension <= V6_MAX_EMA_EXTENSION_ATR;

    if (diag) diag.evaluated = (diag.evaluated || 0) + 1;
    if (!localTrend) return fail("no_ema_trend");
    if (!htfAligned) return fail("4h_trend_against");
    if (!rsiOk) return fail("rsi_out_of_range");
    if (!macdOk) return fail("macd_wrong_side");
    if (!notExtended) return fail("price_too_far_from_ema20");

    let score = 0; const reasons: string[] = [];
    score += 20; reasons.push(long ? "Local EMA trend" : "Local EMA downtrend");
    if (separationOk) { score += 10; reasons.push("EMA separation"); }
    score += 10; reasons.push(regime.trend === "neutral" ? "HTF 4H neutral" : "HTF 4H aligned");
    score += 10; reasons.push("RSI " + R.toFixed(0));
    if (volumeOk) { score += 10; reasons.push("Vol " + volRatio.toFixed(1) + "x"); }
    else { score += 4; reasons.push("Vol " + volRatio.toFixed(1) + "x"); }
    score += 5; reasons.push(long ? "MACD+" : "MACD-");
    if (pullback) { score += 10; reasons.push("EMA20 pullback"); }
    if (reclaim) { score += 10; reasons.push(long ? "EMA20 reclaim" : "EMA20 breakdown"); }
    if (momentumOk) { score += 5; reasons.push("Momentum"); }
    if (strongCandle) { score += 5; reasons.push(long ? "Bull candle" : "Bear candle"); }
    if (macdStrengthOk) { score += 5; reasons.push("MACD strength"); }
    if (score < V6_MIN_SCORE) return fail("score_below_75");

    let sl: number, risk: number;
    if (long) {
      const swing = Math.min(lows[i], lows[p], lows[i - 2] || lows[p], lows[i - 3] || lows[p]);
      sl = swing - A * 0.30; risk = price - sl;
    } else {
      const swing = Math.max(highs[i], highs[p], highs[i - 2] || highs[p], highs[i - 3] || highs[p]);
      sl = swing + A * 0.30; risk = sl - price;
    }
    if (!Number.isFinite(risk) || risk <= 0) return fail("bad_stop");
    const minRisk = price * V6_MIN_STOP_PCT, maxRisk = price * V6_MAX_STOP_PCT;
    if (risk < minRisk) { risk = minRisk; sl = long ? price - risk : price + risk; }
    if (risk > maxRisk) return fail("stop_wider_than_3.5pct");

    const tp = long ? price + risk * rrRatio : price - risk * rrRatio;
    const confidence = calculateSetupConfidence({ dir, score, rsiValue: R, volumeRatio: volRatio, price, e20: e20[i], e50: e50[i], e100: e100[i], atrValue: A, hist, prevHist, rr: rrRatio });
    return {
      sym: symbol, name: symbol, price, chg: Number(ticker?.chg || 0), dir, entry: price, sl, tp, rr: rrRatio,
      score: Math.min(100, score), conf: Math.min(95, Math.max(50, Math.round(confidence / 5) * 5)),
      reasons, rsi: R, atr: A, volumeRatio: volRatio, stopPct: risk / price, v6: true,
      htfTrend: regime.trend, longScore: long ? score : 0, shortScore: long ? 0 : score,
    };
  };

  const candidates: any[] = [];
  if (direction !== "SHORT") { const x = evaluate("LONG"); if (x) candidates.push(x); }
  if (V6_ALLOW_SHORTS && direction !== "LONG") { const x = evaluate("SHORT"); if (x) candidates.push(x); }
  candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  return candidates[0] || null;
}

export function signalFingerprint(s: any) {
  const structuralReasons = (Array.isArray(s.reasons) ? s.reasons : [])
    .map((x: any) => String(x).replace(/RSI\s*[-+]?\d+(?:\.\d+)?/gi, "RSI").replace(/Vol\s*[-+]?\d+(?:\.\d+)?x/gi, "Vol").trim())
    .join("|");
  const rr = Number(s.rr), stop = Number(s.stopPct);
  return [String(s.dir || ""), Math.round(Number(s.score) || 0), Math.round(Number(s.conf) || 0),
    Number.isFinite(rr) ? rr.toFixed(1) : "", Number.isFinite(stop) ? (stop * 100).toFixed(1) : "", structuralReasons].join("::");
}

export function dedupeEquivalentSignals(list: any[]) {
  const groups = new Map<string, any>();
  for (const s of list) {
    const key = signalFingerprint(s);
    const existing = groups.get(key);
    if (!existing) { groups.set(key, s); continue; }
    const scoreA = Number(s.score) || 0, scoreB = Number(existing.score) || 0;
    const confA = Number(s.conf) || 0, confB = Number(existing.conf) || 0;
    const volA = Number(s.volumeRatio) || 0, volB = Number(existing.volumeRatio) || 0;
    const stopA = Number(s.stopPct), stopB = Number(existing.stopPct);
    if (scoreA > scoreB || (scoreA === scoreB && confA > confB) ||
      (scoreA === scoreB && confA === confB && volA > volB) ||
      (scoreA === scoreB && confA === confB && volA === volB && Number.isFinite(stopA) && Number.isFinite(stopB) && stopA < stopB)) {
      groups.set(key, s);
    }
  }
  return Array.from(groups.values());
}

export function validateLevels(s: { dir: string; entry: number; sl: number; tp: number }) {
  const entry = Number(s.entry), sl = Number(s.sl), tp = Number(s.tp);
  if (!["LONG", "SHORT"].includes(s.dir)) return false;
  if (![entry, sl, tp].every(Number.isFinite) || entry <= 0 || sl <= 0 || tp <= 0) return false;
  return s.dir === "LONG" ? (sl < entry && tp > entry) : (tp < entry && entry < sl);
}

/* Recalculate levels from the live price exactly like scanSingleQuote does. */
export function recalcFromLive(signal: any, price: number, rrRatio: number) {
  const oldEntry = Number(signal.entry), oldSL = Number(signal.sl);
  const riskPct = oldEntry > 0 ? Math.abs(oldEntry - oldSL) / oldEntry : 0.01;
  const liveRisk = price * Math.max(V6_MIN_STOP_PCT, Math.min(V6_MAX_STOP_PCT, riskPct));
  signal.entry = price; signal.price = price;
  if (signal.dir === "SHORT") { signal.sl = price + liveRisk; signal.tp = price - liveRisk * Number(signal.rr || rrRatio); }
  else { signal.sl = price - liveRisk; signal.tp = price + liveRisk * Number(signal.rr || rrRatio); }
  signal.stopPct = liveRisk / price;
  return signal;
}

/* Page-identical post-filter for a quote's signal list. */
export function finalizeSignals(results: any[], direction: string, rrRatio: number) {
  const filtered = results
    .filter((s) => s && s.dir && s.score >= V6_MIN_SCORE)
    .filter((s) => s.v6 === true && ["LONG", "SHORT"].includes(s.dir) &&
      (direction === "BOTH" || s.dir === direction) &&
      Number(s.volumeRatio) >= V6_MIN_VOLUME && Number(s.stopPct) >= V6_MIN_STOP_PCT && Number(s.stopPct) <= V6_MAX_STOP_PCT)
    .filter((s) => Math.abs(Number(s.rr) - rrRatio) < 0.000001);
  return dedupeEquivalentSignals(filtered).sort((a, b) => {
    const d = (Number(b.score) || 0) - (Number(a.score) || 0);
    if (d) return d;
    return (Number(b.conf) || 0) - (Number(a.conf) || 0);
  });
}
