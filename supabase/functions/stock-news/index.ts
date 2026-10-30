// stock-news: recent headlines and NSE filings for one stock, for the News tab on the Home stock card.
//   GET ?symbol=POWERGRID[&name=Power Grid Corporation of India Limited]
// Headlines: Google News search (India edition, last 14 days) for the company name.
// Filings: the company's latest NSE corporate announcements (results, dividends, orders, meetings...).
// MarketPulse's own tagged news (with impact tags) is read by the page straight from the news table.
// Cached in memory for 15 minutes per symbol.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const cache = new Map<string, { at: number; body: string }>();

function reply(body: string, status = 200, maxAge = 300) {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` } });
}
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
const tag = (xml: string, name: string) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ""; };

// "Power Grid Corporation of India Limited" -> "Power Grid Corporation of India"
function shortName(name: string) {
  return name.replace(/\s+(limited|ltd\.?)$/i, "").replace(/\s+\(india\)$/i, "").trim();
}

async function googleNews(name: string, symbol: string) {
  const q = `"${shortName(name)}" OR "${symbol}" share when:14d`;
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=en-IN&gl=IN&ceid=IN:en";
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml" } });
  if (!r.ok) throw new Error("Google News " + r.status);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const seen = new Set<string>();
  return items.map((it) => {
    const source = tag(it, "source");
    let title = tag(it, "title");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const pub = tag(it, "pubDate");
    return { title, source, url: tag(it, "link"), published_at: pub ? new Date(pub).toISOString() : null };
  }).filter((x) => {
    const k = x.title.toLowerCase().replace(/\W+/g, " ").slice(0, 80);
    if (!x.title || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, 15);
}

async function nseFilings(symbol: string) {
  const r = await fetch("https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=" + encodeURIComponent(symbol), {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.nseindia.com/companies-listing/corporate-filings-announcements", "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!r.ok) throw new Error("NSE " + r.status);
  const d = await r.json();
  const list: any[] = Array.isArray(d) ? d : d?.data || [];
  return list.slice(0, 10).map((x) => {
    // an_dt like "30-Oct-2026 18:42:10" (IST)
    const m = String(x.an_dt || x.sort_date || "").match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})/);
    const mon = m ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[2]) : -1;
    const at = m && mon >= 0 ? new Date(Date.UTC(+m[3], mon, +m[1], +m[4], +m[5]) - 330 * 60e3).toISOString() : null;
    return { subject: String(x.desc || "Announcement"), detail: String(x.attchmntText || "").slice(0, 400), url: x.attchmntFile || null, published_at: at };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const u = new URL(req.url);
  const symbol = (u.searchParams.get("symbol") || "").toUpperCase().trim();
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) return reply(JSON.stringify({ error: "Bad symbol" }), 400, 0);
  const name = (u.searchParams.get("name") || symbol).replace(/[^\w &.()'-]/g, " ").slice(0, 80).trim();
  const key = symbol + "|" + name.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60e3) return reply(hit.body);
  const [h, f] = await Promise.allSettled([googleNews(name, symbol), nseFilings(symbol)]);
  const body = JSON.stringify({
    symbol, name, fetched_at: new Date().toISOString(),
    headlines: h.status === "fulfilled" ? h.value : [],
    filings: f.status === "fulfilled" ? f.value : [],
    errors: [h, f].filter((x) => x.status === "rejected").map((x: any) => String(x.reason?.message || x.reason)),
  });
  if (h.status === "fulfilled" || f.status === "fulfilled") cache.set(key, { at: Date.now(), body });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return reply(body);
});
