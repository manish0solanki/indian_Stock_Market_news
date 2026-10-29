// Turns market data into post definitions: title, slug, key numbers, tables and the
// facts handed to the AI writer (plus a plain-language fallback if AI isn't available).
// Pure functions: no network or file access, so they can be tested with fixture data.

/* ───────── formatting ───────── */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sept", "oct", "nov", "dec"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const n = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
export const fmt = (v, d = 2) => Number.isFinite(v) ? v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
export const pct = (v, d = 2) => Number.isFinite(v) ? (v >= 0 ? "+" : "") + v.toFixed(d) + "%" : "—";
const ab = (v, d = 2) => Number.isFinite(v) ? Math.abs(v).toFixed(d) + "%" : "—";
export const signed = (v, d = 2) => Number.isFinite(v) ? (v >= 0 ? "+" : "−") + fmt(Math.abs(v), d) : "—";
const crore = (v) => !Number.isFinite(v) ? "—" : v >= 1e12 ? "₹" + fmt(v / 1e12, 2) + " lakh Cr" : "₹" + fmt(v / 1e7, 0) + " Cr";
const tone = (v) => (Number.isFinite(v) ? (v > 0 ? "up" : v < 0 ? "down" : "") : "");
export const slugify = (s) => String(s).toLowerCase().replace(/₹/g, "").replace(/%/g, " percent").replace(/&/g, " and ")
  .replace(/(\d)\.(\d)/g, "$1-$2").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 110).replace(/-+$/, "");
export const cleanCompany = (name) => String(name || "").replace(/\s+/g, " ").replace(/[\s,]*\b(limited|ltd\.?)\s*$/i, "").trim();

// IST calendar helpers (GitHub runners use UTC).
export function istParts(date = new Date()) {
  const t = new Date(date.getTime() + 330 * 60e3);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), dow: t.getUTCDay(), iso: t.toISOString().slice(0, 10) };
}
export const istIso = (date) => istParts(date).iso;
const longDate = (p) => `${p.d} ${MON[p.m]} ${p.y}`;
const slugDate = (p) => `${p.d}-${MONTHS[p.m]}-${p.y}`;
const words = (k) => ["", "", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][k] || `${k}th`;

function streak(rows, key) {
  const last = n(rows[rows.length - 1]?.[key]);
  let k = 0;
  for (let i = rows.length - 1; i >= 0; i--) { const v = n(rows[i][key]); if (Number.isFinite(v) && Math.sign(v) === Math.sign(last) && v !== 0) k++; else break; }
  return { sign: Math.sign(last), days: k };
}
const nameOf = (stocks) => { const m = new Map(stocks.map((s) => [s.symbol, s])); return (sym) => cleanCompany(m.get(sym)?.company_name) || sym; };
const sane = (q) => n(q.price) > 0 && Number.isFinite(n(q.change_percent)) && Math.abs(n(q.change_percent)) <= 25;
const moverRows = (list, name) => list.map((q) => [{ html: `<a href="/stock-analysis.html?symbol=${encodeURIComponent(q.symbol)}">${q.symbol}</a>`, sub: name(q.symbol) }, "₹" + fmt(n(q.price)), { text: pct(n(q.change_percent)), tone: tone(n(q.change_percent)) }]);
function moodOf(p) { return p > 0.5 ? "Bullish" : p > 0.05 ? "Mildly Bullish" : p < -0.5 ? "Bearish" : p < -0.05 ? "Mildly Bearish" : "Neutral"; }

