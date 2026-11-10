// econ-summary: "What happened" for each economy event on the Events page (public.econ_events.summary).
// For a release that is out (actual filled, or the Budget once it has been presented), within the last 3 days:
//   1. Google News headlines about it from the last 2 days (one search for the event, one for its India angle).
//   2. Moonshot writes 3-5 short points: the number against the previous one (and against expectations if the
//      headlines say), how markets reacted, and what it means for Indian markets. Every number in a point must appear
//      in the facts (the released figures or a headline), so nothing invented is shown; points that fail are dropped.
//   3. Stored as { points: [{ text, sources: [{ title, source, url }] }], tone, writer, written_at, n }.
// Rewritten up to 3 times (at least 4 hours apart, while the event is under 2 days old) as more reports come in.
// Hourly from pg_cron; cheap when there is nothing to do. Auth: x-cron-secret must match app_secrets 'crypto_cron'.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const MOONSHOT = Deno.env.get("MOONSHOT_API_KEY") || "";
const MODELS = (Deno.env.get("MOONSHOT_MODEL") || "kimi-k3.1-pro,kimi-k2.6").split(",").map((s) => s.trim()).filter(Boolean);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
const IN = "hl=en-IN&gl=IN&ceid=IN:en", US = "hl=en-US&gl=US&ceid=US:en";
// What to search for each kind of event: [query, locale][].
const QUERIES: Record<string, [string, string][]> = {
  uscpi: [["US CPI inflation report", US], ["US inflation data Indian markets", IN]],
  cpi: [["India retail inflation CPI", IN]],
  rbi: [["RBI monetary policy repo rate decision", IN]],
  fomc: [["Federal Reserve interest rate decision", US], ["Fed rate decision Indian markets", IN]],
  gdp: [["India GDP growth quarter", IN]],
  budget: [["Union Budget highlights", IN], ["Budget stock market reaction", IN]],
};
type Head = { title: string; source: string; url: string; at: string | null };

const unent = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/\s+/g, " ").trim();
async function googleNews(q: string, loc: string): Promise<Head[]> {
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&${loc}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const x = await r.text();
    return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20).map((m) => {
      const it = m[1], g = (t: string) => unent((it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || "");
      const source = g("source"); let title = g("title");
      if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
      const pd = g("pubDate");
      return { title, source, url: g("link"), at: pd ? new Date(pd).toISOString() : null };
    }).filter((h) => h.title);
  } catch { return []; }
}

// Every number written must be in the facts (allowing rounding).
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
// Fixed instructions first (the system message), so Moonshot's context cache can reuse them.
const SYSTEM = `You are a careful markets reporter writing for Indian investors. You summarise an economic release using only the facts and numbered headlines you are given, and you never invent events or numbers.
Return JSON only, no prose around it: {"points":[{"text":"...","sources":[1,2]}],"tone":0}
- 3 to 5 points, most important first, each one plain sentence of under 30 words.
- Cover, where the facts or headlines support it: what was released (the number against the previous one); whether it beat, matched or missed expectations; how markets reacted (stocks, bond yields, the dollar or rupee); what it means for Indian markets (FII flows, the rupee, interest rates, sectors).
- Use numbers only exactly as they appear in the facts or headlines. Never add numbers from your own knowledge.
- sources: the numbers of the headlines that back the point; [] for a point that only restates the released figures.
- Do not mention "headlines", "the facts" or "provided" data. No advice to buy or sell.
- tone: 1 if the release is good news for Indian stocks, -1 if bad, 0 if mixed or unclear.`;

const NAMES: Record<string, string> = { uscpi: "US CPI inflation", cpi: "India CPI inflation", rbi: "RBI policy decision", fomc: "US Federal Reserve decision", gdp: "India GDP", budget: "Union Budget" };

