/* Stock screener: every NSE stock with a recent quote from stock_screener() (Supabase), filtered and
   sorted in the browser. Filters live in the URL (shareable) and are remembered on this device. */
(function () {
  const SUPABASE_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co';
  const KEY = 'sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 2) => v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const cr = (v) => v === null || v === undefined ? '—' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' Cr';
  const pct = (v, d = 2) => v === null || v === undefined ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%';

  // Row layout from stock_screener(): see supabase/stock-screener.sql
  let rows = [], meta = {};
  const toObj = (r) => ({
    sym: r[0], name: r[1], sector: r[2], industry: r[3], price: r[4], chg: r[5], mcap: r[6], pe: r[7], roe: r[8], roce: r[9],
    dy: r[10], pb: r[11], volr: r[12], hi: r[13], lo: r[14], d50: r[15], d200: r[16], fno: r[17],
  });

  // During market hours today's volume is only part of a day; scale it by the share of the session gone.
  function sessionFrac() {
    const t = new Date(Date.now() + 330 * 60e3), d = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
    if (d === 0 || d === 6 || m < 555 || m >= 930) return 1;
    return Math.max(0.1, (m - 555) / 375);
  }

  const MCAP = { large: [20000, Infinity], mid: [5000, 20000], small: [500, 5000], micro: [0, 500] };
  const DEFAULTS = { q: '', sector: '', cap: '', peMin: '', peMax: '', pbMax: '', roeMin: '', roceMin: '', dyMin: '', w52: '', vol: '', trend: '', chg: '', fno: '', sort: 'mcap', dir: 'desc' };
  let F = { ...DEFAULTS }, shown = 50;

  const PRESETS = [
    { id: 'quality', label: 'Quality at a fair price', hint: 'ROE and ROCE 15%+, P/E 25 or less, ₹1,000 Cr+', f: { roeMin: 15, roceMin: 15, peMax: 25, cap: 'notmicro', sort: 'roe', dir: 'desc' } },
    { id: 'leaders', label: 'Large caps in uptrend', hint: '₹20,000 Cr+ and above the 200-day average', f: { cap: 'large', trend: 'above200', sort: 'mcap', dir: 'desc' } },
    { id: 'highs', label: 'Near 52-week high', hint: 'Within 3% of the 52-week high, ₹1,000 Cr+', f: { w52: 'nearHigh', cap: 'notmicro', sort: 'fromHigh', dir: 'asc' } },
    { id: 'lows', label: 'Near 52-week low', hint: 'Within 5% of the 52-week low, ₹1,000 Cr+', f: { w52: 'nearLow', cap: 'notmicro', sort: 'fromLow', dir: 'asc' } },
    { id: 'volume', label: 'Volume spikes', hint: '2× normal volume and a 2%+ move, ₹500 Cr+', f: { vol: '2', chg: 'big', cap: 'notmicro500', sort: 'volr', dir: 'desc' } },
    { id: 'dividend', label: 'High dividend', hint: 'Dividend yield 3%+, ₹1,000 Cr+', f: { dyMin: 3, cap: 'notmicro', sort: 'dy', dir: 'desc' } },
    { id: 'value', label: 'Value picks', hint: 'P/B 1.5 or less, ROE 12%+, P/E 15 or less', f: { pbMax: 1.5, roeMin: 12, peMax: 15, cap: 'notmicro500', sort: 'pe', dir: 'asc' } },
    { id: 'gainers', label: "Today's gainers", hint: 'Up today, ₹1,000 Cr+', f: { chg: 'up', cap: 'notmicro', sort: 'chg', dir: 'desc' } },
  ];

  const num = (v) => v === '' || v === null || v === undefined ? null : Number(v);
  function pass(s) {
    if (F.q) { const q = F.q.toLowerCase(); if (!s.sym.toLowerCase().includes(q) && !String(s.name).toLowerCase().includes(q)) return false; }
    if (F.sector && s.sector !== F.sector) return false;
    if (F.cap) {
      if (s.mcap === null) return false;
      if (F.cap === 'notmicro') { if (s.mcap < 1000) return false; }
      else if (F.cap === 'notmicro500') { if (s.mcap < 500) return false; }
      else { const [lo, hi] = MCAP[F.cap]; if (s.mcap < lo || s.mcap >= hi) return false; }
    }
    const rng = (v, min, max) => (min === null || (v !== null && v >= min)) && (max === null || (v !== null && v <= max));
    if (!rng(s.pe, num(F.peMin), num(F.peMax))) return false;
    if (!rng(s.pb, null, num(F.pbMax))) return false;
    if (!rng(s.roe, num(F.roeMin), null)) return false;
    if (!rng(s.roce, num(F.roceMin), null)) return false;
    if (!rng(s.dy, num(F.dyMin), null)) return false;
    if (F.w52) {
      if (!s.hi || !s.lo) return false;
      const fromHigh = (s.hi - s.price) / s.hi * 100, fromLow = (s.price - s.lo) / s.lo * 100;
      if (F.w52 === 'newHigh' && fromHigh > 1) return false;
      if (F.w52 === 'nearHigh' && fromHigh > 3) return false;
      if (F.w52 === 'nearLow' && fromLow > 5) return false;
      if (F.w52 === 'newLow' && fromLow > 1) return false;
      if (F.w52 === 'far' && fromHigh < 30) return false;
    }
    if (F.vol) { const v = s.volr === null ? null : s.volr / sessionFrac(); if (v === null || v < Number(F.vol)) return false; }
    if (F.trend) {
      if (F.trend === 'above50' && !(s.d50 && s.price > s.d50)) return false;
      if (F.trend === 'above200' && !(s.d200 && s.price > s.d200)) return false;
      if (F.trend === 'aboveBoth' && !(s.d50 && s.d200 && s.price > s.d50 && s.price > s.d200)) return false;
      if (F.trend === 'below200' && !(s.d200 && s.price < s.d200)) return false;
      if (F.trend === 'golden' && !(s.d50 && s.d200 && s.d50 > s.d200)) return false;
    }
    if (F.chg) {
      const c = s.chg; if (c === null) return false;
      if (F.chg === 'up' && c <= 0) return false;
      if (F.chg === 'down' && c >= 0) return false;
      if (F.chg === 'big' && Math.abs(c) < 2) return false;
      if (F.chg === 'up3' && c < 3) return false;
      if (F.chg === 'down3' && c > -3) return false;
    }
    if (F.fno && !s.fno) return false;
    return true;
  }
  const SORTS = {
    mcap: (s) => s.mcap, chg: (s) => s.chg, price: (s) => s.price, pe: (s) => s.pe, pb: (s) => s.pb, roe: (s) => s.roe, roce: (s) => s.roce, dy: (s) => s.dy,
    volr: (s) => s.volr, fromHigh: (s) => s.hi ? (s.hi - s.price) / s.hi : null, fromLow: (s) => s.lo ? (s.price - s.lo) / s.lo : null, sym: (s) => s.sym,
  };
  function results() {
    const list = rows.filter(pass), key = SORTS[F.sort] || SORTS.mcap, dir = F.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = key(a), y = key(b);
      if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
  }

  /* ───────── rendering ───────── */
  function range52(s) {
    if (!s.hi || !s.lo || s.hi <= s.lo) return '<span class="muted">—</span>';
    const p = Math.max(0, Math.min(100, (s.price - s.lo) / (s.hi - s.lo) * 100));
    return `<div class="r52" title="52-week low ₹${fmt(s.lo)} · high ₹${fmt(s.hi)}"><i style="left:${p.toFixed(0)}%"></i></div><small>${((s.hi - s.price) / s.hi * 100).toFixed(1)}% below high</small>`;
  }
  const volTxt = (s) => s.volr === null ? '—' : (s.volr / sessionFrac()).toFixed(1) + '×';
  const link = (s) => '/stock-analysis.html?symbol=' + encodeURIComponent(s.sym);
  const COLS = [['sym', 'Stock'], ['price', 'Price'], ['chg', 'Today'], ['mcap', 'Market cap'], ['pe', 'P/E'], ['pb', 'P/B'], ['roe', 'ROE'], ['roce', 'ROCE'], ['dy', 'Div yield'], ['fromHigh', '52-week range'], ['volr', 'Volume']];
  function draw() {
    const list = results();
    $('count').innerHTML = `<b>${list.length.toLocaleString('en-IN')}</b> of ${rows.length.toLocaleString('en-IN')} stocks`;
    const page = list.slice(0, shown);
    const arrow = (k) => F.sort === k ? (F.dir === 'asc' ? ' ▲' : ' ▼') : '';
    $('thead').innerHTML = '<tr>' + COLS.map(([k, l]) => `<th class="${k === 'sym' ? '' : 'r'}"><button type="button" data-sort="${k}">${l}${arrow(k)}</button></th>`).join('') + '</tr>';
    $('tbody').innerHTML = page.map((s) => `<tr>
      <td><a href="${link(s)}"><b>${esc(s.sym)}</b>${s.fno ? '<span class="fno">F&amp;O</span>' : ''}</a><small title="${esc(s.industry || '')}">${esc(s.name)} · ${esc(s.sector)}</small></td>
      <td class="r">₹${fmt(s.price)}</td><td class="r ${s.chg >= 0 ? 'up' : 'down'}">${pct(s.chg)}</td><td class="r">${cr(s.mcap)}</td>
      <td class="r">${fmt(s.pe, 1)}</td><td class="r">${fmt(s.pb, 1)}</td><td class="r">${s.roe === null ? '—' : fmt(s.roe, 1) + '%'}</td><td class="r">${s.roce === null ? '—' : fmt(s.roce, 1) + '%'}</td>
      <td class="r">${s.dy === null ? '—' : fmt(s.dy, 2) + '%'}</td><td class="r">${range52(s)}</td><td class="r">${volTxt(s)}</td></tr>`).join('') ||
      `<tr><td colspan="${COLS.length}" class="empty">No stocks match these filters. Try loosening one, or press Reset.</td></tr>`;
    $('cards').innerHTML = page.map((s) => `<a class="scard" href="${link(s)}">
      <div class="top"><div><b>${esc(s.sym)}</b>${s.fno ? '<span class="fno">F&amp;O</span>' : ''}<small>${esc(s.name)}</small></div><div class="px"><b>₹${fmt(s.price)}</b><small class="${s.chg >= 0 ? 'up' : 'down'}">${pct(s.chg)}</small></div></div>
      <div class="kv"><span>Mcap <b>${cr(s.mcap)}</b></span><span>P/E <b>${fmt(s.pe, 1)}</b></span><span>ROE <b>${s.roe === null ? '—' : fmt(s.roe, 1) + '%'}</b></span><span>Div <b>${s.dy === null ? '—' : fmt(s.dy, 1) + '%'}</b></span><span>Vol <b>${volTxt(s)}</b></span></div>
      ${range52(s)}<div class="sec">${esc(s.sector)}</div></a>`).join('') || '<div class="empty">No stocks match these filters. Try loosening one, or press Reset.</div>';
    $('more').hidden = list.length <= shown;
    $('more').textContent = `Show more (${(list.length - shown).toLocaleString('en-IN')} left)`;
    PRESETS.forEach((p) => { const b = document.querySelector(`[data-preset="${p.id}"]`); if (b) b.classList.toggle('on', isPreset(p)); });
    save();
  }
  const isPreset = (p) => Object.keys(DEFAULTS).every((k) => String(k in p.f ? p.f[k] : DEFAULTS[k]) === String(F[k] ?? ''));

  /* ───────── state: form <-> F <-> URL ───────── */
  const FIELDS = ['q', 'sector', 'cap', 'peMin', 'peMax', 'pbMax', 'roeMin', 'roceMin', 'dyMin', 'w52', 'vol', 'trend', 'chg'];
  function toForm() {
    FIELDS.forEach((k) => { const el = $('f_' + k); if (el) el.value = F[k] ?? ''; });
    $('f_fno').checked = !!F.fno;
    syncSort();
  }
  // A column-header sort may have no matching entry in the sort menu: show it as "Sorted by column".
  function syncSort() {
    const sel = $('sortSel'), v = F.sort + ':' + F.dir;
    sel.querySelectorAll('option[data-custom]').forEach((o) => o.remove());
    sel.value = v;
    if (sel.value !== v) { const o = new Option('Sorted by column', v); o.dataset.custom = '1'; sel.add(o); sel.value = v; }
  }
  function fromForm() {
    FIELDS.forEach((k) => { const el = $('f_' + k); if (el) F[k] = el.value; });
    F.fno = $('f_fno').checked ? '1' : '';
  }
  function save() {
    const p = new URLSearchParams();
    Object.keys(DEFAULTS).forEach((k) => { if (String(F[k] ?? '') !== String(DEFAULTS[k])) p.set(k, F[k]); });
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
    try { localStorage.setItem('mp-screener', qs); } catch (_) {}
  }
  function load() {
    let qs = location.search.slice(1);
    if (!qs) { try { qs = localStorage.getItem('mp-screener') || ''; } catch (_) {} }
    const p = new URLSearchParams(qs);
    F = { ...DEFAULTS };
    Object.keys(DEFAULTS).forEach((k) => { if (p.has(k)) F[k] = p.get(k); });
  }
  const activeCount = () => FIELDS.filter((k) => String(F[k] ?? '') !== String(DEFAULTS[k])).length + (F.fno ? 1 : 0);

  function csv() {
    const list = results();
    const head = ['Symbol', 'Name', 'Sector', 'Industry', 'Price', 'Change %', 'Market cap (Cr)', 'P/E', 'P/B', 'ROE %', 'ROCE %', 'Dividend yield %', '52w high', '52w low', 'Volume vs avg', 'F&O'];
    const out = [head].concat(list.map((s) => [s.sym, s.name, s.sector, s.industry || '', s.price, s.chg, s.mcap, s.pe, s.pb, s.roe, s.roce, s.dy, s.hi, s.lo, s.volr === null ? '' : (s.volr / sessionFrac()).toFixed(2), s.fno ? 'Yes' : 'No']));
    const text = out.map((r) => r.map((c) => { const v = c === null || c === undefined ? '' : String(c); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = 'marketpulse-screener.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function wire() {
    $('presets').innerHTML = PRESETS.map((p) => `<button type="button" class="chip" data-preset="${p.id}" title="${esc(p.hint)}">${esc(p.label)}</button>`).join('');
    $('presets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-preset]'); if (!b) return;
      const p = PRESETS.find((x) => x.id === b.dataset.preset);
      F = isPreset(p) ? { ...DEFAULTS } : { ...DEFAULTS, ...Object.fromEntries(Object.entries(p.f).map(([k, v]) => [k, String(v)])) };
      shown = 50; toForm(); draw(); $('presetHint').textContent = isPreset(p) ? p.hint : '';
      updateBadge();
    });
    $('filters').addEventListener('input', () => { fromForm(); shown = 50; draw(); updateBadge(); $('presetHint').textContent = ''; });
    $('sortSel').addEventListener('change', () => { const [s, d] = $('sortSel').value.split(':'); F.sort = s; F.dir = d; draw(); });
    $('thead').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sort]'); if (!b) return;
      const k = b.dataset.sort;
      F.dir = F.sort === k ? (F.dir === 'asc' ? 'desc' : 'asc') : (['sym', 'pe', 'pb', 'fromHigh', 'fromLow'].includes(k) ? 'asc' : 'desc');
      F.sort = k; syncSort(); draw();
    });
    $('more').addEventListener('click', () => { shown += 100; draw(); });
    $('reset').addEventListener('click', () => { F = { ...DEFAULTS }; shown = 50; toForm(); draw(); updateBadge(); $('presetHint').textContent = ''; });
    $('csvBtn').addEventListener('click', csv);
    $('toggleFilters').addEventListener('click', () => { const open = $('filters').classList.toggle('open'); $('toggleFilters').setAttribute('aria-expanded', open); });
  }
  function updateBadge() { const n = activeCount(); $('fcount').textContent = n ? String(n) : ''; $('fcount').hidden = !n; }

  async function fetchData() {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/stock_screener', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    meta = d; rows = (d.rows || []).map(toObj);
    const sectors = {};
    rows.forEach((s) => { sectors[s.sector] = (sectors[s.sector] || 0) + 1; });
    const cur = $('f_sector').value;
    $('f_sector').innerHTML = '<option value="">All sectors</option>' + Object.entries(sectors).sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join('');
    $('f_sector').value = F.sector || cur || '';
    const t = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
    const fd = d.fundamentals_as_of ? new Date(d.fundamentals_as_of).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
    $('asof').textContent = `Prices as of ${t(d.as_of)} IST · P/E, ROE, ROCE, dividend and book value as of ${fd}`;
  }

  async function start() {
    load(); wire(); toForm(); updateBadge();
    try { await fetchData(); toForm(); draw(); }
    catch (e) { $('tbody').innerHTML = '<tr><td colspan="11" class="empty">Could not load stock data. Please try again.</td></tr>'; console.warn('[Screener]', e); }
    // Prices move all day: refresh every 3 minutes while the page is open and visible.
    setInterval(async () => { if (document.hidden) return; try { await fetchData(); draw(); } catch (_) {} }, 180e3);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