/* ───────── Daily wrap ───────── */
export function buildDailyWrap(data, now = new Date()) {
  const p = istParts(now), name = nameOf(data.stocks);
  const idx = Object.fromEntries((data.snapshot || []).map((x) => [x.symbol, x]));
  const nifty = idx["^NSEI"];
  if (!nifty) throw new Error("NIFTY 50 quote missing");
  const nPct = n(nifty.change_percent), nChg = n(nifty.change);
  const n50 = data.nifty50.filter(sane).sort((a, b) => n(b.change_percent) - n(a.change_percent));
  const adv = n50.filter((q) => n(q.change_percent) > 0).length, dec = n50.filter((q) => n(q.change_percent) < 0).length;
  const sectors = (data.sectors || []).filter((s) => Number.isFinite(n(s.change_percent)))
    .map((s) => ({ name: (s.display_name || s.name).replace(/^Nifty /i, ""), chg: n(s.change_percent) })).sort((a, b) => b.chg - a.chg);
  const best = sectors[0], worst = sectors[sectors.length - 1];
  const gainers = n50.slice(0, 5), losers = n50.slice(-5).reverse();
  const verb = Math.abs(nPct) < 0.05 ? "Ends Flat" : nPct > 0 ? `Gains ${Math.abs(nPct).toFixed(2)}%` : `Drops ${Math.abs(nPct).toFixed(2)}%`;
  const title = `Nifty 50 Daily Wrap — ${longDate(p)}: ${verb}`;
  const b = data.breadth || {};
  const others = [["^NSEBANK", "Nifty Bank"], ["^BSESN", "Sensex"], ["^NSEMDCP50", "Nifty Midcap 50"], ["NIFTY_FIN_SERVICE.NS", "Nifty Fin Service"]]
    .filter(([s]) => idx[s]).map(([s, label]) => ({ label, price: n(idx[s].price), pct: n(idx[s].change_percent) }));

  const facts = {
    date: longDate(p), nifty50: { close: n(nifty.price), change_points: nChg, change_percent: nPct },
    other_indices: others.map((o) => ({ index: o.label, close: o.price, change_percent: o.pct })),
    nifty50_breadth: { advances: adv, declines: dec },
    all_nse_breadth: { advances: n(b.advances), declines: n(b.declines), unchanged: n(b.unchanged) },
    sectors: sectors.map((s) => ({ sector: s.name, change_percent: +s.chg.toFixed(2) })),
    top_gainers: gainers.map((q) => ({ symbol: q.symbol, company: name(q.symbol), price: n(q.price), change_percent: +n(q.change_percent).toFixed(2) })),
    top_losers: losers.map((q) => ({ symbol: q.symbol, company: name(q.symbol), price: n(q.price), change_percent: +n(q.change_percent).toFixed(2) })),
  };
  const summary = `Nifty 50 ${nChg >= 0 ? "rose" : "fell"} ${fmt(Math.abs(nChg))} points (${ab(nPct)}) to close at ${fmt(n(nifty.price))}, with ${adv} of 50 constituents advancing and ${dec} declining.` +
    (best && worst ? ` ${best.name} was the strongest sector (${pct(best.chg)}) and ${worst.name} the weakest (${pct(worst.chg)}).` : "");
  const fallback = [
    summary,
    gainers[0] && losers[0] ? `Among Nifty 50 stocks, ${name(gainers[0].symbol)} led the gainers (${pct(n(gainers[0].change_percent))}), while ${name(losers[0].symbol)} was the biggest drag (${pct(n(losers[0].change_percent))}).` : "",
    Number.isFinite(n(b.advances)) ? `Across all NSE stocks tracked, ${fmt(n(b.advances), 0)} advanced and ${fmt(n(b.declines), 0)} declined.` : "",
  ].filter(Boolean);

  return {
    category: "daily-wrap", categoryLabel: "Daily Wrap", emoji: "📈", title, slug: `nifty-50-daily-wrap-${slugDate(p)}`,
    mood: moodOf(nPct), tags: ["Nifty 50", "Market Wrap", "Sensex", "Bank Nifty", moodOf(nPct)], dataSources: ["nse-market-data"],
    summary, facts, fallback,
    aiTask: "Write the market wrap for today's Indian stock market close: what the Nifty did, how broad the move was, which sectors and stocks led or lagged, and what that suggests about market mood.",
    sections: [
      { type: "kpis", heading: "📊 Key Numbers", items: [
        { label: "Nifty 50", value: fmt(n(nifty.price)), sub: pct(nPct), tone: tone(nPct) },
        ...others.slice(0, 2).map((o) => ({ label: o.label, value: fmt(o.price), sub: pct(o.pct), tone: tone(o.pct) })),
        { label: "Nifty 50 breadth", value: `${adv} ▲ / ${dec} ▼`, sub: "advances / declines", tone: adv > dec ? "up" : adv < dec ? "down" : "" },
        ...(best ? [{ label: "Best sector", value: best.name, sub: pct(best.chg), tone: tone(best.chg) }] : []),
        ...(worst ? [{ label: "Worst sector", value: worst.name, sub: pct(worst.chg), tone: tone(worst.chg) }] : []),
      ] },
      { type: "ai", heading: "📝 Market Wrap" },
      { type: "table", heading: "📈 Sector Performance", columns: ["Sector", "Change"], align: ["l", "r"], rows: sectors.map((s) => [s.name, { text: pct(s.chg), tone: tone(s.chg) }]) },
      { type: "table", heading: "🚀 Top Gainers (Nifty 50)", columns: ["Stock", "LTP", "Change"], align: ["l", "r", "r"], rows: moverRows(gainers, name) },
      { type: "table", heading: "📉 Top Losers (Nifty 50)", columns: ["Stock", "LTP", "Change"], align: ["l", "r", "r"], rows: moverRows(losers, name) },
      ...(Number.isFinite(n(b.advances)) ? [{ type: "kpis", heading: "🎯 Broader Market Breadth (all NSE stocks)", items: [
        { label: "Advances", value: fmt(n(b.advances), 0), tone: "up" }, { label: "Declines", value: fmt(n(b.declines), 0), tone: "down" },
        { label: "Unchanged", value: fmt(n(b.unchanged), 0) },
        { label: "A/D ratio", value: n(b.declines) > 0 ? (n(b.advances) / n(b.declines)).toFixed(2) : "—", tone: n(b.advances) >= n(b.declines) ? "up" : "down" },
      ] }] : []),
    ],
  };
}

