// Renders a post definition into a standalone HTML page that uses the shared /blog/assets/post.css.
export const SITE = process.env.SITE_URL || "https://tradesutra-chi.vercel.app";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CAT_PATH = { "daily-wrap": "daily-wrap", "sector-analysis": "sector-analysis", "stock-spotlight": "stock-spotlight", "fiidii-flows": "fiidii-flows" };
export const postPath = (post) => `/blog/${CAT_PATH[post.category]}/${post.slug}/`;

function cell(c, align) {
  const a = align === "r" ? ' class="r"' : "";
  if (c && typeof c === "object") {
    const t = c.tone ? ` class="${align === "r" ? "r " : ""}${c.tone}"` : a;
    const body = c.html ?? esc(c.text);
    return `<td${t}>${body}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</td>`;
  }
  return `<td${a}>${esc(c)}</td>`;
}

function section(s, narrative, summary) {
  switch (s.type) {
    case "kpis":
      return `<h2>${esc(s.heading)}</h2><div class="kpis">${s.items.map((k) => `<div class="kpi"><span>${esc(k.label)}</span><strong class="${k.tone || ""}">${esc(k.value)}</strong>${k.sub ? `<em>${esc(k.sub)}</em>` : ""}</div>`).join("")}</div>`;
    case "table":
      return `<h2>${esc(s.heading)}</h2><div class="tw"><table><thead><tr>${s.columns.map((c, i) => `<th${s.align?.[i] === "r" ? ' class="r"' : ""}>${esc(c)}</th>`).join("")}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map((c, i) => cell(c, s.align?.[i])).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "ai":
      // The template text starts with the summary sentence, which is already shown above.
      return `<h2>${esc(s.heading)}</h2>${narrative.filter((p, i) => !(i === 0 && p === summary && narrative.length > 1)).map((p) => `<p>${esc(p)}</p>`).join("")}`;
    case "list":
      return `<h2>${esc(s.heading)}</h2><ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    case "note":
      return `<p class="note">${esc(s.text)}</p>`;
    case "cta":
      return `<a class="cta" href="${esc(s.href)}">${esc(s.text)} →</a>`;
    default:
      return "";
  }
}

export function readTime(post, narrative) {
  const words = (narrative.join(" ") + " " + post.summary).split(/\s+/).length + 120;
  return Math.max(2, Math.round(words / 200)) + " min read";
}

export function renderPost(post, narrative, publishedIso, aiSource) {
  const url = SITE + postPath(post);
  const excerpt = (narrative[0] || post.summary).slice(0, 300);
  const dateLabel = new Date(publishedIso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const moodClass = /Bull/.test(post.mood) ? "up" : /Bear/.test(post.mood) ? "down" : "";
  const ld = {
    "@context": "https://schema.org", "@type": "NewsArticle", headline: post.title, description: excerpt, datePublished: publishedIso, dateModified: publishedIso,
    author: { "@type": "Organization", name: "MarketPulse" }, publisher: { "@type": "Organization", name: "MarketPulse" }, mainEntityOfPage: url,
    articleSection: post.categoryLabel, keywords: post.tags.join(", "),
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(post.title)} — MarketPulse</title>
<meta name="description" content="${esc(excerpt)}">
<meta name="keywords" content="${esc(post.tags.join(", "))}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(post.title)}">
<meta property="og:description" content="${esc(excerpt)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="MarketPulse">
<meta property="article:published_time" content="${publishedIso}">
<meta property="article:section" content="${esc(post.categoryLabel)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(post.title)}">
<meta name="twitter:description" content="${esc(excerpt)}">
<meta name="generator" content="MarketPulse blog bot (${esc(aiSource)})">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
<link rel="stylesheet" href="/blog/assets/post.css">
<script>try{var t=localStorage.getItem('marketpulse-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head>
<body>
<header class="top"><a class="brand" href="/"><i></i>MarketPulse</a><nav><a href="/">Dashboard</a><a href="/blog/">Blog</a><a href="/stock-analysis.html">Analysis</a></nav></header>
<main class="post">
<nav class="crumbs"><a href="/">Home</a> / <a href="/blog/">Blog</a> / <span>${esc(post.categoryLabel)}</span></nav>
<div class="cat">${post.emoji} ${esc(post.categoryLabel)}</div>
<h1>${esc(post.title)}</h1>
<div class="meta"><time datetime="${publishedIso}">${esc(dateLabel)}</time><span>·</span><span>${esc(readTime(post, narrative))}</span><span>·</span><span class="mood ${moodClass}">${esc(post.mood)}</span></div>
<p class="summary"><strong>MarketPulse summary:</strong> ${esc(post.summary)}</p>
${post.sections.map((s) => section(s, narrative, post.summary)).join("\n")}
<div class="track"><strong>📊 Track it live</strong><span>Live Nifty, heatmap, FII/DII flows and news on the MarketPulse dashboard.</span><a href="/">Open dashboard →</a></div>
<p class="disclaimer">Data from NSE and public market sources, compiled automatically by MarketPulse. Figures may be delayed or revised. This is not investment advice.</p>
</main>
</body>
</html>
`;
}
