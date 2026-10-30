// Diagnostic for the blog's Moonshot setup (run by .github/workflows/ai-check.yml, never publishes).
// Lists the models the MOONSHOT_API_KEY can use and times one blog-sized request on each candidate.
const key = process.env.MOONSHOT_API_KEY;
if (!key) { console.log("MOONSHOT_API_KEY is not set"); process.exit(1); }
const H = { Authorization: "Bearer " + key, "Content-Type": "application/json" };

const list = await fetch("https://api.moonshot.ai/v1/models", { headers: H }).then((r) => r.json()).catch((e) => ({ error: e.message }));
const ids = (list?.data || []).map((m) => m.id).sort();
console.log("models available:", ids.length ? ids.join(", ") : JSON.stringify(list).slice(0, 300));

const facts = { index: "Nifty 50", close: 22936.75, change: 237.9, changePct: 1.05, advances: 39, declines: 11, topGainers: [{ s: "TRENT", p: 6.2 }, { s: "LAURUSLABS", p: 6.0 }], topLosers: [{ s: "SUZLON", p: -8.8 }], sectors: [{ n: "IT", p: 2.5 }, { n: "Energy", p: -1.0 }] };
const prompt = "You are a careful Indian stock-market journalist. Write 3 short paragraphs (170-230 words) about today's market using ONLY these facts, plain text:\n" + JSON.stringify(facts);
const wanted = (process.env.CANDIDATES || "kimi-k2.6,kimi-k2.5,kimi-k2-turbo-preview,kimi-k2-0905-preview,moonshot-v1-8k").split(",").map((s) => s.trim());
for (const model of wanted.filter((m) => !ids.length || ids.includes(m))) {
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.moonshot.ai/v1/chat/completions", {
      method: "POST", headers: H, signal: AbortSignal.timeout(240000),
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: Number(process.env.MOONSHOT_TEMPERATURE || 1), max_tokens: 3000 }),
    });
    const d = await r.json().catch(() => ({}));
    const c = d?.choices?.[0];
    console.log(`${model}: HTTP ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s, finish=${c?.finish_reason}, tokens=${JSON.stringify(d?.usage || {})}, words=${(c?.message?.content || "").split(/\s+/).filter(Boolean).length}${d?.error ? ", error=" + d.error.message : ""}`);
    if (c?.message?.content) console.log("  sample:", c.message.content.replace(/\s+/g, " ").slice(0, 260));
  } catch (e) {
    console.log(`${model}: failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${e.message}`);
  }
}