/* ───────── Sector analysis ───────── */
// Sector indices mapped to the industry names in the `stocks` table.
export const SECTOR_MAP = {
  "NIFTY PHARMA": /^(Pharmaceuticals|Biotechnology)$/,
  "NIFTY IT": /Computers - Software|IT Enabled Services|Software Products|Business Process Outsourcing/,
  "NIFTY AUTO": /Auto Components|Passenger Cars|2\/3 Wheelers|Commercial Vehicles|Tyres|Tractors/,
  "NIFTY FMCG": /Diversified FMCG|Packaged Foods|Personal Care|Tea & Coffee|Household Products|Edible Oil|Dairy|Cigarettes|Breweries|Other Food Products|Other Beverages/,
  "NIFTY METAL": /Iron & Steel|Aluminium|Copper|Zinc|Diversified Metals|Ferro|Sponge Iron|Pig Iron|Precious Metals|Industrial Minerals|Trading - Metals/,
  "NIFTY REALTY": /Residential, Commercial Projects|Real Estate related services/,
  "NIFTY ENERGY": /Refineries|Oil Exploration|Power Generation|Integrated Power|Power - Transmission|Power Distribution|Gas Transmission|LPG\/CNG|^Coal$|Petrochemicals/,
  "NIFTY MEDIA": /TV Broadcasting|Media & Entertainment|Film Production|Print Media|Electronic Media|Digital Entertainment|Advertising|Printing & Publication|Web based media/,
  "NIFTY PSU BANK": /^Public Sector Bank$/,
  "NIFTY PRIVATE BANK": /^Private Sector Bank$/,
  "NIFTY HEALTHCARE": /Pharmaceuticals|Hospital|Healthcare|Medical Equipment|Biotechnology|Pharmacy Retail/,
  "NIFTY CONSUMER DURABLES": /Consumer Electronics|Household Appliances|Gems, Jewellery|Footwear|Plywood|Ceramics|Sanitary|Cables - Electricals/,
  "NIFTY OIL & GAS": /Refineries|Oil Exploration|Gas Transmission|LPG\/CNG|Oil Equipment|Oil Storage|Lubricants/,
};

