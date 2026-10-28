// stocks-sync: adds newly listed NSE companies to `stocks`.
// Source: NSE's official equity master list (EQUITY_L.csv), refreshed daily by NSE.
// Insert-only: existing rows (sectors, fundamentals, names) are never changed and
// delisted symbols are never removed, so portfolios and history stay intact.
// After adding stocks it triggers sector-refresh so their prices appear right away.
// Runs from a Supabase cron job (same x-cron-secret as the other jobs).
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const LIST_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
// NSE lists ~2,600 equities; anything far below that is a broken download, not delistings.
const MIN_ROWS = 1500;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

// Minimal CSV parser that handles quoted fields (company names can contain commas).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field.trim()); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim()); field = "";
      if (row.some((f) => f)) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field.trim()); if (row.some((f) => f)) rows.push(row); }
  return rows;
}

async function existingSymbols(): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("stocks").select("symbol").order("symbol").range(from, from + 999);
    if (error) throw new Error("stocks read: " + error.message);
    (data || []).forEach((r: { symbol: string }) => out.add(r.symbol));
    if (!data || data.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  try {
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: sec } = await supabase.from("app_secrets").select("value").eq("name", "crypto_cron").maybeSingle();
    if (!sec || !secret || secret !== sec.value) return json({ error: "unauthorized" }, 401);
    const dryRun = new URL(req.url).searchParams.get("dry") === "1";

    const res = await fetch(LIST_URL, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" } });
    if (!res.ok) throw new Error("NSE list HTTP " + res.status);
    const rows = parseCsv(await res.text());
    const header = (rows.shift() || []).map((h) => h.toUpperCase());
    const col = (name: string) => header.findIndex((h) => h === name);
    const iSym = col("SYMBOL"), iName = col("NAME OF COMPANY"), iSeries = col("SERIES"), iListed = col("DATE OF LISTING"), iFace = col("FACE VALUE");
    if (iSym < 0 || iName < 0) throw new Error("Unexpected NSE list header: " + header.join("|"));
    if (rows.length < MIN_ROWS) throw new Error(`NSE list looks truncated (${rows.length} rows); nothing changed`);

    const have = await existingSymbols();
    const toAdd = rows
      .map((r) => ({
        symbol: (r[iSym] || "").toUpperCase(),
        company_name: r[iName] || null,
        series: iSeries >= 0 ? r[iSeries] : "",
        listed: iListed >= 0 ? r[iListed] : "",
        face_value: iFace >= 0 && Number.isFinite(Number(r[iFace])) ? Number(r[iFace]) : null,
      }))
      .filter((r) => /^[A-Z0-9&.-]+$/.test(r.symbol) && !have.has(r.symbol));

    if (!dryRun && toAdd.length) {
      for (let i = 0; i < toAdd.length; i += 500) {
        const batch = toAdd.slice(i, i + 500).map(({ symbol, company_name, face_value }) => ({
          symbol, company_name, face_value, exchange: "NSE", source: "NSE_EQUITY_L",
        }));
        // ignoreDuplicates: never overwrite a row that appeared since we read the list.
        const { error } = await supabase.from("stocks").upsert(batch, { onConflict: "symbol", ignoreDuplicates: true });
        if (error) throw new Error("stocks insert: " + error.message);
      }
      // Fetch prices for the new symbols now instead of waiting for the next scheduled run.
      const refresh = fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/sector-refresh?force=1", {
        method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": secret }, body: "{}",
      }).catch(() => {});
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(refresh);
    }

    const summary = {
      dry_run: dryRun, nse_listed: rows.length, already_known: have.size, added: dryRun ? 0 : toAdd.length,
      new_symbols: toAdd.map((r) => `${r.symbol} (${r.series}, listed ${r.listed})`),
    };
    console.log("STOCKS_SYNC", JSON.stringify({ ...summary, new_symbols: summary.new_symbols.length }));
    return json(summary);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.error("STOCKS_SYNC_FATAL", msg);
    return json({ error: msg }, 500);
  }
});
