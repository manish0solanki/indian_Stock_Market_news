// market-reasons: the "why" behind each market's move, from the news, for India, the US, Europe and Asia.
// 1. Headlines from the last ~30 hours: Google News searches for each market's daily wrap ("why stocks fell today" etc.),
//    plus the site's own feeds (via market_why()).
// 2. Groups them into themes (AI & chips, elections & politics, rates & central banks, tariffs, results, oil, China,
//    war, money flows, currencies) and ranks the themes by coverage.
// 3. Bellwether stocks for each region (Nvidia, TSMC, SK Hynix, ASML, Indian IT and banks ...), so a theme like
//    "AI stocks sold off" comes with the actual moves.
// 4. If MOONSHOT_API_KEY is set, Moonshot writes 2-4 short reasons from those headlines and numbers only, citing the
//    headlines. A reason with a number that isn't in the facts is dropped. The AI is skipped when the headlines and
//    index moves haven't changed since the last run.
//    Cost: each market is refreshed only around its own trading hours plus a closing update (WINDOWS, UTC), and
//    the fixed instructions go first in the prompt (system message) so Moonshot can bill them at its cache rate.
// 5. News sentiment: every headline rated good / bad / neutral for that market's stocks (by the AI in the same call, or
//    by a word list when the AI isn't available), summed into a -100..100 score.
// Writes market_reasons (supabase/market-reasons.sql). POST [?force=1] [?debug=1: return, don't save].
// Auth: x-cron-secret (app_secrets 'crypto_cron'); pg_cron 'market-reasons' hourly on weekdays, 'market-reasons-weekend'
// once a day at weekends (every market runs then).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MOONSHOT = Deno.env.get("MOONSHOT_API_KEY") || "";
const MODELS = (Deno.env.get("MOONSHOT_MODEL") || "kimi-k3.1-pro,kimi-k2.6").split(",").map((s) => s.trim()).filter(Boolean);

type Head = { title: string; source: string; url: string; at: string | null };
type Mover = { s: string; n: string; c: number; theme: string };

const REGIONS: Record<string, { name: string; news: string[]; loc: string }> = {
  india: { name: "India", loc: "hl=en-IN&gl=IN&ceid=IN:en", news: ["Sensex Nifty today", "stock market today Sensex Nifty why", "Nifty closing bell"] },
  us: { name: "United States", loc: "hl=en-US&gl=US&ceid=US:en", news: ["stock market today Dow S&P 500 Nasdaq", "why stocks fell OR rose today Wall Street", "Wall Street close stocks"] },
  europe: { name: "Europe", loc: "hl=en-GB&gl=GB&ceid=GB:en", news: ["European stocks STOXX 600 close", "European shares today DAX FTSE"] },
  asia: { name: "Asia", loc: "hl=en-US&gl=US&ceid=US:en", news: ["Asian markets today Nikkei Kospi Hang Seng", "Asia stocks close Nikkei"] },
};

// When each market is refreshed on weekdays: [from, to) in UTC hours, from before the open to an hour or so after the
// close (covers both summer and winter time). Outside it the saved reasons stay as they are.
const WINDOWS: Record<string, [number, number]> = { india: [3, 11], asia: [23, 9], europe: [6, 17], us: [12, 23] };
function inWindow(region: string, now = new Date()) {
  const day = now.getUTCDay(); if (day === 0 || day === 6) return true; // the weekend run covers everything
  const h = now.getUTCHours(), [a, b] = WINDOWS[region];
  return a < b ? h >= a && h < b : h >= a || h < b;
}