// Biggest mover among mappable sector indices; avoid repeating yesterday's sector unless it clearly dominates.
export function pickSector(sectors, recentSectorSlugs = []) {
  const c = (sectors || []).filter((s) => SECTOR_MAP[s.name] && Number.isFinite(n(s.change_percent)))
    .sort((a, b) => Math.abs(n(b.change_percent)) - Math.abs(n(a.change_percent)));
  if (!c.length) return null;
  const recent = (s) => recentSectorSlugs.some((slug) => slug.startsWith(slugify(s.name)));
  if (recent(c[0]) && c[1] && Math.abs(n(c[1].change_percent)) >= 0.7 * Math.abs(n(c[0].change_percent))) return c[1];
  return c[0];
}

export function buildSector(data, sector, quotes, now = new Date()) {
  const p = istParts(now), name = nameOf(data.stocks);
  const label = sector.display_name || sector.name.replace(/^NIFTY/, "Nifty");
  const short = label.replace(/^Nifty /i, "");
  const chg = n(sector.change_percent), pts = n(sector.change), level = n(sector.price);
  const qs = quotes.filter(sane);
  if (qs.length < 8) throw new Error(`Only ${qs.length} priced stocks for ${label}`);
  const adv = qs.filter((q) => n(q.change_percent) > 0).length, dec = qs.filter((q) => n(q.change_percent) < 0).length, unch = qs.length - adv - dec;
  const byCap = qs.slice().sort((a, b) => (n(b.market_cap) || 0) - (n(a.market_cap) || 0));
  const avg = (l) => l.length ? l.reduce((s, q) => s + n(q.change_percent), 0) / l.length : NaN;
  const top10 = byCap.slice(0, 10), rest = byCap.slice(10);
  const capSum = qs.reduce((s, q) => s + (n(q.market_cap) || 0), 0);
  const weighted = capSum ? qs.reduce((s, q) => s + n(q.change_percent) * (n(q.market_cap) || 0), 0) / capSum : NaN;
  const sorted = qs.map((q) => n(q.change_percent)).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  const breadthScore = (adv - dec) / qs.length * 100;
  const byChg = qs.slice().sort((a, b) => n(b.change_percent) - n(a.change_percent));
  const gainers = byChg.slice(0, 5), losers = byChg.slice(-5).reverse();
  const verb = chg >= 3 ? "Surges" : chg >= 1.5 ? "Jumps" : chg > 0 ? "Gains" : chg <= -3 ? "Slumps" : chg <= -1.5 ? "Falls" : "Slips";
  const advShare = (chg >= 0 ? adv : dec) / qs.length;
  const lead = n(avg(top10)) - n(avg(rest));
  const why = advShare >= 0.6 ? `as ${chg >= 0 ? adv : dec} of ${qs.length} Stocks ${chg >= 0 ? "Advance" : "Decline"}`
    : (chg >= 0 ? lead > 0.5 : lead < -0.5) ? `as Large Caps Lead the ${chg >= 0 ? "Rally" : "Decline"}`
    : chg >= 0 ? "on Broad-Based Strength" : "on Broad-Based Selling";
  const title = `${label} ${verb} ${Math.abs(chg).toFixed(2)}% ${why}`;
  const facts = {
    date: longDate(p), sector_index: label, close: level, change_percent: +chg.toFixed(2), change_points: +pts.toFixed(2), previous_close: n(sector.previous_close),
    stock_universe: { stocks: qs.length, advancing: adv, declining: dec, unchanged: unch, breadth_score: +breadthScore.toFixed(1) },
    top10_by_market_cap_avg_change: +avg(top10).toFixed(2), smaller_stocks_avg_change: +avg(rest).toFixed(2),
    market_cap_weighted_change: +weighted.toFixed(2), median_change: +median.toFixed(2),
    top_gainers: gainers.map((q) => ({ company: name(q.symbol), symbol: q.symbol, change_percent: +n(q.change_percent).toFixed(2) })),
    top_losers: losers.map((q) => ({ company: name(q.symbol), symbol: q.symbol, change_percent: +n(q.change_percent).toFixed(2) })),
    note: "The stock universe is all NSE-listed companies in this industry group, not only the official index constituents.",
  };
  const summary = `${label} ${chg >= 0 ? "rose" : "fell"} ${ab(chg)} (${fmt(Math.abs(pts))} points) to ${fmt(level)}. Across ${qs.length} listed ${short} stocks, ${adv} advanced and ${dec} declined.`;
  return {
    category: "sector-analysis", categoryLabel: "Sector Analysis", emoji: "📊", title, slug: slugify(title),
    mood: chg >= 0 ? "Bullish" : "Bearish", tags: [label, "Sector Analysis", short, "Market Breadth"], dataSources: ["nse-sector-indices", "nse-market-data"],
    summary, facts,
    fallback: [summary,
      `The ten largest companies averaged ${pct(avg(top10))} against ${pct(avg(rest))} for smaller stocks, with a market-cap-weighted change of ${pct(weighted)}.`,
      `${name(gainers[0].symbol)} led the gainers (${pct(n(gainers[0].change_percent))}), while ${name(losers[0].symbol)} fell the most (${pct(n(losers[0].change_percent))}).`],
    aiTask: `Analyse today's move in the ${label} index: how broad it was, whether large caps or smaller stocks led, and which stocks stood out. Do not speculate about causes that are not in the data.`,
    sections: [
      { type: "kpis", heading: "📊 Key Numbers", items: [
        { label: label, value: fmt(level), sub: pct(chg), tone: tone(chg) },
        { label: "Advancing", value: String(adv), sub: (adv / qs.length * 100).toFixed(1) + "% of stocks", tone: "up" },
        { label: "Declining", value: String(dec), sub: (dec / qs.length * 100).toFixed(1) + "% of stocks", tone: "down" },
        { label: "Breadth score", value: breadthScore.toFixed(1), sub: breadthScore >= 0 ? "Positive" : "Negative", tone: tone(breadthScore) },
      ] },
      { type: "ai", heading: "🎯 What Happened" },
      { type: "kpis", heading: "🏢 Large Caps vs Smaller Stocks", items: [
        { label: "Top 10 by market cap", value: pct(avg(top10)), sub: "average change", tone: tone(avg(top10)) },
        { label: "Smaller stocks", value: pct(avg(rest)), sub: "average change", tone: tone(avg(rest)) },
        { label: "Cap-weighted", value: pct(weighted), sub: "whole universe", tone: tone(weighted) },
        { label: "Median stock", value: pct(median), sub: "whole universe", tone: tone(median) },
      ] },
      { type: "table", heading: "🚀 Top Gainers", columns: ["Stock", "LTP", "Change"], align: ["l", "r", "r"], rows: moverRows(gainers, name) },
      { type: "table", heading: "📉 Top Losers", columns: ["Stock", "LTP", "Change"], align: ["l", "r", "r"], rows: moverRows(losers, name) },
      { type: "note", text: `Stock universe: all ${qs.length} NSE-listed ${short} companies with a price today, not only the official index constituents.` },
    ],
  };
}

