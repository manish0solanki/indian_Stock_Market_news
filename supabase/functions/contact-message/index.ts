// contact-message: receives the site's contact form (replaces the n8n webhook).
// Every message is stored in `contact_messages`; if the TELEGRAM_BOT_TOKEN and
// TELEGRAM_CHAT_ID secrets are set, a copy is also sent to Telegram.
// Basic abuse protection: length limits, a hidden honeypot field and 5 messages/hour per IP.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function notifyTelegram(m: { name: string; email: string; message: string; page: string | null }) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN"), chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chat) return false;
  const text = `📬 MarketPulse contact form\n\nFrom: ${m.name} <${m.email}>\n${m.page ? "Page: " + m.page + "\n" : ""}\n${m.message}`;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    // Bots fill every field; real visitors never see this one.
    if (body.website) return json({ ok: true });
    const name = String(body.name || "").trim().slice(0, 100);
    const email = String(body.email || "").trim().slice(0, 200);
    const message = String(body.message || "").trim().slice(0, 4000);
    const page = body.page ? String(body.page).slice(0, 300) : null;
    if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "Please enter your name, a valid email and a message." }, 400);
    }

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const ipHash = await sha256(ip + "|marketpulse-contact");
    const { count } = await supabase.from("contact_messages").select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash).gte("created_at", new Date(Date.now() - 3600e3).toISOString());
    if ((count || 0) >= 5) return json({ ok: false, error: "Too many messages. Please try again in an hour." }, 429);

    const { data, error } = await supabase.from("contact_messages")
      .insert({ name, email, message, page, ip_hash: ipHash }).select("id").single();
    if (error) throw new Error(error.message);

    let notified = false;
    try { notified = await notifyTelegram({ name, email, message, page }); } catch (_) { /* stored anyway */ }
    if (notified) await supabase.from("contact_messages").update({ notified_at: new Date().toISOString() }).eq("id", data.id);
    return json({ ok: true });
  } catch (e) {
    console.error("CONTACT_FATAL", String((e as Error)?.message || e));
    return json({ ok: false, error: "Could not send your message right now." }, 500);
  }
});
