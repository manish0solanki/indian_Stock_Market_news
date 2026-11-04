// Records the sample data that white-label demos show (see sample-data.js).
// Serves this repository locally, opens every page in a real browser (as a signed-out visitor, with live
// data), and saves each successful response from Supabase and the Cloudflare Worker to sample/<id>.json,
// keyed exactly as sample-data.js looks it up. Pages that load more after sign-in (Signals) get their
// public data requested directly with the same supabase-js calls the page makes.
// Run by .github/workflows/demo-data.yml (weekly, and on demand). Needs network access and Playwright.
//   node scripts/demo/record.mjs            → writes sample/
import { createServer } from "node:http";
import { readFile, stat, rm, mkdir, writeFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";
import "../../site-config.js";
import "../../sample-data.js";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const OUT = join(ROOT, "sample");
const CFG = globalThis.MP_CONFIG;
const HOSTS = [new URL(CFG.supabaseUrl).host, CFG.apiHost];
const SYMBOLS = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "SBIN", "BHARTIARTL", "ITC", "LT", "TATASTEEL", "KOTAKBANK", "AXISBANK"];
const MAX_BODY = 12_000_000;

// ── a tiny static server for the repository ──
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".xml": "application/xml", ".txt": "text/plain" };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = join(ROOT, p);
    if (!f.startsWith(ROOT)) throw new Error("outside");
    if ((await stat(f).catch(() => null))?.isDirectory()) f = join(f, "index.html");
    const data = await readFile(f);
    res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((ok) => server.listen(4321, ok));
const BASE = "http://localhost:4321";

// ── record ──
const saved = new Map();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: "block" });
// Testing without network access: DEMO_MOCK=1 answers every backend request with a stand-in, and
// DEMO_SUPABASE_UMD points at a local copy of the supabase-js browser build.
if (process.env.DEMO_SUPABASE_UMD) await context.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, (r) => r.fulfill({ path: process.env.DEMO_SUPABASE_UMD, contentType: "text/javascript" }));
if (process.env.DEMO_MOCK) await context.route((u) => HOSTS.includes(u.host), (r) => r.fulfill({ json: { mock: true, url: r.request().url(), body: r.request().postData() || null } }));
let current = "";
context.on("response", async (resp) => {
  const req = resp.request();
  try {
    const u = new URL(req.url());
    if (!HOSTS.includes(u.host) || u.pathname.startsWith("/auth/")) return;
    if (!["GET", "POST"].includes(req.method())) return;
    if (resp.status() < 200 || resp.status() > 299) return;
    const body = resp.status() === 204 ? "" : await resp.text();
    if (body.length > MAX_BODY) return;
    const { key, id } = globalThis.mpSampleKey(req.method(), req.url(), req.postData() || "");
    const h = resp.headers();
    saved.set(id, { key, page: current, status: resp.status(), type: h["content-type"] || "application/json", range: h["content-range"] || undefined, body });
  } catch { /* a response we couldn't read: the demo falls back to live for it */ }
});

async function visit(path, after) {
  current = path;
  const page = await context.newPage();
  try {
    await page.goto(BASE + path, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(7000);
    if (after) await after(page);
    await page.waitForTimeout(2000);
  } catch (e) { console.log("  ! " + path + ": " + e.message.split("\n")[0]); }
  await page.close();
  console.log(`${path}: ${saved.size} responses so far`);
}
const rpc = (calls) => async (page) => {
  await page.evaluate(async (calls) => {
    const sb = window.supabase.createClient(MP_CONFIG.supabaseUrl, MP_CONFIG.supabaseKey);
    for (const [fn, args] of calls) { try { await (args === undefined ? sb.rpc(fn) : sb.rpc(fn, args)); } catch {} }
  }, calls);
};

await visit("/", async (page) => {
  // stock cards opened from Home's search
  await page.evaluate(async (syms) => { for (const s of syms) { try { await window.fetchStockDetailFromSupabase(s); await window.fetchStockDetailFromSupabase(s, 400); } catch {} } }, SYMBOLS);
});
for (const h of ["sectors", "global", "crude", "crypto"]) await visit("/#" + h);
// "All signals": request its data the way the page does too, in case the button can't be clicked headless.
await visit("/stock-analysis.html", async (page) => { await page.click("#openAll", { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(6000); await rpc([["analysis_scan_bars"]])(page); });
for (const s of SYMBOLS) await visit("/stock-analysis.html?symbol=" + s);
await visit("/stock-signals.html", rpc([["stock_signals_feed"], ["market_snapshot"], ["stock_signals_status"], ["signal_history", { p_tf: null, p_days: 90, p_limit: 400 }]]));
for (const p of ["/picks.html", "/screener.html", "/fno.html", "/ipo.html", "/events.html", "/sectors.html", "/crypto-signals.html", "/money.html", "/portfolio.html"]) await visit(p);

await browser.close();
server.close();

// ── write ──
if (saved.size < 20) { console.error(`Only ${saved.size} responses recorded; keeping the previous sample data.`); process.exit(1); }
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const files = {};
let bytes = 0;
for (const [id, rec] of saved) {
  const text = JSON.stringify(rec);
  bytes += text.length;
  await writeFile(join(OUT, id + ".json"), text);
  files[id] = 1;
}
const recorded_at = new Date().toISOString();
await writeFile(join(OUT, "index.json"), JSON.stringify({ recorded_at, count: saved.size, files }));
await writeFile(join(OUT, "README.md"), `# Demo sample data\n\nSaved responses that white-label demos show instead of live data (see \`sample-data.js\`).\nRecorded ${recorded_at} by \`scripts/demo/record.mjs\` (GitHub Action "Demo sample data"). Do not edit by hand.\n`);
console.log(`Saved ${saved.size} responses (${(bytes / 1e6).toFixed(1)} MB) to sample/`);
console.log("count=" + saved.size);