// What a headline is about. Order matters only for display ties.
const THEMES: [string, string, RegExp][] = [
  ["ai", "AI & chip stocks", /\b(ai|artificial intelligence|nvidia|chips?|chipmakers?|semiconductors?|openai|data cent(?:er|re)s?|hynix|tsmc|broadcom|amd|micron|asml|softbank|tech stocks?|tech shares|tech sell-?off|big tech|magnificent seven)\b/i],
  ["election", "Elections & politics", /\b(elections?|midterms?|votes?|voting|ballots?|congress|senate|republicans?|democrats?|gop|parliament|coalition|government shutdown|shutdown|poll results)\b/i],
  ["rates", "Interest rates & central banks", /\b(fed|federal reserve|powell|rate cuts?|rate hikes?|interest rates?|treasur(?:y|ies)|bond yields?|yields|ecb|boj|bank of japan|bank of england|rbi|central bank|inflation|cpi|payrolls?|jobs report|jobless)\b/i],
  ["trade", "Tariffs & trade", /\b(tariffs?|trade (?:war|deal|talks|tensions)|export (?:curbs?|controls?)|sanctions?)\b/i],
  ["earnings", "Company results", /\b(earnings|results|quarterly|q[1-4]|profit|revenue|guidance|forecast)\b/i],
  ["oil", "Oil & energy", /\b(oil|crude|opec|brent|energy prices?)\b/i],
  ["china", "China", /\b(china|chinese|beijing|yuan|pboc)\b/i],
  ["geo", "War & geopolitics", /\b(war|missiles?|attacks?|iran|israel|russia|ukraine|conflict|military|ceasefire|geopolitic\w*)\b/i],
  ["flows", "Foreign money flows", /\b(fiis?|fpis?|foreign (?:investors?|funds?|inflows?|outflows?|selling|buying)|outflows?|inflows?)\b/i],
  ["banks", "Banks & financials", /\b(banks?|banking|lenders?|financials?|nbfcs?)\b/i],
  ["autos", "Auto stocks", /\b(autos?|automakers?|carmakers?|vehicles?|tractors?|ev)\b/i],
  ["broad", "Midcaps & smallcaps", /\b(mid-?caps?|small-?caps?|broader market)\b/i],
  ["currency", "Currency moves", /\b(rupee|dollar|yen|euro|currency|forex)\b/i],
  ["crypto", "Crypto", /\b(bitcoin|crypto\w*)\b/i],
];
// Which bellwether groups back up a theme.
const THEME_STOCKS: Record<string, string[]> = { ai: ["ai"], rates: ["banks"], oil: ["oil"], china: ["china"], earnings: [], election: [], trade: ["ai", "autos"], geo: ["defence", "oil"], banks: ["banks"], autos: ["autos"] };

// Bellwether stocks per region: [Yahoo symbol, name, group]. India comes from stock_quotes.
const BELL: Record<string, [string, string, string][]> = {
  us: [["NVDA", "Nvidia", "ai"], ["MSFT", "Microsoft", "ai"], ["GOOGL", "Alphabet", "ai"], ["META", "Meta", "ai"], ["AVGO", "Broadcom", "ai"], ["AMD", "AMD", "ai"], ["ORCL", "Oracle", "ai"], ["MU", "Micron", "ai"], ["PLTR", "Palantir", "ai"],
    ["AAPL", "Apple", "tech"], ["AMZN", "Amazon", "tech"], ["TSLA", "Tesla", "autos"], ["JPM", "JPMorgan", "banks"], ["GS", "Goldman Sachs", "banks"], ["XOM", "Exxon Mobil", "oil"], ["LMT", "Lockheed Martin", "defence"]],
  europe: [["ASML.AS", "ASML", "ai"], ["SAP.DE", "SAP", "ai"], ["IFX.DE", "Infineon", "ai"], ["SIE.DE", "Siemens", "industrial"], ["MC.PA", "LVMH", "china"], ["NOVO-B.CO", "Novo Nordisk", "health"],
    ["SHEL.L", "Shell", "oil"], ["TTE.PA", "TotalEnergies", "oil"], ["HSBA.L", "HSBC", "banks"], ["SAN.MC", "Santander", "banks"], ["RHM.DE", "Rheinmetall", "defence"], ["VOW3.DE", "Volkswagen", "autos"]],
  asia: [["2330.TW", "TSMC", "ai"], ["005930.KS", "Samsung Electronics", "ai"], ["000660.KS", "SK Hynix", "ai"], ["9984.T", "SoftBank Group", "ai"], ["8035.T", "Tokyo Electron", "ai"], ["6857.T", "Advantest", "ai"],
    ["7203.T", "Toyota", "autos"], ["6758.T", "Sony", "tech"], ["8306.T", "Mitsubishi UFJ", "banks"], ["0700.HK", "Tencent", "china"], ["9988.HK", "Alibaba", "china"], ["1211.HK", "BYD", "china"]],
};
const INDIA_BELL: [string, string, string][] = [["TCS", "TCS", "ai"], ["INFY", "Infosys", "ai"], ["HCLTECH", "HCL Tech", "ai"], ["WIPRO", "Wipro", "ai"], ["TECHM", "Tech Mahindra", "ai"],
  ["HDFCBANK", "HDFC Bank", "banks"], ["ICICIBANK", "ICICI Bank", "banks"], ["SBIN", "SBI", "banks"], ["AXISBANK", "Axis Bank", "banks"], ["KOTAKBANK", "Kotak Bank", "banks"],
  ["RELIANCE", "Reliance", "oil"], ["ONGC", "ONGC", "oil"], ["BPCL", "BPCL", "oil"], ["M&M", "M&M", "autos"], ["MARUTI", "Maruti", "autos"], ["TATASTEEL", "Tata Steel", "china"], ["HAL", "HAL", "defence"], ["BEL", "BEL", "defence"]];

