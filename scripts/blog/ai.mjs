// Writes the commentary paragraphs with Moonshot (Kimi), using only the supplied facts.
// Needs MOONSHOT_API_KEY; the model is MOONSHOT_MODEL (default kimi-k3.1-pro, then kimi-k2.6 and kimi-k3 as fallbacks:
// with thinking off, k3.1-pro wrote the closest to the 200-260 word brief in about 12s and ~300 tokens).
// Output is capped at MOONSHOT_MAX_TOKENS (default 500) per post. These models "think" before writing and
// thinking counts against the cap, so it is switched off (Moonshot then requires temperature 0.6);
// set MOONSHOT_THINKING=enabled to turn it back on (needs a much larger cap).
// Every number in the AI's text must match a number in the facts; otherwise the post falls
// back to the plain-language paragraphs built from the data, so nothing invented gets published.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_WAITS = [0, 8000, 20000]; // busy / rate-limited models usually recover within seconds
// kimi-k2.x "thinking" models often need 60-120s; a hung request still can't stall the job for long.
const TIMEOUT_MS = Number(process.env.MOONSHOT_TIMEOUT_MS || 150000);
const MAX_TOKENS = Number(process.env.MOONSHOT_MAX_TOKENS || 500);
const THINKING = process.env.MOONSHOT_THINKING === "enabled";

async function callMoonshot(key, model, prompt) {
  const res = await fetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a careful Indian stock-market journalist. Use only the facts you are given." },
        { role: "user", content: prompt },
      ],
      // With thinking on these models only accept temperature 1; with it off, only 0.6.
      temperature: Number(process.env.MOONSHOT_TEMPERATURE || (THINKING ? 1 : 0.6)),
      max_tokens: MAX_TOKENS,
      ...(THINKING ? {} : { thinking: { type: "disabled" } }),
    }),
  });
  const d = await res.json().catch(() => ({}));
  let text = d?.choices?.[0]?.message?.content || "";
  // Cut off by the token cap: keep only up to the last complete sentence.
  if (d?.choices?.[0]?.finish_reason === "length") text = text.slice(0, Math.max(text.lastIndexOf(". "), text.lastIndexOf(".\n")) + 1);
  return { ok: res.ok, status: res.status, error: d?.error?.message, text };
}

function providers() {
  const list = [];
  if (process.env.MOONSHOT_API_KEY) {
    for (const m of (process.env.MOONSHOT_MODEL || "kimi-k3.1-pro,kimi-k2.6,kimi-k3").split(",")) list.push({ name: "moonshot:" + m.trim(), call: (p) => callMoonshot(process.env.MOONSHOT_API_KEY, m.trim(), p) });
  }
  return list;
}

async function generate(prompt) {
  let lastErr;
  for (const prov of providers()) {
    for (const wait of RETRY_WAITS) {
      if (wait) await sleep(wait);
      const r = await prov.call(prompt).catch((e) => ({ ok: false, status: 0, error: e.message }));
      if (r.ok && r.text.trim()) return { model: prov.name, text: r.text };
      lastErr = new Error(`${prov.name}: ${r.error || (r.ok ? "empty response" : "HTTP " + r.status)}`);
      // Busy / rate-limited: wait and retry. Timed out or any other error: try the next model.
      if (r.ok || /abort|timeout/i.test(r.error || "") || ![0, 429, 500, 502, 503].includes(r.status)) break;
    }
  }
  throw lastErr;
}

function factNumbers(facts) {
  const set = [];
  const walk = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) set.push(v, Math.abs(v));
    else if (typeof v === "string") for (const m of v.matchAll(/-?\d[\d,]*\.?\d*/g)) { const x = Number(m[0].replace(/,/g, "")); if (Number.isFinite(x)) set.push(x, Math.abs(x)); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  return set;
}

