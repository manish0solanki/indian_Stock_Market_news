// sales-import: loads SEBI's public register of research analysts into the Sales Desk (sales_leads).
// Pages through https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=14 the way its
// "next page" links do, and saves name, registration no., contact person, email, phone, address and validity
// through sales_upsert_sebi() (new analysts are added; known ones are refreshed without touching their stage).
// Auth: the MarketPulse platform admin's token (Sales Desk "Import from SEBI"), or x-cron-secret.
// POST [?from=0&to=200]  page range (0-based, 25 entries a page); default: every page.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const LIST = "https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=14";
const PAGE = "https://www.sebi.gov.in/sebiweb/ajax/other/getintmfpiinfo.jsp";
const UA = "Mozilla/5.0 (compatible; MarketPulse sales desk)";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ent = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const FIELD: Record<string, string> = { "Name": "name", "Registration No.": "reg", "E-mail": "email", "Telephone": "phone", "Address": "address", "Contact Person": "contact", "Validity": "validity" };

function parse(html: string) {
  const rows: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  // The first page quotes attributes with ", the pages loaded after it with '.
  const re = /<div class=["']title["']>\s*<span>([\s\S]*?)<\/span>\s*<\/div>\s*<div class=["']value[^"']*["']>\s*<span>([\s\S]*?)<\/span>/g;
  for (const m of html.matchAll(re)) {
    const k = FIELD[ent(m[1])]; if (!k) continue;
    if (k === "name") { if (cur) rows.push(cur); cur = {}; }
    if (cur) cur[k] = ent(m[2]);
  }
  if (cur) rows.push(cur);
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // the platform admin, or the cron secret
  const secret = req.headers.get("x-cron-secret") || "";
  let ok = false;
  if (secret) { const { data } = await admin.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle(); ok = !!data && data.value === secret; }
  if (!ok) {
    const r = await fetch(SB_URL + "/rest/v1/rpc/mp_is_platform_admin", { method: "POST", headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") || "", Authorization: req.headers.get("Authorization") || "", "Content-Type": "application/json" }, body: "{}" });
    ok = r.ok && (await r.json()) === true;
  }
  if (!ok) return json({ error: "Only the MarketPulse admin can import leads." }, 403);

  // a session with SEBI's site, as a browser would have
  const first = await fetch(LIST, { headers: { "User-Agent": UA } });
  const cookie = (first.headers.get("set-cookie") || "").split(/,(?=\s*\w+=)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  const html0 = await first.text();
  const total = Number((html0.match(/of\s+([\d,]+)\s+records/i) || [])[1]?.replace(/,/g, "") || 0);
  const pages = Math.max(1, Math.ceil(total / 25));
  const u = new URL(req.url);
  const from = Math.max(0, Number(u.searchParams.get("from") || 0)), to = Math.min(pages - 1, Number(u.searchParams.get("to") ?? pages - 1));

  async function page(i: number) {
    if (i === 0) return parse(html0);
    const body = new URLSearchParams({ nextValue: "1", next: "n", intmId: "14", contPer: "", name: "", regNo: "", email: "", location: "", exchange: "", affiliate: "", alp: "", language: "2", model: "", esgCategory: "", doDirect: String(i), intmIds: "" });
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(PAGE, { method: "POST", body, headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Referer: LIST, ...(cookie ? { Cookie: cookie } : {}) } });
        if (r.ok) {
          // SEBI keeps the position in the session: only accept the page we asked for ("26 to 50 of …")
          const t = await r.text(), at = Number((t.match(/(\d+)\s+to\s+\d+\s+of/) || [])[1] || 0);
          const rows = parse(t);
          if (rows.length && at === i * 25 + 1) return rows;
        }
      } catch { /* retry */ }
      await new Promise((ok) => setTimeout(ok, 800 * (a + 1)));
    }
    return [];
  }

  if (u.searchParams.get("debug") === "1") {   // what SEBI returns for page 2, to diagnose paging
    const body = new URLSearchParams({ nextValue: "1", next: "n", intmId: "14", contPer: "", name: "", regNo: "", email: "", location: "", exchange: "", affiliate: "", alp: "", language: "2", model: "", esgCategory: "", doDirect: "1", intmIds: "" });
    const r = await fetch(PAGE, { method: "POST", body, headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Referer: LIST, ...(cookie ? { Cookie: cookie } : {}) } });
    const t = await r.text();
    return json({ status: r.status, cookie: cookie.replace(/=[^;]+/g, "=…"), len: t.length, head: t.slice(0, 600), rows: parse(t).length });
  }

  let rows = 0, saved = 0, empty = 0;
  const todo = Array.from({ length: to - from + 1 }, (_, k) => from + k);
  const sample: string[] = [];
  for (let k = 0; k < todo.length; k++) {   // one page at a time: SEBI tracks the page per session
    const got = [await page(todo[k])];
    const batch = got.flat();
    got.forEach((g) => { if (!g.length) empty++; });
    if (batch.length) {
      rows += batch.length;
      if (sample.length < 3) sample.push(...batch.slice(0, 3 - sample.length).map((r) => r.reg + " " + r.name));
      const { data, error } = await admin.rpc("sales_upsert_sebi", { p_rows: batch });
      if (error) return json({ error: error.message, rows, saved }, 500);
      saved += data as number;
    }
  }
  console.log("sales-import", { total, pages, from, to, rows, saved, empty });
  return json({ ok: true, total, pages, from, to, rows, saved, empty_pages: empty, sample });
});
