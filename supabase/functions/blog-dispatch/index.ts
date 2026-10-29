// blog-dispatch: starts the "Blog autopublish" GitHub Actions workflow (workflow_dispatch).
// Called by pg_cron (public.dispatch_blog) at the publishing times, because GitHub's own cron
// schedule drops runs. Each run skips posts that are already published.
// Secrets: GIT_HUB_ACCESS (GitHub classic token with repo + workflow scopes).
// Auth: x-cron-secret header must match app_secrets 'crypto_cron'.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const REPO = "manish0solanki/indian_Stock_Market_news";
const KINDS = new Set(["wrap", "sector", "spotlight", "fiidii"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const { data: sec } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
  const secret = req.headers.get("x-cron-secret") || "";
  if (!sec || !secret || secret !== sec.value) return json({ error: "unauthorized" }, 401);

  const token = Deno.env.get("GIT_HUB_ACCESS");
  if (!token) return json({ error: "GIT_HUB_ACCESS secret is not set" }, 500);

  const url = new URL(req.url);
  const posts = (url.searchParams.get("posts") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!posts.length || posts.some((p) => !KINDS.has(p))) return json({ error: "posts must be a list of: " + [...KINDS].join(", ") }, 400);
  const check = url.searchParams.get("check") === "1"; // verify the token can see the workflow, start nothing

  const headers = {
    Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "marketpulse-supabase-cron", "Content-Type": "application/json",
  };
  const wf = `https://api.github.com/repos/${REPO}/actions/workflows/blog.yml`;
  const r = check
    ? await fetch(wf, { headers })
    : await fetch(wf + "/dispatches", { method: "POST", headers, body: JSON.stringify({ ref: "main", inputs: { posts: posts.join(",") } }) });
  const body = r.status === 204 ? "" : (await r.text()).slice(0, 300);
  const scopes = r.headers.get("x-oauth-scopes");
  console.log("blog-dispatch", check ? "check" : posts.join(","), r.status, scopes ?? "", body);
  return json({ ok: r.ok, status: r.status, posts, check, scopes, detail: r.ok ? undefined : body }, r.ok ? 200 : 502);
});