/* ───────── Stock spotlight ───────── */
export function pickSpotlight(large, recentSymbols = []) {
  const skip = new Set(recentSymbols);
  const c = (large || []).filter(sane).map((q) => ({ q, ratio: n(q.volume) / n(q.avg_volume_3m), chg: n(q.change_percent) }))
    .filter((x) => Number.isFinite(x.ratio) && x.ratio >= 1.8 && Math.abs(x.chg) >= 2.5 && Math.abs(x.chg) <= 20 && !skip.has(x.q.symbol))
    .sort((a, b) => Math.abs(b.chg) * Math.min(b.ratio, 6) - Math.abs(a.chg) * Math.min(a.ratio, 6));
  return c[0] || null;
}

export function buildSpotlight(data, pick, news, now = new Date()) {
  const p = istParts(now), q = pick.q, sym = q.symbol;
  const stock = data.stocks.find((s) => s.symbol === sym) || {};
  const company = cleanCompany(stock.company_name) || sym;
  const price = n(q.price), prev = n(q.previous_close), chg = n(q.change_percent), ratio = pick.ratio;
  const d50 = n(q.fifty_day_avg), d200 = n(q.two_hundred_day_avg), hi = n(q.high_52w), lo = n(q.low_52w);
  const crossed50 = Number.isFinite(d50) && prev < d50 && price > d50 ? "Reclaims 50-Day Average" : Number.isFinite(d50) && prev > d50 && price < d50 ? "Slips Below 50-Day Average" : "";
  const nearHigh = Number.isFinite(hi) && price >= hi * 0.98 ? "Nears 52-Week High" : Number.isFinite(lo) && price <= lo * 1.02 ? "Nears 52-Week Low" : "";
  const verb = chg >= 5 ? "Surges" : chg > 0 ? "Rises" : chg <= -5 ? "Slumps" : "Falls";
  const title = `${company} ${verb} ${Math.abs(chg).toFixed(1)}% on ${ratio.toFixed(1)}x Volume${crossed50 || nearHigh ? ", " + (crossed50 || nearHigh) : ""}`;
  const rangePos = hi > lo ? (price - lo) / (hi - lo) * 100 : NaN;
  const facts = {
    date: longDate(p), company, symbol: sym, sector: stock.sector || null, close: price, previous_close: prev, change_percent: +chg.toFixed(2),
    volume: n(q.volume), average_volume_3m: n(q.avg_volume_3m), volume_multiple: +ratio.toFixed(1),
    fifty_day_average: d50, two_hundred_day_average: d200, high_52w: hi, low_52w: lo,
    position_in_52w_range_percent: Number.isFinite(rangePos) ? +rangePos.toFixed(0) : null, market_cap_crore: Number.isFinite(n(q.market_cap)) ? Math.round(n(q.market_cap) / 1e7) : null,
    recent_headlines: (news || []).map((x) => x.title),
  };
  const summary = `${company} (${sym}) ${chg >= 0 ? "rose" : "fell"} ${ab(chg)} to ₹${fmt(price)} on volume ${ratio.toFixed(1)} times its three-month average.`;
  return {
    category: "stock-spotlight", categoryLabel: "Stock Spotlight", emoji: "🔎", title,
    slug: `${slugify(sym)}-stock-spotlight-${slugDate(p)}`, symbol: sym,
    mood: chg >= 0 ? "Bullish" : "Bearish", tags: ["Stock Spotlight", sym, company], dataSources: ["nse-market-data", "news"],
    summary, facts,
    fallback: [summary,
      Number.isFinite(d50) ? `The stock closed ${price >= d50 ? "above" : "below"} its 50-day average of ₹${fmt(d50)}${Number.isFinite(d200) ? ` and ${price >= d200 ? "above" : "below"} its 200-day average of ₹${fmt(d200)}` : ""}.` : "",
      Number.isFinite(rangePos) ? `It now trades at ${rangePos.toFixed(0)}% of its 52-week range (₹${fmt(lo)} – ₹${fmt(hi)}).` : ""].filter(Boolean),
    aiTask: `Explain today's unusual move in ${company} (${sym}): the price change, the volume spike, where the stock sits against its moving averages and 52-week range, and any relevant recent headlines provided. Do not invent reasons that aren't in the data.`,
    sections: [
      { type: "kpis", heading: "📊 Key Numbers", items: [
        { label: "Close", value: "₹" + fmt(price), sub: pct(chg), tone: tone(chg) },
        { label: "Volume vs 3M avg", value: ratio.toFixed(1) + "×", sub: fmt(n(q.volume), 0) + " shares", tone: "up" },
        { label: "50-day average", value: Number.isFinite(d50) ? "₹" + fmt(d50) : "—", sub: Number.isFinite(d50) ? (price >= d50 ? "Price above" : "Price below") : "", tone: price >= d50 ? "up" : "down" },
        { label: "200-day average", value: Number.isFinite(d200) ? "₹" + fmt(d200) : "—", sub: Number.isFinite(d200) ? (price >= d200 ? "Price above" : "Price below") : "", tone: price >= d200 ? "up" : "down" },
        { label: "52-week range", value: Number.isFinite(rangePos) ? rangePos.toFixed(0) + "%" : "—", sub: `₹${fmt(lo)} – ₹${fmt(hi)}` },
        { label: "Market cap", value: crore(n(q.market_cap)), sub: stock.sector || "" },
      ] },
      { type: "ai", heading: "🔎 The Move" },
      ...(news && news.length ? [{ type: "list", heading: "📰 Recent Headlines", items: news.map((x) => x.title) }] : []),
      { type: "cta", text: `Full chart, indicators and levels for ${sym}`, href: `/stock-analysis.html?symbol=${encodeURIComponent(sym)}` },
    ],
  };
}

