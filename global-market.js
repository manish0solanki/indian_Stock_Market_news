/* Global Market page (index.html#global): what overseas markets, currencies, bond yields and
   commodities are doing, which exchanges are open, and a plain-English read of what it means for
   the Indian open. Quotes: global_market() (index-refresh, every 5 min). GIFT Nifty: index-sparklines.
   Headlines: global_headlines_feed(). Rendered only while the page is open; refreshes every 30 s
   (the quotes themselves are refreshed every 30 s by index-refresh?fast=1), and drives the
   "Updated … · next in …" pill (refresh-stamp.js) while the page is showing. */
(function () {
  const SB = 'https://fzazdrzlemmkqngvpzxj.supabase.co';
  const KEY = 'sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq';
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const unent = (s) => { const t = document.createElement('textarea'); t.innerHTML = String(s ?? ''); return t.value; };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const tone = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const sgn = (v, d = 2) => v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
  const fmtPx = (v) => v === null ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: Math.abs(v) < 50 ? 3 : 2, maximumFractionDigits: Math.abs(v) < 50 ? 3 : 2 });
  const ago = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

  // Exchanges: IANA zone, weekday session in local time (lunch breaks ignored; holidays not known).
  const EX = {
    tokyo: ['Tokyo', 'Asia/Tokyo', '09:00', '15:30'], hk: ['Hong Kong', 'Asia/Hong_Kong', '09:30', '16:00'],
    shanghai: ['Shanghai', 'Asia/Shanghai', '09:30', '15:00'], seoul: ['Seoul', 'Asia/Seoul', '09:00', '15:30'],
    taipei: ['Taipei', 'Asia/Taipei', '09:00', '13:30'], singapore: ['Singapore', 'Asia/Singapore', '09:00', '17:00'],
    sydney: ['Sydney', 'Australia/Sydney', '10:00', '16:00'], india: ['India (NSE)', 'Asia/Kolkata', '09:15', '15:30'],
    london: ['London', 'Europe/London', '08:00', '16:30'], frankfurt: ['Frankfurt', 'Europe/Berlin', '09:00', '17:30'],
    paris: ['Paris', 'Europe/Paris', '09:00', '17:30'], newyork: ['New York', 'America/New_York', '09:30', '16:00'],
  };
  const CLOCK = ['tokyo', 'hk', 'shanghai', 'singapore', 'india', 'london', 'frankfurt', 'newyork'];
  function local(zone) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { wd: p.weekday, hm: p.hour + ':' + p.minute };
  }
  function exStatus(key) {
    const e = EX[key]; if (!e) return null;
    const { wd, hm } = local(e[1]);
    const open = !['Sat', 'Sun'].includes(wd) && hm >= e[2] && hm < e[3];
    return { name: e[0], open, time: hm, wd, hours: e[2] + '–' + e[3] };
  }
  const roundClock = (kind) => {
    const ny = local('America/New_York');
    if (kind === 'crypto') return { open: true, label: 'Trades 24/7' };
    const weekend = (ny.wd === 'Sat') || (ny.wd === 'Sun' && ny.hm < '18:00') || (ny.wd === 'Fri' && ny.hm >= '17:00');
    return weekend ? { open: false, label: 'Closed for the weekend' } : { open: true, label: kind === 'fx' ? 'Trades 24 h on weekdays' : 'Trades nearly 24 h' };
  };

  // What each quote is and why an Indian investor watches it. kind: index | fut | fx | rate | vol | cmd | crypto
  const META = {
    'ES=F|world': ['S&P 500 futures', 'fut', null, 'Trades through the Indian day: the best live read of the US mood.'],
    'NQ=F|world': ['Nasdaq 100 futures', 'fut', null, 'Tech-heavy; moves Indian IT stocks.'],
    'YM=F|world': ['Dow futures', 'fut', null, 'Large US industrials and banks.'],
    '^GSPC|world': ['S&P 500', 'index', 'newyork', 'The main US index; its close sets the tone for Asia next morning.'],
    '^IXIC|global': ['Nasdaq Composite', 'index', 'newyork', 'US tech; a big move here usually shows up in Infosys, TCS and peers.'],
    '^DJI|global': ['Dow Jones', 'index', 'newyork', '30 large US companies.'],
    '^N225|global': ['Nikkei 225', 'index', 'tokyo', 'Japan opens before India: an early cue for Asian risk appetite.'],
    '^HSI|global': ['Hang Seng', 'index', 'hk', 'Hong Kong and China-linked stocks; affects metals and EM flows.'],
    '000001.SS|world': ['Shanghai Composite', 'index', 'shanghai', 'Mainland China; matters for metals and commodities.'],
    '^KS11|world': ['KOSPI', 'index', 'seoul', 'South Korea; a gauge of foreign flows into emerging markets.'],
    '^TWII|world': ['Taiwan Weighted', 'index', 'taipei', 'Chip-heavy; tracks global tech demand.'],
    '^STI|world': ['Straits Times', 'index', 'singapore', 'Singapore, open alongside India.'],
    '^AXJO|world': ['ASX 200', 'index', 'sydney', 'Australia opens first in Asia; heavy in miners and banks.'],
    '^FTSE|global': ['FTSE 100', 'index', 'london', 'Europe opens in the Indian afternoon and can sway the last hours.'],
    '^GDAXI|global': ['DAX', 'index', 'frankfurt', 'Germany, Europe’s largest economy.'],
    '^FCHI|global': ['CAC 40', 'index', 'paris', 'France.'],
    '^STOXX50E|world': ['Euro Stoxx 50', 'index', 'frankfurt', '50 large eurozone companies.'],
    'INR=X|world': ['USD / INR', 'fx', null, 'Rupee per dollar. Higher = weaker rupee: good for IT and pharma exporters, bad for importers and FII flows.'],
    'DX-Y.NYB|world': ['Dollar index (DXY)', 'fx', null, 'Dollar against major currencies. A strong dollar usually pulls money out of emerging markets.'],
    '^TNX|world': ['US 10-year yield', 'rate', null, 'In %. Rising US yields make US bonds more attractive and can drain FII money from India.'],
    '^VIX|world': ['US VIX (fear gauge)', 'vol', 'newyork', 'Above 20 means nervous markets; above 30, panic.'],
    'EURUSD=X|world': ['EUR / USD', 'fx', null, 'Euro in dollars.'],
    'JPY=X|world': ['USD / JPY', 'fx', null, 'Yen per dollar. Sharp yen strength can mean global risk-off (carry trades unwinding).'],
    'BZ=F|world': ['Brent crude ($/bbl)', 'cmd', null, 'India imports most of its oil: higher crude hurts the rupee, inflation, OMCs, paints and airlines.'],
    'CL=F|world': ['WTI crude ($/bbl)', 'cmd', null, 'US crude benchmark.'],
    'NG=F|world': ['Natural gas ($/MMBtu)', 'cmd', null, 'Input cost for gas utilities, fertilisers and city gas companies.'],
    'GC=F|world': ['Gold ($/oz)', 'cmd', null, 'Safe haven; drives Indian gold prices and gold loan / jewellery stocks.'],
    'SI=F|world': ['Silver ($/oz)', 'cmd', null, 'Precious and industrial metal.'],
    'HG=F|world': ['Copper ($/lb)', 'cmd', null, 'A barometer of global growth; moves Hindalco, Vedanta, Hindustan Copper.'],
    'BTC-USD|global': ['Bitcoin', 'crypto', null, 'Risk appetite in crypto.'],
    'ETH-USD|world': ['Ethereum', 'crypto', null, ''],
  };
  const GROUPS = [
    ['us', 'United States', '🇺🇸', ['ES=F|world', 'NQ=F|world', 'YM=F|world', '^GSPC|world', '^IXIC|global', '^DJI|global']],
    ['asia', 'Asia-Pacific', '🌏', ['^N225|global', '^HSI|global', '000001.SS|world', '^KS11|world', '^TWII|world', '^STI|world', '^AXJO|world']],
    ['europe', 'Europe', '🇪🇺', ['^FTSE|global', '^GDAXI|global', '^FCHI|global', '^STOXX50E|world']],
    ['fx', 'Currencies, yields & volatility', '💱', ['INR=X|world', 'DX-Y.NYB|world', '^TNX|world', '^VIX|world', 'EURUSD=X|world', 'JPY=X|world']],
    ['cmd', 'Commodities', '🛢️', ['BZ=F|world', 'CL=F|world', 'NG=F|world', 'GC=F|world', 'SI=F|world', 'HG=F|world']],
    ['crypto', 'Crypto', '₿', ['BTC-USD|global', 'ETH-USD|world']],
  ];

  const EVERY = 30e3;
  let Q = {}, updatedAt = null, gift = null, heads = [], timer = null, loading = false, lastLoad = 0, headsAt = 0;

  function spark(vals, up) {
    vals = (vals || []).map(Number).filter(Number.isFinite);
    if (vals.length < 2) return '<span class="gm-spark-empty"></span>';
    const W = 72, Hh = 22, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const d = vals.map((v, i) => (i ? 'L' : 'M') + (i / (vals.length - 1) * W).toFixed(1) + ' ' + (2 + (hi - v) / span * (Hh - 4)).toFixed(1)).join('');
    return `<svg class="gm-spark" viewBox="0 0 ${W} ${Hh}" aria-hidden="true"><path d="${d}" fill="none" stroke="${up ? 'var(--positive)' : 'var(--negative)'}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  function status(key) {
    const m = META[key]; if (!m) return '';
    let s;
    if (m[2]) { const x = exStatus(m[2]); s = { open: x.open, label: (x.open ? 'Open' : 'Closed') + ' · ' + x.name + ' ' + x.time }; }
    else s = roundClock(m[1] === 'crypto' ? 'crypto' : m[1] === 'fx' || m[1] === 'rate' ? 'fx' : 'fut');
    return `<span class="gm-st ${s.open ? 'on' : ''}"><i></i>${esc(s.label)}</span>`;
  }
  function row(key) {
    const q = Q[key], m = META[key]; if (!q || !m) return '';
    const pct = num(q.change_percent), ch = num(q.change), px = num(q.price);
    const isRate = m[1] === 'rate';
    const chTxt = isRate ? sgn(ch === null ? null : ch * 100, 0) + ' bp' : sgn(ch, Math.abs(px) < 50 ? 3 : 2);
    return `<tr title="${esc(m[3])}">
      <td><b>${esc(m[0])}</b><small>${status(key)}${q.market_time ? ' · last trade ' + esc(ago(q.market_time)) : ''}</small>${m[3] ? `<small class="gm-why">${esc(m[3])}</small>` : ''}</td>
      <td class="r gm-px">${fmtPx(px)}${isRate ? '%' : ''}</td>
      <td class="r ${tone(ch)} gm-hide">${chTxt}</td>
      <td class="r"><span class="gm-pill ${tone(pct)}">${sgn(pct)}%</span></td>
      <td class="r gm-sp">${spark(q.spark, (pct || 0) >= 0)}</td></tr>`;
  }

  /* ───────── the read for India ───────── */
  const avg = (keys) => { const v = keys.map((k) => num(Q[k]?.change_percent)).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  function cues() {
    const out = []; let score = 0;
    const add = (pts, good, text) => { score += pts; out.push([good, text]); };
    const g = gift && num(gift.change_percent);
    if (g !== null && g !== undefined) {
      add(Math.max(-2, Math.min(2, g * 2)), g >= 0, `GIFT Nifty is ${g >= 0 ? 'up' : 'down'} ${Math.abs(g).toFixed(2)}% ${giftLive() ? '(trading now)' : 'in its last session'}: the most direct pointer to the Nifty open.`);
    }
    const us = avg(['ES=F|world', 'NQ=F|world', 'YM=F|world']);
    if (us !== null) add(Math.max(-1.5, Math.min(1.5, us)), us >= 0, `US futures are ${us >= 0 ? 'up' : 'down'} ${Math.abs(us).toFixed(2)}% on average${Math.abs(us) >= 1 ? ' — a strong cue' : ''}.`);
    const asia = avg(['^N225|global', '^HSI|global', '000001.SS|world', '^KS11|world', '^TWII|world']);
    if (asia !== null) add(Math.max(-1, Math.min(1, asia * 0.7)), asia >= 0, `Asian markets are ${asia >= 0 ? 'up' : 'down'} ${Math.abs(asia).toFixed(2)}% on average.`);
    const brent = num(Q['BZ=F|world']?.change_percent), brentPx = num(Q['BZ=F|world']?.price);
    if (brent !== null) add(Math.max(-0.8, Math.min(0.8, -brent * 0.3)), brent <= 0, `Brent crude is ${brent >= 0 ? 'up' : 'down'} ${Math.abs(brent).toFixed(2)}% at $${brentPx?.toFixed(1)}${brent > 1 ? ' — a worry for India’s import bill and the rupee' : brent < -1 ? ' — a relief for India' : ''}.`);
    const inr = num(Q['INR=X|world']?.change_percent), inrPx = num(Q['INR=X|world']?.price);
    if (inr !== null) add(Math.max(-0.8, Math.min(0.8, -inr * 1.5)), inr <= 0, `The rupee is ${inr > 0 ? 'weaker' : inr < 0 ? 'stronger' : 'flat'} at ₹${inrPx?.toFixed(2)} per dollar.`);
    const tnx = num(Q['^TNX|world']?.change);
    if (tnx !== null) add(Math.max(-0.5, Math.min(0.5, -tnx * 5)), tnx <= 0, `The US 10-year yield is ${tnx >= 0 ? 'up' : 'down'} ${Math.abs(tnx * 100).toFixed(0)} bp at ${num(Q['^TNX|world']?.price)?.toFixed(2)}%${tnx > 0.05 ? ' — higher yields can pull foreign money out of India' : ''}.`);
    const vix = num(Q['^VIX|world']?.price);
    if (vix !== null) add(vix >= 30 ? -1 : vix >= 20 ? -0.5 : vix < 15 ? 0.3 : 0, vix < 20, `US VIX is ${vix.toFixed(1)}: ${vix >= 30 ? 'panic levels' : vix >= 20 ? 'markets are nervous' : vix < 15 ? 'calm markets' : 'normal'}.`);
    const label = score >= 1 ? ['Positive', 'up'] : score <= -1 ? ['Negative', 'down'] : ['Mixed', 'mixed'];
    return { score, label, out };
  }
  const giftLive = () => gift && (typeof gift.live === 'boolean' ? gift.live : /open/i.test(gift.status || '') && !/clos/i.test(gift.status || ''));
  // Home fetched a newer GIFT Nifty reading: show the same number here.
  document.addEventListener('mp:gift', (e) => { if (e.detail?.from !== 'global' && e.detail?.gift) { gift = e.detail.gift; if (Object.keys(Q).length) render(); } });
  function giftTile() {
    if (!gift || num(gift.price) === null) return '';
    const pct = num(gift.change_percent);
    const live = giftLive();
    const when = (String(gift.as_of || '').match(/\d{1,2}:\d{2}/) || [''])[0];
    return `<div class="gm-gift"><div class="gm-k">GIFT Nifty${gift.expiry ? ' · ' + esc(String(gift.expiry).split('-').slice(1).join(' ')) : ''}</div>
      <div class="gm-v">${fmtPx(num(gift.price))}</div><div class="${tone(pct)}">${sgn(num(gift.change))} (${sgn(pct)}%)${live ? '' : ' <small class="gm-muted">last session</small>'}</div>
      <div class="gm-st ${live ? 'on' : ''}"><i></i>${live ? 'Live' + (gift.session ? ' · ' + esc(gift.session) : '') : 'Closed' + (gift.next_open ? ' · opens ' + esc(gift.next_open) : '')}</div>
      ${when ? `<div class="gm-muted">NSE IX · as of ${esc(when)} IST</div>` : ''}</div>`;
  }

  function render() {
    const host = $('gmRoot'); if (!host) return;
    if (!Object.keys(Q).length) { host.innerHTML = '<div class="mp-panel gm-empty">Global market data is not available right now. Please try again in a few minutes.</div>'; return; }
    const c = cues();
    const clock = CLOCK.map((k) => { const s = exStatus(k); return `<div class="gm-ex ${s.open ? 'on' : ''}" title="Weekday session ${esc(s.hours)} local time (holidays not shown)"><b>${esc(s.name)}</b><span>${esc(s.time)} · ${s.open ? 'Open' : 'Closed'}</span></div>`; }).join('');
    host.innerHTML = `
      <div class="mp-panel gm-read">
        <div class="gm-read-main">
          <div class="gm-k">Global cues for India</div>
          <div class="gm-verdict ${c.label[1]}">${c.label[0]}</div>
          <ul class="gm-reasons">${c.out.map(([good, t]) => `<li class="${good ? 'up' : 'down'}"><span>${good ? '▲' : '▼'}</span>${esc(t)}</li>`).join('')}</ul>
          <div class="gm-note">A rule-based summary of overnight and live global moves, weighted towards what usually matters most for the Indian open. Not a forecast or advice.</div>
        </div>
        ${giftTile()}
      </div>
      <div class="mp-panel gm-clock-wrap"><div class="mp-panel-title"><span>Market clock</span><span class="gm-muted">Local time at each exchange</span></div><div class="gm-clock">${clock}</div></div>
      <div class="gm-grid">
        ${GROUPS.map(([id, title, icon, keys]) => {
          const rows = keys.map(row).join('');
          if (!rows) return '';
          const a = avg(keys.filter((k) => ['index', 'fut'].includes(META[k]?.[1])));
          return `<div class="mp-panel gm-card" id="gm-${id}"><div class="mp-panel-title"><span>${icon} ${esc(title)}</span>${a !== null && ['us', 'asia', 'europe'].includes(id) ? `<span class="gm-pill ${tone(a)}">avg ${sgn(a)}%</span>` : ''}</div>
            <div class="gm-tw"><table class="gm-t"><thead><tr><th></th><th class="r">Price</th><th class="r gm-hide">Change</th><th class="r">%</th><th class="r gm-sp">5 days</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
        }).join('')}
      </div>
      <div class="mp-panel gm-heads"><div class="mp-panel-title"><span>📰 Global headlines</span><span class="gm-muted">CNBC, MarketWatch and others</span></div>
        ${heads.length ? `<div class="gm-hl">${heads.map((a) => `<a class="gm-h" href="${esc(a.url || '#')}" target="_blank" rel="noopener"><b>${esc(unent(a.title || ''))}</b><span>${esc(typeof a.source === 'object' ? a.source?.name : a.source || 'News')} · ${esc(ago(a.publishedAt || a.published_at))}</span></a>`).join('')}</div>` : '<div class="gm-muted">No global headlines right now.</div>'}
      </div>
      <div class="gm-foot">Prices from Yahoo Finance, refreshed every 30 seconds (some exchanges are delayed 15–20 min by the source), GIFT Nifty from NSE IX. Updated ${esc(ago(updatedAt))}.</div>`;
  }

  async function load() {
    if (loading) return; loading = true;
    try {
      // Headlines change slowly: fetch them every 5 minutes, not on every 30-second tick.
      const wantHeads = Date.now() - headsAt > 5 * 60e3;
      const [gm, sp, hl] = await Promise.all([
        fetch(SB + '/rest/v1/rpc/global_market', { method: 'POST', headers: H, body: '{}' }).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(SB + '/functions/v1/index-sparklines', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null),
        wantHeads ? fetch(SB + '/rest/v1/rpc/global_headlines_feed', { method: 'POST', headers: H, body: JSON.stringify({ p_limit: 12 }) }).then((r) => r.ok ? r.json() : null).catch(() => null) : null,
      ]);
      if (gm && Array.isArray(gm.quotes)) { Q = {}; for (const q of gm.quotes) Q[q.symbol + '|' + q.grp] = q; updatedAt = gm.updated_at; }
      if (sp && sp.gift_nifty) { gift = sp.gift_nifty; document.dispatchEvent(new CustomEvent('mp:gift', { detail: { gift, from: 'global' } })); }
      if (hl) { heads = Array.isArray(hl) ? hl : (hl.articles || []); headsAt = Date.now(); }
      if (gm) lastLoad = Date.now();
      render();
      cycle();
    } finally { loading = false; }
  }
  function visible() { const p = $('page-global'); return p && !p.classList.contains('hidden') && !document.hidden; }
  // While the page is on screen the "Updated" pill counts this page's 30-second cycle.
  function cycle() {
    const p = $('page-global'), on = p && !p.classList.contains('hidden');
    window.mpStampCycle = on && lastLoad ? { last: lastLoad, every: EVERY } : null;
  }

  window.mpGlobalMarket = {
    show() {
      if (!$('gmRoot')) return;
      if (!Object.keys(Q).length) $('gmRoot').innerHTML = '<div class="mp-panel gm-empty">Loading global markets…</div>';
      load();
      if (!timer) timer = setInterval(() => { cycle(); if (visible() && Date.now() - lastLoad >= EVERY - 500) load(); }, 1000);
      cycle();
    },
    refresh: () => load(),
  };
  // Opened straight from a #global link before this script loaded.
  if (visible()) window.mpGlobalMarket.show();
})();
