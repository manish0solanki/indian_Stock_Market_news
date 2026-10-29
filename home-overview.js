/* MarketPulse home overview: index cards, Nifty heatmap, FII/DII, gainers/losers,
   global indices, sidebar navigation and the mobile menu.

   Loaded after the main inline script in index.html. It reuses that script's
   `supabaseClient` and hooks into its existing render functions
   (renderSnapshot, renderGlobalIndices, renderFiiDii), so no data is fetched twice. */
(function () {
  'use strict';
  if (typeof supabaseClient === 'undefined') return;

  const SPARK_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/index-sparklines';
  const CARD_INDICES = ['^NSEI', '^NSEBANK', '^BSESN', 'BSE-BANK.BO', '^NSEMDCP50', 'NIFTY_FIN_SERVICE.NS'];
  const NIFTY50 = ['ADANIENT','ADANIPORTS','APOLLOHOSP','ASIANPAINT','AXISBANK','BAJAJ-AUTO','BAJFINANCE','BAJAJFINSV','BEL','BHARTIARTL',
    'CIPLA','COALINDIA','DRREDDY','EICHERMOT','ETERNAL','GRASIM','HCLTECH','HDFCBANK','HDFCLIFE','HINDALCO','HINDUNILVR','ICICIBANK',
    'INDIGO','INFY','ITC','JIOFIN','JSWSTEEL','KOTAKBANK','LT','M&M','MARUTI','MAXHEALTH','NESTLEIND','NTPC','ONGC','POWERGRID',
    'RELIANCE','SBILIFE','SBIN','SHRIRAMFIN','SUNPHARMA','TATACONSUM','TMPV','TATASTEEL','TCS','TECHM','TITAN','TRENT','ULTRACEMCO','WIPRO'];

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (v === null || v === undefined || v === '') ? NaN : Number(v);
  const fmt = (v, d = 2) => Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const signed = (v, d = 2) => Number.isFinite(v) ? (v >= 0 ? '+' : '') + fmt(v, d) : '—';
  const tone = v => Number.isFinite(v) ? (v >= 0 ? 'mp-up-t' : 'mp-down-t') : '';
  const crore = v => !Number.isFinite(v) ? '—' : v >= 1e12 ? '₹' + fmt(v / 1e12, 2) + ' L Cr' : '₹' + fmt(v / 1e7, 0) + ' Cr';
  const homeVisible = () => !document.hidden && !$('homeDashboard')?.classList.contains('hidden');
  const analysisUrl = sym => '/stock-analysis.html?symbol=' + encodeURIComponent(sym);
  function hook(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      try { after.apply(this, arguments); } catch (e) { console.error('[Home overview]', name, e); }
      return orig.apply(this, arguments);
    };
  }
  function marketOpen() {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const d = ist.getDay(), m = ist.getHours() * 60 + ist.getMinutes();
    return d > 0 && d < 6 && m >= 550 && m <= 940;
  }

  /* ───────── Index cards ───────── */
  let snapshot = [], sparks = {}, gift = null;
  function sparkSvg(points, prevClose, up) {
    const vals = points.map(p => p[1]);
    if (vals.length < 2) return '<div class="mp-spark-empty">Intraday chart unavailable</div>';
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (Number.isFinite(prevClose)) { lo = Math.min(lo, prevClose); hi = Math.max(hi, prevClose); }
    const W = 200, H = 56, pad = 3, span = hi - lo || 1;
    const x = i => (i / (vals.length - 1)) * W, y = v => pad + (hi - v) / span * (H - pad * 2);
    const line = vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
    const col = up ? 'var(--positive)' : 'var(--negative)', id = 'g' + Math.random().toString(36).slice(2, 8);
    const base = Number.isFinite(prevClose) ? `<line x1="0" x2="${W}" y1="${y(prevClose).toFixed(1)}" y2="${y(prevClose).toFixed(1)}" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : '';
    return `<svg class="mp-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" style="color:var(--text-muted)">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      ${base}<path d="${line}L${W} ${H}L0 ${H}Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  function renderIndexCards() {
    const host = $('mpIndexCards');
    if (!host || !snapshot.length) return;
    const bySym = Object.fromEntries(snapshot.map(x => [x.symbol, x]));
    host.innerHTML = giftStrip(bySym['^NSEI']) + CARD_INDICES.filter(s => bySym[s] || sparks[s]).map(sym => {
      const q = bySym[sym] || {}, sp = sparks[sym] || {};
      const price = Number.isFinite(num(q.price)) ? num(q.price) : num(sp.price);
      const prev = Number.isFinite(num(q.previous_close)) ? num(q.previous_close) : num(sp.previous_close);
      const chg = Number.isFinite(num(q.change)) ? num(q.change) : price - prev;
      const pct = Number.isFinite(num(q.change_percent)) ? num(q.change_percent) : chg / prev * 100;
      const lo = num(sp.day_low), hi = num(sp.day_high);
      return `<article class="mp-card mp-idx-card">
        <div class="mp-idx-name"><span>${esc(q.display_name || q.name || sym)}</span></div>
        <div class="mp-idx-price">${fmt(price)}</div>
        <div class="mp-idx-chg ${tone(chg)}">${signed(chg)} (${signed(pct)}%)</div>
        ${sparkSvg(sp.points || [], prev, chg >= 0)}
        <div class="mp-idx-meta"><span>Prev. Close</span><span>Today's Range</span><b>${fmt(prev)}</b><b>${Number.isFinite(lo) && Number.isFinite(hi) ? fmt(lo) + ' – ' + fmt(hi) : '—'}</b></div>
      </article>`;
    }).join('');
  }
  // GIFT Nifty: near-month Nifty future on NSE IX, which trades before and after Indian market hours.
  function giftStrip(nifty) {
    if (!gift || !Number.isFinite(num(gift.price))) return '';
    const chg = num(gift.change), pct = num(gift.change_percent);
    const live = /open/i.test(gift.status || '') && !/clos/i.test(gift.status || '');
    const spot = num(nifty?.price);
    const gap = Number.isFinite(spot) ? num(gift.price) - spot : NaN;
    const cue = Number.isFinite(gap) ? `<span class="mp-gift-cue" title="GIFT Nifty minus Nifty 50">${gap >= 0 ? 'Premium' : 'Discount'} ${signed(gap)} pts vs Nifty</span>` : '';
    const when = (String(gift.as_of || '').match(/\d{1,2}:\d{2}/) || [''])[0];
    const exp = String(gift.expiry || '').split('-').slice(1).join(' ');
    return `<div class="mp-gift" title="${esc(gift.status || 'NSE IX')}">
      <span class="mp-gift-name"><i class="${live ? 'live' : ''}"></i>GIFT NIFTY</span>
      <span class="mp-gift-price">${fmt(num(gift.price))}</span>
      <span class="mp-gift-chg ${tone(chg)}">${signed(chg)} (${signed(pct)}%)</span>
      ${cue}
      <span class="mp-gift-note">NSE IX${exp ? ' · ' + esc(exp) + ' futures' : ''}${when ? ' · as of ' + esc(when) + ' IST' : ''}</span>
    </div>`;
  }
  hook('renderSnapshot', items => { snapshot = Array.isArray(items) ? items : []; renderIndexCards(); });

  let sparkAt = 0;
  async function loadSparks(force) {
    // Every minute while the market is open; every 5 minutes otherwise (GIFT Nifty trades outside market hours).
    if (!force && (!homeVisible() || Date.now() - sparkAt < (marketOpen() ? 55e3 : 5 * 60e3))) return;
    try {
      const r = await fetch(SPARK_URL, { cache: 'no-store' });
      const d = await r.json();
      if (d?.series) { sparks = d.series; gift = d.gift_nifty || gift; sparkAt = Date.now(); renderIndexCards(); }
    } catch (e) { console.warn('[Index sparklines]', e); }
  }

  /* ───────── Heatmap + gainers/losers ───────── */
  // Market caps live in stock_quotes (the stock_latest view takes them from stocks,
  // where they are empty), so quotes come from stock_quotes and names from stocks.
  const universeCache = {}, names = {};
  let universe = 'nifty50', nifty = [];
  async function addNames(rows) {
    const missing = rows.map(r => r.symbol).filter(s => !(s in names));
    for (let i = 0; i < missing.length; i += 200) {
      const { data } = await supabaseClient.from('stocks').select('symbol,company_name,sector').in('symbol', missing.slice(i, i + 200));
      (data || []).forEach(s => { names[s.symbol] = s; });
      missing.slice(i, i + 200).forEach(s => { if (!(s in names)) names[s] = {}; });
    }
    rows.forEach(r => { r.company_name = names[r.symbol]?.company_name || ''; r.sector = names[r.symbol]?.sector || ''; });
  }
  async function fetchUniverse(u) {
    const hit = universeCache[u];
    if (hit && Date.now() - hit.at < 60e3) return hit.rows;
    let q = supabaseClient.from('stock_quotes').select('symbol,price,change,change_percent,market_cap');
    q = u === 'nifty50' ? q.in('symbol', NIFTY50) : q.gt('market_cap', 0).gt('price', 0).order('market_cap', { ascending: false }).limit(u === 'top100' ? 100 : 500);
    const { data, error } = await q;
    if (error) throw error;
    // Ignore quotes with impossible daily moves (stale or split-adjusting rows).
    const rows = (data || []).filter(r => num(r.price) > 0 && Number.isFinite(num(r.change_percent)) && Math.abs(num(r.change_percent)) <= 25);
    try { await addNames(rows); } catch (e) { console.warn('[Home heatmap] names', e); }
    universeCache[u] = { at: Date.now(), rows };
    return rows;
  }
  function squarify(items, x, y, w, h) {
    const out = []; let rest = items;
    while (rest.length) {
      const short = Math.min(w, h);
      const worst = row => { const s = row.reduce((a, b) => a + b.a, 0), mx = row[0].a, mn = row[row.length - 1].a; return Math.max(short * short * mx / (s * s), (s * s) / (short * short * mn)); };
      let row = [rest[0]], i = 1;
      while (i < rest.length && worst(row.concat(rest[i])) <= worst(row)) row.push(rest[i++]);
      const s = row.reduce((a, b) => a + b.a, 0);
      if (w >= h) { const cw = s / h; let cy = y; row.forEach(r => { const rh = r.a / cw; out.push({ ...r, x, y: cy, w: cw, h: rh }); cy += rh; }); x += cw; w -= cw; }
      else { const rh = s / w; let cx = x; row.forEach(r => { const cw = r.a / rh; out.push({ ...r, x: cx, y, w: cw, h: rh }); cx += cw; }); y += rh; h -= rh; }
      rest = rest.slice(i);
    }
    return out;
  }
  function heatColor(c) {
    const t = Math.min(1, Math.abs(c) / 3) ** 0.75;
    const from = [52, 60, 82], to = c >= 0 ? [22, 163, 74] : [220, 38, 38];
    return 'rgb(' + from.map((f, i) => Math.round(f + (to[i] - f) * (Math.abs(c) < 0.05 ? 0 : 0.25 + 0.75 * t))).join(',') + ')';
  }
  let heatRows = [];
  function renderTreemap() {
    const host = $('mpTreemap');
    if (!host || !heatRows.length) return;
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    const rows = heatRows.filter(r => num(r.market_cap) > 0).sort((a, b) => num(b.market_cap) - num(a.market_cap));
    const total = rows.reduce((s, r) => s + num(r.market_cap), 0);
    const tiles = squarify(rows.map(r => ({ r, a: num(r.market_cap) / total * W * H })), 0, 0, W, H);
    host.innerHTML = tiles.map(({ r, x, y, w, h }) => {
      const c = num(r.change_percent), fs = Math.max(9, Math.min(18, (w - 6) / (r.symbol.length * 0.68), h / 2.8));
      const label = w > 54 && h > 32 ? `<b style="font-size:${fs.toFixed(0)}px">${esc(r.symbol)}</b><i style="font-size:${Math.max(9, fs * .78).toFixed(0)}px">${signed(c, 1)}%</i>`
        : w > 34 && h > 16 ? `<b style="font-size:9px">${esc(r.symbol)}</b>` : '';
      return `<a class="mp-tile" href="${analysisUrl(r.symbol)}" data-sym="${esc(r.symbol)}" aria-label="${esc(r.symbol)} ${signed(c)}%" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;background:${heatColor(c)}">${label}</a>`;
    }).join('') + '<div class="mp-heat-tip" id="mpHeatTip" hidden></div>';
  }
  function bindTreemapTips() {
    const host = $('mpTreemap');
    host.addEventListener('pointermove', e => {
      const a = e.target.closest('.mp-tile'), tip = $('mpHeatTip');
      if (!tip) return;
      if (!a) { tip.hidden = true; return; }
      const r = heatRows.find(x => x.symbol === a.dataset.sym); if (!r) return;
      tip.innerHTML = `<strong>${esc(r.symbol)}</strong>${esc(r.company_name || '')}<br>₹${fmt(num(r.price))} · <span class="${tone(num(r.change_percent))}">${signed(num(r.change_percent))}%</span><br>Market cap ${crore(num(r.market_cap))}${r.sector ? '<br>' + esc(r.sector) : ''}`;
      tip.hidden = false;
      const b = host.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      let lx = e.clientX - b.left + 14, ly = e.clientY - b.top + 14;
      if (lx + tw > b.width) lx = e.clientX - b.left - tw - 14;
      if (ly + th > b.height) ly = Math.max(4, e.clientY - b.top - th - 14);
      tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
    });
    host.addEventListener('pointerleave', () => { const tip = $('mpHeatTip'); if (tip) tip.hidden = true; });
  }
  const expanded = { mpGainers: false, mpLosers: false };
  function moverTable(rows) {
    if (!rows.length) return '<div class="mp-loading">No data right now.</div>';
    return `<table class="mpx-table"><thead><tr><th class="sm-hide">#</th><th>Stock</th><th class="r">LTP (₹)</th><th class="r sm-hide">Change</th><th class="r">%</th></tr></thead><tbody>${rows.map((r, i) => {
      const c = num(r.change_percent), ch = Number.isFinite(num(r.change)) ? num(r.change) : num(r.price) - num(r.price) / (1 + c / 100);
      return `<tr><td class="n sm-hide">${i + 1}</td><td><a href="${analysisUrl(r.symbol)}" title="${esc(r.company_name || '')}">${esc(r.symbol)}</a><small class="sm-only">${esc(r.company_name || '')}</small></td><td class="r">${fmt(num(r.price))}</td><td class="r sm-hide ${tone(ch)}">${signed(ch)}</td><td class="r"><span class="mpx-pill ${tone(c)}">${signed(c)}%</span></td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function renderMovers() {
    const sorted = nifty.slice().sort((a, b) => num(b.change_percent) - num(a.change_percent));
    const n = k => expanded[k] ? 15 : 5;
    if ($('mpGainersBody')) $('mpGainersBody').innerHTML = moverTable(sorted.filter(r => num(r.change_percent) > 0).slice(0, n('mpGainers')));
    if ($('mpLosersBody')) $('mpLosersBody').innerHTML = moverTable(sorted.reverse().filter(r => num(r.change_percent) < 0).slice(0, n('mpLosers')));
    document.querySelectorAll('[data-mp-more]').forEach(b => { b.textContent = expanded[b.dataset.mpMore] ? 'Show less ↑' : 'View all →'; });
  }
  async function loadMarket(force) {
    if (!force && !homeVisible()) return;
    try {
      nifty = await fetchUniverse('nifty50');
      renderMovers();
      heatRows = universe === 'nifty50' ? nifty : await fetchUniverse(universe);
      renderTreemap();
    } catch (e) {
      console.error('[Home heatmap]', e);
      if (!heatRows.length && $('mpTreemap')) $('mpTreemap').innerHTML = '<div class="mp-loading">Heatmap data is unavailable right now.</div>';
    }
  }

  /* ───────── FII / DII ───────── */
  function flowBlock(label, hist, key) {
    const last = hist[hist.length - 1] || {};
    const net = num(last[key + '_net']), buy = num(last[key + '_buy']), sell = num(last[key + '_sell']);
    const series = hist.slice(-12).map(d => num(d[key + '_net'])).filter(Number.isFinite);
    const max = Math.max(1, ...series.map(Math.abs));
    let streak = 0; for (let i = hist.length - 1; i >= 0; i--) { const v = num(hist[i][key + '_net']); if (Number.isFinite(v) && Math.sign(v) === Math.sign(net) && v !== 0) streak++; else break; }
    return `<div class="mp-flow">
      <div class="mp-flow-t">${label} (₹ Cr)</div>
      <div class="mp-flow-v ${tone(net)}">${signed(net)}</div>
      <div class="mp-bars" title="Net flow, last ${series.length} sessions">${series.map(v => `<i style="height:${Math.max(8, Math.abs(v) / max * 100).toFixed(0)}%;background:${v >= 0 ? 'var(--positive)' : 'var(--negative)'}"></i>`).join('')}</div>
      <dl><dt>${label} Net</dt><dd class="${tone(net)}">${signed(net)}</dd><dt>${label} Buy</dt><dd>${fmt(buy)}</dd><dt>${label} Sell</dt><dd>${fmt(sell)}</dd></dl>
      ${streak > 1 ? `<div class="mp-flow-streak">Net ${net >= 0 ? 'buyers' : 'sellers'} for ${streak} straight sessions</div>` : ''}
    </div>`;
  }
  hook('renderFiiDii', payload => {
    const hist = Array.isArray(payload?.history) ? payload.history : Array.isArray(payload) ? payload : [];
    if (!hist.length || !$('mpFlowsBody')) return;
    const last = hist[hist.length - 1];
    const d = last.trade_date ? new Date(last.trade_date + 'T00:00:00') : null;
    $('mpFlowsDate').textContent = d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : (last.date || '');
    $('mpFlowsBody').innerHTML = flowBlock('FII', hist, 'fii') + flowBlock('DII', hist, 'dii');
  });

  /* ───────── Global indices ───────── */
  hook('renderGlobalIndices', items => {
    const host = $('mpGlobalBody');
    if (!host || !Array.isArray(items) || !items.length) return;
    host.innerHTML = `<table class="mpx-table"><thead><tr><th>Index</th><th class="r">Value</th><th class="r sm-hide">Change</th><th class="r">%</th></tr></thead><tbody>${items.slice(0, 6).map(x => {
      const ch = num(x.change), pct = num(x.change_percent);
      return `<tr><td><b>${esc(x.name || x.display_name || x.symbol)}</b></td><td class="r">${fmt(num(x.price))}</td><td class="r sm-hide ${tone(ch)}">${signed(ch)}</td><td class="r"><span class="mpx-pill ${tone(pct)}">${signed(pct)}%</span></td></tr>`;
    }).join('')}</tbody></table>`;
  });

  /* ───────── Navigation: sidebar, buttons, mobile drawer ───────── */
  const body = document.body, menuBtn = $('mpMenuBtn'), scrim = $('mpScrim');
  function setDrawer(open) {
    body.classList.toggle('mp-nav-open', open);
    if (scrim) scrim.hidden = !open;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', String(open));
  }
  menuBtn?.addEventListener('click', () => setDrawer(!body.classList.contains('mp-nav-open')));

  /* ───────── Phone helpers: search toggle, movers tabs, bottom bar, news "show more" ───────── */
  const searchBtn = $('mpSearchBtn');
  searchBtn?.addEventListener('click', () => {
    const open = !body.classList.contains('mp-search-open');
    body.classList.toggle('mp-search-open', open);
    searchBtn.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => $('searchInput')?.focus(), 50);
  });
  document.querySelectorAll('[data-movers-tab]').forEach(b => b.addEventListener('click', () => {
    const row = b.closest('[data-movers]');
    row.dataset.movers = b.dataset.moversTab;
    row.querySelectorAll('[data-movers-tab]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
  }));
  // Bottom bar highlight follows the section in view.
  const tabs = [...document.querySelectorAll('#mpTabbar [data-mp-scroll]')];
  const tabTargets = tabs.map(t => t.dataset.mpScroll === 'top' ? null : $(t.dataset.mpScroll));
  const syncTabs = () => {
    let active = 0;
    tabTargets.forEach((el, i) => { if (el && el.getBoundingClientRect().top < innerHeight * 0.4) active = i; });
    tabs.forEach((t, i) => t.classList.toggle('on', i === active && homeVisible()));
  };
  addEventListener('scroll', () => requestAnimationFrame(syncTabs), { passive: true });
  // The news feed scrolls inside a fixed box on desktop; on phones it flows with the page,
  // showing the first 12 stories until "Show more" is tapped.
  const feed = $('feed'), more = $('mpNewsMore');
  if (feed && more) {
    const sync = () => { more.hidden = body.classList.contains('mp-news-all') || feed.querySelectorAll(':scope > .news-card').length <= 12; };
    new MutationObserver(sync).observe(feed, { childList: true });
    more.addEventListener('click', () => { body.classList.add('mp-news-all'); sync(); });
    sync();
  }
  scrim?.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setDrawer(false); });

  function markActive(page, scrollId) {
    document.querySelectorAll('.mp-side-link[data-mp-go]').forEach(b => {
      b.classList.toggle('active', b.dataset.mpGo === page && (page !== 'home' || (b.dataset.mpScroll || 'top') === (scrollId || 'top')));
    });
  }
  document.addEventListener('click', e => {
    const more = e.target.closest('[data-mp-more]');
    if (more) { expanded[more.dataset.mpMore] = !expanded[more.dataset.mpMore]; renderMovers(); return; }
    const go = e.target.closest('[data-mp-go]');
    if (!go) return;
    const page = go.dataset.mpGo, target = go.dataset.mpScroll;
    const current = (location.hash || '#home').slice(1);
    // Switching pages scrolls to the top itself; only do it when the page actually changes,
    // otherwise its smooth scroll fights the jump to the section below.
    if (page !== current && window.MarketPulsePages?.setPage) window.MarketPulsePages.setPage(page);
    markActive(page, target);
    setDrawer(false);
    if (!target || target === 'top') { if (page === current) scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setTimeout(() => {
      const el = $(target); if (!el) return;
      const offset = (document.querySelector('.topbar')?.offsetHeight || 60) + 10;
      scrollTo({ top: el.getBoundingClientRect().top + scrollY - offset, behavior: 'smooth' });
    }, page !== current ? 350 : 0);
    if (page === 'home') { loadMarket(true); loadSparks(); }
  });
  window.addEventListener('hashchange', () => markActive((location.hash || '#home').slice(1)));
  markActive((location.hash || '#home').slice(1));

  $('mpHeatSeg')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-universe]'); if (!b || b.dataset.universe === universe) return;
    universe = b.dataset.universe;
    document.querySelectorAll('#mpHeatSeg [data-universe]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    $('mpTreemap').innerHTML = '<div class="mp-loading">Loading heatmap…</div>';
    heatRows = [];
    await loadMarket(true);
  });

  // Keep the sticky offsets in sync with the real top-bar height (it wraps on phones).
  const topbar = document.querySelector('.topbar');
  const syncTop = () => topbar && document.documentElement.style.setProperty('--mp-top-h', topbar.offsetHeight + 'px');
  if (window.ResizeObserver && topbar) new ResizeObserver(syncTop).observe(topbar);
  syncTop();
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderTreemap, 150); });

  /* ───────── Links from other pages ───────── */
  // /?login=1 opens the login form (the shared header on other pages links here);
  // /#mpHeatmap, /#marketNews etc. scroll to that section once the page has laid out.
  const params = new URLSearchParams(location.search);
  if (params.get('login') === '1' && !document.getElementById('accountWrap')?.classList.contains('visible')) {
    setTimeout(() => document.getElementById('authButton')?.click(), 300);
    history.replaceState(null, '', location.pathname + location.hash);
  }
  const jump = (location.hash || '').slice(1);
  if (jump && !['home', 'sectors', 'crude', 'global', 'crypto'].includes(jump) && $(jump)) {
    setTimeout(() => { const el = $(jump); if (el) scrollTo({ top: el.getBoundingClientRect().top + scrollY - (document.querySelector('.topbar')?.offsetHeight || 60) - 10 }); }, 700);
  }

  /* ───────── Boot ───────── */
  bindTreemapTips();
  loadMarket(true);
  loadSparks(true);
  setInterval(() => loadMarket(false), 60e3);
  setInterval(() => loadSparks(false), 30e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadMarket(false); loadSparks(false); } });
})();
