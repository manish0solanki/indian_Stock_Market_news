// premarket-brief: the Home page's pre-market brief (premarket.js), built at 7:45 and 8:50 AM IST on weekdays.
//   ?action=snap (3:35 PM IST, after the close): saves Nifty / Bank Nifty high, low, close and the GIFT Nifty price to
//     premarket_snap, so the next morning's GIFT Nifty move is measured "since our close" and the day's levels exist.
//   default: builds today's brief into premarket_brief:
//     GIFT Nifty and the open it points to, India VIX, Nifty / Bank Nifty levels (pivots from the last session),
//     overnight US / Europe / Asia (moves, the main reasons and news sentiment from market-reasons), US futures,
//     crude, rupee, US yields, dollar, FII / DII flows, today's results and corporate actions (largest companies
//     first), this week's economic data, and stocks in the news since the last close (the card also matches these
//     to the viewer's holdings), plus 3-4 lines on what to watch, written by Moonshot from those facts only (any
//     line with a number that isn't in the facts is dropped; a plain template is used without the AI).
//   ?debug=1 returns the brief without saving. Auth: x-cron-secret (app_secrets 'crypto_cron').
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const MOONSHOT = Deno.env.get("MOONSHOT_API_KEY") || "";
const MODELS = (Deno.env.get("MOONSHOT_MODEL") || "kimi-k3.1-pro,kimi-k2.6").split(",").map((s) => s.trim()).filter(Boolean);

const num = (v: unknown) => { const n = Number(v); return v === null || v === undefined || v === "" || !isFinite(n) ? null : n; };
const r2 = (v: number | null) => v === null ? null : Math.round(v * 100) / 100;
const istDate = (d = new Date()) => new Date(d.getTime() + 330 * 60e3).toISOString().slice(0, 10);
const sg = (v: number | null, d = 2, unit = "%") => v === null ? "n/a" : (v > 0 ? "+" : v < 0 ? "-" : "") + Math.abs(v).toFixed(d) + unit;
const inr = (v: number) => Math.round(Math.abs(v)).toLocaleString("en-IN");

