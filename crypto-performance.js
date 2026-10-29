/* Crypto bot performance: the edge-check strip above the tabs and the Performance tab.
   Reads the signed-in user's closed paper trades, the bot's last run (circuit-breaker state) and the
   shadow trades recorded while the breaker is on. Uses the page globals dbRequest, currentUser, $.
   window.mpCryptoPerf.render() draws the Performance tab; the strip refreshes itself every minute. */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const inr = (v, sign) => { const n = Math.round(num(v)); return (sign && n > 0 ? '+' : n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN'); };
  const rFmt = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + 'R';
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const notesOf = (t) => { try { const n = typeof t.notes === 'string' ? JSON.parse(t.notes || '{}') : (t.notes || {}); return n && typeof n === 'object' ? n : {}; } catch (e) { return {}; } };
  const EXITS = [
    ['take_profit', 'Take-profit', 'Reached the full target'],
    ['trailing_stop', 'Trailing stop', 'Stop had moved into profit, then price came back'],
    ['stop_loss', 'Stop-loss', 'Hit the original stop'],
    ['manual', 'Closed by hand', 'Manual or kill-switch close'],
  ];
  const BINS = [[-Infinity, -1, '≤ −1R', '≤−1'], [-1, -0.5, '−1 to −0.5', '−1…−½'], [-0.5, 0, '−0.5 to 0', '−½…0'], [0, 0.5, '0 to 0.5', '0…½'], [0.5, 1, '0.5 to 1', '½…1'], [1, 2, '1 to 2', '1…2'], [2, Infinity, '≥ 2R', '≥2']];
  let data = null, loading = null, loadedAt = 0;

  // Original risk in ₹ (the stop may have trailed; the target never moves: risk = |target − entry| / rr).
  function riskInr(t) {
    const entry = num(t.entry_price), tp = num(t.take_profit), rr = num(t.rr) || 2;
    return entry > 0 ? num(t.amount_inr) * (num(t.leverage) || 1) * (Math.abs(tp - entry) / rr) / entry : 0;
  }
  function exitKind(t, n) {
    if (n.closeReason === 'take_profit' || n.closeReason === 'trailing_stop' || n.closeReason === 'stop_loss') return n.closeReason;
    if (t.status === 'TP_HIT') return 'take_profit';
    if (t.status === 'SL_HIT') return n.profitTrailActivated === true || num(t.pnl_inr) > 0 ? 'trailing_stop' : 'stop_loss';
    return 'manual';
  }

  async function load() {
    if (typeof currentUser === 'undefined' || !currentUser || typeof dbRequest !== 'function') return null;
    const uid = encodeURIComponent(currentUser.id);
    const [tr, bot, sh] = await Promise.all([
      dbRequest('crypto_trades?select=pair,direction,status,entry_price,take_profit,close_price,rr,amount_inr,leverage,pnl_inr,notes,created_at,closed_at&user_id=eq.' + uid + '&closed_at=not.is.null&status=neq.CANCELLED&order=closed_at.asc'),
      dbRequest('crypto_bot_settings?select=enabled,config,last_run_at,last_summary&user_id=eq.' + uid),
      dbRequest('crypto_shadow_trades?select=pair,direction,status,entry_price,close_price,r_multiple,pnl_inr,created_at,closed_at&user_id=eq.' + uid + '&order=created_at.desc&limit=200'),
    ]);
    const trades = (Array.isArray(tr.data) ? tr.data : []).map((t) => {
      const n = notesOf(t), risk = riskInr(t), pnl = num(t.pnl_inr);
      const fee = Number.isFinite(Number(n.feeRate)) ? Number(n.feeRate) : 0.001;
      const pos = num(t.amount_inr) * (num(t.leverage) || 1), ratio = num(t.entry_price) > 0 && num(t.close_price) > 0 ? num(t.close_price) / num(t.entry_price) : 1;
      return { pair: t.pair, dir: t.direction, pnl, r: risk > 0 ? pnl / risk : null, exit: exitKind(t, n), fees: pos * fee * (1 + ratio), at: t.closed_at };
    });
    const row = Array.isArray(bot.data) ? bot.data[0] : null;
    const shadow = Array.isArray(sh.data) ? sh.data : [];
    return { trades, bot: row, shadow, error: tr.error ? (tr.error.message || String(tr.error)) : null };
  }

  function stats(trades) {
    const n = trades.length, wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
    const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
    const net = sum(trades, (t) => t.pnl), gw = sum(wins, (t) => t.pnl), gl = sum(losses, (t) => t.pnl);
    const withR = trades.filter((t) => t.r !== null);
    let eq = 0, peak = 0, dd = 0;
    const curve = trades.map((t) => { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); return eq; });
    const last = withR.slice(-30);
    return {
      n, wins: wins.length, losses: losses.length, net, curve, maxDD: dd,
      winRate: n ? wins.length / n * 100 : 0,
      avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? gl / losses.length : 0,
      expInr: n ? net / n : 0, expR: withR.length ? sum(withR, (t) => t.r) / withR.length : 0,
      last30R: last.length ? sum(last, (t) => t.r) / last.length : 0, last30n: last.length,
      pf: gl < 0 ? gw / -gl : null, fees: sum(trades, (t) => t.fees),
    };
  }

  function breakerOf(d) {
    const b = d.bot?.last_summary?.breaker;
    const on = !!(d.bot && d.bot.enabled && d.bot.config && d.bot.config.where === 'server');
    return { serverOn: on, active: !!b?.active, expR: num(b?.expR), n: num(b?.n), since: b?.since || null, resumeAtR: b?.resumeAtR ?? 0.05, known: !!b };
  }
  // A guard in the user's own settings that rejects every signal (e.g. 1h timeframe with the 4h-only guard).
  function settingsBlock(d) {
    const blocked = d.bot?.last_summary?.blocked || [];
    const hit = blocked.find((m) => /timeframe .* is below 4h|auto SHORT trades are off/.test(m));
    if (!hit) return '';
    return /timeframe/.test(hit)
      ? 'Your settings use the ' + esc(d.bot.config?.tf || '') + ' timeframe, but the “4h and above” trade guard rejects anything shorter, so no signal can be traded (or shadow-tracked). Change one of them in Settings.'
      : 'A SHORT signal was skipped because auto SHORT trades are off in your guards.';
  }

  /* ───────── Bot status line (above the price row) ───────── */
  function renderStrip() {
    const el = $('edgeStrip');
    if (!el) return;
    if (!data) { el.hidden = true; return; }
    const s = stats(data.trades), b = breakerOf(data);
    let tone, text;
    if (!b.serverOn) { tone = 'off'; text = '<b>Bot is off.</b> Turn on Auto Trades (Server) to let it trade.'; }
    else if (b.active) { tone = 'paused'; text = '<b>Bot paused.</b> Its last ' + b.n + ' trades average ' + rFmt(b.expR) + ', so it is only paper-tracking signals until that is back above +' + num(b.resumeAtR).toFixed(2) + 'R.'; }
    else if (s.n < 20) { tone = 'live'; text = '<b>Bot trading.</b> ' + (s.n ? s.n + ' trade' + (s.n === 1 ? '' : 's') + ' closed so far' : 'No trades closed yet') + '; it pauses itself if the last 30 trades average below 0R (from 20 trades).'; }
    else { tone = 'live'; text = '<b>Bot trading.</b> Last 30 trades average ' + rFmt(b.known ? b.expR : s.last30R) + ' each.'; }
    const warn = settingsBlock(data);
    el.className = 'edge-strip ' + tone;
    el.innerHTML = '<span class="es-dot" aria-hidden="true"></span><span class="es-text">' + text + (warn ? ' <span class="es-warn">⚠️ Settings block every signal; see Performance.</span>' : '') + '</span>' +
      '<button type="button" class="es-more" data-perf-open>Performance →</button>';
    el.hidden = false;
  }

  /* ───────── Performance tab ───────── */
  function verdict(s, b, d) {
    let head, body, tone;
    if (!s.n) { tone = 'neutral'; head = 'Fresh start'; body = 'No closed trades yet. Results appear here as trades close; give it 20–30 trades before judging the strategy.'; }
    else if (s.n < 20) { tone = 'neutral'; head = 'Too early to judge'; body = s.n + ' closed trade' + (s.n === 1 ? '' : 's') + ' so far (' + inr(s.net, true) + '). A strategy needs 20–30 trades before the average means much.'; }
    else if (s.expR < 0) { tone = 'bad'; head = 'Losing ' + rFmt(s.expR).replace('−', '') + ' per trade'; body = 'Each trade loses ' + inr(s.expInr) + ' on average after fees: wins average ' + inr(s.avgWin, true) + ', losses ' + inr(s.avgLoss) + '.'; }
    else { tone = 'good'; head = 'Making ' + rFmt(s.expR) + ' per trade'; body = 'Each trade makes ' + inr(s.expInr, true) + ' on average after fees.'; }
    let breaker = '';
    if (b.known && b.active) breaker = '<p>🛑 <b>Paused by the circuit breaker</b>: the last ' + b.n + ' trades average ' + rFmt(b.expR) + '. Signals are paper-tracked (see Shadow trades below) and real trading resumes on its own above +' + num(b.resumeAtR).toFixed(2) + 'R.</p>';
    const warn = settingsBlock(d);
    return '<section class="pf-card pf-verdict ' + tone + '"><h2>' + head + '</h2><p>' + body + '</p>' + breaker +
      (warn ? '<p class="pf-warn">⚠️ ' + warn + '</p>' : '') + '</section>';
  }

  function tiles(s) {
    const t = (label, value, sub, c) => '<div class="pf-tile"><span>' + label + '</span><b class="' + (c || '') + '">' + value + '</b><small>' + sub + '</small></div>';
    return '<section class="pf-tiles">' +
      t('Net P&amp;L', inr(s.net, true), s.n + ' closed trade' + (s.n === 1 ? '' : 's') + ' · fees ' + inr(s.fees), cls(s.net)) +
      t('Win rate', s.n ? Math.round(s.winRate) + '%' : '—', s.wins + ' won · ' + s.losses + ' lost') +
      t('Average win', s.wins ? inr(s.avgWin, true) : '—', 'Per winning trade', s.wins ? 'pos' : '') +
      t('Average loss', s.losses ? inr(s.avgLoss) : '—', 'Per losing trade', s.losses ? 'neg' : '') +
    '</section>';
  }

  function moreTiles(s) {
    const t = (label, value, sub, c) => '<div class="pf-tile"><span>' + label + '</span><b class="' + (c || '') + '">' + value + '</b><small>' + sub + '</small></div>';
    return '<section class="pf-tiles">' +
      t('Per trade', rFmt(s.expR), inr(s.expInr, true) + ' on average', cls(s.expR)) +
      t('Profit factor', s.pf === null ? '—' : s.pf.toFixed(2), 'Above 1 makes money', s.pf !== null ? (s.pf >= 1 ? 'pos' : 'neg') : '') +
      t('Worst drawdown', inr(s.maxDD), 'Largest fall from a peak', s.maxDD < 0 ? 'neg' : '') +
      t('Last 30 trades', rFmt(s.last30R), 'Average per trade', cls(s.last30R)) +
    '</section>';
  }

  function winLossBars(s) {
    const max = Math.max(Math.abs(s.avgWin), Math.abs(s.avgLoss), 1);
    const bar = (label, v, c) => '<div class="pf-wl"><span>' + label + '</span><i><u class="' + c + '" style="width:' + (Math.abs(v) / max * 100).toFixed(1) + '%"></u></i><b>' + inr(v, c === 'pos') + '</b></div>';
    return '<section class="pf-card"><h3>Average win vs average loss</h3><p class="pf-note">A typical loss is ' + (s.avgWin ? (Math.abs(s.avgLoss / s.avgWin)).toFixed(1) : '—') + '× a typical win. With ' + Math.round(s.winRate) + '% winners, wins need to be at least ' + (s.winRate > 0 && s.winRate < 100 ? ((100 - s.winRate) / s.winRate).toFixed(2) : '—') + '× the size of losses to break even.</p>' +
      bar('Average win', s.avgWin, 'pos') + bar('Average loss', s.avgLoss, 'neg') + '</section>';
  }

  function exitTable(trades) {
    const rows = EXITS.map(([k, label, hint]) => {
      const list = trades.filter((t) => t.exit === k), total = list.reduce((a, t) => a + t.pnl, 0);
      return { k, label, hint, n: list.length, total, avg: list.length ? total / list.length : 0 };
    }).filter((r) => r.n);
    const max = Math.max(1, ...rows.map((r) => r.n));
    return '<section class="pf-card"><h3>How trades end</h3><table class="pf-table"><thead><tr><th>Exit</th><th class="r">Trades</th><th class="r">Avg</th><th class="r">Total</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td><b>' + r.label + '</b><small>' + r.hint + '</small><i class="pf-share"><u style="width:' + (r.n / max * 100).toFixed(1) + '%"></u></i></td><td class="r">' + r.n + '</td><td class="r ' + cls(r.avg) + '">' + inr(r.avg, true) + '</td><td class="r ' + cls(r.total) + '">' + inr(r.total, true) + '</td></tr>').join('') +
      '</tbody></table></section>';
  }

  // Equity curve: cumulative net P&L after each closed trade. Single series, so no legend; hover shows the trade.
  // Charts are drawn at their on-screen width (W), so text stays ~11px on phones and wide screens.
  function equityChart(s, trades, W) {
    if (trades.length < 2) return '';
    const H = Math.round(Math.min(260, Math.max(190, W * 0.42))), P = { l: 56, r: 12, t: 12, b: 26 };
    const ys = [0, ...s.curve], min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
    const x = (i) => P.l + (i / (s.curve.length)) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - (v - min) / span) * (H - P.t - P.b);
    const pts = [[x(0), y(0)], ...s.curve.map((v, i) => [x(i + 1), y(v)])];
    const ticks = [min, (min + max) / 2, max].map((v) => '<g><line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="pf-grid"/><text x="' + (P.l - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" class="pf-axis" text-anchor="end">' + inr(v) + '</text></g>').join('');
    const last = s.curve[s.curve.length - 1];
    return '<section class="pf-card"><h3>Equity curve</h3><p class="pf-note">Net P&amp;L after each closed trade, oldest to newest. Hover or tap for details.</p>' +
      '<div class="pf-chart" data-chart="equity"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cumulative net P&L over ' + trades.length + ' trades, ending at ' + inr(last, true) + '">' + ticks +
      '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" class="pf-zero"/>' +
      '<polyline points="' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '" class="pf-line ' + (last >= 0 ? 'pos' : 'neg') + '"/>' +
      '<text x="' + P.l + '" y="' + (H - 6) + '" class="pf-axis">Trade 1</text><text x="' + (W - P.r) + '" y="' + (H - 6) + '" class="pf-axis" text-anchor="end">Trade ' + trades.length + '</text>' +
      '<line class="pf-cross" y1="' + P.t + '" y2="' + (H - P.b) + '" x1="-10" x2="-10"/><circle class="pf-dot" r="4" cx="-10" cy="-10"/>' +
      '<rect class="pf-hit" x="' + P.l + '" y="' + P.t + '" width="' + (W - P.l - P.r) + '" height="' + (H - P.t - P.b) + '"/></svg><div class="pf-tip" hidden></div></div></section>';
  }

  function histogram(trades, W) {
    const rs = trades.filter((t) => t.r !== null).map((t) => t.r);
    if (rs.length < 3) return '';
    const counts = BINS.map(([a, b]) => rs.filter((r) => r >= a && r < b).length), max = Math.max(1, ...counts);
    const H = 210, P = { l: 6, r: 6, t: 18, b: 34 }, bw = (W - P.l - P.r) / BINS.length, short = W < 520;
    const bars = BINS.map(([a, , long, compact], i) => {
      const label = short ? compact : long;
      const h = counts[i] / max * (H - P.t - P.b), x0 = P.l + i * bw + 3, y0 = H - P.b - h;
      return '<g class="pf-bar-g" data-tip="' + esc(long + ': ' + counts[i] + ' trade' + (counts[i] === 1 ? '' : 's')) + '"><rect class="pf-hit" x="' + (P.l + i * bw) + '" y="' + P.t + '" width="' + bw + '" height="' + (H - P.t - P.b) + '"/>' +
        '<rect class="pf-bar ' + (a < 0 ? 'neg' : 'pos') + '" x="' + x0.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + (bw - 6).toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="3"/>' +
        (counts[i] ? '<text class="pf-val" x="' + (x0 + (bw - 6) / 2).toFixed(1) + '" y="' + (y0 - 4).toFixed(1) + '" text-anchor="middle">' + counts[i] + '</text>' : '') +
        '<text class="pf-axis" x="' + (x0 + (bw - 6) / 2).toFixed(1) + '" y="' + (H - P.b + 16) + '" text-anchor="middle">' + label + '</text></g>';
    }).join('');
    return '<section class="pf-card"><h3>Result per trade, in R</h3><p class="pf-note">1R = the amount risked to the original stop. Red bars lost money, green made money.</p>' +
      '<div class="pf-chart" data-chart="hist"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Distribution of ' + rs.length + ' trade results in R">' +
      '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + (H - P.b) + '" y2="' + (H - P.b) + '" class="pf-grid"/>' + bars + '</svg><div class="pf-tip" hidden></div></div></section>';
  }

  function shadowTable(d) {
    const rows = d.shadow.slice(0, 12);
    const closed = d.shadow.filter((x) => x.closed_at), avg = closed.length ? closed.reduce((a, x) => a + num(x.r_multiple), 0) / closed.length : null;
    return '<section class="pf-card"><h3>Shadow trades</h3><p class="pf-note">Recorded while the circuit breaker is on: what the bot would have traded, managed with the same stop and target rules, without touching your wallet.' +
      (closed.length ? ' ' + closed.length + ' closed, averaging <b class="' + cls(avg) + '">' + rFmt(avg) + '</b>.' : '') + '</p>' +
      (rows.length ? '<table class="pf-table"><thead><tr><th>Pair</th><th>Opened</th><th>Status</th><th class="r">Result</th></tr></thead><tbody>' + rows.map((x) =>
        '<tr><td><b>' + esc(x.pair) + '</b><small>' + esc(x.direction) + '</small></td><td>' + esc(new Date(x.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + '</td><td>' +
        (x.status === 'RUNNING' ? '<span class="pf-pill">Running</span>' : x.status === 'TP_HIT' ? '<span class="pf-pill pos">Target</span>' : '<span class="pf-pill neg">Stop</span>') + '</td><td class="r ' + cls(num(x.r_multiple)) + '">' + (x.closed_at ? rFmt(num(x.r_multiple)) : '—') + '</td></tr>').join('') + '</tbody></table>'
        : '<div class="pf-empty">No shadow trades yet. They appear here when the bot finds a signal while paused.</div>') + '</section>';
  }

  function findings() {
    return '<section class="pf-card pf-findings"><h3>Strategy check · 29 Oct 2026</h3>' +
      '<p>Why the breaker exists: I replayed every real trade and backtested the V6 strategy on 24 coins over about a year of Binance data.</p><ul>' +
      '<li><b>The trailing stop is not the problem.</b> On the same 132 trades it was the least-bad exit; a fixed 2R target lost twice as much (−79.8R vs −40.6R), and wider targets or breakeven stops were worse still.</li>' +
      '<li><b>The entries have no edge.</b> 68% of trades never moved 1R in their favour before the stop. V6 lost 0.05R per trade over 1,040 backtest trades (Oct 2025 – Jun 2026) and 0.12R over 469 (Jul – Oct 2026).</li>' +
      '<li><b>Higher confidence did not help.</b> Signals rated 90–95% did no better than 75–85%.</li>' +
      '<li><b>Fees cost about 0.14R per trade</b>, so tight stops (under 1.3%) lose the most to fees.</li>' +
      '<li>A trend-breakout alternative made money in summer 2026 but lost on older data, so it was not adopted.</li></ul></section>';
  }

  function wireCharts(root, trades, s) {
    root.querySelectorAll('.pf-chart').forEach((box) => {
      const svg = box.querySelector('svg'), tip = box.querySelector('.pf-tip');
      const show = (html, px, py) => { tip.innerHTML = html; tip.hidden = false; const bw = box.clientWidth; tip.style.left = Math.min(Math.max(8, px + 12), bw - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.max(0, py - 44) + 'px'; };
      const hide = () => { tip.hidden = true; const c = svg.querySelector('.pf-cross'), d = svg.querySelector('.pf-dot'); if (c) { c.setAttribute('x1', -10); c.setAttribute('x2', -10); } if (d) { d.setAttribute('cx', -10); d.setAttribute('cy', -10); } };
      if (box.dataset.chart === 'equity') {
        const line = svg.querySelector('.pf-line'), pts = line.getAttribute('points').split(' ').map((p) => p.split(',').map(Number));
        const move = (e) => {
          const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * svg.viewBox.baseVal.width;
          let best = 1; for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - sx) < Math.abs(pts[best][0] - sx)) best = i;
          const [px, py] = pts[best], t = trades[best - 1];
          svg.querySelector('.pf-cross').setAttribute('x1', px); svg.querySelector('.pf-cross').setAttribute('x2', px);
          const dot = svg.querySelector('.pf-dot'); dot.setAttribute('cx', px); dot.setAttribute('cy', py);
          show('<b>Trade ' + best + ' · ' + esc(t.pair) + ' ' + esc(t.dir) + '</b><span>' + inr(t.pnl, true) + (t.r !== null ? ' (' + rFmt(t.r) + ')' : '') + '</span><span>Running total ' + inr(s.curve[best - 1], true) + '</span>', px / svg.viewBox.baseVal.width * r.width, py / svg.viewBox.baseVal.height * r.height);
        };
        svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', hide);
      } else {
        svg.querySelectorAll('.pf-bar-g').forEach((g) => {
          const on = (e) => { const r = svg.getBoundingClientRect(); show(esc(g.dataset.tip), e.clientX - r.left, e.clientY - r.top); };
          g.addEventListener('pointermove', on); g.addEventListener('pointerdown', on); g.addEventListener('pointerleave', hide);
        });
      }
    });
  }

  async function refresh(force) {
    if (loading) return loading;
    if (!force && data && Date.now() - loadedAt < 30000) return data;
    loading = load().then((d) => { if (d) { data = d; loadedAt = Date.now(); } return data; }).catch((e) => { console.warn('[Performance]', e); return data; }).finally(() => { loading = null; });
    return loading;
  }

  async function render() {
    const root = $('perfPane');
    if (!root) return;
    if (typeof currentUser === 'undefined' || !currentUser) { root.innerHTML = '<div class="pf-empty">Log in to see your bot’s performance.</div>'; return; }
    if (!data) root.innerHTML = '<div class="pf-empty">Loading performance…</div>';
    await refresh(true);
    if (!data) { root.innerHTML = '<div class="pf-empty">Could not load your trades. Please try again.</div>'; return; }
    const s = stats(data.trades), b = breakerOf(data);
    if (b.known) s.last30R = b.expR; // the bot's own figure (real + shadow trades), so tile and strip agree
    // Chart width = its card's inner width: two columns from 900px, one below.
    const cs = getComputedStyle(root), inner = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const two = inner >= 860, W = Math.max(260, Math.round((two ? (inner - 14) / 2 : inner) - 34));
    const open = (() => { try { return localStorage.getItem('cs_perf_more') === '1'; } catch (e) { return false; } })();
    root.innerHTML = verdict(s, b, data) + tiles(s) +
      (s.n >= 2 ? '<div class="pf-cols">' + equityChart(s, data.trades, W) + exitTable(data.trades) + '</div>' : '') +
      '<details class="pf-more" id="pfMore"' + (open ? ' open' : '') + '><summary>More detail</summary>' +
        (s.n ? moreTiles(s) + '<div class="pf-cols">' + winLossBars(s) + histogram(data.trades, W) + '</div>' : '') +
        '<div class="pf-cols">' + shadowTable(data) + findings() + '</div>' +
      '</details>';
    $('pfMore')?.addEventListener('toggle', (e) => { try { localStorage.setItem('cs_perf_more', e.target.open ? '1' : '0'); } catch (x) {} });
    wireCharts(root, data.trades, s);
    renderStrip();
  }

  // Technical connection log: collapsed to its title bar unless opened (remembered on this device).
  const log = $('connectionLog'), logHead = log?.querySelector('.connection-log-head');
  const showLog = (on) => { if (!log) return; log.classList.toggle('collapsed', !on); logHead.setAttribute('aria-expanded', String(on)); const c = log.querySelector('.cl-chev'); if (c) c.textContent = on ? '▾' : '▸'; try { localStorage.setItem('cs_log_open', on ? '1' : '0'); } catch (e) {} };
  logHead?.addEventListener('click', (e) => { if (!e.target.closest('button')) showLog(log.classList.contains('collapsed')); });
  logHead?.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')) { e.preventDefault(); showLog(log.classList.contains('collapsed')); } });
  try { if (localStorage.getItem('cs_log_open') === '1') showLog(true); } catch (e) {}

  // "Bot settings" button: shows the settings panel (open state remembered on this device).
  const setBtn = $('cxSettingsBtn'), setPanel = $('cxSettings');
  const showSettings = (on) => { if (!setPanel || !setBtn) return; setPanel.hidden = !on; setBtn.setAttribute('aria-expanded', String(on)); setBtn.classList.toggle('on', on); try { localStorage.setItem('cs_settings_open', on ? '1' : '0'); } catch (e) {} };
  setBtn?.addEventListener('click', () => showSettings(setPanel.hidden));
  try { if (localStorage.getItem('cs_settings_open') === '1') showSettings(true); } catch (e) {}

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-perf-open]') && typeof selectAppTab === 'function') { selectAppTab('performance'); $('perfPane')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  // Wait for the page to sign in, then keep the strip fresh.
  let tries = 0;
  const boot = setInterval(async () => {
    tries++;
    if (typeof currentUser !== 'undefined' && currentUser) { clearInterval(boot); await refresh(true); renderStrip(); setInterval(async () => { if (document.hidden) return; await refresh(true); renderStrip(); if ($('perfPane') && !$('perfPane').hidden) render(); }, 60000); }
    else if (tries > 60) clearInterval(boot);
  }, 1000);

  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if ($('perfPane') && !$('perfPane').hidden && data) render(); }, 250); });

  window.mpCryptoPerf = { render, refresh, stats };
})();