const unent = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/\s+/g, " ").trim();
const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 60);
const fresh = (at: string | null, h = 30) => !at || Date.now() - Date.parse(at) < h * 3600e3;

async function googleNews(q: string, loc: string): Promise<Head[]> {
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:1d")}&${loc}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const x = await r.text();
    return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 25).map((m) => {
      const it = m[1], g = (t: string) => unent((it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || "");
      const source = g("source"); let title = g("title");
      if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
      const pd = g("pubDate");
      return { title, source, url: g("link"), at: pd ? new Date(pd).toISOString() : null };
    }).filter((h) => h.title && fresh(h.at));
  } catch { return []; }
}

async function yahoo(sym: string): Promise<{ c: number; t: string } | null> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=15m`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    const p = m?.regularMarketPrice, prev = m?.chartPreviousClose ?? m?.previousClose;
    if (!(p > 0 && prev > 0)) return null;
    return { c: Math.round((p / prev - 1) * 10000) / 100, t: new Date((m.regularMarketTime || 0) * 1000).toISOString() };
  } catch { return null; }
}

async function bellwethers(region: string): Promise<Mover[]> {
  if (region === "india") {
    const { data } = await sb.from("stock_quotes").select("symbol,change_percent,quote_time").in("symbol", INDIA_BELL.map((b) => b[0]));
    const by = new Map((data || []).filter((q) => q.change_percent !== null && Math.abs(q.change_percent) <= 20 && fresh(q.quote_time, 120)).map((q) => [q.symbol, Number(q.change_percent)]));
    return INDIA_BELL.filter((b) => by.has(b[0])).map(([s, n, theme]) => ({ s, n, theme, c: Math.round(by.get(s)! * 100) / 100 }));
  }
  const got = await Promise.all(BELL[region].map(async ([s, n, theme]) => { const q = await yahoo(s); return q ? { s, n, theme, c: q.c } : null; }));
  return got.filter((x): x is Mover => !!x);
}

function themesOf(heads: Head[], movers: Mover[]) {
  const out = THEMES.map(([k, label, re]) => {
    const hs = heads.filter((h) => re.test(h.title));
    const groups = THEME_STOCKS[k] || [];
    const stocks = movers.filter((m) => groups.includes(m.theme)).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 6);
    const avg = stocks.length ? Math.round(stocks.reduce((a, m) => a + m.c, 0) / stocks.length * 100) / 100 : null;
    return { k, label, n: hs.length, heads: hs.slice(0, 4), stocks: stocks.map(({ s, n, c }) => ({ s, n, c })), avg };
  }).filter((t) => t.n >= 2 || (t.n >= 1 && heads.length < 8));
  return out.sort((a, b) => b.n - a.n).slice(0, 6);
}

/* ---------- AI writer ---------- */
const sgn = (v: number | null | undefined, d = 2) => v === null || v === undefined || !isFinite(Number(v)) ? "n/a" : (Number(v) > 0 ? "+" : "") + Number(v).toFixed(d) + "%";
function factsFor(region: string, W: any, movers: Mover[], themes: any[], heads: Head[]) {
  const L: string[] = [];
  if (region === "india") {
    const I = W.india || {};
    L.push(`Market: India. Nifty 50 ${sgn(I.chg)} (${I.pts} points), Sensex ${sgn(I.sensex)}, Bank Nifty ${sgn(I.bank)}, Midcap 50 ${sgn(I.midcap)}. Session: ${I.session}.`);
    const C = I.contributors || {};
    L.push("Biggest Nifty point contributors: " + [...(C.up || []), ...(C.down || [])].map((x: any) => `${x.s} ${sgn(x.chg)} (${x.pts} pts)`).join(", "));
    if (I.breadth) L.push(`Breadth: ${I.breadth.up} stocks up, ${I.breadth.down} down.`);
    L.push("Market drivers: " + (I.drivers || []).map((d: any) => `${d.label}: ${d.value}`).join("; "));
  } else {
    const R = (W.regions || []).find((r: any) => r.key === region) || {};
    L.push(`Market: ${R.name}. Latest session index moves: ` + (R.indices || []).map((x: any) => `${x.n} ${sgn(x.c)}`).join(", "));
    L.push("Cross-market moves: " + (R.drivers || []).map((d: any) => `${d.label}: ${d.value}`).join("; "));
  }
  if (movers.length) L.push("Bellwether stocks (latest session): " + movers.map((m) => `${m.n} ${sgn(m.c)}`).join(", "));
  if (themes.length) L.push("Headline themes by coverage: " + themes.map((t) => `${t.label} (${t.n} headlines${t.avg !== null ? `, related stocks average ${sgn(t.avg)}` : ""})`).join("; "));
  L.push("HEADLINES:");
  heads.forEach((h, i) => L.push(`[${i + 1}] ${h.title} (${h.source})`));
  return L.join("\n");
}

// Every number the AI writes must be in the facts (allowing rounding), so nothing invented gets shown.
const nums = (s: string) => [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ""));
function numbersOk(text: string, facts: string) {
  const have = nums(facts).map(Number);
  return nums(text).every((t) => {
    const v = Number(t); if (!t.includes(".") && v <= 12) return true;
    const dp = (t.split(".")[1] || "").length, tol = 0.5 * 10 ** -dp + 1e-9;
    return have.some((h) => Math.abs(h - v) <= tol);
  });
}

async function moonshot(model: string, system: string, prompt: string) {
  const r = await fetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(90000),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + MOONSHOT },
    body: JSON.stringify({ model, temperature: 0.6, max_tokens: 900, thinking: { type: "disabled" },
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${model}: ${d?.error?.message || r.status}`);
  return String(d?.choices?.[0]?.message?.content || "");
}

