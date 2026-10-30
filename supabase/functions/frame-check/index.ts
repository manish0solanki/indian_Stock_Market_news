// frame-check: can this outside page be shown inside our site (in an iframe)?
// GET ?url=https://... -> { ok: true, frameable: boolean }. Used by link-viewer.js to decide between the
// in-site viewer and opening the page in the same tab. Only reads response headers (X-Frame-Options,
// CSP frame-ancestors); public https/http hosts only, results cached in memory for 6 hours.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const cache = new Map<string, { at: number; frameable: boolean }>();
const TTL = 6 * 3600e3;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": status === 200 ? "public, max-age=3600" : "no-store" } });
}
// Hostnames only: no IP literals, no localhost or internal names.
function allowedHost(h: string) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h) && !/^\d+(\.\d+){3}$/.test(h) && !/(^|\.)(localhost|internal|local)$/i.test(h);
}
function frameable(headers: Headers) {
  const xfo = (headers.get("x-frame-options") || "").toLowerCase();
  if (xfo.includes("deny") || xfo.includes("sameorigin")) return false;
  const fa = (headers.get("content-security-policy") || "").toLowerCase().match(/frame-ancestors([^;]*)/);
  if (fa && !/(^|\s)(\*|https:)(\s|$)/.test(fa[1].trim() + " ")) return false; // any narrower list excludes us
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let u: URL;
  try { u = new URL(new URL(req.url).searchParams.get("url") || ""); } catch (_) { return json({ ok: false, error: "Bad url" }, 400); }
  if (!/^https?:$/.test(u.protocol) || !allowedHost(u.hostname)) return json({ ok: false, error: "Not allowed" }, 400);
  const key = u.origin + u.pathname;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return json({ ok: true, frameable: hit.frameable, cached: true });
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(u.toString(), { redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36", Accept: "text/html" } });
    clearTimeout(timer);
    // An http page cannot be framed in our https site; neither can a page that errors.
    const ok = r.ok && new URL(r.url).protocol === "https:" && frameable(r.headers);
    r.body?.cancel().catch(() => {});
    cache.set(key, { at: Date.now(), frameable: ok });
    return json({ ok: true, frameable: ok });
  } catch (_) {
    return json({ ok: true, frameable: false });
  }
});