async function sparks() {
  try {
    const r = await fetch(URL_ + "/functions/v1/index-sparklines", { signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
const ser = (S: any, sym: string) => {
  const s = S?.series?.[sym]; if (!s) return null;
  return { price: num(s.price), prev: num(s.previous_close), high: num(s.day_high), low: num(s.day_low) };
};
const pivots = (h: number, l: number, c: number) => {
  const P = (h + l + c) / 3;
  return { P: r2(P), R1: r2(2 * P - l), R2: r2(P + (h - l)), S1: r2(2 * P - h), S2: r2(P - (h - l)) };
};

/* ---------- 3:35 PM snapshot ---------- */
async function snap() {
  const S = await sparks();
  const n = ser(S, "^NSEI"), b = ser(S, "^NSEBANK"), v = ser(S, "^INDIAVIX"), g = S?.gift_nifty;
  if (!n?.price) return { error: "no Nifty data" };
  const data = { vix: v?.price ? { c: v.price } : null, nifty: { c: n.price, h: n.high, l: n.low, prev: n.prev }, bank: b?.price ? { c: b.price, h: b.high, l: b.low, prev: b.prev } : null,
    // GIFT only while it is trading (3:35 PM on a weekday); a weekend run must not store Friday night's close as "our close"
    gift: g?.price && g.live ? { price: num(g.price), as_of: g.as_of } : null, at: new Date().toISOString() };
  const { error } = await sb.from("premarket_snap").upsert({ d: istDate(), data }, { onConflict: "d" });
  return error ? { error: error.message } : { ok: true, snap: data };
}

/* ---------- the brief ---------- */
async function build() {
  const today = istDate();
  const [S, why, rsn, snapRow, fii, ev, econ, news, mkt] = await Promise.all([
    sparks(),
    sb.rpc("market_why").then((r) => r.data),
    sb.rpc("market_reasons").then((r) => r.data || {}),
    sb.from("premarket_snap").select("d,data,created_at").lt("d", today).order("d", { ascending: false }).limit(1).maybeSingle().then((r) => r.data),
    sb.from("fii_dii_daily").select("trade_date,fii_net,dii_net").order("trade_date", { ascending: false }).limit(5).then((r) => r.data || []),
    sb.from("market_events").select("symbol,company,kind,title,detail,amount").eq("event_date", today).then((r) => r.data || []),
    sb.from("econ_events").select("event_date,time_ist,country,kind,title,period,confirmed")
      .gte("event_date", today).lte("event_date", istDate(new Date(Date.now() + 5 * 864e5))).order("event_date").order("time_ist").then((r) => r.data || []),
    sb.from("news").select("symbol,company_name,title,short_term_impact,source_link,published_at,created_at").eq("is_visible", true).not("symbol", "is", null)
      .gte("published_at", new Date(Date.now() - 20 * 3600e3).toISOString()).order("published_at", { ascending: false }).limit(120).then((r) => r.data || []),
    sb.rpc("market_snapshot").then((r) => r.data || []),
  ]);

  // GIFT Nifty and the open it points to
  const n = ser(S, "^NSEI"), b = ser(S, "^NSEBANK"), vixS = ser(S, "^INDIAVIX"), g = S?.gift_nifty || null;
  const sn = snapRow?.data || null;
  // The site's index table has the true last close and change, also after a special session (e.g. a Muhurat Sunday)
  // that the 3:35 PM weekday snapshot didn't see. When its close differs from the snapshot's, a session happened after
  // the snapshot: then the GIFT move is measured from its own last session, VIX's change is left out (Yahoo's previous
  // close can be wrong then), and the pivots stay on the last full session.
  const mk = (sym: string) => (mkt as any[]).find((x) => x.symbol === sym);
  const mN = mk("^NSEI"), mB = mk("^NSEBANK");
  const stale = !!(sn?.nifty?.c && num(mN?.price) && Math.abs(num(mN.price)! - num(sn.nifty.c)!) > 0.01);
  const niftyClose = num(mN?.price) ?? num(sn?.nifty?.c) ?? n?.price ?? null;
  let gift: any = null;
  if (g?.price) {
    const base = stale ? null : num(sn?.gift?.price);
    const pts = base ? num(g.price)! - base : num(g.change);
    const pct = base ? (num(g.price)! / base - 1) * 100 : num(g.change_percent);
    gift = { price: num(g.price), pts: r2(pts), pct: r2(pct), live: !!g.live, as_of: g.as_of, basis: base ? "since our close" : "since its last session",
      implied_open: niftyClose !== null && pct !== null ? Math.round(niftyClose * (1 + pct / 100)) : null };
  }
  const lvl = (x: any, fallback: any) => {
    const h = num(x?.h) ?? fallback?.high, l = num(x?.l) ?? fallback?.low, c = num(x?.c) ?? fallback?.price, prev = num(x?.prev) ?? fallback?.prev;
    return h && l && c ? { close: c, high: h, low: l, chg: prev ? r2((c / prev - 1) * 100) : null, ...pivots(h, l, c) } : null;
  };
  const withLast = (L: any, m: any) => L && m && num(m.price) ? { ...L, close: num(m.price), chg: r2(num(m.change_percent)), pivots_from: stale ? "the last full session" : "the last session" } : L;
  const nifty = withLast(lvl(sn?.nifty, n), mN), bank = withLast(lvl(sn?.bank, b), mB);
  const vixBase = stale ? null : num(sn?.vix?.c) ?? vixS?.prev ?? null;
  const vix = vixS?.price ? { price: r2(vixS.price), chg: vixBase ? r2((vixS.price / vixBase - 1) * 100) : null } : null;

  // overnight world
  const regions = (why?.regions || []).map((r: any) => {
    const R = rsn?.[r.key] || {};
    return { key: r.key, name: r.name, move: r2(num(r.move)), indices: (r.indices || []).map((x: any) => ({ n: x.n, c: r2(num(x.c)) })).filter((x: any) => x.c !== null),
      sentiment: R.sentiment ? { label: R.sentiment.label, score: R.sentiment.score } : null,
      reasons: (R.reasons || []).slice(0, 3).map((x: any) => x.title), written_at: R.written_at || R.updated_at || null };
  });
  const drivers = (why?.india?.drivers || []).filter((d: any) => ["usfut", "crude", "rupee", "yield", "dollar"].includes(d.key))
    .map((d: any) => ({ key: d.key, label: d.label, value: d.value, impact: d.impact, why: d.why }));
  const indiaMood = rsn?.india?.sentiment ? { label: rsn.india.sentiment.label, score: rsn.india.sentiment.score } : null;

  // flows
  const flows = fii.length ? { date: fii[0].trade_date, fii: num(fii[0].fii_net), dii: num(fii[0].dii_net),
    fii5: r2(fii.reduce((a: number, x: any) => a + (num(x.fii_net) || 0), 0)), dii5: r2(fii.reduce((a: number, x: any) => a + (num(x.dii_net) || 0), 0)), days: fii.length } : null;

  // today's company events, biggest companies first
  const syms = [...new Set([...ev.map((e: any) => e.symbol), ...news.map((x: any) => x.symbol)].filter(Boolean))];
  const { data: caps } = syms.length ? await sb.from("stock_quotes").select("symbol,market_cap,change_percent").in("symbol", syms) : { data: [] };
  const cap = new Map((caps || []).map((q: any) => [q.symbol, num(q.market_cap) || 0]));
  const byCap = (a: any, b: any) => (cap.get(b.symbol) || 0) - (cap.get(a.symbol) || 0);
  const results = ev.filter((e: any) => e.kind === "results").sort(byCap);
  const actions = ev.filter((e: any) => e.kind !== "results").sort(byCap).slice(0, 10)
    .map((e: any) => ({ symbol: e.symbol, company: e.company, kind: e.kind, title: e.title }));
  const events = { results_n: results.length, results: results.slice(0, 15).map((e: any) => ({ symbol: e.symbol, company: e.company })), actions };

  // stocks in the news since the last close: non-neutral first, then the biggest companies
  const seen = new Set<string>();
  const tone = (s: string) => /pos/i.test(s || "") ? 1 : /neg/i.test(s || "") ? -1 : 0;
  const items = news.filter((x: any) => { const k = x.symbol + "|" + String(x.title).slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((x: any) => ({ symbol: x.symbol, company: x.company_name, title: x.title, t: tone(x.short_term_impact), url: x.source_link, at: x.published_at || x.created_at }));
  const focus = items.filter((x: any) => x.t !== 0).sort((a: any, b: any) => (cap.get(b.symbol) || 0) - (cap.get(a.symbol) || 0))
    .filter((x: any, i: number, arr: any[]) => arr.findIndex((y) => y.symbol === x.symbol) === i).slice(0, 8);

  const payload: any = { date: today, gift, nifty, bank, vix, regions, drivers, india_mood: indiaMood, flows, events,
    econ: econ.map((e: any) => ({ date: e.event_date, time: e.time_ist, country: e.country, title: e.title, period: e.period, confirmed: e.confirmed })),
    focus, news: items.slice(0, 60), snap_d: snapRow?.d || null };

  // what to watch: AI lines from the facts, or a template
  const facts = factsOf(payload);
  let lines = template(payload), writer = "template";
  if (MOONSHOT) {
    const w = await writeLines(facts);
    if (w.lines) { lines = w.lines; writer = w.writer; } else payload.ai_error = w.error;
  }
  payload.lines = lines;
  return { payload, writer, facts };
}

function factsOf(p: any) {
  const L: string[] = [`Date: ${p.date} (IST). Indian market opens at 9:15 AM.`];
  if (p.gift) L.push(`GIFT Nifty: ${p.gift.price} (${sg(p.gift.pts, 0, " points")}, ${sg(p.gift.pct)} ${p.gift.basis}). It points to a Nifty open near ${p.gift.implied_open ?? "n/a"}.`);
  if (p.nifty) L.push(`Nifty 50 last close: ${p.nifty.close} (${sg(p.nifty.chg)}). Levels (floor pivots from ${p.nifty.pivots_from || "the last session"}, high ${p.nifty.high}, low ${p.nifty.low}): pivot ${p.nifty.P}, resistance R1 ${p.nifty.R1}, R2 ${p.nifty.R2}, support S1 ${p.nifty.S1}, S2 ${p.nifty.S2}.`);
  if (p.bank) L.push(`Bank Nifty last close: ${p.bank.close} (${sg(p.bank.chg)}). Pivot ${p.bank.P}, R1 ${p.bank.R1}, S1 ${p.bank.S1}.`);
  if (p.vix) L.push(p.vix.chg === null ? `India VIX: ${p.vix.price}.` : `India VIX: ${p.vix.price} (${sg(p.vix.chg)}).`);
  for (const r of p.regions) L.push(`${r.name}: latest session ${sg(r.move)} (${r.indices.map((x: any) => `${x.n} ${sg(x.c)}`).join(", ")})${r.sentiment ? `; news sentiment ${r.sentiment.label} (${r.sentiment.score})` : ""}${r.reasons.length ? `; main reasons: ${r.reasons.join("; ")}` : ""}.`);
  if (p.drivers.length) L.push("Other markets: " + p.drivers.map((d: any) => `${d.label} ${d.value}`).join("; ") + ".");
  if (p.india_mood) L.push(`India market news sentiment: ${p.india_mood.label} (${p.india_mood.score}).`);
  if (p.flows) L.push(`FII net ${p.flows.fii >= 0 ? "buying" : "selling"} of ${inr(p.flows.fii)} Cr and DII net ${p.flows.dii >= 0 ? "buying" : "selling"} of ${inr(p.flows.dii)} Cr on ${p.flows.date}; over the last ${p.flows.days} sessions FIIs net ${inr(p.flows.fii5)} Cr ${p.flows.fii5 >= 0 ? "bought" : "sold"}.`);
  if (p.events.results_n) L.push(`${p.events.results_n} companies report results today, including ${p.events.results.slice(0, 8).map((e: any) => e.symbol).join(", ")}.`);
  if (p.events.actions.length) L.push("Corporate actions today: " + p.events.actions.map((e: any) => `${e.symbol} ${e.title}`).join("; ") + ".");
  const todayEcon = p.econ.filter((e: any) => e.date === p.date);
  if (todayEcon.length) L.push("Economic data today: " + todayEcon.map((e: any) => `${e.title}${e.time ? " at " + e.time + " IST" : ""}`).join("; ") + ".");
  const later = p.econ.filter((e: any) => e.date !== p.date);
  if (later.length) L.push("Later this week: " + later.map((e: any) => `${e.title} on ${e.date}`).join("; ") + ".");
  if (p.focus.length) L.push("Stocks in the news since the last close: " + p.focus.map((x: any) => `${x.symbol} (${x.t > 0 ? "positive" : "negative"}): ${x.title}`).join(" | "));
  return L.join("\n");
}

function template(p: any) {
  const out: string[] = [];
  if (p.gift && p.gift.pct !== null) {
    const dir = Math.abs(p.gift.pct) < 0.15 ? "a flat" : p.gift.pct > 0 ? "a higher" : "a lower";
    out.push(`GIFT Nifty is ${sg(p.gift.pts, 0, " points")} (${sg(p.gift.pct)}) ${p.gift.basis}, pointing to ${dir} open${p.gift.implied_open ? " near " + p.gift.implied_open.toLocaleString("en-IN") : ""}.`);
  }
  const us = p.regions.find((r: any) => r.key === "us"), asia = p.regions.find((r: any) => r.key === "asia");
  if (us && us.move !== null) out.push(`Wall Street ${us.move >= 0 ? "rose" : "fell"} ${Math.abs(us.move).toFixed(2)}% in its last session${us.reasons[0] ? " (" + us.reasons[0].toLowerCase() + ")" : ""}${asia && asia.move !== null ? `; Asia is ${sg(asia.move)}` : ""}.`);
  if (p.flows) out.push(`FIIs ${p.flows.fii >= 0 ? "bought" : "sold"} ₹${inr(p.flows.fii)} Cr and DIIs ${p.flows.dii >= 0 ? "bought" : "sold"} ₹${inr(p.flows.dii)} Cr in the last session.`);
  if (p.nifty) out.push(`Nifty levels: support ${p.nifty.S1.toLocaleString("en-IN")} and ${p.nifty.S2.toLocaleString("en-IN")}, resistance ${p.nifty.R1.toLocaleString("en-IN")} and ${p.nifty.R2.toLocaleString("en-IN")}.`);
  if (p.events.results_n) out.push(`${p.events.results_n} companies report results today, including ${p.events.results.slice(0, 4).map((e: any) => e.symbol).join(", ")}.`);
  return out.slice(0, 4);
}

/* ---------- AI lines ---------- */
const nums = (s: string) => [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ""));
function numbersOk(text: string, facts: string) {
  const have = nums(facts).map(Number);
  return nums(text).every((t) => {
    const v = Number(t); if (!t.includes(".") && v <= 12) return true;
    const dp = (t.split(".")[1] || "").length, tol = 0.5 * 10 ** -dp + 1e-9;
    return have.some((h) => Math.abs(h - v) <= tol) || have.some((h) => Math.round(h) === v); // whole-number rounding of a fact
  });
}
// The fixed instructions go first (system message) so Moonshot's context cache can match them from day to day.
const SYSTEM = `You are a careful Indian stock-market reporter writing a pre-market brief for traders, before the 9:15 AM open.
Using ONLY the facts given, write 3 or 4 short lines on what to expect at the open and what to watch today.
Return JSON only: {"lines":["...","..."]}
- Line 1: the likely open (GIFT Nifty) and the main reason from overnight markets.
- Then the most useful of: key Nifty levels, flows, big results or events today, notable stocks in the news, risk (India VIX).
- Each line one sentence, plain words, under 35 words. Numbers only exactly as in the facts (you may round to whole numbers).
- No advice: never tell the reader to buy or sell. Don't invent causes, numbers or events.`;
async function writeLines(facts: string) {
  let lastErr = "";
  for (const model of MODELS) {
    try {
      const r = await fetch("https://api.moonshot.ai/v1/chat/completions", {
        method: "POST", signal: AbortSignal.timeout(60000),
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + MOONSHOT },
        body: JSON.stringify({ model, temperature: 0.6, max_tokens: 400, thinking: { type: "disabled" },
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: facts }] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { lastErr = `${model}: ${d?.error?.message || r.status}`; continue; }
      const m = String(d?.choices?.[0]?.message?.content || "").match(/\{[\s\S]*\}/);
      if (!m) { lastErr = model + ": no JSON"; continue; }
      const lines = (JSON.parse(m[0]).lines || []).map((x: unknown) => String(x).trim()).filter((x: string) => x && numbersOk(x, facts)).slice(0, 4);
      if (lines.length >= 2) return { lines, writer: "moonshot:" + model };
      lastErr = model + ": too few usable lines";
    } catch (e) { lastErr = String((e as Error).message || e); }
  }
  return { lines: null, writer: "template", error: lastErr };
}

Deno.serve(async (req) => {
  const { data: sec } = await sb.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
  if (!sec || req.headers.get("x-cron-secret") !== sec.value) return json({ error: "unauthorized" }, 401);
  const u = new URL(req.url);
  if (u.searchParams.get("action") === "snap") return json(await snap());
  const { payload, writer, facts } = await build();
  if (u.searchParams.has("debug")) return json({ writer, payload, facts });
  const { error } = await sb.from("premarket_brief").upsert({ d: payload.date, payload, writer, built_at: new Date().toISOString() }, { onConflict: "d" });
  return json(error ? { error: error.message } : { ok: true, d: payload.date, writer, lines: payload.lines, gift: payload.gift, events: payload.events.results_n, news: payload.news.length });
});