// The fixed part of the prompt. It never changes, so it goes first (as the system message) where Moonshot's context
// cache can match it from call to call; the market data and headlines follow in the user message.
const SYSTEM = `You are a careful markets reporter. You explain market moves using only the facts and numbered headlines you are given, and you never invent events or numbers.
Explain why the named market moved the way it did in its latest session.
Return JSON only, no prose around it: {"reasons":[{"title":"...","detail":"...","sources":[1,2]}],"tones":[1,-1,0]}
- 2 to 4 reasons, the most important first. Name the actual events (e.g. an election result, a sell-off in AI stocks, a central bank decision, company results) when the headlines report them.
- title: under 10 words. detail: 1-2 plain sentences that connect the news to the move, adding the stock or index moves from the facts where they back it up.
- Use numbers only exactly as they appear in the facts. Don't add numbers from your own knowledge.
- sources: the numbers of the headlines that support the reason (at least one).
- Write for an investor: never mention "the facts", "supplied" or "provided" data, headline numbers or headline counts.
- tones: one number for EVERY headline, in order: 1 if it is good news for this market's stocks, -1 if bad news, 0 if neutral or not about the market.
- If the headlines don't explain the move, give one reason saying the cause isn't clear from the news, with no sources.`;

async function writeReasons(region: string, facts: string, heads: Head[]) {
  const prompt = `${facts}\n\nExplain the ${REGIONS[region].name} market's latest move. There are ${heads.length} headlines, so "tones" must have ${heads.length} numbers.`;
  let lastErr = "";
  for (const model of MODELS) {
    try {
      const txt = await moonshot(model, SYSTEM, prompt);
      const m = txt.match(/\{[\s\S]*\}/); if (!m) { lastErr = model + ": no JSON"; continue; }
      const parsed = JSON.parse(m[0]);
      const reasons = (parsed.reasons || []).slice(0, 4).map((x: any) => ({
        title: String(x.title || "").trim(), detail: String(x.detail || "").trim(),
        sources: [...new Set((x.sources || []).map(Number).filter((i: number) => i >= 1 && i <= heads.length))].slice(0, 3).map((i: any) => heads[i - 1]),
      })).filter((x: any) => x.title && numbersOk(x.title + " " + x.detail, facts));
      const tones = Array.isArray(parsed.tones) && parsed.tones.length === heads.length ? parsed.tones.map((t: unknown) => Math.sign(Number(t) || 0)) : null;
      if (reasons.length) return { reasons, tones, writer: "moonshot:" + model };
      lastErr = model + ": no usable reasons";
    } catch (e) { lastErr = String((e as Error).message || e); }
  }
  return { reasons: null, tones: null, writer: "themes", error: lastErr };
}

