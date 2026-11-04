/* Sectors page (index.html#sectors). One call, sector_dashboard() (supabase/sector-dashboard.sql), feeds:
   1. Market read   — a plain-English verdict from breadth today, trend breadth (50/200-day) and new highs vs lows.
   2. Scoreboard    — the 20 NSE sector indices over Today / 1W / 1M / 3M / 6M / 1Y, against the Nifty, with trend,
                      distance from the 52-week high, a 3-month chart and the rotation phase.
   3. Rotation map  — relative strength vs the Nifty (x) and its 10-day momentum (y), with a 4-week trail.
   4. Sector groups — breadth, trend, valuation and volume for every broad group of stocks; click for its stocks
                      (sector_group_stocks()).
   The crude / defensive / confirmation insights and the 186-industry table stay in index.html (tabs and a
   collapsible section below these panels). Refreshes every 60 s while the page is open. */
(function () {
  const SB = window.MP_CONFIG.supabaseUrl;
  const KEY = window.MP_CONFIG.supabaseKey;
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const tone = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const sgn = (v, d = 2, unit = '%') => v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + unit;
  const short = (n) => String(n || '').replace(/^Nifty\s+/i, '').replace(/ Sector$/, '').replace('Financial Services', 'Fin Services').replace('India Consumption', 'Consumption').replace('Infrastructure', 'Infra');
  const cr = (v) => { v = num(v); if (v === null) return '—'; return v >= 1e5 ? (v / 1e5).toFixed(2) + ' L Cr' : Math.round(v).toLocaleString('en-IN') + ' Cr'; };

  const PERIODS = [['d1', 'Today'], ['w1', '1W'], ['m1', '1M'], ['m3', '3M'], ['m6', '6M'], ['y1', '1Y']];
  const PHASE = {
    Leading: { cls: 'lead', txt: 'Beating the Nifty and still gaining ground.' },
    Weakening: { cls: 'weak', txt: 'Still ahead of the Nifty, but losing ground.' },
    Lagging: { cls: 'lag', txt: 'Behind the Nifty and still slipping.' },
    Improving: { cls: 'imp', txt: 'Behind the Nifty, but catching up.' },
  };
  let D = null, period = 'd1', groupSort = 'mcap', openGroup = null, lastLoad = 0, loading = false, timer = null;
  try { period = localStorage.getItem('mp_sec_period') || 'd1'; } catch (e) { /* ignore */ }
  if (!PERIODS.some((p) => p[0] === period)) period = 'd1';

  async function rpc(name, body) {
    const r = await fetch(SB + '/rest/v1/rpc/' + name, { method: 'POST', headers: H, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error(name + ' ' + r.status);
    return r.json();
  }

  /* ---------- 1. Market read ---------- */
  function marketRead() {
    const m = D.market || {}, nf = D.nifty || {};
    const up = num(m.up) || 0, down = num(m.down) || 0, adv = up + down ? up / (up + down) * 100 : null;
    const a50 = num(m.above50), a200 = num(m.above200), hi = num(m.near_high) || 0, lo = num(m.near_low) || 0;
    const trend = a50 !== null && a200 !== null ? (a50 + a200) / 2 : a50;
    const day = adv === null ? 'flat' : adv >= 55 ? 'up' : adv <= 45 ? 'down' : 'flat';
    const tr = trend === null ? 'mixed' : trend >= 55 ? 'up' : trend <= 45 ? 'down' : 'mixed';
    const V = {
      'up|up': ['Broad strength', 'up', 'Most stocks are rising and most are above their averages. Leadership is wide, not just a few big names.'],
      'up|mixed': ['Positive day, trend undecided', 'up', 'Buyers are in control today, but only about half of stocks are in an uptrend. Watch whether the breadth holds for a few sessions.'],
      'up|down': ['Relief rally in a weak market', 'mixed', 'Most stocks are up today, but most are still below their 50- and 200-day averages. Rallies like this need several strong days before the trend turns.'],
      'down|up': ['Dip in an uptrend', 'mixed', 'Most stocks are down today, but most are still above their averages, so the larger trend is intact for now.'],
      'down|mixed': ['Selling, trend undecided', 'down', 'Sellers are in control today and only about half of stocks are in an uptrend.'],
      'down|down': ['Broad weakness', 'down', 'Most stocks are falling and most are below their averages. Weakness is wide, not confined to a few sectors.'],
      'flat|up': ['Quiet day in an uptrend', 'up', 'Advancers and decliners are roughly even today; most stocks remain above their averages.'],
      'flat|mixed': ['Mixed market', 'mixed', 'No clear direction today and the trend is split. Stock and sector selection matters more than the index.'],
      'flat|down': ['Quiet day in a downtrend', 'down', 'Advancers and decliners are roughly even today, but most stocks remain below their averages.'],
    }[day + '|' + tr];
    const idx = D.indices || [];
    const by = (ph) => idx.filter((x) => x.phase === ph);
    const lead = by('Leading'), imp = by('Improving');
    const ranked = idx.filter((x) => num(x.ret && x.ret.m1) !== null).sort((a, b) => b.ret.m1 - a.ret.m1);
    const reasons = [];
    if (adv !== null) reasons.push([tone(adv - 50), `<b>${up.toLocaleString('en-IN')}</b> stocks up, <b>${down.toLocaleString('en-IN')}</b> down today (${Math.round(adv)}% advancing).`]);
    if (a50 !== null) reasons.push([tone(a50 - 50), `<b>${Math.round(a50)}%</b> of stocks are above their 50-day average and <b>${a200 === null ? '—' : Math.round(a200) + '%'}</b> above their 200-day average.`]);
    reasons.push([tone(hi - lo), `<b>${hi}</b> stocks are within 3% of a 52-week high; <b>${lo}</b> are within 3% of a 52-week low.`]);
    if (num(nf.d1) !== null) reasons.push([tone(num(nf.d1)), `Nifty 50 ${sgn(num(nf.d1))} today, ${sgn(num(nf.m1))} over a month, ${sgn(num(nf.m3))} over 3 months.`]);
    if (lead.length) reasons.push(['up', `Leading sectors: <b>${lead.map((x) => esc(short(x.name))).join(', ')}</b>.` + (imp.length ? ` Improving: ${imp.map((x) => esc(short(x.name))).join(', ')}.` : '')]);
    else if (imp.length) reasons.push(['', `No sector is leading the Nifty right now. Improving: <b>${imp.map((x) => esc(short(x.name))).join(', ')}</b>.`]);
    if (ranked.length > 1) reasons.push(['', `Best over a month: <b>${esc(short(ranked[0].name))}</b> ${sgn(ranked[0].ret.m1)}; worst: <b>${esc(short(ranked[ranked.length - 1].name))}</b> ${sgn(ranked[ranked.length - 1].ret.m1)}.`]);
    const gauge = (label, v, help) => {
      const w = v === null ? 0 : Math.max(0, Math.min(100, v));
      const c = v === null ? '' : v >= 55 ? 'up' : v <= 45 ? 'down' : 'mid';
      return `<div class="sx-g" title="${esc(help)}"><div class="sx-g-h"><span>${label}</span><b class="${c}">${v === null ? '—' : Math.round(v) + '%'}</b></div><div class="sx-g-bar"><i class="${c}" style="width:${w}%"></i><em></em></div></div>`;
    };
    const hl = hi + lo ? hi / (hi + lo) * 100 : null;
    return `<div class="mp-panel span-12 sx-read">
      <div class="sx-read-main">
        <div class="sx-k">Market read</div>
        <div class="sx-verdict ${V[1]}">${V[0]}</div>
        <p class="sx-lede">${V[2]}</p>
        <ul class="sx-reasons">${reasons.map((r) => `<li class="${r[0]}"><span>●</span><div>${r[1]}</div></li>`).join('')}</ul>
      </div>
      <div class="sx-gauges">
        ${gauge('Advancing today', adv, 'Share of stocks up today, of those that moved.')}
        ${gauge('Above 50-day avg', a50, 'Share of stocks trading above their 50-day average: the medium-term trend.')}
        ${gauge('Above 200-day avg', a200, 'Share of stocks above their 200-day average: the long-term trend.')}
        ${gauge('Highs vs lows', hl, 'Stocks near a 52-week high, as a share of those near a high or a low.')}
        <div class="sx-note">Across ${(num(m.stocks) || 0).toLocaleString('en-IN')} NSE stocks with live prices. Green above 55%, red below 45%.</div>
      </div>
    </div>`;
  }

  /* ---------- 2. Scoreboard ---------- */
  function spark(arr, up) {
    if (!Array.isArray(arr) || arr.length < 5) return '<span class="sx-spark-empty">—</span>';
    const v = arr.map(Number), mn = Math.min(...v), mx = Math.max(...v), w = 84, h = 26, r = mx - mn || 1;
    const pts = v.map((y, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 2 - (y - mn) / r * (h - 4)).toFixed(1)}`).join(' ');
    return `<svg class="sx-spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
  }
  function scoreboard() {
    const nf = D.nifty || {}, nRet = num(nf[period]);
    const rows = (D.indices || []).slice().sort((a, b) => (num(b.ret[period]) ?? -1e9) - (num(a.ret[period]) ?? -1e9));
    const maxAbs = Math.max(0.5, ...rows.map((x) => Math.abs(num(x.ret[period]) || 0)), Math.abs(nRet || 0));
    const bar = (v) => {
      if (v === null) return '<div class="sx-bar"></div>';
      const w = Math.abs(v) / maxAbs * 50;
      return `<div class="sx-bar"><i class="${tone(v)}" style="${v >= 0 ? 'left:50%' : 'right:50%'};width:${w.toFixed(1)}%"></i></div>`;
    };
    const chip = (ok, label) => ok === null || ok === undefined ? `<span class="sx-chip na" title="Not enough history yet">${label} —</span>` : `<span class="sx-chip ${ok ? 'up' : 'down'}" title="${ok ? 'Above' : 'Below'} its ${label}-day average">${label}D ${ok ? '▲' : '▼'}</span>`;
    const pLabel = PERIODS.find((p) => p[0] === period)[1];
    const missing = rows.filter((x) => num(x.ret[period]) === null).length;
    const body = rows.map((x) => {
      const v = num(x.ret[period]), rel = v !== null && nRet !== null ? v - nRet : null, fh = num(x.from_high), ph = x.phase && PHASE[x.phase];
      return `<div class="sx-row${x.group ? ' click' : ''}" ${x.group ? `data-grp="${esc(x.group)}" role="button" tabindex="0" title="See the ${esc(x.group)} stocks"` : ''}>
        <div class="sx-name"><b>${esc(x.name)}</b><small>${x.group ? esc(x.group) : 'Index'}${x.history_days < 30 ? ' · history building' : ''}</small></div>
        <div class="sx-ret"><span class="${tone(v)}">${sgn(v)}</span>${bar(v)}</div>
        <div class="sx-rel ${tone(rel)}" title="Percentage points ahead of (+) or behind (−) the Nifty 50 over ${pLabel}">${rel === null ? '—' : sgn(rel, 1, ' pts')}</div>
        <div class="sx-trend">${chip(x.above50, '50')}${chip(x.above200, '200')}</div>
        <div class="sx-fh" title="Distance from the 52-week high">${fh === null ? '—' : fh > -0.5 ? '<span class="up">At high</span>' : sgn(fh, 1)}</div>
        <div class="sx-sp">${spark(x.spark, (num(x.ret.m3) ?? 0) >= 0)}</div>
        <div class="sx-ph">${ph ? `<span class="sx-phase ${ph.cls}" title="${esc(ph.txt)}">${x.phase}</span>` : '<span class="sx-phase na" title="Needs about 3 months of history">—</span>'}</div>
      </div>`;
    }).join('');
    const bench = `<div class="sx-row sx-bench" title="The benchmark every sector is compared with">
        <div class="sx-name"><b>Nifty 50</b><small>Benchmark</small></div>
        <div class="sx-ret"><span class="${tone(nRet)}">${sgn(nRet)}</span>${bar(nRet)}</div>
        <div class="sx-rel">—</div><div class="sx-trend"></div><div class="sx-fh"></div>
        <div class="sx-sp">${spark(nf.spark, (num(nf.m3) ?? 0) >= 0)}</div><div class="sx-ph"><span class="sx-phase na">Benchmark</span></div>
      </div>`;
    return `<div class="mp-panel span-12">
      <div class="mp-panel-title"><span>Sector scoreboard</span><span class="widget-badge neutral">Nifty 50 ${pLabel}: ${sgn(nRet)}</span></div>
      <div class="sx-tabs" role="tablist">${PERIODS.map((p) => `<button type="button" role="tab" class="sx-tab${p[0] === period ? ' on' : ''}" data-period="${p[0]}">${p[1]}</button>`).join('')}</div>
      <div class="sx-board">
        <div class="sx-row sx-head"><div>Index</div><div>Return ${pLabel}</div><div>vs Nifty</div><div>Trend</div><div>From 52W high</div><div>3 months</div><div>Phase</div></div>
        ${bench}${body}
      </div>
      <p class="mp-panel-note">Sorted by the ${pLabel} return. <b>vs Nifty</b> is the gap to the Nifty 50's return over the same period. <b>Trend</b>: is the index above its 50- and 200-day averages. <b>Phase</b> comes from the rotation map below. Click a row to see the stocks in that group.${missing ? ` ${missing} indices show “—” because their price history is still being collected.` : ''}</p>
    </div>`;
  }

  /* ---------- 3. Rotation map ---------- */
  function rotation() {
    const pts = (D.indices || []).filter((x) => num(x.rs) !== null && num(x.mom) !== null);
    if (!pts.length) return `<div class="mp-panel span-12"><div class="mp-panel-title"><span>Sector rotation</span></div><div class="sx-empty">Not enough price history yet.</div></div>`;
    // Scale to the current positions (trails may run off the edge and are clipped), so one outlier does not squash the rest.
    const heads = pts.map((x) => [num(x.rs), num(x.mom)]);
    const mx = Math.max(2.5, ...heads.map((p) => Math.abs(p[0]))) * 1.35, my = Math.max(2.5, ...heads.map((p) => Math.abs(p[1]))) * 1.35;
    const W = 520, Hh = 400, pad = 28;
    const cl = (v, m) => Math.max(-m, Math.min(m, v));
    const X = (v) => pad + (cl(v, mx) + mx) / (2 * mx) * (W - 2 * pad), Y = (v) => Hh - pad - (cl(v, my) + my) / (2 * my) * (Hh - 2 * pad);
    const cx = X(0), cy = Y(0);
    const col = { Leading: 'var(--positive)', Weakening: 'var(--neutral)', Lagging: 'var(--negative)', Improving: '#5B8DEF' };
    // Labels: try eight spots around each dot and keep the first that overlaps no other label or dot.
    const boxes = pts.map((x) => { const hx = X(num(x.rs)), hy = Y(num(x.mom)); return [hx - 6, hy - 6, hx + 6, hy + 6]; });
    const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const order = pts.map((x, i) => i).sort((a, b) => Math.abs(num(pts[b].rs)) - Math.abs(num(pts[a].rs)));
    const labels = [];
    order.forEach((i) => {
      const x = pts[i], hx = X(num(x.rs)), hy = Y(num(x.mom)), t = short(x.name), w = t.length * 6.4 + 2, h = 12;
      const spots = [[8, -4], [8, 10], [-8 - w, -4], [-8 - w, 10], [-w / 2, -10], [-w / 2, 20], [8, -16], [-8 - w, -16], [8, 22], [-8 - w, 22]];
      let best = null;
      for (const [dx, dy] of spots) {
        const bx = [hx + dx, hy + dy - h + 2, hx + dx + w, hy + dy + 2];
        if (bx[0] < 2 || bx[2] > W - 2 || bx[1] < 2 || bx[3] > Hh - 2) continue;
        if (!labels.some((l) => hit(l.b, bx)) && !boxes.some((b, j) => j !== i && hit(b, bx))) { best = { b: bx, x: hx + dx, y: hy + dy }; break; }
      }
      if (!best) { const dx = hx > W - 90 ? -8 - w : 8; best = { b: [hx + dx, hy - 10, hx + dx + w, hy + 2], x: hx + dx, y: hy - 4 }; }
      labels[i] = best; labels.push(best);
    });
    const dots = pts.map((x, i) => {
      const tr = (x.trail || []).map((t) => [X(num(t[0])), Y(num(t[1]))]);
      const hx = X(num(x.rs)), hy = Y(num(x.mom)), c = col[x.phase] || 'var(--text-muted)';
      return `<g class="sx-pt" data-grp="${esc(x.group || '')}"><title>${esc(x.name)}: relative strength ${sgn(num(x.rs), 2, '')}, momentum ${sgn(num(x.mom), 2, '')} · ${x.phase}</title>
        ${tr.length > 1 ? `<polyline points="${tr.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" style="stroke:${c}" class="sx-trail"/>` : ''}
        ${tr.slice(0, -1).map((p, k) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${1.6 + k * 0.5}" style="fill:${c}" opacity="${0.25 + k * 0.12}"/>`).join('')}
        <circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="5.5" style="fill:${c}" class="sx-head"/></g>`;
    }).join('');
    const texts = pts.map((x, i) => `<text x="${labels[i].x.toFixed(1)}" y="${labels[i].y.toFixed(1)}" class="sx-lbl" data-grp="${esc(x.group || '')}">${esc(short(x.name))}</text>`).join('');
    const svg = `<svg class="sx-rrg" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Sector rotation map">
      <rect x="${cx}" y="${pad}" width="${W - pad - cx}" height="${cy - pad}" class="q lead"/><rect x="${cx}" y="${cy}" width="${W - pad - cx}" height="${Hh - pad - cy}" class="q weak"/>
      <rect x="${pad}" y="${cy}" width="${cx - pad}" height="${Hh - pad - cy}" class="q lag"/><rect x="${pad}" y="${pad}" width="${cx - pad}" height="${cy - pad}" class="q imp"/>
      <line x1="${pad}" x2="${W - pad}" y1="${cy}" y2="${cy}" class="ax"/><line x1="${cx}" x2="${cx}" y1="${pad}" y2="${Hh - pad}" class="ax"/>
      <text x="${W - pad - 6}" y="${pad + 14}" text-anchor="end" class="ql lead">LEADING</text><text x="${W - pad - 6}" y="${Hh - pad - 8}" text-anchor="end" class="ql weak">WEAKENING</text>
      <text x="${pad + 6}" y="${Hh - pad - 8}" class="ql lag">LAGGING</text><text x="${pad + 6}" y="${pad + 14}" class="ql imp">IMPROVING</text>
      <text x="${W - pad}" y="${Hh - 8}" text-anchor="end" class="axl">Stronger than Nifty →</text><text x="${pad}" y="${Hh - 8}" class="axl">← Weaker</text>
      <text x="12" y="${pad}" class="axl" transform="rotate(-90 12 ${pad})" text-anchor="end">Gaining →</text>
      <defs><clipPath id="sxClip"><rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${Hh - 2 * pad}"/></clipPath></defs>
      <g clip-path="url(#sxClip)">${dots}</g>${texts}</svg>`;
    const lists = ['Leading', 'Improving', 'Weakening', 'Lagging'].map((ph) => {
      const xs = pts.filter((x) => x.phase === ph).sort((a, b) => num(b.rs) - num(a.rs));
      return `<div class="sx-q ${PHASE[ph].cls}"><div class="sx-q-h"><span class="sx-phase ${PHASE[ph].cls}">${ph}</span><small>${PHASE[ph].txt}</small></div>
        <div class="sx-q-l">${xs.length ? xs.map((x) => `<span${x.group ? ` data-grp="${esc(x.group)}" role="button" tabindex="0"` : ''}>${esc(short(x.name))}</span>`).join('') : '<em>None</em>'}</div></div>`;
    }).join('');
    return `<div class="mp-panel span-12">
      <div class="mp-panel-title"><span>Sector rotation vs Nifty 50</span><span class="widget-badge neutral">${pts.length} indices · trail = last 4 weeks</span></div>
      <div class="sx-rot"><div class="sx-rrg-w">${svg}</div><div class="sx-qs">${lists}</div></div>
      <p class="mp-panel-note"><b>How to read:</b> right of centre = the sector has done better than the Nifty over the last 3 months (its price ratio to the Nifty is above its 3-month average); above centre = that lead is growing over the last 10 days. Sectors usually move clockwise: Improving → Leading → Weakening → Lagging. The faded dots show where each one was 5, 10, 15 and 20 trading days ago. This describes past moves; it is not a forecast.</p>
    </div>`;
  }

  /* ---------- 4. Sector groups ---------- */
  function groups() {
    const gs = (D.groups || []).filter((g) => g.grp).slice();
    const key = { mcap: (g) => num(g.mcap) || 0, today: (g) => num(g.wtd_chg) ?? -99, trend: (g) => num(g.above50) ?? -1, value: (g) => -(num(g.median_pe) ?? 1e6) }[groupSort];
    gs.sort((a, b) => key(b) - key(a));
    const pct = (v) => { v = num(v); if (v === null) return '<span class="sx-muted">—</span>'; const c = v >= 55 ? 'up' : v <= 45 ? 'down' : 'mid'; return `<div class="sx-mini"><span class="${c}">${Math.round(v)}%</span><div><i class="${c}" style="width:${Math.max(0, Math.min(100, v))}%"></i></div></div>`; };
    const movers = (arr) => (arr || []).slice(0, 2).map((t) => `<span data-sym="${esc(t.s)}">${esc(t.s)}</span> <span class="${tone(num(t.c))}">${sgn(num(t.c), 1)}</span>`).join('<br>') || '—';
    const sortBtn = (k, l) => `<button type="button" class="sx-tab${groupSort === k ? ' on' : ''}" data-gsort="${k}">${l}</button>`;
    const rows = gs.map((g) => {
      const up = num(g.up) || 0, dn = num(g.down) || 0, tot = Math.max(1, up + dn), rv = num(g.rel_vol), sel = openGroup === g.grp;
      return `<tr class="sx-grow${sel ? ' sel' : ''}" data-grp="${esc(g.grp)}" role="button" tabindex="0" title="See the ${esc(g.grp)} stocks">
        <td><b>${esc(g.grp)}</b><small>${g.stocks} stocks · ${cr(g.mcap)}</small></td>
        <td class="r ${tone(num(g.wtd_chg))}" title="Market-cap weighted; equal-weight ${sgn(num(g.avg_chg))}">${sgn(num(g.wtd_chg))}</td>
        <td><div class="sx-ud"><span class="mono">${up}/${dn}</span><div><i style="width:${(up / tot * 100).toFixed(0)}%"></i></div></div></td>
        <td>${pct(g.above50)}</td><td class="hide-s">${pct(g.above200)}</td>
        <td class="r hide-s"><span class="up">${num(g.near_high) || 0}</span> / <span class="down">${num(g.near_low) || 0}</span></td>
        <td class="r hide-s">${num(g.median_pe) === null ? '—' : num(g.median_pe).toFixed(1)}</td>
        <td class="r hide-s ${rv !== null && rv >= 1.3 ? 'up' : ''}" title="Today's volume vs the 3-month average">${rv === null ? '—' : rv.toFixed(2) + '×'}</td>
        <td class="sx-mv hide-s">${movers((g.best || []).slice(0, 1).concat((g.worst || []).slice(0, 1)))}</td>
      </tr>${sel ? `<tr class="sx-gx"><td colspan="9"><div id="sxGroupStocks" class="sx-gs">Loading ${esc(g.grp)} stocks…</div></td></tr>` : ''}`;
    }).join('');
    return `<div class="mp-panel span-12" id="sxGroups">
      <div class="mp-panel-title"><span>Breadth &amp; valuation by sector</span><span class="widget-badge neutral">${gs.length} groups</span></div>
      <div class="sx-tabs">${sortBtn('mcap', 'Largest')}${sortBtn('today', 'Best today')}${sortBtn('trend', 'Strongest trend')}${sortBtn('value', 'Cheapest P/E')}</div>
      <div class="sx-tw"><table class="sx-t">
        <thead><tr><th>Group</th><th class="r">Today</th><th>Up / down</th><th>Above 50D</th><th class="hide-s">Above 200D</th><th class="r hide-s">Near high / low</th><th class="r hide-s">Median P/E</th><th class="r hide-s">Volume</th><th class="hide-s">Top gainer / loser</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="mp-panel-note"><b>Today</b> is weighted by market cap, so large companies count more. <b>Above 50D / 200D</b>: share of the group's stocks above their 50- and 200-day averages — above 55% is a healthy trend, below 45% a weak one. <b>Near high / low</b>: stocks within 3% of a 52-week high or low. <b>Volume</b> above 1.3× means unusual interest. Top gainer and loser are among stocks worth more than ₹500 Cr. Click a group to see its stocks.</p>
    </div>`;
  }

  async function loadGroup(g) {
    let list;
    try { list = await rpc('sector_group_stocks', { p_group: g, p_limit: 60 }); } catch (e) { list = null; }
    const box = $('sxGroupStocks');
    if (!box || openGroup !== g) return;
    if (!Array.isArray(list)) { box.textContent = 'Could not load the stocks. Try again.'; return; }
    if (!list.length) { box.textContent = 'No priced stocks in this group.'; return; }
    const ch = (ok, l) => ok === null || ok === undefined ? '' : `<span class="sx-chip ${ok ? 'up' : 'down'}">${l} ${ok ? '▲' : '▼'}</span>`;
    box.innerHTML = `<div class="sx-gs-h"><b>${esc(g)}</b> — ${list.length} largest stocks <button type="button" class="sx-x" data-close="1">Close ✕</button></div>
      <div class="sx-tw"><table class="sx-t sx-t2"><thead><tr><th>Stock</th><th class="r">Price</th><th class="r">Today</th><th class="r hide-s">M-cap</th><th class="r hide-s">P/E</th><th class="r hide-s">ROE</th><th>Trend</th><th class="r hide-s">From high</th><th class="r hide-s">Volume</th></tr></thead><tbody>
      ${list.map((s) => `<tr><td><b data-sym="${esc(s.symbol)}">${esc(s.symbol)}</b><small data-sym="${esc(s.symbol)}">${esc(s.name || '')}${s.industry ? ' · ' + esc(s.industry) : ''}</small></td>
        <td class="r mono">${num(s.price) === null ? '—' : '₹' + num(s.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
        <td class="r ${tone(num(s.chg))}">${sgn(num(s.chg))}</td><td class="r hide-s">${cr(s.mcap)}</td>
        <td class="r hide-s">${num(s.pe) === null ? '—' : num(s.pe).toFixed(1)}</td><td class="r hide-s">${num(s.roe) === null ? '—' : num(s.roe).toFixed(1) + '%'}</td>
        <td>${ch(s.above50, '50D')}${ch(s.above200, '200D')}</td>
        <td class="r hide-s">${num(s.from_high) === null ? '—' : sgn(num(s.from_high), 1)}</td>
        <td class="r hide-s ${num(s.rel_vol) >= 1.5 ? 'up' : ''}">${num(s.rel_vol) === null ? '—' : num(s.rel_vol).toFixed(2) + '×'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function render() {
    const root = $('sxRoot');
    if (!root || !D) return;
    root.innerHTML = marketRead() + scoreboard() + rotation() + groups();
    if (openGroup) loadGroup(openGroup);
  }
  function setGroup(g, scroll) {
    openGroup = openGroup === g && !scroll ? null : g;
    render();
    if (scroll && openGroup) { const el = document.querySelector('#sxGroups tr.sel'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      const d = await rpc('sector_dashboard');
      if (d && Array.isArray(d.indices)) { D = d; lastLoad = Date.now(); render(); }
    } catch (e) {
      console.error('[Sectors]', e);
      if (!D && $('sxRoot')) $('sxRoot').innerHTML = '<div class="mp-panel span-12 sx-empty">Could not load sector data. It will retry in a minute.</div>';
    } finally { loading = false; }
  }
  function visible() { const p = $('page-sectors'); return p && !p.classList.contains('hidden') && !document.hidden; }

  document.addEventListener('click', (e) => {
    const root = $('sxRoot');
    if (!root || !root.contains(e.target)) return;
    if (e.target.closest('[data-sym]')) return; // opens the stock (site-header.js)
    const t = e.target.closest('[data-period],[data-gsort],[data-close],[data-grp]');
    if (!t) return;
    if (t.dataset.period) { period = t.dataset.period; try { localStorage.setItem('mp_sec_period', period); } catch (x) { /* ignore */ } render(); }
    else if (t.dataset.gsort) { groupSort = t.dataset.gsort; render(); }
    else if (t.dataset.close) { openGroup = null; render(); }
    else if (t.dataset.grp) setGroup(t.dataset.grp, !t.classList.contains('sx-grow'));
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#sxRoot [data-grp][role=button]')) { e.preventDefault(); e.target.click(); }
  });

  window.mpSectors = {
    show() {
      if (!$('sxRoot')) return;
      if (!D) $('sxRoot').innerHTML = '<div class="mp-panel span-12 sx-empty">Loading sector data…</div>';
      if (Date.now() - lastLoad > 20000) load(); else render();
      if (!timer) timer = setInterval(() => { if (visible() && Date.now() - lastLoad >= 59000) load(); }, 5000);
    },
    refresh: () => load(),
  };
  if (visible()) window.mpSectors.show();
})();
