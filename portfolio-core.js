/* Portfolio summary shared by the Home page card: stocks (portfolio_transactions, priced in one
   batch through the stock_quotes_for RPC) plus mutual funds (portfolio_mf_transactions, NAVs from
   the mf-data function). Holdings use the average-cost method, like portfolio.html.
   window.mpPortfolio.summary(sb, user) -> { stocks, funds, totals, at } or null when no portfolio.
   window.mpPortfolio.heldSymbols(sb, user) -> symbols of the stocks currently held.
   The last summary is kept in localStorage per user so the card can show it instantly. */
(function () {
  const MF_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/mf-data';
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const clean = (s) => String(s || '').trim().toUpperCase();
  const byDate = (a, b) => String(a.trade_date).localeCompare(String(b.trade_date)) || String(a.created_at).localeCompare(String(b.created_at));

  function positions(rows, key, qtyField, costOf) {
    const map = {};
    for (const t of [...rows].sort(byDate)) {
      const k = key(t); if (!k) continue;
      const m = map[k] || (map[k] = { key: k, qty: 0, cost: 0, row: t });
      const q = num(t[qtyField]);
      if (String(t.transaction_type).toUpperCase() === 'BUY') { m.qty += q; m.cost += costOf(t); }
      else if (m.qty > 0) { const avg = m.cost / m.qty; m.cost -= Math.min(q, m.qty) * avg; m.qty = Math.max(0, m.qty - q); }
    }
    return Object.values(map).filter((m) => m.qty > 1e-6);
  }

  async function summary(sb, user) {
    const { data: p, error: pe } = await sb.from('portfolios').select('id').eq('user_id', user.id).order('created_at').limit(1).maybeSingle();
    if (pe) throw pe;
    if (!p) return null;
    const [st, mf] = await Promise.all([
      sb.from('portfolio_transactions').select('symbol,transaction_type,quantity,price,charges,trade_date,created_at').eq('portfolio_id', p.id),
      sb.from('portfolio_mf_transactions').select('scheme_code,scheme_name,transaction_type,units,nav,amount,trade_date,created_at').eq('portfolio_id', p.id),
    ]);
    if (st.error) throw st.error;
    const stockPos = positions(st.data || [], (t) => clean(t.symbol), 'quantity', (t) => num(t.quantity) * num(t.price) + num(t.charges));
    const fundPos = mf.error ? [] : positions(mf.data || [], (t) => t.scheme_code, 'units', (t) => num(t.amount) || num(t.units) * num(t.nav));

    const [quotes, navs] = await Promise.all([
      stockPos.length ? sb.rpc('stock_quotes_for', { p_symbols: stockPos.map((s) => s.key) }).then((r) => r.data || []).catch(() => []) : [],
      fundPos.length ? fetch(MF_URL + '?codes=' + fundPos.map((f) => f.key).slice(0, 40).join(',')).then((r) => r.json()).then((d) => d.funds || []).catch(() => []) : [],
    ]);
    const q = Object.fromEntries((Array.isArray(quotes) ? quotes : []).map((x) => [clean(x.symbol), x]));
    const n = Object.fromEntries(navs.map((x) => [String(x.code), x]));

    const stocks = stockPos.map((s) => {
      const x = q[s.key] || {}, price = num(x.price), prev = num(x.previous_close);
      const current = price ? s.qty * price : 0;
      return { kind: 'stock', id: s.key, name: s.key, longName: x.name || s.key, qty: s.qty, cost: s.cost, price, current,
        day: price && prev ? s.qty * (price - prev) : 0, dayPct: price && prev ? (price - prev) / prev * 100 : null,
        pnl: current ? current - s.cost : 0, pct: current && s.cost ? (current - s.cost) / s.cost * 100 : null };
    });
    const funds = fundPos.map((f) => {
      const x = n[f.key] || {}, nav = num(x.nav), prev = num(x.prev_nav);
      const name = x.name || f.row.scheme_name || f.key;
      const current = nav ? f.qty * nav : 0;
      return { kind: 'fund', id: f.key, name: String(name).split(/\s+-\s+/)[0], longName: name, category: x.category || '', navDate: x.nav_date || '', qty: f.qty, cost: f.cost, price: nav, current,
        day: nav && prev ? f.qty * (nav - prev) : 0, dayPct: nav && prev ? (nav - prev) / prev * 100 : null,
        pnl: current ? current - f.cost : 0, pct: current && f.cost ? (current - f.cost) / f.cost * 100 : null };
    });

    const all = [...stocks, ...funds];
    const sum = (list, fn) => list.reduce((a, x) => a + fn(x), 0);
    // Unpriced holdings count at cost in the value and are left out of P&L.
    const value = (list) => sum(list, (x) => x.current || x.cost);
    const pnlOf = (list) => sum(list, (x) => x.current ? x.current - x.cost : 0);
    const pricedCost = (list) => sum(list, (x) => x.current ? x.cost : 0);
    const day = sum(all, (x) => x.day), pricedValue = sum(all, (x) => x.current);
    // Day change for one class, as a percent of that class's priced value at the previous close.
    const dayOf = (list) => { const d = sum(list, (x) => x.day), base = sum(list, (x) => x.current) - d; return { day: d, dayPct: base > 0 ? d / base * 100 : null }; };
    const totals = {
      value: value(all), invested: sum(all, (x) => x.cost), pnl: pnlOf(all), pct: pricedCost(all) ? pnlOf(all) / pricedCost(all) * 100 : 0,
      day, dayPct: pricedValue - day > 0 ? day / (pricedValue - day) * 100 : 0,
      stocks: { value: value(stocks), invested: sum(stocks, (x) => x.cost), pnl: pnlOf(stocks), pct: pricedCost(stocks) ? pnlOf(stocks) / pricedCost(stocks) * 100 : null, count: stocks.length, ...dayOf(stocks) },
      funds: { value: value(funds), invested: sum(funds, (x) => x.cost), pnl: pnlOf(funds), pct: pricedCost(funds) ? pnlOf(funds) / pricedCost(funds) * 100 : null, count: funds.length, ...dayOf(funds) },
      priced: all.filter((x) => x.current).length, count: all.length,
    };
    const out = { stocks, funds, totals, at: Date.now() };
    try { localStorage.setItem('mp-portfolio-snapshot:' + user.id, JSON.stringify(out)); } catch (_) {}
    return out;
  }

  // Symbols of the stocks currently held (net quantity above zero), for the "My stocks" ticker.
  async function heldSymbols(sb, user) {
    const { data: p } = await sb.from('portfolios').select('id').eq('user_id', user.id).order('created_at').limit(1).maybeSingle();
    if (!p) return [];
    const { data, error } = await sb.from('portfolio_transactions').select('symbol,transaction_type,quantity,trade_date,created_at').eq('portfolio_id', p.id);
    if (error) throw error;
    return positions(data || [], (t) => clean(t.symbol), 'quantity', () => 0).map((s) => s.key);
  }

  function cached(user) {
    try { return JSON.parse(localStorage.getItem('mp-portfolio-snapshot:' + user.id) || 'null'); } catch (_) { return null; }
  }

  window.mpPortfolio = { summary, cached, heldSymbols };
})();