// Word-list tone, used when the AI didn't rate the headlines.
const POS = /\b(rall(?:y|ies|ied)|surg(?:e|es|ed|ing)|soar\w*|jump\w*|gain\w*|ris(?:e|es|ing)|rose|climb\w*|record high|rebound\w*|recover\w*|advanc\w*|boost\w*|upbeat|optimis\w*|bull\w*|beat\w*|green|higher|winning streak)\b/i;
const NEG = /\b(fall\w*|fell|drop\w*|slump\w*|plung\w*|tumbl\w*|crash\w*|sell-?off\w*|selloff|rout\w*|sink\w*|sank|slid\w*|slide\w*|loss\w*|lose|losing|fear\w*|worr\w*|bear\w*|lower|declin\w*|weak\w*|red|halt\w*|turmoil|panic|recession)\b/i;
const wordTone = (t: string) => { const p = POS.test(t), n = NEG.test(t); return p && !n ? 1 : n && !p ? -1 : 0; };
function sentimentOf(heads: Head[], tones: number[] | null) {
  const t = heads.map((h, i) => (tones ? tones[i] : wordTone(h.title)));
  const pos = t.filter((x) => x > 0).length, neg = t.filter((x) => x < 0).length, neu = t.length - pos - neg;
  const score = pos + neg ? Math.round(100 * (pos - neg) / (pos + neg + neu * 0.5)) : 0;
  const label = score >= 40 ? "Very positive" : score >= 15 ? "Positive" : score > -15 ? "Mixed" : score > -40 ? "Negative" : "Very negative";
  const pick = (sgn: number) => heads.filter((_, i) => t[i] === sgn).slice(0, 3).map(({ title, source, url, at }) => ({ title, source, url, at }));
  return { sentiment: { pos, neg, neu, score, label, by: tones ? "ai" : "words", up: pick(1), down: pick(-1) }, t };
}

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const { data: sec } = await sb.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
  if (!sec || req.headers.get("x-cron-secret") !== sec.value) return json({ error: "unauthorized" }, 401);
  const u = new URL(req.url), debug = u.searchParams.has("debug"), force = u.searchParams.has("force");
  const only = u.searchParams.get("region");

  const { data: W, error } = await sb.rpc("market_why");
  if (error) return json({ error: error.message }, 500);
  const { data: prev } = await sb.from("market_reasons").select("region,heads_hash,reasons,writer,sentiment,themes,written_at,updated_at");
  const old = new Map((prev || []).map((r) => [r.region, r]));

  const out: Record<string, unknown> = { has_ai_key: !!MOONSHOT };
  await Promise.all(Object.keys(REGIONS).filter((r) => !only || r === only).map(async (region) => {
    const cfg = REGIONS[region];
    const o = old.get(region);
    if (o && !force && !debug && !inWindow(region)) { out[region] = "outside its trading window: kept as is"; return; }
    const [gn, movers] = await Promise.all([Promise.all(cfg.news.map((q) => googleNews(q, cfg.loc))), bellwethers(region)]);
    const own: Head[] = (region === "india" ? W?.india?.headlines : (W?.regions || []).find((r: any) => r.key === region)?.headlines) || [];
    const seen = new Set<string>(), heads: Head[] = [];
    for (const h of [...gn.flat(), ...own.map((h: any) => ({ title: unent(String(h.title || "")), source: h.source || "", url: h.url || "", at: h.at || null }))]) {
      const k = key(h.title); if (!h.title || seen.has(k)) continue; seen.add(k); heads.push(h);
    }
    heads.sort((a, b) => Date.parse(b.at || "0") - Date.parse(a.at || "0"));
    const top = heads.slice(0, 30);
    const themes = themesOf(top, movers);
    const facts = factsFor(region, W, movers, themes, top);
    const moveKey = region === "india" ? String(W?.india?.chg) : String((W?.regions || []).find((r: any) => r.key === region)?.move?.toFixed?.(1));
    const hash = await sha(moveKey + "|" + top.slice(0, 15).map((h) => key(h.title)).sort().join("|"));
    let reasons = o?.reasons ?? null, writer = o?.writer ?? "themes", aiErr: string | undefined, tones: number[] | null = null, ran = false;
    let written_at = o?.written_at ?? null;
    if (MOONSHOT && top.length >= 3 && (force || debug || !o?.reasons || o.heads_hash !== hash)) {
      const w = await writeReasons(region, facts, top);
      ran = true; tones = w.tones;
      if (w.reasons) { reasons = w.reasons; writer = w.writer; written_at = new Date().toISOString(); } else { aiErr = w.error; if (o?.heads_hash !== hash) { reasons = null; writer = "themes"; } }
    } else if (!MOONSHOT) { reasons = null; writer = "themes"; }
    // sentiment: from the AI's ratings when it ran; the last saved one when nothing changed; else the word list
    let sentiment: any;
    if (tones || ran || !o?.sentiment || o.heads_hash !== hash) {
      const sres = sentimentOf(top, tones);
      sentiment = sres.sentiment;
      const toneBy = new Map(top.map((h, i) => [key(h.title), sres.t[i]]));
      for (const th of themes) th.heads = th.heads.map((h: Head) => ({ ...h, t: toneBy.get(key(h.title)) ?? 0 }));
    } else {
      sentiment = o.sentiment;
      const was = new Map<string, number>();
      for (const th of o.themes || []) for (const h of th.heads || []) if (typeof h.t === "number") was.set(key(h.title), h.t);
      for (const th of themes) th.heads = th.heads.map((h: Head) => ({ ...h, t: was.get(key(h.title)) ?? wordTone(h.title) }));
    }
    const row = { region, themes, reasons, movers, sentiment, writer, heads_hash: hash, written_at, updated_at: new Date().toISOString() };
    if (debug) out[region] = { ...row, heads: top.length, google: gn.map((g) => g.length), aiErr, facts };
    else {
      const { error: e } = await sb.from("market_reasons").upsert(row, { onConflict: "region" });
      out[region] = e ? { error: e.message } : { sentiment: `${sentiment.label} ${sentiment.score} (${sentiment.by})`, heads: top.length, themes: themes.map((t) => `${t.k}:${t.n}`), movers: movers.length, writer, aiErr };
    }
  }));
  return json(out);
});
