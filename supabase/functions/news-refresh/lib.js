// Pure helpers for news-refresh: RSS parsing, company matching and keyword sentiment.
// Plain JavaScript (no Deno APIs) so it can be unit-tested with Node.

export const FEEDS = [
  { name: "LiveMint", url: "https://www.livemint.com/rss/markets" },
  { name: "Economic Times", url: "https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2146842.cms" },
  { name: "ET Earnings", url: "https://economictimes.indiatimes.com/markets/stocks/earnings/rssfeeds/2143429.cms" },
  { name: "Business Standard", url: "https://www.business-standard.com/rss/markets-106.rss" },
];

/* ───────── RSS ───────── */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };
export function cleanText(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? cleanText(m[1]) : "";
}
export function parseFeed(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    const link = tag(b, "link") || tag(b, "guid");
    items.push({ title: tag(b, "title"), link: link.trim(), description: tag(b, "description"), pubDate: tag(b, "pubDate") });
  }
  return items;
}

/* ───────── Company matching ───────── */
const norm = (s) => String(s || "").toLowerCase().replace(/[’`]/g, "'").replace(/'s\b/g, "").replace(/[^a-z0-9&]+/g, " ").trim();
export function cleanCompany(name) {
  return String(name || "").replace(/\s+/g, " ").replace(/^the\s+/i, "")
    .replace(/[\s,]*\b(limited|ltd\.?)\s*$/i, "").replace(/\s*\(india\)\s*$/i, "").trim();
}
// Words that are too generic (or shared by business groups) to identify one company on their own.
const GENERIC = new Set(("india indian national bharat hindustan state central global united first great power capital future new premier prime super " +
  "standard general eastern western southern northern gujarat punjab bank finance financial gold silver steel cement sugar textile textiles market markets " +
  "stock stocks share shares tata adani bajaj birla reliance jindal godrej kotak icici hdfc axis aditya sun star mahindra larsen jio ola shree sri shri " +
  "royal modern advance advanced ultra smart digital tech infra energy green solar housing home life health metro city urban rural royal golden diamond " +
  "crystal max mega micro alpha delta apex prima nova vision summit century continental international universal asian oriental").split(" "));
// Two-word name prefixes that are everyday phrases in headlines.
const BLOCKED = new Set(["blue chip", "first source", "great eastern", "new delhi", "south india", "north east"]);
// Brokerages are listed companies too; "Motilal Oswal sees 36% upside in X" is about X, not the broker.
const BROKERS = new Set(["MOTILALOFS", "ANGELONE", "IIFL", "JMFINANCIL", "NUVAMA", "ICICISEC", "GEOJITFSL", "5PAISA", "CHOICEIN", "ANANDRATHI", "PRUDENT"]);
const BROKER_VERB = /^(sees?|says?|recommends?|picks?|initiates?|adds?|stock|stocks|bullish|bearish|bets?|expects?|raises?|cuts?|upgrades?|downgrades?|likes?|prefers?|top|target)$/;
// Upper-case tokens in headlines that are not company tickers.
const NOT_TICKERS = new Set("IPO RBI GDP GST CEO CFO USA FII FIIS DII DIIS NSE BSE EV EVS AI IT PSU PSUS MF MFS FPI FPIS SEBI NIFTY SENSEX ETF ETFS OFS QIP AGM EPS YOY QOQ FY UK US EU OPEC IMF WTO CPI WPI PMI IIP RBI'S NBFC NBFCS SME SMES MSCI FTSE HNI HNIS EBITDA PAT GMP NAV SIP SIPS LIC'S ESG ESOP FDI REIT REITS INVIT INVITS".split(" "));
// Common names in headlines that don't match the official company name.
const MANUAL = {
  RIL: "RELIANCE", "reliance industries": "RELIANCE", HUL: "HINDUNILVR", "l&t": "LT", SBI: "SBIN", airtel: "BHARTIARTL", maruti: "MARUTI",
  "m&m": "M&M", "mahindra & mahindra": "M&M", "kotak bank": "KOTAKBANK", "kotak mahindra bank": "KOTAKBANK", hcltech: "HCLTECH", "hcl tech": "HCLTECH",
  infy: "INFY", zomato: "ETERNAL", eternal: "ETERNAL", "jio financial": "JIOFIN", "jio platforms": "JPL", "dr reddy": "DRREDDY", "bajaj finance": "BAJFINANCE",
  "bajaj finserv": "BAJAJFINSV", "bajaj auto": "BAJAJ-AUTO", "tata steel": "TATASTEEL", "tata power": "TATAPOWER", "tata consumer": "TATACONSUM",
  "tata elxsi": "TATAELXSI", "tata chemicals": "TATACHEM", "tata communications": "TATACOMM", "adani enterprises": "ADANIENT", "adani ports": "ADANIPORTS",
  "adani power": "ADANIPOWER", "adani green": "ADANIGREEN", "adani energy": "ADANIENSOL", "adani total gas": "ATGL", "hdfc bank": "HDFCBANK",
  "hdfc life": "HDFCLIFE", "hdfc amc": "HDFCAMC", "icici bank": "ICICIBANK", "icici prudential": "ICICIPRULI", "icici lombard": "ICICIGI",
  "axis bank": "AXISBANK", "sun pharma": "SUNPHARMA", "asian paints": "ASIANPAINT", "ultratech": "ULTRACEMCO", "hero motocorp": "HEROMOTOCO",
  "eicher motors": "EICHERMOT", "nestle india": "NESTLEIND", "power grid": "POWERGRID", "coal india": "COALINDIA", "indian oil": "IOC",
  "bharat electronics": "BEL", "vodafone idea": "IDEA", paytm: "PAYTM", nykaa: "NYKAA", "policybazaar": "POLICYBZR", "indigo": "INDIGO",
  "interglobe aviation": "INDIGO", "ola electric": "OLAELEC", "zydus life": "ZYDUSLIFE", "info edge": "NAUKRI", "tamo pv": "TMPV", jio: "JPL", "adani ent": "ADANIENT", "sbi life": "SBILIFE", "sbi card": "SBICARD", "godrej consumer": "GODREJCP", "godrej properties": "GODREJPROP",
};

export function buildMatcher(stocks) {
  const bySym = new Map(stocks.map((s) => [s.symbol, s]));
  const firstWordCount = new Map();
  for (const s of stocks) {
    const w = norm(cleanCompany(s.company_name)).split(" ")[0];
    if (w) firstWordCount.set(w, (firstWordCount.get(w) || 0) + 1);
  }
  const caps = stocks.map((s) => Number(s.market_cap) || 0).sort((a, b) => b - a);
  const top300 = caps[Math.min(299, caps.length - 1)] || 0;
  const twoWordCount = new Map();
  for (const s of stocks) {
    const w = norm(cleanCompany(s.company_name)).split(" ");
    if (w.length >= 2) { const k = w[0] + " " + w[1]; twoWordCount.set(k, (twoWordCount.get(k) || 0) + 1); }
  }

  // alias (normalised words) -> {symbol, words, proper}
  const index = new Map(); // first word -> aliases
  const add = (alias, symbol, proper = false) => {
    const words = norm(alias).split(" ").filter(Boolean);
    if (!words.length || !bySym.has(symbol)) return;
    const list = index.get(words[0]) || [];
    if (!list.some((a) => a.symbol === symbol && a.words.join(" ") === words.join(" "))) list.push({ symbol, words, proper });
    index.set(words[0], list);
  };
  for (const s of stocks) {
    const clean = cleanCompany(s.company_name);
    const w = norm(clean).split(" ").filter(Boolean);
    if (!w.length) continue;
    if (w.length >= 2 || w[0].length >= 6) add(clean, s.symbol);
    if (w.length >= 3 && !["and", "&", "of"].includes(w[1]) && twoWordCount.get(w[0] + " " + w[1]) === 1 && !BLOCKED.has(w[0] + " " + w[1])) add(w[0] + " " + w[1], s.symbol);
    if (w[0].length >= 5 && !GENERIC.has(w[0]) && firstWordCount.get(w[0]) === 1 && (Number(s.market_cap) || 0) >= top300) add(w[0], s.symbol, true);
  }
  for (const [alias, sym] of Object.entries(MANUAL)) add(alias, sym);
  const tickers = new Set(stocks.filter((s) => /^[A-Z]{3,}$/.test(s.symbol) && !NOT_TICKERS.has(s.symbol)).map((s) => s.symbol));

  // Returns the company mentioned first in `text` (longer and larger companies win ties).
  return function match(text) {
    const raw = String(text || "");
    const words = norm(raw).split(" ").filter(Boolean);
    const rawWords = raw.replace(/[’`]/g, "'").replace(/'s\b/g, "").split(/[^A-Za-z0-9&]+/).filter(Boolean);
    let best = null;
    const consider = (symbol, pos, len) => {
      const cap = Number(bySym.get(symbol)?.market_cap) || 0;
      if (!best || pos < best.pos || (pos === best.pos && (len > best.len || (len === best.len && cap > best.cap)))) best = { symbol, pos, len, cap };
    };
    for (let i = 0; i < words.length; i++) {
      for (const a of index.get(words[i]) || []) {
        if (a.words.every((x, j) => words[i + j] === x)) {
          if (BROKERS.has(a.symbol) && words.slice(i + a.words.length, i + a.words.length + 2).some((x) => BROKER_VERB.test(x))) continue;
          // Single-word aliases must be capitalised in the headline (a proper noun, not a common word).
          if (a.proper && a.words.length === 1 && !/^[A-Z]/.test(rawWords[i] || "")) continue;
          consider(a.symbol, i, a.words.length);
        }
      }
    }
    rawWords.forEach((t, i) => { if (tickers.has(t)) consider(t, i, 1); else if (MANUAL[t] && /^[A-Z&]+$/.test(t)) consider(MANUAL[t], i, 1); });
    if (!best) return null;
    const s = bySym.get(best.symbol);
    return { symbol: s.symbol, company_name: cleanCompany(s.company_name) || s.symbol };
  };
}