/* ───────── FII / DII flows ───────── */
export function buildFiiDii(data, now = new Date()) {
  const hist = (data.fii || []).filter((r) => r.trade_date).sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
  const last = hist[hist.length - 1], prev = hist[hist.length - 2];
  if (!last) throw new Error("No FII/DII data");
  const p = istParts(new Date(last.trade_date + "T12:00:00+05:30"));
  const fii = n(last.fii_net), dii = n(last.dii_net), fs = streak(hist, "fii_net"), ds = streak(hist, "dii_net");
  const cr = (v) => "₹" + fmt(Math.abs(v)) + " Cr";
  const fiiPart = fii >= 0
    ? (n(prev?.fii_net) < 0 ? `FIIs Return to Net Buying with ${cr(fii)} Inflow` : `FII Buying Extends to ${fs.days} Sessions with ${cr(fii)} Inflow`)
    : (n(prev?.fii_net) > 0 ? `FII Selling Resumes with ${cr(fii)} Outflow` : `FII Selling Extends to ${fs.days} Sessions at ${cr(fii)}`);
  const diiPart = dii >= 0
    ? (ds.days > 1 ? `DII Buying Extends to ${words(ds.days) ? words(ds.days).replace(/^./, (c) => c.toUpperCase()) + " Straight Session" : ds.days + " Sessions"}` : "DIIs Turn Buyers")
    : (ds.days > 1 ? `DII Selling Extends to ${ds.days} Sessions` : "DIIs Turn Sellers");
  const title = `${fiiPart} as ${diiPart}`;
  const nifty = (data.snapshot || []).find((x) => x.symbol === "^NSEI");
  const niftyToday = nifty && istIso(new Date(nifty.updated_at)) >= last.trade_date ? nifty : null;
  const last5 = hist.slice(-5), sum = (k) => last5.reduce((s, r) => s + n(r[k]), 0);
  const facts = {
    date: longDate(p), fii: { buy: n(last.fii_buy), sell: n(last.fii_sell), net: fii, streak_days: fs.days, streak_direction: fs.sign >= 0 ? "buying" : "selling" },
    dii: { buy: n(last.dii_buy), sell: n(last.dii_sell), net: dii, streak_days: ds.days, streak_direction: ds.sign >= 0 ? "buying" : "selling" },
    combined_net: +(fii + dii).toFixed(2), previous_session: prev ? { date: prev.date, fii_net: n(prev.fii_net), dii_net: n(prev.dii_net) } : null,
    last_5_sessions: { fii_net_total: +sum("fii_net").toFixed(2), dii_net_total: +sum("dii_net").toFixed(2) },
    nifty50: niftyToday ? { close: n(niftyToday.price), change_percent: n(niftyToday.change_percent) } : null,
    units: "₹ crore, NSE provisional cash-market data",
  };
  const summary = `FIIs were net ${fii >= 0 ? "buyers" : "sellers"} of ${cr(fii)} and DIIs net ${dii >= 0 ? "buyers" : "sellers"} of ${cr(dii)} on ${longDate(p)}, a combined net ${fii + dii >= 0 ? "inflow" : "outflow"} of ${cr(fii + dii)}.`;
  return {
    category: "fiidii-flows", categoryLabel: "FII / DII Flows", emoji: "🏦", title, slug: slugify(title), tradeDate: last.trade_date,
    mood: fii + dii >= 0 ? "Bullish" : "Bearish", tags: ["FII", "DII", "Institutional Flows", "Nifty 50", "Indian Stock Market"], dataSources: ["nse-fii-dii-provisional"],
    summary, facts,
    fallback: [summary,
      `FII ${fs.sign >= 0 ? "buying" : "selling"} has now run for ${fs.days} session${fs.days > 1 ? "s" : ""}, and DII ${ds.sign >= 0 ? "buying" : "selling"} for ${ds.days}.`,
      `Over the last five sessions FIIs were net ${sum("fii_net") >= 0 ? "buyers" : "sellers"} of ${cr(sum("fii_net"))} and DIIs net ${sum("dii_net") >= 0 ? "buyers" : "sellers"} of ${cr(sum("dii_net"))}.`],
    aiTask: "Explain today's foreign (FII) and domestic (DII) institutional cash-market flows: direction, size versus recent sessions, streaks, and how the Nifty moved if given.",
    sections: [
      { type: "kpis", heading: "📊 Key Numbers", items: [
        { label: "FII net", value: signed(fii) + " Cr", sub: `Buy ${fmt(n(last.fii_buy))} · Sell ${fmt(n(last.fii_sell))}`, tone: tone(fii) },
        { label: "DII net", value: signed(dii) + " Cr", sub: `Buy ${fmt(n(last.dii_buy))} · Sell ${fmt(n(last.dii_sell))}`, tone: tone(dii) },
        { label: "Combined", value: signed(fii + dii) + " Cr", sub: fii + dii >= 0 ? "Net inflow" : "Net outflow", tone: tone(fii + dii) },
        ...(niftyToday ? [{ label: "Nifty 50", value: fmt(n(niftyToday.price)), sub: pct(n(niftyToday.change_percent)), tone: tone(n(niftyToday.change_percent)) }] : []),
      ] },
      { type: "ai", heading: "🏦 Flow Analysis" },
      { type: "table", heading: "📅 Last 10 Sessions (₹ Cr)", columns: ["Date", "FII net", "DII net", "Combined"], align: ["l", "r", "r", "r"],
        rows: hist.slice(-10).reverse().map((r) => [r.date || r.trade_date, { text: signed(n(r.fii_net)), tone: tone(n(r.fii_net)) }, { text: signed(n(r.dii_net)), tone: tone(n(r.dii_net)) }, { text: signed(n(r.fii_net) + n(r.dii_net)), tone: tone(n(r.fii_net) + n(r.dii_net)) }]) },
      { type: "note", text: "Source: NSE provisional FII/FPI and DII cash-market data. Figures can be revised." },
    ],
  };
}
