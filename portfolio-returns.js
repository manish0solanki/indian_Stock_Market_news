/* Portfolio "Returns & tax" panel: XIRR, comparison with Nifty 50, SIP tracking and a capital-gains report,
   for stocks and mutual funds. Works only from the transactions already saved on the Portfolio page.
   portfolio.html calls window.mpReturns.render({ stockTx, fundTx, stocks, funds }) after every render.

   Method notes (also shown to the user):
   - XIRR uses every buy/sell as a cash flow plus today's value of what is still held.
   - "If invested in Nifty 50" buys/sells Nifty units with the same money on the same dates (price index,
     without dividends), so it shows what the same timing would have earned in the index.
   - Capital gains use FIFO lots. Equity (shares and equity-oriented funds): long term after 12 months;
     STCG 20% / LTCG 12.5% above ₹1.25 lakh a year for sales from 23 Jul 2024 (15% / 10% above ₹1 lakh before).
     Other funds bought from 1 Apr 2023 are taxed at your slab rate; earlier ones are long term after 24 months.
     Estimates only: no grandfathering (pre-2018), STT, surcharge or cess, and not tax advice. */
(function () {
  const HISTORY_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/index-history?index=NIFTY50';
  const DAY = 864e5;
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (v, d = 0) => (v < 0 ? '−' : '') + '₹' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sInr = (v) => (v >= 0 ? '+' : '−') + '₹' + Math.abs(Math.round(v)).toLocaleString('en-IN');
  const pct = (v, d = 1) => v === null || !Number.isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%';
  const tone = (v) => !Number.isFinite(v) || v === null ? '' : v >= 0 ? 'green' : 'red';
  const ms = (iso) => Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  const fmtDate = (iso) => iso ? new Date(ms(iso)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
  const todayIso = () => new Date(Date.now() + 330 * 60e3).toISOString().slice(0, 10);
  const fyOf = (iso) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); const s = m >= 4 ? y : y - 1; return `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`; };

  /* ───────── XIRR ───────── */
  // flows: [{ t: ms, v: amount }] with money invested negative and money received (incl. today's value) positive.
  function xirr(flows) {
    const f = flows.filter((x) => x.v && Number.isFinite(x.v)).sort((a, b) => a.t - b.t);
    if (f.length < 2 || !f.some((x) => x.v < 0) || !f.some((x) => x.v > 0)) return null;
    const t0 = f[0].t, yrs = f.map((x) => (x.t - t0) / (365 * DAY));
    const npv = (r) => f.reduce((s, x, i) => s + x.v / Math.pow(1 + r, yrs[i]), 0);
    const d = (r) => f.reduce((s, x, i) => s - yrs[i] * x.v / Math.pow(1 + r, yrs[i] + 1), 0);
    let r = 0.1;
    for (let i = 0; i < 60; i++) {
      const v = npv(r), dv = d(r);
      if (!Number.isFinite(v) || !Number.isFinite(dv) || dv === 0) break;
      const nr = r - v / dv;
      if (!Number.isFinite(nr) || nr <= -0.9999) break;
      if (Math.abs(nr - r) < 1e-8) return nr * 100;
      r = nr;
    }
    // Newton didn't settle: bisect between -99.99% and +1000%.
    let lo = -0.9999, hi = 10, flo = npv(lo), fhi = npv(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-6) return mid * 100;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return ((lo + hi) / 2) * 100;
  }

  /* ───────── Cash flows from saved transactions ───────── */
  const sortTx = (a, b) => String(a.trade_date).localeCompare(String(b.trade_date)) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
  function stockFlows(tx) {
    return [...tx].sort(sortTx).map((t) => {
      const q = n(t.quantity), p = n(t.price), c = n(t.charges);
      return { t: ms(t.trade_date), date: String(t.trade_date).slice(0, 10), v: t.transaction_type === 'BUY' ? -(q * p + c) : q * p - c, key: 'S:' + t.symbol };
    }).filter((x) => x.v);
  }
  function fundFlows(tx) {
    return [...tx].sort(sortTx).map((t) => {
      const amt = n(t.amount) || n(t.units) * n(t.nav);
      return { t: ms(t.trade_date), date: String(t.trade_date).slice(0, 10), v: t.transaction_type === 'BUY' ? -amt : amt, key: 'F:' + t.scheme_code };
    }).filter((x) => x.v);
  }

  /* ───────── Nifty 50 benchmark ───────── */
  let nifty = null, niftyLoading = null;
  function loadNifty() {
    if (nifty || niftyLoading) return niftyLoading;
    niftyLoading = fetch(HISTORY_URL).then((r) => r.json()).then((d) => { if (d?.ok && Array.isArray(d.closes)) nifty = d.closes; })
      .catch(() => {}).finally(() => { niftyLoading = null; if (last) draw(); });
    return niftyLoading;
  }
  // Close on that date, or the last close before it (weekends and holidays).
  function niftyOn(iso) {
    if (!nifty || !nifty.length) return null;
    let lo = 0, hi = nifty.length - 1, ans = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (nifty[mid][0] <= iso) { ans = nifty[mid][1]; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  function benchmark(flows) {
    if (!nifty || !flows.length || flows[0].date < nifty[0][0]) return null;
    let units = 0;
    const out = [];
    for (const f of flows) {
      const px = niftyOn(f.date);
      if (!px) return null;
      units += -f.v / px; // money in buys index units; money out sells them
      out.push({ t: f.t, v: f.v });
    }
    const latest = nifty[nifty.length - 1][1];
    const value = Math.max(0, units) * latest;
    return { value, xirr: xirr(out.concat([{ t: Date.now(), v: value }])), asOf: nifty[nifty.length - 1][0] };
  }

  /* ───────── SIP detection ───────── */
  function sips(fundTx, funds) {
    const byScheme = {};
    for (const t of fundTx) if (t.transaction_type === 'BUY') (byScheme[t.scheme_code] = byScheme[t.scheme_code] || []).push(t);
    const out = [];
    for (const [code, list] of Object.entries(byScheme)) {
      const buys = list.filter((t) => !/holding snapshot/i.test(t.notes || '')).sort(sortTx);
      if (buys.length < 3) continue;
      const amts = buys.map((t) => n(t.amount) || n(t.units) * n(t.nav));
      const gaps = buys.slice(1).map((t, i) => (ms(t.trade_date) - ms(buys[i].trade_date)) / DAY);
      const monthly = gaps.filter((g) => g >= 25 && g <= 38).length, weekly = gaps.filter((g) => g >= 6 && g <= 8).length;
      const tagged = buys.filter((t) => /\bsip\b|systematic/i.test(t.notes || '')).length;
      const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const amt = med(amts.slice(-6));
      const steady = amts.slice(-6).filter((a) => Math.abs(a - amt) <= amt * 0.12).length >= Math.min(3, amts.length);
      const freq = weekly > monthly ? 'Weekly' : 'Monthly';
      const regular = (freq === 'Monthly' ? monthly : weekly) >= Math.max(2, Math.floor(gaps.length * 0.6));
      if (!(tagged >= 2 || (regular && steady))) continue;
      const lastD = buys[buys.length - 1].trade_date, step = freq === 'Monthly' ? 30.4 : 7;
      const next = new Date(ms(lastD) + step * DAY).toISOString().slice(0, 10);
      const fund = funds.find((f) => String(f.code) === String(code)) || {};
      const flows = fundFlows(list);
      const value = n(fund.current);
      out.push({
        code, name: fund.name || buys[0].scheme_name, freq, amount: amt, count: buys.length, since: buys[0].trade_date, last: lastD, next,
        active: (Date.now() - ms(lastD)) / DAY <= (freq === 'Monthly' ? 45 : 14),
        invested: amts.reduce((s, a) => s + a, 0), value, xirr: value ? xirr(flows.concat([{ t: Date.now(), v: value }])) : null,
      });
    }
    return out.sort((a, b) => b.invested - a.invested);
  }

  /* ───────── Capital gains (FIFO) ───────── */
  const EQUITY_RE = /equity|elss|index|etf|large cap|mid cap|small cap|multi cap|flexi|focused|value|contra|dividend yield|sectoral|thematic|aggressive hybrid|arbitrage|equity savings|balanced advantage|dynamic asset/i;
  const NEW_RATE_FROM = '2024-07-23';
  function classify(kind, buyIso, sellIso, category) {
    const held = (ms(sellIso) - ms(buyIso)) / DAY;
    if (kind === 'stock' || EQUITY_RE.test(category || '')) return held > 365 ? 'LTCG' : 'STCG';
    if (buyIso >= '2023-04-01') return 'SLAB';
    return held > 730 ? 'LTCG_OTHER' : 'SLAB';
  }
  function lotsReport(stockTx, fundTx, stocks, funds, catOf) {
    const realised = [], unreal = [];
    const run = (key, kind, label, rows, qtyOf, pxOf, chargesOf, current, category) => {
      const lots = [];
      for (const t of rows) {
        const q = qtyOf(t); if (!q) continue;
        const d = String(t.trade_date).slice(0, 10);
        if (t.transaction_type === 'BUY') { lots.push({ d, q, cost: (pxOf(t) * q + chargesOf(t)) / q }); continue; }
        let left = q; const sellPx = pxOf(t) - chargesOf(t) / q;
        while (left > 1e-9 && lots.length) {
          const lot = lots[0], take = Math.min(lot.q, left);
          realised.push({ key, kind, label, buy: lot.d, sell: d, qty: take, cost: take * lot.cost, value: take * sellPx, type: classify(kind, lot.d, d, category) });
          lot.q -= take; left -= take; if (lot.q <= 1e-9) lots.shift();
        }
      }
      if (current && current.price) for (const lot of lots) {
        const today = todayIso(), type = classify(kind, lot.d, today, category);
        const lt = kind === 'stock' || EQUITY_RE.test(category || '') ? 365 : 730;
        const ltOn = new Date(ms(lot.d) + (lt + 1) * DAY).toISOString().slice(0, 10);
        unreal.push({ key, kind, label, buy: lot.d, qty: lot.q, cost: lot.q * lot.cost, value: lot.q * current.price, type, ltOn });
      }
    };
    const bySym = {};
    for (const t of [...stockTx].sort(sortTx)) (bySym[t.symbol] = bySym[t.symbol] || []).push(t);
    for (const [sym, rows] of Object.entries(bySym)) {
      const h = stocks.find((x) => x.symbol === String(sym).toUpperCase().trim()) || stocks.find((x) => x.symbol === sym);
      run('S:' + sym, 'stock', sym, rows, (t) => n(t.quantity), (t) => n(t.price), (t) => n(t.charges), h ? { price: n(h.ltp) } : null, '');
    }
    const byCode = {};
    for (const t of [...fundTx].sort(sortTx)) (byCode[t.scheme_code] = byCode[t.scheme_code] || []).push(t);
    for (const [code, rows] of Object.entries(byCode)) {
      const f = funds.find((x) => String(x.code) === String(code));
      const name = (f && f.name) || rows[0].scheme_name || code;
      run('F:' + code, 'fund', String(name).split(/\s+-\s+/)[0], rows, (t) => n(t.units), (t) => n(t.nav) || (n(t.amount) / (n(t.units) || 1)), () => 0, f ? { price: n(f.nav) } : null, catOf(code, name));
    }
    return { realised, unreal };
  }
  function fySummary(rows) {
    const fys = {};
    for (const r of rows) {
      const fy = fyOf(r.sell), g = r.value - r.cost;
      const s = fys[fy] = fys[fy] || { fy, stcg: 0, ltcg: 0, ltcgOther: 0, slab: 0, tax: 0, newRates: false, rows: [] };
      s.rows.push(r);
      if (r.type === 'STCG') s.stcg += g; else if (r.type === 'LTCG') s.ltcg += g; else if (r.type === 'LTCG_OTHER') s.ltcgOther += g; else s.slab += g;
      if (r.sell >= NEW_RATE_FROM) s.newRates = true;
    }
    for (const s of Object.values(fys)) {
      // Sales from 23 Jul 2024: STCG 20%, LTCG 12.5% above ₹1.25 lakh. Earlier FYs: 15% and 10% above ₹1 lakh.
      const [st, lt, ex] = s.newRates ? [0.20, 0.125, 125000] : [0.15, 0.10, 100000];
      s.exemption = ex;
      s.tax = Math.max(0, s.stcg) * st + Math.max(0, s.ltcg - ex) * lt + Math.max(0, s.ltcgOther) * 0.125;
      s.rates = s.newRates ? 'STCG 20%, LTCG 12.5% above ₹1.25 lakh' : 'STCG 15%, LTCG 10% above ₹1 lakh';
    }
    return Object.values(fys).sort((a, b) => b.fy.localeCompare(a.fy));
  }
  const TYPE_LABEL = { STCG: 'Short term', LTCG: 'Long term', LTCG_OTHER: 'Long term (non-equity)', SLAB: 'Slab rate' };

  /* ───────── Rendering ───────── */
  let last = null, tab = 'returns';
  try { tab = localStorage.getItem('mp-returns-tab') || 'returns'; } catch (_) {}
  function host() {
    let el = document.getElementById('returnsPanel');
    if (el) return el;
    el = document.createElement('section');
    el.className = 'panel rt-panel'; el.id = 'returnsPanel';
    const after = document.getElementById('insights');
    after.parentNode.insertBefore(el, after.nextSibling);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rt-tab]');
      if (b) { tab = b.dataset.rtTab; try { localStorage.setItem('mp-returns-tab', tab); } catch (_) {} draw(); return; }
      if (e.target.closest('#rtCsv')) downloadCsv();
    });
    return el;
  }

  function returnsTab(d) {
    const block = (label, flows, value, holdingsCost) => {
      if (!flows.length) return '';
      const invested = -flows.filter((f) => f.v < 0).reduce((s, f) => s + f.v, 0), received = flows.filter((f) => f.v > 0).reduce((s, f) => s + f.v, 0);
      const gain = value + received - invested;
      const days = (Date.now() - flows[0].t) / DAY;
      const x = days >= 30 ? xirr(flows.concat([{ t: Date.now(), v: value }])) : null;
      const b = benchmark(flows);
      const diff = b ? value - b.value : null;
      return `<div class="rt-card">
        <div class="rt-l">${label}</div>
        <div class="rt-big ${tone(x ?? gain)}">${x === null ? (days < 30 ? 'Too new' : '—') : pct(x)}<small>${x === null ? (days < 30 ? 'XIRR shows after 30 days' : 'XIRR') : 'XIRR (annualised)'}</small></div>
        <div class="rt-kv"><span>Invested</span><b>${inr(invested)}</b><span>Withdrawn</span><b>${inr(received)}</b><span>Value today</span><b>${inr(value)}</b><span>Total gain</span><b class="${tone(gain)}">${sInr(gain)}</b></div>
        ${b ? `<div class="rt-bench"><span>Same money in Nifty 50</span><b>${inr(b.value)}</b><em class="${tone(diff)}">${diff >= 0 ? 'You are ahead by ' : 'You are behind by '}${inr(Math.abs(diff))}${b.xirr !== null && x !== null ? ` · Nifty XIRR ${pct(b.xirr)}` : ''}</em></div>`
          : `<div class="rt-bench muted">${nifty ? 'Nifty comparison needs transactions from the last 10 years.' : 'Loading Nifty 50 history…'}</div>`}
      </div>`;
    };
    const all = d.sFlows.concat(d.fFlows).sort((a, b) => a.t - b.t);
    const snapshotOnly = d.fundTx.length && d.fundTx.every((t) => /holding snapshot/i.test(t.notes || ''));
    return `<div class="rt-grid">${block('Whole portfolio', all, d.sValue + d.fValue)}${block('Stocks', d.sFlows, d.sValue)}${block('Mutual funds', d.fFlows, d.fValue)}</div>` +
      (snapshotOnly ? '<div class="rt-warn">Your mutual funds were imported from a <b>summary</b> CAS (one holding per fund, dated the day of import), so their XIRR and the Nifty comparison can\'t reflect when you really invested. Import a <b>Detailed</b> CAS from your first investment date for accurate returns and SIP tracking.</div>' : '') +
      '<p class="rt-note">XIRR is the yearly return that accounts for when each rupee went in and came out. The Nifty 50 comparison invests and withdraws the same amounts on the same dates in the index (price index, dividends not included). Holdings without a live price are valued at cost.</p>';
  }

  function sipTab(d) {
    const list = sips(d.fundTx, d.funds);
    if (!list.length) return `<div class="rt-empty"><b>No SIPs found yet</b><span>SIPs are recognised from regular purchases (3 or more, about a month or a week apart, similar amounts) or CAS lines marked SIP. ${d.fundTx.some((t) => /holding snapshot/i.test(t.notes || '')) ? 'Your funds came from a summary CAS without the individual instalments: import a <b>Detailed</b> CAS to see your SIPs.' : 'Add each instalment as a purchase, or import a Detailed CAS.'}</span></div>`;
    const monthly = list.filter((s) => s.active).reduce((s, x) => s + (x.freq === 'Monthly' ? x.amount : x.amount * 52 / 12), 0);
    return `<div class="rt-sipsum"><div><span>Active SIPs</span><b>${list.filter((s) => s.active).length}</b></div><div><span>Monthly commitment</span><b>${inr(monthly)}</b></div><div><span>Invested through SIPs</span><b>${inr(list.reduce((s, x) => s + x.invested, 0))}</b></div></div>
      <div class="tablewrap"><table class="rt-table"><thead><tr><th>Fund</th><th class="r">Amount</th><th>Since</th><th class="r">Instalments</th><th class="r">Invested</th><th class="r">Value</th><th class="r">XIRR</th><th>Next due</th></tr></thead><tbody>
      ${list.map((s) => `<tr><td><b>${esc(String(s.name).split(/\s+-\s+/)[0])}</b><small>${s.freq}${s.active ? '' : ' · paused?'}</small></td><td class="r">${inr(s.amount)}</td><td>${fmtDate(s.since)}</td><td class="r">${s.count}</td><td class="r">${inr(s.invested)}</td><td class="r">${s.value ? inr(s.value) : '—'}</td><td class="r ${tone(s.xirr)}">${pct(s.xirr)}</td><td>${s.active ? fmtDate(s.next) : '<span class="muted">No recent instalment</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="rt-note">Value and XIRR are for the whole fund holding (including any lump-sum purchases). "Next due" is estimated from your last instalment.</p>`;
  }

  function gainsTab(d) {
    const { realised, unreal } = d.gains;
    const fys = fySummary(realised);
    const curFy = fyOf(todayIso());
    const ltThisFy = (fys.find((f) => f.fy === curFy)?.ltcg) || 0;
    const uSt = unreal.filter((u) => u.type === 'STCG').reduce((s, u) => s + u.value - u.cost, 0);
    const uLt = unreal.filter((u) => u.type === 'LTCG').reduce((s, u) => s + u.value - u.cost, 0);
    const uOther = unreal.filter((u) => u.type !== 'STCG' && u.type !== 'LTCG').reduce((s, u) => s + u.value - u.cost, 0);
    const soon = unreal.filter((u) => u.type === 'STCG' && u.value > u.cost && ms(u.ltOn) - Date.now() <= 60 * DAY);
    const room = Math.max(0, 125000 - Math.max(0, ltThisFy));
    const summary = `<div class="rt-grid">
      <div class="rt-card"><div class="rt-l">Booked this year (${curFy})</div>${(() => { const s = fys.find((f) => f.fy === curFy); return s ? `<div class="rt-kv"><span>Short-term (equity)</span><b class="${tone(s.stcg)}">${sInr(s.stcg)}</b><span>Long-term (equity)</span><b class="${tone(s.ltcg)}">${sInr(s.ltcg)}</b><span>At slab rate</span><b class="${tone(s.slab)}">${sInr(s.slab)}</b><span>Estimated tax</span><b>${inr(s.tax)}</b></div>` : '<p class="muted">No sales this financial year.</p>'; })()}</div>
      <div class="rt-card"><div class="rt-l">Not yet booked (if sold today)</div><div class="rt-kv"><span>Short-term (equity)</span><b class="${tone(uSt)}">${sInr(uSt)}</b><span>Long-term (equity)</span><b class="${tone(uLt)}">${sInr(uLt)}</b><span>Other funds</span><b class="${tone(uOther)}">${sInr(uOther)}</b></div></div>
      <div class="rt-card"><div class="rt-l">Tax-free LTCG left this year</div><div class="rt-big">${inr(room)}<small>of ₹1.25 lakh equity LTCG exemption</small></div>
        ${soon.length ? `<p class="rt-tip">${soon.length} profitable lot${soon.length > 1 ? 's turn' : ' turns'} long-term in the next 60 days (first: ${esc(soon.sort((a, b) => a.ltOn.localeCompare(b.ltOn))[0].label)} on ${fmtDate(soon[0].ltOn)}). Selling after that date lowers the tax rate.</p>` : ''}</div>
    </div>`;
    const table = fys.length ? fys.map((s, i) => `<details class="rt-fy" ${i === 0 ? 'open' : ''}><summary><b>${s.fy}</b><span>STCG <b class="${tone(s.stcg)}">${sInr(s.stcg)}</b> · LTCG <b class="${tone(s.ltcg)}">${sInr(s.ltcg)}</b>${s.slab ? ` · Slab <b class="${tone(s.slab)}">${sInr(s.slab)}</b>` : ''} · Est. tax <b>${inr(s.tax)}</b></span></summary>
        <div class="tablewrap"><table class="rt-table"><thead><tr><th>Holding</th><th>Bought</th><th>Sold</th><th class="r">Qty / units</th><th class="r">Cost</th><th class="r">Sale value</th><th class="r">Gain</th><th>Type</th></tr></thead><tbody>
        ${s.rows.map((r) => `<tr><td><b${r.kind === 'stock' ? ` data-sym="${esc(r.key)}"` : ''}>${esc(r.label)}</b><small>${r.kind === 'stock' ? 'Share' : 'Mutual fund'}</small></td><td>${fmtDate(r.buy)}</td><td>${fmtDate(r.sell)}</td><td class="r">${+r.qty.toFixed(4)}</td><td class="r">${inr(r.cost, 2)}</td><td class="r">${inr(r.value, 2)}</td><td class="r ${tone(r.value - r.cost)}">${sInr(r.value - r.cost)}</td><td>${TYPE_LABEL[r.type]}</td></tr>`).join('')}
        </tbody></table></div><p class="rt-note">${s.rates}. Slab-rate gains are added to your income and taxed at your income-tax slab.</p></details>`).join('')
      : '<div class="rt-empty"><b>No sales recorded yet</b><span>Capital gains appear here when you record a sale of shares or a redemption of fund units.</span></div>';
    return summary + `<div class="rt-head2"><b>Realised gains by financial year</b>${realised.length ? '<button type="button" class="btn sm" id="rtCsv">⇩ Download CSV</button>' : ''}</div>` + table +
      '<p class="rt-note"><b>Estimate only, not tax advice.</b> Uses first-in-first-out lots. Shares and equity-oriented funds are long term after 12 months; other funds bought from 1 Apr 2023 are taxed at your slab rate (earlier purchases are long term after 24 months). Brokerage you entered is included; STT, surcharge, cess, grandfathering of pre-2018 gains and set-off of losses are not. Check with your CA or the capital-gains statement from your broker / CAMS before filing.</p>';
  }

  function downloadCsv() {
    if (!last) return;
    const rows = [['Financial year', 'Type', 'Holding', 'Asset', 'Buy date', 'Sell date', 'Quantity', 'Cost', 'Sale value', 'Gain']];
    for (const r of last.gains.realised) rows.push([fyOf(r.sell), TYPE_LABEL[r.type], r.label, r.kind === 'stock' ? 'Share' : 'Mutual fund', r.buy, r.sell, r.qty.toFixed(4), r.cost.toFixed(2), r.value.toFixed(2), (r.value - r.cost).toFixed(2)]);
    const csv = rows.map((r) => r.map((c) => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'marketpulse-capital-gains.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function draw() {
    const d = last, el = host();
    if (!d || (!d.stockTx.length && !d.fundTx.length)) { el.hidden = true; return; }
    el.hidden = false;
    const tabs = [['returns', 'Returns vs Nifty'], ['sip', 'SIPs'], ['gains', 'Capital gains']];
    el.innerHTML = `<div class="panelhead"><div><span class="paneltitle">Returns &amp; tax</span><div class="muted" style="font-size:12px">XIRR, Nifty 50 comparison, SIPs and capital gains from your transactions</div></div>
      <div class="rt-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-rt-tab="${k}" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="rt-body">${tab === 'sip' ? sipTab(d) : tab === 'gains' ? gainsTab(d) : returnsTab(d)}</div>`;
  }

  window.mpReturns = {
    xirr, // exposed for testing
    render({ stockTx = [], fundTx = [], stocks = [], funds = [], catOf = () => '' }) {
      const value = (list) => list.reduce((s, x) => s + (n(x.current) || n(x.cost)), 0);
      last = {
        stockTx, fundTx, stocks, funds,
        sFlows: stockFlows(stockTx), fFlows: fundFlows(fundTx),
        sValue: value(stocks), fValue: value(funds),
        gains: lotsReport(stockTx, fundTx, stocks, funds, catOf),
      };
      loadNifty();
      draw();
    },
  };
})();
