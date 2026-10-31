// festive-picks: publishes the occasion picks (picks.html) - 5 large-cap, 5 mid-cap and 5 small-cap stocks
// for long-term investment - on each occasion's publish date (pick_occasions), and marks picks that reach
// their target. Runs daily from pg_cron (x-cron-secret).
//   1. festive_pick_candidates() screens every stock (quality, value vs industry, trend, room to the 52-week
//      high, liquidity) and returns a shortlist per size bucket;
//   2. the latest quarterly results (stock-fundamentals) add growth; shrinking or loss-making businesses drop;
//   3. one stock per broad sector per bucket (two at most overall), a 12-month model target
//      (forward EPS x fair P/E), and the reasons and risks in plain words.
// Published picks are never rewritten. ?occasion=<slug> runs that occasion now if it isn't published yet;
// ?dry=1 returns the picks without saving them.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const JOB = "festive-picks";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const n = (v: unknown) => { const x = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(x) ? null : x; };
const r1 = (v: number) => Math.round(v * 10) / 10;
const inr = (v: number) => "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 });
const pct = (v: number) => `${v >= 0 ? "+" : ""}${r1(v)}%`;
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
function roundTarget(v: number) {
  const step = v < 100 ? 0.5 : v < 1000 ? 1 : v < 5000 ? 5 : 10;
  return Math.round(v / step) * step;
}
const CAP_NAME: Record<string, string> = { large: "large caps", mid: "mid caps", small: "small caps" };

const SECTOR_RISK: Record<string, string> = {
  "IT & Technology": "Slower tech spending in the US and Europe, and a stronger rupee, can hurt growth and margins.",
  "Banks": "Bad loans rising, or lending margins narrowing as interest rates move, would hit profits.",
  "Financial Services": "Earnings depend on markets, credit quality and regulation, all of which can turn quickly.",
  "Healthcare & Pharma": "US FDA inspections, price erosion in generics and drug-price controls in India.",
  "Automobiles & Auto Parts": "A demand slowdown or higher steel and commodity costs would squeeze volumes and margins.",
  "FMCG & Food": "Weak rural demand and raw-material inflation can slow volumes and margins.",
  "Consumer Durables": "Discretionary spending slowdowns and stiff competition can weigh on growth.",
  "Consumer Services & Retail": "Discretionary spending is the first to slow when the economy cools.",
  "Energy & Power": "Crude and gas price swings and government pricing decisions drive earnings.",
  "Metals & Mining": "Earnings follow the global commodity cycle and Chinese supply.",
  "Chemicals & Fertilisers": "Chinese competition and raw-material prices can pressure margins.",
  "Construction & Infrastructure": "Execution delays, slower government spending and working-capital stress.",
  "Capital Goods & Industrials": "Order inflows can slow with capex cycles; execution delays hit revenue timing.",
  "Defence & Aerospace": "Government orders are lumpy and execution timelines can slip.",
  "Real Estate": "Higher interest rates or a slowdown in housing sales would hurt pre-sales.",
  "Telecom & Media": "Tariff competition, heavy capex and regulatory changes.",
  "Logistics & Services": "Trade volumes and freight rates can swing with the global economy.",
  "Textiles & Apparel": "Export demand and cotton prices are volatile.",
  "Paper & Packaging": "Raw-material (pulp, wood) prices and cheap imports.",
  "Agriculture": "Monsoon, crop prices and government policy drive results.",
};

type Cand = Record<string, any>;

