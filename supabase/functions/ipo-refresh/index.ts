// ipo-refresh: IPO list for the IPO page, from NSE's public IPO feeds. Runs every 10 minutes from a
// Supabase cron job and writes public.ipos.
//   current issues  -> open IPOs with total subscription
//   upcoming issues -> open + forthcoming IPOs (mainboard and SME) with lot size
//   ipo-detail      -> issue information (lead managers, registrar, face value...) and SME bids
//   active-category -> category-wise subscription (QIB / NII / retail...) for open mainboard IPOs
//   past issues     -> listing date and final issue price (last 120 days kept)
// Grey market premium (GMP) is not published by NSE; it is read from InvestorGain's live GMP page
// (one fetch per run) and shown on the site credited to InvestorGain with a link back.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const NSE = "https://www.nseindia.com/api/";
const MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
async function nse(path: string) {
  const r = await fetch(NSE + path, { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.nseindia.com/", "Accept-Language": "en-US,en;q=0.9" } });
  if (!r.ok) throw new Error(path.split("?")[0] + " HTTP " + r.status);
  return r.json();
}
// "29-Oct-2026" / "23-OCT-2026" -> "2026-10-29"
const isoDate = (s: unknown) => {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s || "").trim());
  return m && MON[m[2].toLowerCase()] ? `${m[3]}-${MON[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}` : null;
};
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d.eE+-]/g, "")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null; };
// "Rs.78 to Rs.82" -> [78, 82]
function band(s: unknown): [number | null, number | null] {
  const n = String(s || "").match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  return [n[0] ?? null, n[n.length - 1] ?? null];
}

// Category-wise subscription (times subscribed) keyed by short names.
const CATS: [string, RegExp][] = [
  ["qib", /^Qualified Institutional/i], ["nii", /^Non Institutional Investors$/i], ["bnii", /more than Ten Lakh/i],
  ["snii", /Two Lakh/i], ["retail", /^Retail Individual/i], ["employee", /^Employee/i], ["shareholder", /^Shareholder/i], ["total", /^Total$/i],
];
function subscription(rows: Record<string, unknown>[], offered?: number | null) {
  const out: Record<string, number> = {};
  for (const r of rows || []) {
    const name = String(r.category || "");
    const key = CATS.find(([, re]) => re.test(name))?.[0];
    if (!key) continue;
    let times = num(r.noOfTotalMeant ?? r.noOfTime);
    // SME rows carry shares bid and applications but no "times" figure.
    if (times === null && key === "total" && offered) { const bid = num(r.noOfshareBid ?? r.noOfsharesBid); if (bid !== null) times = bid / offered; }
    if (times !== null) out[key] = Math.round(times * 100) / 100;
    if (key === "total" && num(r.noofapplication) !== null) out.applications = num(r.noofapplication)!;
  }
  return Object.keys(out).length ? out : null;
}
function details(info: { dataList?: { title?: string | null; value?: string }[] } | undefined) {
  return (info?.dataList || [])
    .filter((d) => d.title && d.value && !/^\*?As per SEBI/i.test(String(d.value)))
    .map((d) => ({ title: String(d.title).trim(), value: String(d.value).replace(/^"+|"+$/g, "").replace(/\s+/g, " ").trim().slice(0, 700) }));
}

/* ───────── GMP from InvestorGain ─────────
   Their page embeds its table as JSON rows inside Next.js stream chunks (self.__next_f.push([1,"..."])). */
type Gmp = { name: string; gmp: number | null; pct: number | null; low: number | null; high: number | null; price: number | null; rating: number; updated: string | null; url: string | null; sme: boolean };
const IG = "https://www.investorgain.com";
const strip = (h: unknown) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/&#8377;/g, "₹").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const normName = (s: unknown) => String(s || "").toLowerCase().replace(/\b(limited|ltd|ipo)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

