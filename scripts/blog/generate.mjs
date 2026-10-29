#!/usr/bin/env node
// MarketPulse blog publisher (replaces the n8n blog workflow). Run by .github/workflows/blog.yml.
//
//   node scripts/blog/generate.mjs --posts=wrap,sector,spotlight,fiidii [--force] [--dry] [--fixtures=file.json]
//
// Each post type is skipped (not failed) when today's data isn't there yet (weekends, holidays,
// FII/DII published late) or when it was already published today.
import fs from "node:fs";
import path from "node:path";
import { loadMarketData, quotesForSector, recentNews } from "./data.mjs";
import { buildDailyWrap, buildSector, buildSpotlight, buildFiiDii, pickSector, pickSpotlight, SECTOR_MAP, istIso, istParts } from "./build.mjs";
import { writeNarrative } from "./ai.mjs";
import { renderPost, postPath, readTime, SITE } from "./render.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const wanted = String(args.posts || process.env.POSTS || "wrap,sector,spotlight,fiidii").split(",").map((s) => s.trim()).filter(Boolean);
const force = !!args.force || process.env.FORCE === "true";
const dry = !!args.dry;
const now = args.now ? new Date(args.now) : new Date();
const today = istIso(now);

const POSTS_FILE = path.join(ROOT, "blog/posts.json");
const posts = JSON.parse(fs.readFileSync(POSTS_FILE, "utf8"));
const postedToday = (category) => posts.some((p) => p.category === category && String(p.date).slice(0, 10) === today);
const fileFor = (post) => path.join(ROOT, postPath(post), "index.html");

function istStamp(d) {
  const t = new Date(d.getTime() + 330 * 60e3).toISOString().slice(0, 19);
  return t + "+05:30";
}

const log = (...a) => console.log(...a);
const published = [];

async function publish(post) {
  if (fs.existsSync(fileFor(post))) { log(`  skip: ${postPath(post)} already exists`); return; }
  const { paragraphs, source } = await writeNarrative(post);
  log(`  text: ${source}`);
  const stamp = istStamp(now);
  const html = renderPost(post, paragraphs, stamp, source);
  const entry = {
    slug: post.slug, title: post.title, excerpt: (paragraphs[0] || post.summary).slice(0, 280), category: post.category, date: stamp,
    readTime: readTime(post, paragraphs), tags: post.tags, author: "MarketPulse AI", featured: false, dataSources: post.dataSources,
  };
  if (dry) { log(`  dry run: would write ${postPath(post)} (${html.length} bytes)`); published.push({ ...entry, html }); return; }
  fs.mkdirSync(path.dirname(fileFor(post)), { recursive: true });
  fs.writeFileSync(fileFor(post), html);
  posts.unshift(entry);
  published.push(entry);
  log(`  wrote ${postPath(post)}`);
}

function writeSitemap() {
  const urls = [
    { loc: SITE + "/", priority: "1.0" }, { loc: SITE + "/blog/", priority: "0.9" }, { loc: SITE + "/stock-analysis.html", priority: "0.8" },
  ];
  for (const p of posts) {
    const rel = postPath(p);
    if (!rel.includes("undefined") && fs.existsSync(path.join(ROOT, rel, "index.html"))) urls.push({ loc: SITE + rel, lastmod: String(p.date).slice(0, 10), priority: "0.7" });
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u.loc.replace(/&/g, "&amp;")}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}<priority>${u.priority}</priority></url>`).join("\n") +
    `\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, "blog/sitemap.xml"), xml);
  log(`sitemap: ${urls.length} URLs`);
}

async function main() {
  const p = istParts(now);
  log(`MarketPulse blog run ${istStamp(now)} IST · posts=${wanted.join(",")}${force ? " · force" : ""}${dry ? " · dry run" : ""}`);
  if (!force && (p.dow === 0 || p.dow === 6)) { log("Weekend: nothing to publish."); return; }

  const data = args.fixtures ? JSON.parse(fs.readFileSync(args.fixtures, "utf8")) : await loadMarketData();
  const quoteDay = data.nifty50.map((q) => q.quote_time).filter(Boolean).sort().pop();
  const marketFresh = quoteDay && istIso(new Date(quoteDay)) === today;
  if (!marketFresh) log(`Latest Nifty 50 quote is from ${quoteDay ? istIso(new Date(quoteDay)) : "unknown"}, not ${today}.`);

  for (const kind of wanted) {
    log(`\n[${kind}]`);
    try {
      if (kind === "wrap") {
        if (!marketFresh && !force) { log("  skip: no trading data for today (holiday?)"); continue; }
        await publish(buildDailyWrap(data, now));
      } else if (kind === "sector") {
        if (!marketFresh && !force) { log("  skip: no trading data for today"); continue; }
        if (postedToday("sector-analysis") && !force) { log("  skip: already published today"); continue; }
        const recent = posts.filter((x) => x.category === "sector-analysis").slice(0, 2).map((x) => x.slug);
        const sector = pickSector(data.sectors, recent);
        if (!sector) { log("  skip: no sector data"); continue; }
        const quotes = data.allQuotes // fixture mode: filter locally
          ? data.allQuotes.filter((q) => SECTOR_MAP[sector.name].test(data.stocks.find((s) => s.symbol === q.symbol)?.sector || ""))
          : await quotesForSector(data.stocks, SECTOR_MAP[sector.name]);
        await publish(buildSector(data, sector, quotes, now));
      } else if (kind === "spotlight") {
        if (!marketFresh && !force) { log("  skip: no trading data for today"); continue; }
        if (postedToday("stock-spotlight") && !force) { log("  skip: already published today"); continue; }
        const cutoff = new Date(now.getTime() - 10 * 864e5).toISOString().slice(0, 10);
        const recentSyms = posts.filter((x) => x.category === "stock-spotlight" && String(x.date).slice(0, 10) >= cutoff).map((x) => x.tags?.[1]).filter(Boolean);
        const pick = pickSpotlight(data.large, recentSyms);
        if (!pick) { log("  skip: no stock with an unusual move today"); continue; }
        const news = data.news?.[pick.q.symbol] || await recentNews(pick.q.symbol, new Date(now.getTime() - 3 * 864e5).toISOString()).catch(() => []);
        await publish(buildSpotlight(data, pick, news, now));
      } else if (kind === "fiidii") {
        const last = data.fii.map((r) => r.trade_date).sort().pop();
        if (last !== today && !force) { log(`  skip: latest FII/DII data is for ${last}, not ${today} (NSE publishes in the evening)`); continue; }
        if (posts.some((x) => x.category === "fiidii-flows" && String(x.date).slice(0, 10) === last) && !force) { log("  skip: already published for " + last); continue; }
        await publish(buildFiiDii(data, now));
      } else log("  unknown post type");
    } catch (e) {
      log(`  ERROR: ${e.message}`);
      process.exitCode = 1;
    }
  }

  if (!dry && published.length) {
    fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2) + "\n");
    writeSitemap();
  }
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${published.length}\ntitles<<EOF\n${published.map((x) => "- " + x.title).join("\n")}\nEOF\n`);
  }
  log(`\nDone: ${published.length} post(s).`);
  if (dry && args.out) fs.writeFileSync(args.out, JSON.stringify(published, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
