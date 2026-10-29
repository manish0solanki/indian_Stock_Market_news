// mf-data: mutual fund search and NAVs for the Portfolio page, from mfapi.in (AMFI data).
// mfapi.in sends no CORS headers, so the browser calls this function instead.
//   ?q=parag flexi        -> up to 25 matching schemes [{code, name}]
//   ?codes=122639,120503  -> latest NAV, previous NAV and fund details per scheme (max 40)
//   ?code=122639&date=2026-10-15 -> NAV on that date, or the last NAV before it
//   ?isins=INF879O01027,...  -> scheme code and name per ISIN (max 100), from AMFI's daily NAV file;
//                               used when importing a CAS statement, which lists funds by ISIN
// If mfapi.in can't give a scheme's NAV, AMFI's file supplies the latest NAV (without the previous day's).
// Responses are cached in memory for 15 minutes (NAVs change once a day).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const API = "https://api.mfapi.in/mf";
const CACHE_MS = 15 * 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": status === 200 ? "public, max-age=300" : "no-store" },
  });
}

async function getJson(url: string) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("mfapi HTTP " + res.status);
  const data = await res.json();
  if (cache.size > 500) cache.clear();
  cache.set(url, { at: Date.now(), data });
  return data;
}

// mfapi dates are dd-mm-yyyy.
const toIso = (d: string) => { const [dd, mm, yy] = String(d).split("-"); return `${yy}-${mm}-${dd}`; };
const shift = (iso: string, days: number) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);
const todayIso = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

type Nav = { date: string; nav: number };
const navs = (d: { data?: { date: string; nav: string }[] }): Nav[] =>
  (d?.data || []).map((x) => ({ date: toIso(x.date), nav: Number(x.nav) })).filter((x) => x.nav > 0);

async function latest(code: string) {
  const end = todayIso();
  const d = await getJson(`${API}/${code}?startDate=${shift(end, -20)}&endDate=${end}`) as { meta?: Record<string, unknown>; data?: { date: string; nav: string }[] };
  const list = navs(d).sort((a, b) => b.date.localeCompare(a.date));
  const m = d?.meta || {};
  return {
    code,
    name: m.scheme_name || null,
    fund_house: m.fund_house || null,
    category: m.scheme_category || null,
    nav: list[0]?.nav ?? null,
    nav_date: list[0]?.date ?? null,
    prev_nav: list[1]?.nav ?? null,
    prev_date: list[1]?.date ?? null,
  };
}

// AMFI NAVAll.txt: "Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;NAV;Date"
// One file with every scheme's latest NAV: maps ISINs to scheme codes, and backs up mfapi.in.
type AmfiRow = { code: string; name: string; nav: number | null; date: string | null };
let amfi: { at: number; byIsin: Map<string, AmfiRow>; byCode: Map<string, AmfiRow> } | null = null;
async function getAmfi() {
  if (amfi && Date.now() - amfi.at < 6 * 3600e3) return amfi;
  const res = await fetch("https://www.amfiindia.com/spages/NAVAll.txt");
  if (!res.ok) throw new Error("AMFI HTTP " + res.status);
  const byIsin = new Map<string, AmfiRow>(), byCode = new Map<string, AmfiRow>();
  const MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  for (const line of (await res.text()).split(/\r?\n/)) {
    const f = line.split(";");
    if (f.length < 6 || !/^\d+$/.test(f[0].trim())) continue;
    const d = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(f[5].trim());
    const nav = Number(f[4]);
    const v = { code: f[0].trim(), name: f[3].trim(), nav: nav > 0 ? nav : null, date: d ? `${d[3]}-${MON[d[2].toLowerCase()]}-${d[1]}` : null };
    byCode.set(v.code, v);
    for (const isin of [f[1], f[2]]) if (/^IN[A-Z0-9]{10}$/.test(isin.trim())) byIsin.set(isin.trim(), v);
  }
  if (byCode.size) amfi = { at: Date.now(), byIsin, byCode };
  return { byIsin, byCode };
}

// mfapi.in is called a few schemes at a time, with one retry, so a burst doesn't get throttled.
async function latestAll(codes: string[]) {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < codes.length; i += 4) {
    out.push(...await Promise.all(codes.slice(i, i + 4).map((c) =>
      latest(c).catch(() => latest(c)).catch(() => ({ code: c, nav: null } as Record<string, unknown>)))));
  }
  const missing = out.filter((f) => !f.nav);
  if (missing.length) {
    const { byCode } = await getAmfi().catch(() => ({ byCode: new Map<string, AmfiRow>() }));
    for (const f of missing) {
      const a = byCode.get(String(f.code));
      if (a?.nav) Object.assign(f, { name: f.name || a.name, nav: a.nav, nav_date: a.date, prev_nav: null, prev_date: null, source: "amfi" });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const p = new URL(req.url).searchParams;
  try {
    const q = (p.get("q") || "").trim();
    if (q) {
      if (q.length < 2 || q.length > 80) return json({ error: "query must be 2-80 characters" }, 400);
      const d = await getJson(`${API}/search?q=${encodeURIComponent(q)}`) as { schemeCode: number; schemeName: string }[];
      // Prefer growth options and direct plans, the usual choice for investors.
      const rank = (n: string) => (/growth/i.test(n) ? 0 : 2) + (/direct/i.test(n) ? 0 : 1);
      const out = (Array.isArray(d) ? d : []).map((x) => ({ code: String(x.schemeCode), name: x.schemeName }))
        .sort((a, b) => rank(a.name) - rank(b.name)).slice(0, 25);
      return json({ success: true, results: out });
    }

    const codes = (p.get("codes") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (codes.length) {
      if (codes.length > 40 || codes.some((c) => !/^\d{3,8}$/.test(c))) return json({ error: "codes must be up to 40 numeric scheme codes" }, 400);
      const funds = await latestAll([...new Set(codes)]);
      return json({ success: true, funds });
    }

    const isins = (p.get("isins") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (isins.length) {
      if (isins.length > 100 || isins.some((i) => !/^IN[A-Z0-9]{10}$/.test(i))) return json({ error: "isins must be up to 100 valid ISINs" }, 400);
      const { byIsin } = await getAmfi();
      return json({ success: true, schemes: Object.fromEntries(isins.map((i) => { const v = byIsin.get(i); return [i, v ? { code: v.code, name: v.name } : null]; })) });
    }

    const code = p.get("code") || "", date = p.get("date") || "";
    if (/^\d{3,8}$/.test(code) && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const d = await getJson(`${API}/${code}?startDate=${shift(date, -14)}&endDate=${date}`) as { data?: { date: string; nav: string }[] };
      const hit = navs(d).filter((x) => x.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
      return json({ success: true, code, nav: hit?.nav ?? null, nav_date: hit?.date ?? null });
    }
    return json({ error: "use ?q=, ?codes=, ?isins= or ?code=&date=" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 502);
  }
});