/* ───────── Keyword sentiment ───────── */
const POS = [
  [/\b(surg|soar|zoom|skyrocket)\w*/g, 2], [/\b(jump|rall(y|ies|ied)|spurt|climb)\w*/g, 2], [/\b(gain|rise|rises|risen|rising|advanc)\w*/g, 1],
  [/\brecord (profit|revenue|sales)\b/g, 1], [/\b(all-time|52-week|lifetime|record) highs?\b/g, 2], [/\b(beat|beats|tops|exceeds?|above) (street )?(estimates?|expectations?)\b/g, 2],
  // Profit direction outweighs revenue direction ("profit plunges 93%, revenue rises 13%" is bad news).
  [/\b(profit|earnings|pat|net income)\w* (up|rise|rises|jump|jumps|surge|surges|grow|grows|doubles|triples|soar|soars|zooms)\b/g, 3],
  [/\b(revenue|sales|ebitda)\w* (up|rise|rises|jump|jumps|surge|surges|grow|grows|doubles|soar|soars|spikes)\b/g, 1],
  [/\bloss (narrows|shrinks)\b/g, 2],
  [/\b(three|two|four)-fold\b/g, 1], [/\b(strong|robust|healthy|stellar|solid)\b/g, 1], [/\bupgrade\w*/g, 2], [/\b(buy|outperform|overweight) rating\b/g, 2],
  [/\btarget (price )?(raised|hike\w*|upped)\b|\braises? (target|guidance)\b/g, 2], [/\b(bags?|wins?|wins|secures?|bagged|won|secured) .{0,30}(order|contract|deal|project)s?\b/g, 2],
  [/\b(approval|approves|approved|nod|clearance)\b/g, 1], [/\b(dividend|bonus issue|buyback|stock split)\b/g, 1], [/\b(rebound|recover|turnaround)\w*/g, 1],
  [/\b(oversubscribed|fully subscribed|premium listing|lists at (a )?premium|strong debut|soars on debut)\b/g, 2],
  [/\b(cuts?|reduc\w*|pares?|lowers?) (its )?(net )?debt\b|\bdebt-free\b/g, 2], [/\b(expansion|capacity addition|new plant|acqui\w*)\b/g, 1],
  [/\bimproves?\b|\bimproved\b/g, 1],
];
const NEG = [
  [/\b(plung|crash|tank|slump|tumbl|nosediv)\w*/g, 2], [/\b(fall|falls|fell|falling|drop|drops|dropped|declin\w*|slid\w*|slip\w*|sink\w*|sank|dip|dips|dipped)\b/g, 1],
  [/\b(52-week|record|multi-year|\d+-year) lows?\b|\blower circuit\b/g, 2], [/\b(miss|misses|missed|below|lags?) (street )?(estimates?|expectations?)\b/g, 2],
  [/\b(profit|earnings|pat|net income)\w* (fall|falls|drop|drops|down|decline|declines|slump|slumps|plunge|plunges|shrink|shrinks|dip|dips|tank|tanks)\b/g, 3],
  [/\b(revenue|sales|margins?)\w* (fall|falls|drop|drops|decline|declines|slump|slumps|shrink|shrinks|shrinking|dip|dips)\b|\bshrinking margins?\b/g, 1],
  [/\bretrac\w*/g, 1],
  [/\bnet loss\b|\blosses? widen\w*|\bloss widens\b|\bswings? to (a )?loss\b/g, 2], [/\b(weak|tepid|muted|disappointing|subdued)\b/g, 1], [/\bdowngrad\w*/g, 2],
  [/\b(sell|underperform|underweight|reduce) rating\b/g, 2], [/\btarget (price )?(cut|lowered|slashed)\b|\bcuts? (target|guidance|forecast)\b/g, 2],
  [/\b(penalty|fined|fine of|probe|raid\w*|fraud|scam|default\w*|insolvency|bankruptcy|lawsuit|ban|banned|show-cause)\b/g, 2],
  [/\b(resign\w*|quits|exit of)\b/g, 1], [/\b(strike|shutdown|outage|fire at|recall)\b/g, 1], [/\b(sell-?off|outflows?|slowdown|headwinds?|pressure|concerns?|woes|delay\w*)\b/g, 1],
  [/\b(discount listing|lists at (a )?discount|weak debut)\b/g, 2],
];
const STRUCTURAL = /\b(order|contract|acqui\w*|merger|demerger|capacity|expansion|capex|guidance|rating|approval|licen[cs]e|debt|fraud|probe|default|insolvency|ban|resign\w*|stake|profit|earnings|revenue|margin|q[1-4]|results?)\b/;
function score(text) {
  const t = String(text || "").toLowerCase();
  let s = 0;
  for (const [re, w] of POS) s += (t.match(re) || []).length * w;
  for (const [re, w] of NEG) s -= (t.match(re) || []).length * w;
  return s;
}
export function sentiment(title, description) {
  const total = score(title) * 2 + score(description);
  const short = total >= 2 ? "Positive" : total <= -2 ? "Negative" : "Neutral";
  const long = short !== "Neutral" && STRUCTURAL.test((title + " " + description).toLowerCase()) ? short : "Neutral";
  const mag = Math.abs(total);
  return { short, long, confidence: short === "Neutral" ? "Low" : mag >= 6 ? "High" : mag >= 3 ? "Medium" : "Low" };
}

function summarise(title, description) {
  let d = cleanText(description);
  if (!d || norm(d) === norm(title)) return title;
  if (d.length <= 220) return d;
  const cut = d.slice(0, 220);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return end > 80 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

// RSS item -> news row, or null when no listed company is mentioned in the headline.
export function toNewsRow(item, match) {
  const title = cleanText(item.title);
  if (!title || !item.link) return null;
  const m = match(title);
  if (!m) return null;
  const s = sentiment(title, item.description);
  const ts = Date.parse(item.pubDate);
  return {
    company_name: m.company_name, symbol: m.symbol, title, summary: summarise(title, item.description),
    short_term_impact: s.short, long_term_impact: s.long, confidence: s.confidence,
    source: item.source || null, source_link: item.link, category: null,
    published_at: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
    is_visible: true, is_featured: false,
  };
}