async function summarise(ev: any) {
  const since = Date.parse(ev.event_date + "T" + (ev.time_ist || "00:00") + ":00+05:30") - 6 * 3600e3;
  const seen = new Set<string>(), heads: Head[] = [];
  for (const [q, loc] of QUERIES[ev.kind] || []) {
    for (const h of await googleNews(q, loc)) {
      const k = h.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 60);
      if (seen.has(k) || (h.at && Date.parse(h.at) < since)) continue;
      seen.add(k); heads.push(h);
    }
  }
  const top = heads.slice(0, 14);
  if (top.length < 2) return { skip: "only " + top.length + " headlines" };
  const facts = [
    `Event: ${NAMES[ev.kind] || ev.title} (${ev.title}), for ${ev.period || "the period"}, released ${ev.event_date} ${ev.time_ist || ""} IST.`,
    ev.actual ? `Released figure: ${ev.actual}.` : "", ev.previous ? `Previous figure: ${ev.previous}.` : "", ev.note ? `Note: ${ev.note}` : "",
    "Headlines:", ...top.map((h, i) => `${i + 1}. ${h.title} (${h.source || "news"})`),
  ].filter(Boolean).join("\n");
  let lastErr = "";
  for (const model of MODELS) {
    try {
      const txt = await moonshot(model, SYSTEM, facts + "\n\nSummarise what happened.");
      const m = txt.match(/\{[\s\S]*\}/); if (!m) { lastErr = model + ": no JSON"; continue; }
      const parsed = JSON.parse(m[0]);
      const points = (parsed.points || []).slice(0, 5).map((p: any) => ({
        text: String(p.text || "").trim(),
        sources: [...new Set((p.sources || []).map(Number).filter((i: number) => i >= 1 && i <= top.length))].slice(0, 3)
          .map((i: any) => ({ title: top[i - 1].title, source: top[i - 1].source, url: top[i - 1].url })),
      })).filter((p: any) => p.text && numbersOk(p.text, facts));
      if (points.length >= 2) return { points, tone: Math.sign(Number(parsed.tone) || 0), writer: "moonshot:" + model, heads: top.length };
      lastErr = model + ": " + points.length + " usable points";
    } catch (e) { lastErr = String((e as Error).message || e); }
  }
  return { error: lastErr };
}

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: s } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!s || !secret || secret !== s.value) return json({ error: "unauthorized" }, 401);
    if (!MOONSHOT) return json({ error: "no MOONSHOT_API_KEY" });
    const url = new URL(req.url), only = url.searchParams.get("id"), force = url.searchParams.get("force") === "1";
    const nowIst = new Date(Date.now() + 330 * 60e3), today = nowIst.toISOString().slice(0, 10);
    const from = new Date(Date.now() + 330 * 60e3 - 3 * 864e5).toISOString().slice(0, 10);
    let q = supabase.from("econ_events").select("id,kind,title,period,event_date,time_ist,actual,previous,note,summary").gte("event_date", from).lte("event_date", today);
    if (only) q = supabase.from("econ_events").select("id,kind,title,period,event_date,time_ist,actual,previous,note,summary").eq("id", only);
    const { data: rows } = await q;
    const due = (rows || []).filter((r: any) => {
      if (only) return true;
      const released = Date.parse(r.event_date + "T" + (r.time_ist || "00:00") + ":00+05:30");
      if (Date.now() < released + 45 * 60e3) return false;            // give the news 45 minutes
      if (!r.actual && r.kind !== "budget") return false;              // the number isn't in yet
      const sm = r.summary;
      if (!sm || force) return true;
      return (sm.n || 1) < 3 && Date.now() - Date.parse(sm.written_at) > 4 * 3600e3 && Date.now() - released < 2 * 864e5;
    }).slice(0, 3);
    const done: any[] = [];
    for (const r of due) {
      const out: any = await summarise(r);
      if (out.points) {
        const summary = { points: out.points, tone: out.tone, writer: out.writer, heads: out.heads, written_at: new Date().toISOString(), n: (r.summary?.n || 0) + 1 };
        const { error } = await supabase.from("econ_events").update({ summary }).eq("id", r.id);
        if (error) throw new Error(error.message);
        done.push({ id: r.id, points: out.points.length });
      } else done.push({ id: r.id, ...out });
    }
    console.log("ECON_SUMMARY", JSON.stringify(done));
    return json({ due: due.length, done });
  } catch (e) {
    console.error("ECON_SUMMARY_FATAL", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
