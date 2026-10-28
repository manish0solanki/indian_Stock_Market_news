/* Shared stock search for MarketPulse pages.
   The Cloudflare worker's /stock-search keeps its own stock list, which misses recent
   NSE listings. The Supabase `stocks` table is kept current from NSE's equity list by
   the stocks-sync job, so results from both are merged (worker results first, since
   they carry richer fields; table rows fill in symbols the worker doesn't know).

   mpSearchStocks(query, { url, client, limit }) -> Promise<Array<{symbol, company_name, ...}>>
     url    full worker search endpoint, e.g. API_BASE + '/stock-search'
     client a supabase-js client (optional; without it only the worker is used)
   Throws only if both sources fail. */
(function () {
  'use strict';

  function workerItems(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.results)) return data.results;
    if (data && typeof data === 'object' && (data.symbol || data.company_name)) return [data];
    return [];
  }

  async function fromWorker(url, q) {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(q), { cache: 'no-store' });
    if (!res.ok) throw new Error('Stock search HTTP ' + res.status);
    return workerItems(await res.json());
  }

  async function fromTable(client, q, limit) {
    // PostgREST filter values: drop characters that have meaning in or()/ilike patterns.
    const term = q.replace(/[%_*,()"\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (term.length < 2) return [];
    const { data, error } = await client.from('stocks')
      .select('symbol,company_name,sector')
      .or(`symbol.ilike."${term}%",company_name.ilike."%${term}%"`)
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  window.mpSearchStocks = async function (query, opts = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const limit = opts.limit || 10;
    const [w, t] = await Promise.allSettled([
      opts.url ? fromWorker(opts.url, q) : Promise.resolve([]),
      opts.client ? fromTable(opts.client, q, limit) : Promise.resolve([]),
    ]);
    if (w.status === 'rejected' && t.status === 'rejected') throw w.reason;
    const out = [], seen = new Set();
    const add = s => {
      const sym = String(s?.symbol || '').trim().toUpperCase();
      if (!sym || seen.has(sym)) return;
      seen.add(sym);
      out.push(s);
    };
    if (w.status === 'fulfilled') w.value.forEach(add);
    if (t.status === 'fulfilled') t.value.forEach(add);
    // An exact symbol match (e.g. "JPL") goes to the top.
    const U = q.toUpperCase();
    out.sort((a, b) => (String(b.symbol).toUpperCase() === U) - (String(a.symbol).toUpperCase() === U));
    return out.slice(0, 15);
  };
})();