async function fundamentals(symbol: string): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500));
    const d = await fundamentalsOnce(symbol);
    if (d) return d;
  }
  return null;
}
async function fundamentalsOnce(symbol: string): Promise<any | null> {
  try {
    const r = await fetch(`${SB_URL}/functions/v1/stock-fundamentals?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(25_000) });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d?.quarterly) && d.quarterly.length ? d : null;
  } catch (_e) { return null; }
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>, deadline: number): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length && Date.now() < deadline) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// Growth from the last two reported quarters (year on year), with guards against filing quirks:
// a "quarter" far bigger than both the quarter before and the same quarter a year ago is usually a
// half-year figure, so the quarter before is used;
// growth off a loss or a tiny base is reported as a turnaround and not used as a growth rate.
const baseLabel = (l: string) => { const m = /^Q(\d) FY(\d\d)$/.exec(l || ""); return m ? `Q${m[1]} FY${String(+m[2] - 1).padStart(2, "0")}` : null; };
function growth(f: any) {
  let q = f.quarterly as any[];
  const rev = (x: any) => n(x?.financials?.revenue);
  const r0 = rev(q[0]), r1q = rev(q[1]), rBase = rev(q.find((x) => x.label === baseLabel(q[0]?.label)));
  let shifted = false;
  if (r0 !== null && r1q && r0 > 1.6 * r1q && (!rBase || r0 > 1.6 * rBase) && q.length > 2) { q = q.slice(1); shifted = true; }
  const one = (k: number) => {
    const cur = q[k];
    if (!cur) return { yoy: null as number | null, turnaround: false };
    const base = q.find((x) => x.label === baseLabel(cur.label));
    const np = n(cur.financials?.net_profit), bnp = n(base?.financials?.net_profit);
    // (a profit of exactly 0 is a missing figure in the filing, not a loss)
    if (np !== null && bnp !== null && bnp !== 0 && np > 0 && (bnp < 0 || np / bnp > 3)) return { yoy: null, turnaround: true };
    return { yoy: n(cur.derived?.profit_yoy), turnaround: false };
  };
  const a = one(0), b = one(1);
  let ryoy = n(q[0]?.derived?.revenue_yoy);
  if (ryoy !== null && ryoy > 100) ryoy = null; // a merger or a mis-tagged figure, not organic growth
  return {
    label: q[0]?.label || null, label_prev: q[1]?.label || null, shifted,
    profit_yoy: a.yoy, turnaround: a.turnaround, profit_yoy_prev: b.yoy, revenue_yoy: ryoy,
    net_margin: n(q[0]?.derived?.net_margin_percent), net_profit: n(q[0]?.financials?.net_profit),
    revenue: rev(q[0]),
  };
}

function evaluate(c: Cand, g: ReturnType<typeof growth> | null) {
  // Reject shrinking or loss-making businesses.
  if (g) {
    if (g.net_profit !== null && g.net_profit <= 0) return null;
    if (g.profit_yoy !== null && g.profit_yoy < -10) return null;
    if (g.revenue_yoy !== null && g.revenue_yoy < -8) return null;
    if ((g.profit_yoy ?? 0) < 0 && (g.profit_yoy_prev ?? 0) < 0) return null;
  }
  const pg1 = g?.profit_yoy ?? null, pg2 = g?.profit_yoy_prev ?? pg1, rg = g?.revenue_yoy ?? null;
  const mix = pg1 !== null
    ? 0.45 * clamp(pg1, -20, 60) + 0.25 * clamp(pg2 ?? pg1, -20, 60) + 0.30 * clamp(rg ?? pg1, -20, 60)
    : rg !== null ? clamp(rg, -20, 60) : null;
  const gScore = mix === null ? 0.35 : clamp((mix + 5) / 40, 0, 1);
  const score = 0.72 * Number(c.score1) + 0.28 * gScore;

  // 12-month model target: forward EPS x fair P/E.
  const pe = Number(c.pe), spe = Number(c.sector_pe) || pe, price = Number(c.price);
  const eps = price / pe;
  const gUse = clamp(mix === null ? 8 : mix, 4, 22) / 100;
  const fairPe = clamp(Math.sqrt(pe * spe), 0.9 * pe, 1.15 * pe);
  let target = eps * (1 + gUse) * fairPe;
  let capped = false;
  if (target > price * 1.4) { target = price * 1.4; capped = true; }
  target = roundTarget(target);
  const upside = (target / price - 1) * 100;
  if (upside < 10) return null;
  return { score, gScore, target, upside, capped, eps, fwdEps: eps * (1 + gUse), gUse: gUse * 100, fairPe };
}

function thesis(c: Cand, g: ReturnType<typeof growth> | null) {
  const out: string[] = [];
  const roe = Number(c.roe), roce = Number(c.roce), qr = Number(c.q_rank);
  const top = qr >= 0.8 ? ` — in the top ${Math.max(5, Math.round((1 - qr) * 100 / 5) * 5)}% of eligible ${CAP_NAME[c.cap]}` : "";
  out.push(c.fin
    ? `Return on equity of ${r1(roe)}%${top}, a sign of a well-run, profitable ${c.broad_sector === "Banks" ? "lender" : "financial business"}.`
    : `Earns ${r1(roe)}% on shareholders' money and ${r1(roce)}% on all capital employed${top}.`);
  if (g && g.turnaround && g.net_profit !== null) {
    const rev = g.revenue_yoy !== null ? `, with revenue ${g.revenue_yoy >= 0 ? "up" : "down"} ${r1(Math.abs(g.revenue_yoy))}% year on year` : "";
    out.push(`Earnings turnaround: net profit of ₹${Math.round(g.net_profit).toLocaleString("en-IN")} Cr in ${g.label}, against a loss or a much smaller profit a year earlier${rev}.`);
  } else if (g && g.profit_yoy !== null) {
    const rev = g.revenue_yoy !== null ? ` on revenue ${g.revenue_yoy >= 0 ? "up" : "down"} ${r1(Math.abs(g.revenue_yoy))}%` : "";
    const prev = g.profit_yoy_prev !== null && g.label_prev ? ` (${g.label_prev}: ${pct(g.profit_yoy_prev)})` : "";
    out.push(`Net profit ${g.profit_yoy >= 0 ? "grew" : "dipped"} ${r1(Math.abs(g.profit_yoy))}% year on year in ${g.label}${rev}${prev}.`);
  }
  const pe = Number(c.pe), spe = Number(c.sector_pe);
  if (spe > 0) {
    const disc = (1 - pe / spe) * 100;
    out.push(disc >= 50
      ? `Valued at ${r1(pe)}x earnings — less than half its industry's ${r1(spe)}x.`
      : disc >= 8
      ? `Valued at ${r1(pe)}x earnings against ${r1(spe)}x for its industry — a ${Math.round(disc)}% discount to peers.`
      : disc > -8
        ? `Valued at ${r1(pe)}x earnings, in line with its industry (${r1(spe)}x).`
        : `Valued at ${r1(pe)}x earnings vs ${r1(spe)}x for its industry — a premium its returns help justify.`);
  }
  const fromHigh = (1 - Number(c.price) / Number(c.high_52w)) * 100;
  const vs200 = (Number(c.price) / Number(c.d200) - 1) * 100;
  const trend = vs200 >= 0
    ? `, while holding above its 200-day average${Number(c.d50) > Number(c.d200) ? " with the 50-day above the 200-day (uptrend intact)" : ""}.`
    : vs200 > -3 ? ", right at its 200-day average — a level long-term buyers often defend."
    : `, and ${Math.round(-vs200)}% below its 200-day average — a pullback, so consider buying in stages.`;
  out.push(`${fromHigh >= 3 ? `${Math.round(fromHigh)}% below its 52-week high of ${inr(Number(c.high_52w))}` : "Near its 52-week high"}${trend}`);
  if (Number(c.dy) >= 2) out.push(`Pays a ${r1(Number(c.dy))}% dividend yield while you wait.`);
  if (Number(c.promoter_chg) > 0.2) out.push(`Promoters raised their stake by ${r1(Number(c.promoter_chg))} points last quarter.`);
  return out;
}

function risks(c: Cand, g: ReturnType<typeof growth> | null) {
  const out: string[] = [];
  out.push(SECTOR_RISK[c.broad_sector] || "Sector-specific demand and cost swings.");
  const pe = Number(c.pe), spe = Number(c.sector_pe);
  if (spe > 0 && pe > spe * 1.15) out.push("Trades at a premium to peers, so any earnings miss can hurt the share price more.");
  if (g && g.profit_yoy !== null && g.profit_yoy_prev !== null && g.profit_yoy < g.profit_yoy_prev - 15) out.push(`Profit growth slowed from ${pct(g.profit_yoy_prev)} to ${pct(g.profit_yoy)}; the next results need to confirm the trend.`);
  if (!g) out.push("Latest quarterly results could not be checked when this pick was made.");
  if (g && g.turnaround) out.push("Profits are recovering from a weak base; the next few quarters need to show it can last.");
  if (c.cap === "small") out.push("Small-cap: bigger price swings and thinner trading than large companies.");
  else if (c.cap === "mid") out.push("Mid-cap: more volatile than the Nifty in market sell-offs.");
  if (Number(c.promoter) > 0 && Number(c.promoter) < 30) out.push(`Promoters own ${r1(Number(c.promoter))}% — a smaller founder stake.`);
  return out.slice(0, 3);
}

async function marketNote() {
  const { data: nq } = await supabase.from("index_quotes").select("price").eq("symbol", "^NSEI").maybeSingle();
  const nifty = n(nq?.price);
  let y1: number | null = null, fromHigh: number | null = null;
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=1y&interval=1d", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000) });
    const d = await r.json();
    const cl: number[] = (d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((x: any) => Number.isFinite(x));
    if (cl.length > 100) {
      const last = nifty ?? cl[cl.length - 1];
      y1 = (last / cl[0] - 1) * 100;
      fromHigh = (1 - last / Math.max(...cl)) * 100;
    }
  } catch (_e) { /* optional */ }
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const { data: fd } = await supabase.from("fii_dii_daily").select("fii_net,dii_net").gte("trade_date", since);
  const fii = (fd || []).reduce((s, x: any) => s + (Number(x.fii_net) || 0), 0);
  const dii = (fd || []).reduce((s, x: any) => s + (Number(x.dii_net) || 0), 0);
  const lines: string[] = [];
  if (nifty !== null && y1 !== null) {
    lines.push(`The Nifty 50 is at ${Math.round(nifty).toLocaleString("en-IN")}, ${y1 >= 0 ? "up" : "down"} ${r1(Math.abs(y1))}% over the past year${fromHigh !== null && fromHigh > 2 ? ` and ${r1(fromHigh)}% below its 52-week high` : ""}.`);
    lines.push(y1 < -5
      ? "After a weak year, valuations have cooled in many good businesses — a better starting point for long-term buyers than chasing a rally."
      : y1 > 15
        ? "After a strong year, broad valuations are rich, so we stuck to businesses whose earnings support their price."
        : "With the market moving sideways, returns from here should come mostly from earnings growth rather than re-rating.");
  }
  if (fd && fd.length) lines.push(`Over the last month foreign investors were net ${fii >= 0 ? "buyers" : "sellers"} of ₹${Math.round(Math.abs(fii)).toLocaleString("en-IN")} Cr, while domestic institutions ${dii >= 0 ? "bought" : "sold"} ₹${Math.round(Math.abs(dii)).toLocaleString("en-IN")} Cr.`);
  lines.push("This is a stock-picker's market: we looked for companies with high returns on capital, growing profits and sensible valuations, spread across sectors and sizes, to hold for the next 12 months.");
  return { nifty, nifty_1y: y1 === null ? null : r1(y1), from_high: fromHigh === null ? null : r1(fromHigh), fii_30d: Math.round(fii), dii_30d: Math.round(dii), lines };
}

async function build(deadline: number) {
  const { data: cands, error } = await supabase.rpc("festive_pick_candidates", { p_per_bucket: 16 });
  if (error) throw new Error("candidates: " + error.message);
  const all = (cands || []) as Cand[];
  // interleave the buckets so a slow NSE day still leaves results for large, mid and small caps alike
  const at: Record<string, number> = {};
  const list = all.map((c) => ({ c, k: (at[c.cap] = (at[c.cap] ?? -1) + 1) })).sort((a, b) => a.k - b.k).map((x) => x.c);
  // Quarterly results only change four times a year: use what stock-fundamentals cached in the last 3 days
  // and fetch only the rest.
  const { data: cached } = await supabase.from("stock_fundamentals_cache").select("symbol,data")
    .in("symbol", list.map((c) => c.symbol)).gte("fetched_at", new Date(Date.now() - 3 * 864e5).toISOString());
  const cmap = new Map((cached || []).filter((r: any) => Array.isArray(r.data?.quarterly) && r.data.quarterly.length).map((r: any) => [r.symbol, r.data]));
  const funds: any[] = list.map((c) => cmap.get(c.symbol) || null);
  await pool(list.map((_c, i) => (funds[i] ? -1 : i)).filter((i) => i >= 0), 3, async (i) => { funds[i] = await fundamentals(list[i].symbol); }, deadline);
  // NSE throttles bursts: retry the misses in slower passes (results already read are cached for 6 hours)
  for (let pass = 0; pass < 3 && funds.some((f) => !f) && Date.now() < deadline - 15_000; pass++) {
    await new Promise((r) => setTimeout(r, 5000));
    const miss = list.map((c, i) => (funds[i] ? -1 : i)).filter((i) => i >= 0);
    const got = await pool(miss, 2, (i) => fundamentals(list[i].symbol), deadline);
    miss.forEach((i, k) => { if (got[k]) funds[i] = got[k]; });
  }
  const scored = list.map((c, i) => {
    const g = funds[i] ? growth(funds[i]) : null;
    const ev = evaluate(c, g);
    return ev ? { c, g, ev } : null;
  }).filter(Boolean) as { c: Cand; g: ReturnType<typeof growth> | null; ev: NonNullable<ReturnType<typeof evaluate>> }[];

  const overall: Record<string, number> = {};
  const picks: any[] = [];
  for (const cap of ["large", "mid", "small"]) {
    const pool2 = scored.filter((x) => x.c.cap === cap)
      // stocks whose results we could read come first; unread ones only fill gaps
      .sort((a, b) => (Number(!!b.g) - Number(!!a.g)) || (b.ev.score - a.ev.score));
    const used = new Set<string>();
    for (const x of pool2) {
      if (picks.filter((p) => p.cap === cap).length >= 5) break;
      const bs = x.c.broad_sector;
      if (used.has(bs) || (overall[bs] || 0) >= 2) continue;
      used.add(bs); overall[bs] = (overall[bs] || 0) + 1;
      const c = x.c, g = x.g, ev = x.ev;
      picks.push({
        cap, rank: picks.filter((p) => p.cap === cap).length + 1, symbol: c.symbol, company_name: c.name,
        sector: c.sector, broad_sector: bs, pick_price: Number(c.price), target_price: ev.target,
        mcap_cr: Number(c.mcap_cr), score: Math.round(ev.score * 1000) / 1000,
        metrics: {
          pe: c.pe, sector_pe: c.sector_pe, roe: c.roe, roce: c.roce, pb: c.pb, dy: c.dy, promoter: c.promoter,
          promoter_chg: c.promoter_chg, high_52w: c.high_52w, low_52w: c.low_52w, d200: c.d200, fin: c.fin,
          upside: r1(ev.upside), eps_ttm: r1(ev.eps), eps_fwd: r1(ev.fwdEps), growth_used: r1(ev.gUse), fair_pe: r1(ev.fairPe),
          capped: ev.capped, results: g, quality_rank: c.q_rank, value_rank: c.v_rank, growth_score: r1(ev.gScore * 100) / 100,
        },
        thesis: thesis(c, g), risks: risks(c, g),
      });
    }
  }
  return { picks, candidates: list.length, with_results: funds.filter(Boolean).length, eligible: scored.length };
}

Deno.serve(async (req) => {
  const started = Date.now();
  let beat = false;
  const finish = async (ok: boolean, error: string | null, summary: unknown) => {
    if (!beat) return;
    beat = false;
    try { await supabase.rpc("bot_job_finish", { p_job: JOB, p_ok: ok, p_error: error, p_duration_ms: Date.now() - started, p_summary: summary, p_log: false }); } catch (_e) { /* ignore */ }
  };
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: sec } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!sec || !secret || secret !== sec.value) return json({ error: "unauthorized" }, 401);
    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";
    const want = url.searchParams.get("occasion");

    if (!dry) {
      const { data: go } = await supabase.rpc("bot_job_start", { p_job: JOB, p_interval: 86400 });
      if (!go) return json({ skipped: "already running" });
      beat = true;
    }
    const hits = dry ? 0 : (await supabase.rpc("festive_picks_mark_hits")).data ?? 0;

    const today = todayIST();
    let occ: any = null;
    if (want) {
      const { data } = await supabase.from("pick_occasions").select("*").eq("slug", want).maybeSingle();
      if (!data) { await finish(false, "unknown occasion", null); return json({ error: "unknown occasion " + want }, 404); }
      occ = data;
    } else {
      const { data } = await supabase.from("pick_occasions").select("*").eq("status", "scheduled").lte("publish_on", today).order("publish_on").limit(1);
      occ = data?.[0] || null;
      if (occ && occ.event_date < new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)) {
        await supabase.from("pick_occasions").update({ status: "skipped" }).eq("slug", occ.slug);
        occ = null;
      }
    }
    if (!occ) { const s = { hits, published: null, note: "no occasion due" }; await finish(true, null, s); return json(s); }
    if (occ.status === "published" && !dry) { const s = { hits, skipped: `${occ.slug} already published (picks are locked)` }; await finish(true, null, s); return json(s); }

    const { picks, candidates, with_results, eligible } = await build(started + 110_000);
    const note = await marketNote();
    const summary = { hits, occasion: occ.slug, candidates, with_results, eligible, picks: picks.length, by_cap: ["large", "mid", "small"].map((c) => picks.filter((p) => p.cap === c).length) };
    if (dry) return json({ ...summary, note, picks });
    if (picks.length < 9) { await finish(false, "too few picks", summary); return json({ error: "too few picks", ...summary }, 500); }

    await supabase.from("festive_picks").delete().eq("occasion", occ.slug);
    const { error: insErr } = await supabase.from("festive_picks").insert(picks.map((p) => ({ ...p, occasion: occ.slug })));
    if (insErr) throw new Error("insert: " + insErr.message);
    const { error: upErr } = await supabase.from("pick_occasions").update({ status: "published", published_at: new Date().toISOString(), nifty_at_pick: note.nifty, market_note: note }).eq("slug", occ.slug);
    if (upErr) throw new Error("publish: " + upErr.message);
    await finish(true, null, summary);
    return json({ ok: true, ...summary, symbols: picks.map((p) => `${p.cap}:${p.symbol}`) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish(false, msg, null);
    return json({ error: msg }, 500);
  }
});
