/* F&O page: option chain, open interest, PCR, max pain and expected move for NSE indices and F&O stocks.
   Data: the option-chain Edge Function (NSE, cached a minute). Symbol and expiry live in the URL. */
(function () {
  const SUPABASE_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co';
  const KEY = 'sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq';
  const INDICES = [['NIFTY', 'Nifty 50'], ['BANKNIFTY', 'Bank Nifty'], ['FINNIFTY', 'Fin Nifty'], ['MIDCPNIFTY', 'Midcap Nifty'], ['NIFTYNXT50', 'Nifty Next 50']];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 2) => v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const big = (v) => { const a = Math.abs(v); const s = v < 0 ? '−' : ''; return a >= 1e7 ? s + (a / 1e7).toFixed(2) + ' Cr' : a >= 1e5 ? s + (a / 1e5).toFixed(1) + ' L' : a >= 1e3 ? s + (a / 1e3).toFixed(1) + 'K' : s + a.toLocaleString('en-IN'); };
  const signedBig = (v) => (v > 0 ? '+' : '') + big(v);
  const strikeTxt = (k) => k === null || k === undefined ? '—' : Number(k).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  let S = { symbol: 'NIFTY', expiry: '', range: '15', chart: 'oi' }, D = null, fnoStocks = [], timer = null;

  function load() {
    const p = new URLSearchParams(location.search);
    if (p.get('symbol')) S.symbol = p.get('symbol').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
    if (p.get('expiry')) S.expiry = p.get('expiry');
    try { const r = localStorage.getItem('mp-fno-range'); if (r) S.range = r; } catch (_) {}
  }
  function save() {
    const p = new URLSearchParams();
    if (S.symbol !== 'NIFTY') p.set('symbol', S.symbol);
    if (S.expiry && D && S.expiry !== D.expiries[0]) p.set('expiry', S.expiry);
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
  }

  async function fetchChain() {
    const q = 'symbol=' + encodeURIComponent(S.symbol) + (S.expiry ? '&expiry=' + encodeURIComponent(S.expiry) : '');
    const r = await fetch(SUPABASE_URL + '/functions/v1/option-chain?' + q, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || 'HTTP ' + r.status);
    return d;
  }

  async function refresh(showLoading) {
    if (showLoading) { $('status').hidden = false; $('status').textContent = 'Loading the option chain…'; }
    try {
      D = await fetchChain();
      S.expiry = D.expiry;
      $('status').hidden = true;
      render(); save();
    } catch (e) {
      $('status').hidden = false;
      $('status').textContent = (e.message || 'Could not load the option chain.') + ' Please try again in a minute.';
      if (showLoading) { $('content').hidden = true; }
    }
  }

  /* ───────── rendering ───────── */
  function pcrRead(p) {
    if (p === null) return ['—', ''];
    if (p >= 1.6) return ['Bullish, but stretched', 'up'];
    if (p >= 1.3) return ['Bullish tilt', 'up'];
    if (p >= 1) return ['Mildly bullish', 'up'];
    if (p > 0.7) return ['Neutral to mildly bearish', ''];
    if (p <= 0.5) return ['Bearish, but stretched', 'down'];
    return ['Bearish tilt', 'down'];
  }
  function stats() {
    const d = D, spot = d.spot, [pr, pt] = pcrRead(d.pcr);
    const away = (k) => k && spot ? ((k - spot) / spot * 100) : null;
    const awayTxt = (k) => { const a = away(k); return a === null ? '' : (Math.abs(a) < 0.05 ? 'at spot' : (a > 0 ? '+' : '−') + Math.abs(a).toFixed(1) + '% from spot'); };
    const lo = d.straddle && spot ? spot - d.straddle : null, hi = d.straddle && spot ? spot + d.straddle : null;
    const name = (INDICES.find((x) => x[0] === d.symbol) || [])[1] || d.symbol;
    return `
      <div class="stat"><div class="l">${esc(name)}</div><div class="v">${fmt(spot)}</div><div class="s">${d.timestamp ? 'NSE as of ' + esc(d.timestamp.replace(/:\d\d$/, '')) : ''}</div></div>
      <div class="stat"><div class="l">PCR (open interest)</div><div class="v ${pt}">${d.pcr === null ? '—' : d.pcr.toFixed(2)}</div><div class="s">${pr}${d.pcrVol !== null ? ' · volume PCR ' + d.pcrVol.toFixed(2) : ''}</div></div>
      <div class="stat"><div class="l">Max pain</div><div class="v">${strikeTxt(d.maxPain)}</div><div class="s">${awayTxt(d.maxPain)}</div></div>
      <div class="stat"><div class="l">Support (most put OI)</div><div class="v up">${strikeTxt(d.support)}</div><div class="s">${awayTxt(d.support)}</div></div>
      <div class="stat"><div class="l">Resistance (most call OI)</div><div class="v down">${strikeTxt(d.resistance)}</div><div class="s">${awayTxt(d.resistance)}</div></div>
      <div class="stat"><div class="l">Expected move by expiry</div><div class="v">${d.straddle ? '±' + fmt(d.straddle, 0) : '—'}</div><div class="s">${lo ? fmt(lo, 0) + ' – ' + fmt(hi, 0) : ''}${d.atmIV ? ' · ATM IV ' + d.atmIV.toFixed(1) + '%' : ''}</div></div>`;
  }
  function summary() {
    const d = D, t = d.totals, bits = [];
    if (d.pcr !== null) bits.push(`Put writers hold ${d.pcr >= 1 ? 'more' : 'less'} open interest than call writers (PCR ${d.pcr.toFixed(2)})`);
    if (d.support && d.resistance) bits.push(`the heaviest positions suggest a range of ${strikeTxt(d.support)} to ${strikeTxt(d.resistance)}`);
    if (d.maxPain && d.spot) bits.push(`max pain ${strikeTxt(d.maxPain)} is ${Math.abs(d.maxPain - d.spot) / d.spot < 0.005 ? 'close to spot' : (d.maxPain > d.spot ? 'above' : 'below') + ' spot'}`);
    let s = bits.length ? bits.join('; ') + '.' : '';
    if (t.ceChgOI || t.peChgOI) s += ` Today calls ${t.ceChgOI >= 0 ? 'added' : 'shed'} ${big(Math.abs(t.ceChgOI))} and puts ${t.peChgOI >= 0 ? 'added' : 'shed'} ${big(Math.abs(t.peChgOI))} contracts of open interest${t.peChgOI > t.ceChgOI ? ', more on the put side (supportive)' : t.ceChgOI > t.peChgOI ? ', more on the call side (capping)' : ''}.`;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function visibleRows() {
    const rows = D.rows;
    if (S.range === 'all' || !rows.length) return rows;
    const n = Number(S.range), i = rows.findIndex((r) => r[0] === D.atm);
    const c = i < 0 ? Math.floor(rows.length / 2) : i;
    return rows.slice(Math.max(0, c - n), c + n + 1);
  }
  function chart(rows) {
    const oi = S.chart === 'oi', ci = oi ? 1 : 2, pi = oi ? 7 : 8;
    const max = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r[ci]), Math.abs(r[pi]))));
    const w = (v) => (Math.abs(v) / max * 100).toFixed(1) + '%';
    let spotDone = false;
    return rows.map((r) => {
      let line = '';
      if (!spotDone && r[0] >= D.spot) { spotDone = true; line = `<div class="spotline"><span>Spot ${fmt(D.spot)}</span></div>`; }
      const tags = (r[0] === D.maxPain ? '<em>max pain</em>' : '');
      return line + `<div class="brow${r[0] === D.atm ? ' atm' : ''}">
        <div class="bside ce"><span class="bval">${oi ? big(r[ci]) : signedBig(r[ci])}</span><i class="${r[ci] < 0 ? 'neg' : ''}" style="width:${w(r[ci])}"></i></div>
        <div class="bk">${strikeTxt(r[0])}${tags}</div>
        <div class="bside pe"><i class="${r[pi] < 0 ? 'neg' : ''}" style="width:${w(r[pi])}"></i><span class="bval">${oi ? big(r[pi]) : signedBig(r[pi])}</span></div></div>`;
    }).join('') + (spotDone ? '' : `<div class="spotline"><span>Spot ${fmt(D.spot)}</span></div>`);
  }
  function table(rows) {
    const chg = (v) => v === 0 ? '<span class="muted">0</span>' : `<span class="${v > 0 ? 'up' : 'down'}">${signedBig(v)}</span>`;
    const px = (v, c) => v ? `<b>${fmt(v)}</b><small class="${c >= 0 ? 'up' : 'down'}">${c ? (c > 0 ? '+' : '') + fmt(c) : ''}</small>` : '<span class="muted">—</span>';
    const maxCe = Math.max(1, ...rows.map((r) => r[1])), maxPe = Math.max(1, ...rows.map((r) => r[7]));
    let spotDone = false;
    return rows.map((r) => {
      let line = '';
      if (!spotDone && r[0] >= D.spot) { spotDone = true; line = `<tr class="spotrow"><td colspan="11"><span>Spot ${fmt(D.spot)}</span></td></tr>`; }
      const ceItm = r[0] < D.spot, peItm = r[0] > D.spot;
      return line + `<tr class="${r[0] === D.atm ? 'atm' : ''}">
        <td class="r ce ${ceItm ? 'itm' : ''} oi"><span class="oibar" style="width:${(r[1] / maxCe * 100).toFixed(0)}%"></span>${big(r[1])}</td>
        <td class="r ce ${ceItm ? 'itm' : ''}">${chg(r[2])}</td>
        <td class="r ce ${ceItm ? 'itm' : ''} xs">${big(r[3])}</td>
        <td class="r ce ${ceItm ? 'itm' : ''} xs">${r[4] ? r[4].toFixed(1) : '—'}</td>
        <td class="r ce ${ceItm ? 'itm' : ''} px">${px(r[5], r[6])}</td>
        <td class="k">${strikeTxt(r[0])}</td>
        <td class="pe ${peItm ? 'itm' : ''} px">${px(r[11], r[12])}</td>
        <td class="pe ${peItm ? 'itm' : ''} xs">${r[10] ? r[10].toFixed(1) : '—'}</td>
        <td class="pe ${peItm ? 'itm' : ''} xs">${big(r[9])}</td>
        <td class="pe ${peItm ? 'itm' : ''}">${chg(r[8])}</td>
        <td class="pe ${peItm ? 'itm' : ''} oi"><span class="oibar" style="width:${(r[7] / maxPe * 100).toFixed(0)}%"></span>${big(r[7])}</td></tr>`;
    }).join('');
  }
  function render() {
    if (!D) return;
    $('content').hidden = false;
    $('stats').innerHTML = stats();
    $('summary').textContent = summary();
    const isStock = !INDICES.some((x) => x[0] === D.symbol);
    $('title').innerHTML = isStock ? `<span data-sym="${esc(D.symbol)}">${esc(D.symbol)}</span> option chain` : esc(((INDICES.find((x) => x[0] === D.symbol) || [])[1] || D.symbol)) + ' option chain';
    $('expiry').innerHTML = D.expiries.map((e) => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
    $('expiry').value = D.expiry;
    document.querySelectorAll('#idx [data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === D.symbol));
    if (isStock) $('stockIn').value = D.symbol;
    const rows = visibleRows();
    $('chart').innerHTML = chart(rows);
    $('tbody').innerHTML = table(rows);
    const t = D.totals;
    $('totals').innerHTML = `Total call OI <b>${big(t.ceOI)}</b> · put OI <b>${big(t.peOI)}</b> · contracts, all strikes of this expiry`;
    const atm = document.querySelector('#tbody tr.atm');
    if (atm && !render.scrolled) { render.scrolled = true; const w = $('tablewrap'); w.scrollTop += atm.getBoundingClientRect().top - w.getBoundingClientRect().top - w.clientHeight / 2;
      const c = $('chart'), b = c.querySelector('.brow.atm'); if (b) c.scrollTop += b.getBoundingClientRect().top - c.getBoundingClientRect().top - c.clientHeight / 2; }
  }

  function pick(sym) {
    sym = String(sym || '').toUpperCase().trim();
    if (!sym || sym === S.symbol) return;
    S.symbol = sym; S.expiry = ''; render.scrolled = false;
    refresh(true);
  }

  async function loadStocks() {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/stocks?select=symbol,company_name&is_fno=eq.true&order=symbol', { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
      fnoStocks = r.ok ? await r.json() : [];
      $('fnoList').innerHTML = fnoStocks.map((s) => `<option value="${esc(s.symbol)}">${esc(s.company_name || '')}</option>`).join('');
    } catch (_) {}
  }

  function marketOpen() {
    const t = new Date(Date.now() + 330 * 60e3), d = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
    return d > 0 && d < 6 && m >= 555 && m <= 935;
  }

  function wire() {
    $('idx').innerHTML = INDICES.map(([s, l]) => `<button type="button" class="chip" data-s="${s}">${l}</button>`).join('');
    $('idx').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) pick(b.dataset.s); });
    $('stockForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('stockIn').value.trim().toUpperCase();
      const hit = fnoStocks.find((s) => s.symbol === v) || fnoStocks.find((s) => (s.company_name || '').toUpperCase().includes(v));
      pick(hit ? hit.symbol : v);
    });
    $('stockIn').addEventListener('change', () => { const v = $('stockIn').value.trim().toUpperCase(); if (fnoStocks.some((s) => s.symbol === v)) pick(v); });
    $('expiry').addEventListener('change', () => { S.expiry = $('expiry').value; render.scrolled = false; refresh(true); });
    $('range').value = S.range;
    $('range').addEventListener('change', () => { S.range = $('range').value; try { localStorage.setItem('mp-fno-range', S.range); } catch (_) {} render.scrolled = false; render(); });
    $('chartMode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      S.chart = b.dataset.m;
      document.querySelectorAll('#chartMode [data-m]').forEach((x) => x.classList.toggle('on', x === b));
      render();
    });
  }

  function start() {
    load(); wire(); loadStocks(); refresh(true);
    // NSE updates the chain every few minutes in market hours: refresh each minute while visible.
    timer = setInterval(() => { if (!document.hidden && marketOpen()) refresh(false); }, 60e3);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