// Numbers in the text that don't correspond (after rounding) to any fact.
export function unverifiedNumbers(text, facts) {
  const known = factNumbers(facts);
  const bad = [];
  for (const m of text.matchAll(/(?<![A-Za-z])(\d[\d,]*\.?\d*)(\s*(%|x|×|crore|cr|lakh|points?|sessions?|days?))?/gi)) {
    const raw = m[1].replace(/,/g, "").replace(/\.$/, "");
    const x = Number(raw);
    if (!Number.isFinite(x)) continue;
    const before = text.slice(Math.max(0, m.index - 2), m.index);
    if (/(Q|FY|H)$/i.test(before)) continue;            // Q2, FY27, H1
    if (x >= 2000 && x <= 2100 && !raw.includes(".")) continue; // years
    if (Number.isInteger(x) && x <= 10 && !m[2]) continue;      // "two sectors", list positions
    // Index names, not figures: Nifty 50, Nifty Next 50, Nifty 500, Midcap 150, Smallcap 250, Sensex 30...
    if (/(nifty|next|midcap|smallcap|largemidcap|sensex|bse|total market|microcap)\s*$/i.test(text.slice(Math.max(0, m.index - 16), m.index))) continue;
    // Indicator names, not figures: 20/50/100/200-day averages, 52-week high/low.
    if ([5, 10, 20, 50, 100, 200, 52].includes(x) && /^[\s-]*(day|week|dma|ema|sma)\b/i.test(text.slice(m.index + m[1].length, m.index + m[1].length + 8))) continue;
    const ok = known.some((k) => Math.abs(k - x) <= Math.max(0.011, Math.abs(k) * 0.005) || Math.abs(Math.round(k) - x) < 0.001 || Math.abs(Number(k.toFixed(1)) - x) < 0.001);
    if (!ok) bad.push(m[1]);
  }
  return bad;
}

function clean(text) {
  return text.replace(/\*\*?|__|^#+\s*/gm, "").replace(/^\s*[-•]\s+/gm, "").split(/\n\s*\n|\n/).map((p) => p.trim()).filter((p) => p.length > 30);
}

export async function writeNarrative(post) {
  if (!providers().length) return { paragraphs: post.fallback, source: "template (no MOONSHOT_API_KEY)" };
  const prompt = [
    "You are a careful Indian stock-market journalist writing for retail investors.",
    post.aiTask,
    "Rules:",
    "- Use ONLY the facts in the JSON below. Do not add news, causes, forecasts, price targets or numbers that are not in it.",
    "- Every number you write must appear in the JSON (you may round to 1 or 2 decimals). Write rupee amounts as ₹ with Cr for crore.",
    "- 3 or 4 paragraphs, 200-260 words in total (never more), plain text, no headings, no bullet points, no markdown.",
    "Style (make it a story worth reading, not a list of numbers):",
    "- Open with one sharp sentence that captures the day's main story, like a newspaper lead. Do not start with the date or 'Today'.",
    "- Then explain what stood out and how the pieces connect, e.g. an index up while most stocks fell, or one sector carrying the market.",
    "- Explain in plain words what the figures mean for an ordinary investor (what a breadth reading, a volume spike or a 52-week high signals).",
    "- End with what to keep an eye on next, framed as things to watch in the data (levels, breadth, flows, sectors), not predictions.",
    "- Vary sentence length, use strong precise verbs (rallied, slipped, shrugged off, extended), avoid filler like 'it is worth noting'.",
    "- Neutral and factual, never hype. No investment advice and no words like 'buy', 'sell' or 'should' directed at the reader.",
    "",
    "FACTS:",
    JSON.stringify(post.facts),
  ].join("\n");
  try {
    const { model, text } = await generate(prompt);
    const paragraphs = clean(text);
    if (paragraphs.length < 2) throw new Error("empty or too short response");
    const bad = unverifiedNumbers(paragraphs.join(" "), post.facts);
    if (bad.length) throw new Error("numbers not in the data: " + bad.slice(0, 5).join(", "));
    return { paragraphs: paragraphs.slice(0, 5), source: model };
  } catch (e) {
    return { paragraphs: post.fallback, source: "template (AI rejected: " + e.message + ")" };
  }
}