async function investorGainGmp(): Promise<Gmp[]> {
  const html = await (await fetch(IG + "/report/ipo-gmp-live/331/", { headers: { "User-Agent": UA, Accept: "text/html" } })).text();
  let text = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) { try { text += JSON.parse(m[1]); } catch (_) { /* skip */ } }
  const start = text.indexOf('[{"~orderby1"');
  if (start < 0) return [];
  // Walk to the matching closing bracket (string-aware) and parse the array.
  let depth = 0, inStr = false, end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "[" || c === "{") depth++; else if (c === "]" || c === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return [];
  const rows = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>[];
  return rows.filter((r) => r["~ipo_name"]).map((r) => {
    const g = strip(r.GMP);                                   // "₹58 (38.67%) 18 ↓ / 58 ↑"  or  "₹-- (0.00%)"
    const gm = /₹\s*(-?[\d.]+)/.exec(g), range = /(-?[\d.]+)\s*↓\s*\/\s*(-?[\d.]+)\s*↑/.exec(g);
    const ratingKey = Object.keys(r).find((k) => /Rating/i.test(k));
    const folder = String(r["~urlrewrite_folder_name"] || "");
    return {
      name: String(r["~ipo_name"]), gmp: gm ? Number(gm[1]) : null, pct: num(r["~gmp_percent_calc"]),
      low: range ? Number(range[1]) : null, high: range ? Number(range[2]) : null, price: num(r["Price (₹)"]),
      rating: ratingKey ? (String(r[ratingKey]).match(/&#128293;|🔥/g) || []).length : 0,
      updated: strip(r["Updated-On"]) || null, url: /^\/[\w\/-]+$/.test(folder) ? IG + folder : null,
      sme: /SME/i.test(String(r["~IPO_Category"] || "")),
    };
  });
}
function matchGmp(company: unknown, list: Gmp[]) {
  const n = normName(company);
  if (!n) return null;
  return list.find((g) => normName(g.name) === n) ||
    list.find((g) => { const k = normName(g.name); return k.length >= 6 && (n.startsWith(k) || k.startsWith(n)); }) || null;
}

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: sec } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!sec || !secret || secret !== sec.value) return json({ error: "unauthorized" }, 401);

    const [current, upcoming, past] = await Promise.all([
      nse("ipo-current-issue").catch(() => []),
      nse("all-upcoming-issues?category=ipo").catch(() => []),
      nse("public-past-issues").catch(() => []),
    ]);
    const rows = new Map<string, Record<string, unknown>>();
    const today = new Date(Date.now() + 330 * 60e3).toISOString().slice(0, 10);

    for (const x of [...(upcoming || []), ...(current || [])] as Record<string, unknown>[]) {
      const symbol = String(x.symbol || "").trim().toUpperCase();
      if (!symbol) continue;
      const [lo, hi] = band(x.priceBand || x.issuePrice);
      const prev = rows.get(symbol) || {};
      rows.set(symbol, {
        ...prev, symbol, company: x.companyName || prev.company, segment: String(x.series).toUpperCase() === "SME" ? "SME" : "Mainboard",
        status_nse: x.status || prev.status_nse, open_date: isoDate(x.issueStartDate), close_date: isoDate(x.issueEndDate),
        price_low: lo, price_high: hi, lot_size: num(x.lotSize) ?? prev.lot_size ?? null, shares_offered: num(x.issueSize) ?? prev.shares_offered ?? null,
        ...(x.noOfTime ? { subscription: { total: Math.round(Number(x.noOfTime) * 100) / 100 } } : {}),
      });
    }

    // Issue details and category-wise subscription for open, upcoming and just-closed issues.
    const live = [...rows.values()];
    for (let i = 0; i < live.length; i += 4) {
      await Promise.all(live.slice(i, i + 4).map(async (r) => {
        const series = r.segment === "SME" ? "SME" : "EQ";
        const d = await nse(`ipo-detail?symbol=${encodeURIComponent(String(r.symbol))}&series=${series}`).catch(() => null);
        if (d) {
          const info = details(d.issueInfo);
          if (info.length) r.details = info;
          const lot = info.find((x) => /^(Lot Size|Bid Lot)/i.test(x.title))?.value;
          if (!r.lot_size && lot) r.lot_size = num(lot.match(/[\d,]+/)?.[0]);
          const sub = subscription(d.bidDetails, r.shares_offered as number);
          if (sub) r.subscription = { ...(r.subscription as object || {}), ...sub };
        }
        if (series === "EQ" && r.open_date && String(r.open_date) <= today) {
          const c = await nse(`ipo-active-category?symbol=${encodeURIComponent(String(r.symbol))}`).catch(() => null);
          const sub = subscription((c?.dataList || []).slice(1));
          if (sub) r.subscription = { ...(r.subscription as object || {}), ...sub };
        }
      }));
    }

    // GMP for open, upcoming and just-closed issues (kept from the last run when InvestorGain doesn't answer).
    const gmpList = await investorGainGmp().catch((e) => { console.warn("InvestorGain unavailable:", String(e)); return [] as Gmp[]; });
    let gmpMatched = 0;
    if (gmpList.length) for (const r of rows.values()) {
      const g = matchGmp(r.company, gmpList);
      if (!g) continue;
      gmpMatched++;
      const price = (r.price_high as number) || g.price;
      r.gmp = { gmp: g.gmp, pct: g.pct, low: g.low, high: g.high, est_listing: g.gmp !== null && price ? price + g.gmp : null, rating: g.rating, updated: g.updated, url: g.url, source: "InvestorGain" };
    }

    // Listed in the last 120 days: listing date and final price (other columns are left as they were).
    const cutoff = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
    const listedBy = new Map<string, Record<string, unknown>>(); // NSE repeats some symbols
    for (const x of (past || []) as Record<string, unknown>[]) {
      const symbol = String(x.symbol || "").trim().toUpperCase(), listing = isoDate(x.listingDate);
      // Equity (EQ) and SME IPOs only; the list also carries bonds/debentures.
      const type = String(x.securityType || "").trim().toUpperCase();
      if (!symbol || !listing || listing < cutoff || listedBy.has(symbol) || !["EQ", "SME"].includes(type) || !(num(x.issuePrice)! > 0)) continue;
      // Skip migrations (an old SME company moving to the main board), which NSE lists with the old IPO dates.
      const closed = isoDate(x.ipoEndDate);
      if (closed && Date.parse(listing) - Date.parse(closed) > 30 * 864e5) continue;
      const [lo, hi] = band(x.priceRange);
      listedBy.set(symbol, {
        symbol, company: x.company || x.companyName, segment: type === "SME" ? "SME" : "Mainboard",
        status_nse: "Listed", open_date: isoDate(x.ipoStartDate), close_date: isoDate(x.ipoEndDate), listing_date: listing,
        price_low: lo, price_high: hi, issue_price: num(x.issuePrice), updated_at: new Date().toISOString(),
      });
      rows.delete(symbol);
    }
    const listed = [...listedBy.values()];

    const now = new Date().toISOString();
    const open = [...rows.values()].map((r) => ({ ...r, updated_at: now }));
    for (const batch of [open, listed]) {
      if (!batch.length) continue;
      const { error } = await supabase.from("ipos").upsert(batch, { onConflict: "symbol" });
      if (error) throw new Error("upsert: " + error.message);
    }
    const summary = { open_or_upcoming: open.length, listed: listed.length, gmp: { rows: gmpList.length, matched: gmpMatched }, sources: { current: (current || []).length, upcoming: (upcoming || []).length, past: (past || []).length } };
    console.log("IPO_REFRESH", JSON.stringify(summary));
    return json(summary);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.error("IPO_REFRESH_FATAL", msg);
    return json({ error: msg }, 500);
  }
});
