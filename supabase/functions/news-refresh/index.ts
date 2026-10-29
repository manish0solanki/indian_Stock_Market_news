// news-refresh: Indian market news for the MarketPulse feed (replaces the n8n news workflow).
// Reads stock-market RSS feeds, keeps items about a specific listed company, tags them with
// keyword-based sentiment and inserts new ones into `news`. Runs from a Supabase cron job.
// The matching/sentiment logic lives in ./lib.js so it can be tested outside Deno.
import { createClient } from "npm:@supabase/supabase-js@2";
import { FEEDS, parseFeed, buildMatcher, toNewsRow } from "./lib.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const MAX_AGE_MS = 48 * 3600e3;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

// Company list changes rarely; keep it for 6 hours across warm invocations.
let matcherCache: { at: number; match: ReturnType<typeof buildMatcher> } | null = null;
async function getMatcher() {
  if (matcherCache && Date.now() - matcherCache.at < 6 * 3600e3) return matcherCache.match;
  const stocks: { symbol: string; company_name: string | null }[] = [];
  const caps = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("stocks").select("symbol,company_name").order("symbol").range(from, from + 999);
    if (error) throw new Error("stocks read: " + error.message);
    stocks.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("stock_quotes").select("symbol,market_cap").order("symbol").range(from, from + 999);
    (data || []).forEach((r: { symbol: string; market_cap: number | null }) => caps.set(r.symbol, Number(r.market_cap) || 0));
    if (!data || data.length < 1000) break;
  }
  const match = buildMatcher(stocks.map((s) => ({ ...s, market_cap: caps.get(s.symbol) || 0 })));
  matcherCache = { at: Date.now(), match };
  return match;
}

async function fetchFeed(feed: { name: string; url: string }) {
  const res = await fetch(feed.url, { headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml,*/*" } });
  if (!res.ok) throw new Error(feed.name + " HTTP " + res.status);
  return parseFeed(await res.text()).map((it) => ({ ...it, source: feed.name }));
}

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: sec } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!sec || !secret || secret !== sec.value) return json({ error: "unauthorized" }, 401);
    const dryRun = new URL(req.url).searchParams.get("dry") === "1";

    const [match, ...feedResults] = await Promise.all([getMatcher(), ...FEEDS.map((f) => fetchFeed(f).catch((e) => e as Error))]);
    const perFeed: Record<string, number | string> = {};
    const items = feedResults.flatMap((r, i) => {
      if (r instanceof Error) { perFeed[FEEDS[i].name] = "error: " + r.message; return []; }
      perFeed[FEEDS[i].name] = r.length;
      return r;
    });

    const now = Date.now();
    const seen = new Set<string>();
    const rows = [];
    for (const it of items) {
      if (!it.link || seen.has(it.link)) continue;
      seen.add(it.link);
      const ts = Date.parse(it.pubDate);
      if (Number.isFinite(ts) && now - ts > MAX_AGE_MS) continue;
      const row = toNewsRow(it, match);
      if (row) rows.push(row);
    }

    // Skip links already stored (the unique index on source_link is partial, so no upsert).
    // Items are at most 48h old, so the last 4 days of links cover every possible duplicate.
    const { data: recent, error: recentErr } = await supabase.from("news").select("source_link")
      .gte("created_at", new Date(now - 4 * 864e5).toISOString()).not("source_link", "is", null).limit(5000);
    if (recentErr) throw new Error("news read: " + recentErr.message);
    const have = new Set((recent || []).map((d: { source_link: string }) => d.source_link));
    const fresh = rows.filter((r) => !have.has(r.source_link));

    let inserted = 0;
    if (!dryRun && fresh.length) {
      const { error } = await supabase.from("news").insert(fresh);
      if (!error) inserted = fresh.length;
      else {
        // A parallel writer may have stored one of these links; insert one by one.
        for (const r of fresh) { const { error: e } = await supabase.from("news").insert(r); if (!e) inserted++; }
      }
    }

    const summary = {
      dry_run: dryRun, feeds: perFeed, items: items.length, company_items: rows.length, new: fresh.length, inserted,
      sample: fresh.slice(0, 8).map((r) => `${r.symbol} [${r.short_term_impact}] ${r.title}`),
    };
    console.log("NEWS_REFRESH", JSON.stringify({ ...summary, sample: undefined }));
    return json(summary);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.error("NEWS_REFRESH_FATAL", msg);
    return json({ error: msg }, 500);
  }
});
