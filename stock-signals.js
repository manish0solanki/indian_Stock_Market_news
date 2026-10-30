/* Stock Signals — broker-style paper trading app.
   Signals are produced on the server (Supabase job); paper trades are managed on the server too
   (stops/targets fill at their exact level, intraday positions are squared off at 15:20 IST).
   This page only displays data and places/modifies/exits paper orders. */
(function () {
'use strict';

const SUPABASE_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const fmt = (n, d = 2) => n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const inr = (n, d = 2) => n === null || n === undefined ? '—' : (n < 0 ? '-₹' : '₹') + fmt(Math.abs(n), d);
const sinr = (n, d = 0) => n === null || n === undefined ? '—' : (n >= 0 ? '+' : '-') + '₹' + fmt(Math.abs(n), d);
const pct = (n) => n === null || n === undefined ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'muted');

const S = {
  user: null,
  signals: [], feedAt: null, srvOffset: 0,
  quotes: {},
  account: { starting_balance: 100000, cost_bps: 10, risk_pct: 1 },
  trades: [],
  indices: [],
  status: null,
  tab: 'signals',
  f: { tf: 'all', side: 'all', sort: 'score', q: '', hist: 'all' },
  loaded: { feed: 0, trades: 0 },
};

/* ===================== time / market ===================== */
function ist(ms) { const t = new Date(ms + 330 * 60000); return { dow: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes(), date: t.toISOString().slice(0, 10) }; }
function marketState(ms) {
  const p = ist(ms), wk = p.dow >= 1 && p.dow <= 5;
  const OPEN = 9 * 60 + 15, CLOSE = 15 * 60 + 30;
  if (wk && p.min >= OPEN && p.min < CLOSE) return { open: true, text: 'Market open · closes in ' + dur((CLOSE - p.min) * 60) };
  let mins;
  if (wk && p.min < OPEN) mins = OPEN - p.min;
  else { let add = 1, d = (p.dow + 1) % 7; while (d === 0 || d === 6) { add++; d = (d + 1) % 7; } mins = (24 * 60 - p.min) + (add - 1) * 24 * 60 + OPEN; }
  return { open: false, text: 'Market closed · opens in ' + dur(mins * 60) };
}
function dur(sec) { sec = Math.max(0, Math.round(sec)); const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60); return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm'; }
function ago(iso) { if (!iso) return '—'; const s = (Date.now() + S.srvOffset - new Date(iso).getTime()) / 1000; if (s < 5) return 'just now'; if (s < 90) return Math.round(s) + 's ago'; if (s < 5400) return Math.round(s / 60) + ' min ago'; if (s < 172800) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; }
const nowMs = () => Date.now() + S.srvOffset;

/* ===================== toast / sheet ===================== */
let toastTimer = null;
function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200); }
function openSheet(html) { const s = $('sheet'); s.innerHTML = '<div class="grab"></div>' + html; $('backdrop').hidden = false; s.setAttribute('aria-hidden', 'false'); requestAnimationFrame(() => s.classList.add('open')); s.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheet)); }
function closeSheet() { S.ticketTick = null; const s = $('sheet'); s.classList.remove('open'); s.setAttribute('aria-hidden', 'true'); $('backdrop').hidden = true; setTimeout(() => { if (!s.classList.contains('open')) s.innerHTML = ''; }, 250); }

/* ===================== data helpers ===================== */
function ltpOf(symbol, fallback) {
  const q = S.quotes[symbol]; if (q && num(q.price) > 0) return num(q.price);
  const s = S.signals.find((x) => x.symbol === symbol); if (s && num(s.ltp) > 0) return num(s.ltp);
  return fallback ?? null;
}
function chgOf(symbol) { const q = S.quotes[symbol]; if (q && num(q.change_percent) !== null) return num(q.change_percent); const s = S.signals.find((x) => x.symbol === symbol); return s ? num(s.change_percent) : null; }
const costBpsOf = (t) => { const v = num(t && t.signal_snapshot && t.signal_snapshot.estimated_cost_bps); return v !== null ? v : num(S.account.cost_bps) ?? 10; };

function posMetrics(t) {
  const qty = num(t.quantity) || 0, entry = num(t.entry_price) || 0, buy = t.direction === 'BUY';
  const mark = num(t.signal_snapshot && t.signal_snapshot.mark_price);
  const px = ltpOf(t.symbol, mark ?? entry);
  const gross = (px - entry) * qty * (buy ? 1 : -1);
  const estCost = (entry * qty + px * qty) * costBpsOf(t) / 10000;
  const net = gross - estCost;
  return { qty, entry, px, gross, net, netPct: entry * qty ? net / (entry * qty) * 100 : 0, booked: num(t.realized_pnl) || 0, invested: entry * qty, value: px * qty, risk: Math.abs(entry - (num(t.stop_loss) || entry)) * qty };
}
function acctNumbers() {
  const open = S.trades.filter((t) => t.status === 'OPEN'), closed = S.trades.filter((t) => t.status !== 'OPEN');
  const realized = S.trades.reduce((s, t) => s + (num(t.realized_pnl) || 0), 0);
  let invested = 0, unreal = 0, value = 0, openRisk = 0, booked = 0;
  open.forEach((t) => { const m = posMetrics(t); invested += m.invested; unreal += m.net; value += m.value; openRisk += m.risk; booked += m.booked; });
  const start = num(S.account.starting_balance) || 100000;
  return { open, closed, realized, invested, unreal, value, openRisk, booked, start, cash: start + realized - invested, equity: start + realized + unreal };
}

/* ===================== loaders ===================== */
async function loadFeed() {
  const { data, error } = await sb.rpc('stock_signals_feed');
  if (error) { console.warn('feed', error); return; }
  S.signals = (data && data.signals) || [];
  S.feedAt = data && data.generated_at;
  if (data && data.server_now) S.srvOffset = new Date(data.server_now).getTime() - Date.now();
  S.loaded.feed = Date.now();
  S.signals.forEach((s) => { if (num(s.ltp) > 0) S.quotes[s.symbol] = Object.assign({}, S.quotes[s.symbol], { price: s.ltp, change_percent: s.change_percent }); });
}
async function loadIndices() {
  const { data } = await sb.rpc('market_snapshot');
  S.indices = Array.isArray(data) ? data.slice(0, 4) : [];
}
async function loadStatus() {
  const { data } = await sb.rpc('stock_signals_status');
  S.status = data || null;
}
async function loadAccount() {
  const { data, error } = await sb.from('stock_paper_accounts').select('*').eq('user_id', S.user.id).maybeSingle();
  if (error) { console.warn('account', error); return; }
  if (data) { S.account = { starting_balance: num(data.starting_balance) ?? 100000, cost_bps: num(data.cost_bps) ?? 10, risk_pct: num(data.risk_pct) ?? 1 }; return; }
  // first run: migrate the old per-device settings if present, otherwise defaults
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem('marketpulse-paper-settings-' + S.user.id) || 'null'); } catch (e) { /* ignore */ }
  S.account = { starting_balance: num(legacy && legacy.balance) || 100000, cost_bps: num(legacy && legacy.costBps) ?? 10, risk_pct: 1 };
  await sb.from('stock_paper_accounts').upsert({ user_id: S.user.id, starting_balance: S.account.starting_balance, cost_bps: S.account.cost_bps, risk_pct: S.account.risk_pct }, { onConflict: 'user_id' });
}
async function loadTrades() {
  const { data, error } = await sb.from('stock_paper_trades').select('*').eq('user_id', S.user.id).order('opened_at', { ascending: false }).limit(500);
  if (error) { console.warn('trades', error); return; }
  S.trades = data || [];
  S.loaded.trades = Date.now();
}
async function loadQuotes() {
  const syms = [...new Set(S.trades.filter((t) => t.status === 'OPEN').map((t) => t.symbol))];
  if (!syms.length) return;
  const { data } = await sb.rpc('stock_quotes_for', { p_symbols: syms });
  (data || []).forEach((q) => { S.quotes[q.symbol] = q; });
}
async function refresh(full) {
  await Promise.all([loadFeed(), loadIndices(), full ? loadAccount() : null, loadTrades(), loadStatus()]);
  await loadQuotes();
  renderAll();
  if (S.ticketTick) S.ticketTick();
}

/* ===================== rendering: shared bits ===================== */
function ladder(levels, ltp) {
  const vals = [levels.stop, levels.entry, levels.t1, levels.t2].filter((v) => v !== null && v !== undefined);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.12 || hi * 0.005; lo -= pad; hi += pad;
  const p = (v) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  const tick = (k, label, v) => v === null || v === undefined ? '' : `<div class="tick ${k}" style="left:${p(v).toFixed(1)}%"><span>${label}</span><em>${fmt(v, v < 100 ? 2 : 1)}</em></div>`;
  return `<div class="ladder"><div class="rail"></div>${tick('sl', 'SL', levels.stop)}${tick('en', 'ENTRY', levels.entry)}${tick('t1', 'T1', levels.t1)}${tick('t2', 'T2', levels.t2)}${ltp !== null && ltp !== undefined ? `<div class="ltp" style="left:${p(ltp).toFixed(1)}%" title="LTP"></div>` : ''}</div>`;
}
function zone(s, L) {
  const buy = s.side === 'BUY', risk = num(s.risk_per_share) || 1;
  if (L === null) return { label: 'No live price', cls: 'warn', tradable: false };
  if (buy ? L <= s.stop : L >= s.stop) return { label: 'Stop level breached', cls: 'sell', tradable: false };
  if (buy ? L >= s.target1 : L <= s.target1) return { label: 'Target 1 already reached', cls: 'warn', tradable: false };
  const fav = (buy ? L - s.entry : s.entry - L) / risk;
  if (fav > 0.5) return { label: 'Extended ' + fav.toFixed(1) + 'R — wait for pullback', cls: 'warn', tradable: true };
  if (Math.abs(fav) <= 0.25) return { label: 'In entry zone', cls: 'buy', tradable: true };
  if (fav < -0.25) return { label: 'Below entry — better price', cls: 'buy', tradable: true };
  return { label: 'Near entry', cls: '', tradable: true };
}
function sparkPath(vals, w, h, lo, hi) {
  if (vals.length < 2) return '';
  return vals.map((v, i) => (i ? 'L' : 'M') + (i / (vals.length - 1) * w).toFixed(1) + ' ' + (h - (v - lo) / (hi - lo) * h).toFixed(1)).join(' ');
}
function priceChart(s, L) {
  const closes = (Array.isArray(s.closes) ? s.closes : []).map(Number).filter(Number.isFinite);
  if (closes.length < 5) return '';
  const lv = [s.stop, s.entry, s.target1, s.target2, L].filter((v) => v !== null && v !== undefined);
  let lo = Math.min(...closes, ...lv), hi = Math.max(...closes, ...lv); const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const W = 320, H = 150, y = (v) => (H - (v - lo) / (hi - lo) * H).toFixed(1);
  const line = (v, c, dash, lab) => `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-width="1" ${dash ? 'stroke-dasharray="4 3"' : ''}/><text x="${W - 2}" y="${Number(y(v)) - 3}" text-anchor="end" font-size="9" fill="${c}" font-family="monospace">${lab} ${fmt(v, v < 100 ? 2 : 1)}</text>`;
  const last = closes[closes.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price chart with stop and targets">
    ${line(s.stop, 'var(--red)', true, 'SL')}${line(s.entry, 'var(--muted)', true, 'ENTRY')}${line(s.target1, 'var(--green)', true, 'T1')}${line(s.target2, 'var(--green)', true, 'T2')}
    <path d="${sparkPath(closes, W, H, lo, hi)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${W}" cy="${y(L !== null && L !== undefined ? L : last)}" r="3.5" fill="var(--accent)"/></svg>`;
}

/* ===================== SIGNALS tab ===================== */
function filteredSignals() {
  let list = S.signals.slice();
  if (S.f.tf !== 'all') list = list.filter((s) => s.tf === S.f.tf);
  if (S.f.side !== 'all') list = list.filter((s) => s.side === S.f.side);
  const q = S.f.q.trim().toLowerCase();
  if (q) list = list.filter((s) => s.symbol.toLowerCase().includes(q) || String(s.name || '').toLowerCase().includes(q));
  const rr = (s) => (num(s.target2) !== null && num(s.risk_per_share) ? Math.abs(s.target2 - s.entry) / s.risk_per_share : 0);
  const near = (s) => { const L = ltpOf(s.symbol, s.entry); return Math.abs((L - s.entry) / (s.risk_per_share || 1)); };
  const key = { score: (a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol), rr: (a, b) => rr(b) - rr(a), near: (a, b) => near(a) - near(b), chg: (a, b) => Math.abs(num(chgOf(b.symbol)) || 0) - Math.abs(num(chgOf(a.symbol)) || 0) }[S.f.sort] || ((a, b) => b.score - a.score);
  return list.sort(key);
}
function renderSignals() {
  const m = marketState(nowMs());
  const stale = S.feedAt && (nowMs() - new Date(S.feedAt).getTime()) > 20 * 60000 && m.open;
  const note = $('signalNote');
  const parts = [];
  parts.push(S.feedAt ? 'Scanned ' + ago(S.feedAt) : 'Waiting for the first scan');
  parts.push(m.open ? 'prices refresh about every 3 min' : 'based on the last market close');
  note.textContent = parts.join(' · ') + ' · paper trading only, not investment advice';
  note.className = 'note' + (stale ? ' warn' : '');
  if (stale) note.textContent = '⚠ Scanner delayed (' + ago(S.feedAt) + '). ' + note.textContent;

  const list = filteredSignals();
  const host = $('signalList');
  if (!list.length) {
    host.innerHTML = `<div class="empty"><b>No signals right now</b><br>${S.signals.length ? 'Nothing matches your filters.' : (m.open ? 'The strategy is strict — setups appear when trend, momentum and volume all line up.' : 'New signals are generated during market hours.')}</div>`;
    return;
  }
  host.innerHTML = list.map((s) => {
    const L = ltpOf(s.symbol, null), c = chgOf(s.symbol), z = zone(s, L), buy = s.side === 'BUY';
    const held = S.trades.some((t) => t.status === 'OPEN' && t.symbol === s.symbol);
    const rr2 = num(s.risk_per_share) ? Math.abs(s.target2 - s.entry) / s.risk_per_share : 0;
    return `<article class="scard" data-sig="${esc(s.symbol)}|${esc(s.tf)}">
      <div class="srow"><div><div class="sym">${esc(s.symbol)}</div><div class="nm">${esc(s.name)}</div></div>
        <div class="px"><div class="l">${L === null ? '—' : fmt(L)}</div><div class="c ${cls(c)}">${pct(c)}</div></div></div>
      <div class="tags"><span class="tag ${buy ? 'buy' : 'sell'}">${s.side}</span><span class="tag">${s.tf === 'intraday' ? 'Intraday' : 'Swing'}</span><span class="tag">${esc(s.setup)}</span>${z.label ? `<span class="tag ${z.cls}">${esc(z.label)}</span>` : ''}${held ? '<span class="tag warn">Holding</span>' : ''}</div>
      ${ladder({ stop: s.stop, entry: s.entry, t1: s.target1, t2: s.target2 }, L)}
      <div class="srow2"><div class="metrics"><span>Risk <b>${fmt(s.risk_pct, 2)}%</b></span><span>Reward <b>${fmt(rr2, 1)}R</b></span><span>Vol <b>${fmt(s.vol_ratio, 1)}×</b></span><span>RSI <b>${fmt(s.rsi, 0)}</b></span></div>
        <div style="display:flex;gap:8px;align-items:center"><span class="score" style="--p:${Math.min(100, s.score)}%" data-s="${s.score}"></span>
        <button class="btn small ${buy ? 'buy' : 'sell'}" data-order="${esc(s.symbol)}|${esc(s.tf)}" ${z.tradable && !held ? '' : 'disabled'}>${buy ? 'Buy' : 'Sell'}</button></div></div>
    </article>`;
  }).join('');
}
const sigByKey = (k) => { const [sym, tf] = String(k).split('|'); return S.signals.find((s) => s.symbol === sym && s.tf === tf); };

/* ---- signal detail sheet ---- */
function openSignal(s) {
  const L = ltpOf(s.symbol, null), c = chgOf(s.symbol), z = zone(s, L), buy = s.side === 'BUY';
  const held = S.trades.some((t) => t.status === 'OPEN' && t.symbol === s.symbol);
  openSheet(`<div class="hd"><div><h2>${esc(s.symbol)} <span class="tag ${buy ? 'buy' : 'sell'}">${s.side}</span></h2><div class="sub">${esc(s.name)} · ${s.tf === 'intraday' ? 'Intraday' : 'Swing'} · ${esc(s.setup)}</div></div>
      <button class="x" data-close aria-label="Close">×</button></div>
    <div class="srow" style="margin-top:10px"><div class="px" style="text-align:left"><div class="l" style="font-size:22px">${L === null ? '—' : inr(L)}</div><div class="c ${cls(c)}">${pct(c)} today</div></div><span class="score" style="--p:${Math.min(100, s.score)}%;width:46px;height:46px" data-s="${s.score}"></span></div>
    ${z.label ? `<div class="msg ${z.cls === 'buy' ? 'ok' : z.cls === 'sell' ? 'err' : 'warn'}">${esc(z.label)}</div>` : ''}
    ${priceChart(s, L)}
    ${ladder({ stop: s.stop, entry: s.entry, t1: s.target1, t2: s.target2 }, L)}
    <div class="kv" style="margin-top:22px">
      <div>Signal entry</div><div>${inr(s.entry)}</div><div>Stop loss</div><div class="down">${inr(s.stop)} (${fmt(s.risk_pct, 2)}%)</div>
      <div>Target 1 (1.5R)</div><div class="up">${inr(s.target1)}</div><div>Target 2 (2R)</div><div class="up">${inr(s.target2)}</div>
      <div>RSI / ATR</div><div>${fmt(s.rsi, 0)} / ${fmt(s.atr, 2)}</div><div>${s.tf === 'intraday' ? 'EMA 9 / 21' : 'EMA 20 / 50'}</div><div>${fmt(s.ema_fast, 1)} / ${fmt(s.ema_slow, 1)}</div>
      <div>Volume vs average</div><div>${fmt(s.vol_ratio, 2)}×</div><div>Signal time</div><div>${esc(ago(s.generated_at))}</div></div>
    <ul class="reasons">${(s.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="hint">Target 1 books half the position; stops and targets fill at their exact level (server-checked every minute). Intraday trades are squared off at 15:20 IST.</p>
    <button class="btn block ${buy ? 'buy' : 'sell'}" id="sigOrderBtn" ${z.tradable && !held ? '' : 'disabled'}>${held ? 'Already holding' : (buy ? 'Buy' : 'Sell')} ${held ? '' : esc(s.symbol)}</button>`);
  const b = $('sigOrderBtn'); if (b) b.addEventListener('click', () => openOrder(s));
}

/* ---- order ticket ---- */
function suggestQty(s, entry, stop) {
  const a = acctNumbers(), risk = Math.abs(entry - stop); if (!(risk > 0) || !(entry > 0)) return 0;
  const byRisk = Math.floor((a.equity * (num(S.account.risk_pct) || 1) / 100) / risk);
  const byCash = Math.floor(Math.max(0, a.cash) / entry);
  return Math.max(0, Math.min(byRisk, byCash));
}
function openOrder(s) {
  let L = ltpOf(s.symbol, s.entry); const buy = s.side === 'BUY';
  const q0 = Math.max(1, suggestQty(s, L, s.stop));
  openSheet(`<div class="hd"><div><h2>${buy ? 'Buy' : 'Sell'} ${esc(s.symbol)}</h2><div class="sub">${esc(s.tf === 'intraday' ? 'Intraday · squared off 15:20 IST' : 'Swing · carried overnight')} · paper order at market</div></div><button class="x" data-close aria-label="Close">×</button></div>
    <div class="srow" style="margin:10px 0 2px"><div class="muted">Market price (LTP) <span class="hint" style="margin:0">· ${esc(S.quotes[s.symbol] && S.quotes[s.symbol].updated_at ? ago(S.quotes[s.symbol].updated_at) : 'last close')}</span></div><div class="l mono" id="oLtp" style="font-size:20px;font-weight:700">${inr(L)}</div></div>
    <label class="field"><span>Quantity</span><div class="stepper"><button type="button" id="oqMinus">−</button><input id="oq" type="number" min="1" step="1" value="${q0}" inputmode="numeric"><button type="button" id="oqPlus">+</button></div></label>
    <div class="chips" id="qChips"><span class="chip" data-f="0.5">½ size</span><span class="chip" data-f="1">Suggested (${fmt(num(S.account.risk_pct), 1)}% risk)</span><span class="chip" data-f="max">Max cash</span></div>
    <div class="grid3"><label class="field"><span>Stop loss</span><input id="os" type="number" step="0.05" value="${s.stop}" inputmode="decimal"></label>
      <label class="field"><span>Target 1</span><input id="o1" type="number" step="0.05" value="${s.target1}" inputmode="decimal"></label>
      <label class="field"><span>Target 2</span><input id="o2" type="number" step="0.05" value="${s.target2}" inputmode="decimal"></label></div>
    <div class="kv" id="oSummary"></div><div id="oMsg"></div>
    <button class="btn block ${buy ? 'buy' : 'sell'}" id="oPlace">${buy ? 'Buy' : 'Sell'} ${esc(s.symbol)} · paper</button>
    <p class="hint">Paper trading only — no real order is placed with any broker. Prices refresh about every 3 minutes.</p>`);
  const read = () => ({ qty: Math.floor(num($('oq').value) || 0), sl: num($('os').value), t1: num($('o1').value), t2: num($('o2').value) });
  const recalc = () => {
    const v = read(), a = acctNumbers(), entry = L, risk = v.sl !== null ? Math.abs(entry - v.sl) : 0, notional = v.qty * entry;
    const bps = num(S.account.cost_bps) ?? 10, charges = notional * 2 * bps / 10000;
    const maxLoss = v.qty * risk + charges, p1 = v.t1 !== null ? v.qty / 2 * Math.abs(v.t1 - entry) : 0, p2 = v.t2 !== null ? v.qty * Math.abs(v.t2 - entry) : 0;
    $('oSummary').innerHTML = `<div>Order value</div><div>${inr(notional)}</div><div>Available cash</div><div>${inr(a.cash)}</div>
      <div>Max loss (incl. charges)</div><div class="down">${inr(-maxLoss)} · ${fmt(a.equity ? maxLoss / a.equity * 100 : 0, 2)}% of equity</div>
      <div>Profit at T1 (half) / T2</div><div class="up">${inr(p1, 0)} / ${inr(p2, 0)}</div><div>Estimated charges</div><div>${inr(charges)}</div>`;
    const errs = [];
    if (v.qty < 1) errs.push('Enter a quantity of at least 1.');
    if (notional > a.cash + 0.005) errs.push('Order value exceeds your available cash (' + inr(a.cash, 0) + ').');
    if (v.sl === null || v.t1 === null || v.t2 === null) errs.push('Enter a stop loss and both targets.');
    else if (buy && !(v.sl < entry && v.t1 > entry && v.t2 >= v.t1)) errs.push('For a Buy: stop below the price, targets above it, Target 2 ≥ Target 1.');
    else if (!buy && !(v.sl > entry && v.t1 < entry && v.t2 <= v.t1)) errs.push('For a Sell: stop above the price, targets below it, Target 2 ≤ Target 1.');
    if (S.trades.some((t) => t.status === 'OPEN' && t.symbol === s.symbol)) errs.push('You already hold ' + s.symbol + '.');
    const warns = [];
    if (!marketState(nowMs()).open) warns.push('Market is closed — the order fills at the last traded price and is managed from the next session.');
    $('oMsg').innerHTML = errs.map((e) => `<div class="msg err">${esc(e)}</div>`).join('') + warns.map((w) => `<div class="msg warn">${esc(w)}</div>`).join('');
    $('oPlace').disabled = errs.length > 0;
  };
  ['oq', 'os', 'o1', 'o2'].forEach((id) => $(id).addEventListener('input', recalc));
  $('oqMinus').addEventListener('click', () => { $('oq').value = Math.max(1, (num($('oq').value) || 1) - 1); recalc(); });
  $('oqPlus').addEventListener('click', () => { $('oq').value = (num($('oq').value) || 0) + 1; recalc(); });
  $('qChips').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    const sl = num($('os').value) ?? s.stop, sug = Math.max(1, suggestQty(s, L, sl)), a = acctNumbers();
    $('oq').value = c.dataset.f === 'max' ? Math.max(1, Math.floor(a.cash / L)) : Math.max(1, Math.floor(sug * Number(c.dataset.f)));
    recalc();
  }));
  $('oPlace').addEventListener('click', () => placeOrder(s, L, read(), $('oPlace')));
  // keep the ticket on the freshest price while it is open (prices refresh about every 3 minutes)
  S.ticketTick = () => { const n = ltpOf(s.symbol, null); if (n && n !== L && $('oLtp')) { L = n; $('oLtp').textContent = inr(L); recalc(); } };
  recalc();
}
async function placeOrder(s, L, v, btn) {
  btn.disabled = true;
  try {
    const now = new Date().toISOString(), risk = Math.abs(L - v.sl) * v.qty;
    const row = {
      user_id: S.user.id, symbol: s.symbol, timeframe: s.tf, direction: s.side, setup: s.setup, score: s.score,
      entry_price: L, stop_loss: v.sl, target_1: v.t1, target_2: v.t2, quantity: v.qty, risk_budget: Math.round(risk * 100) / 100,
      signal_time: s.generated_at || now, source: 'stock-signals-v2', status: 'OPEN', opened_at: now,
      signal_snapshot: { reasons: s.reasons, signal_entry: s.entry, signal_stop: s.stop, rsi: s.rsi, atr: s.atr, vol_ratio: s.vol_ratio, estimated_cost_bps: num(S.account.cost_bps) ?? 10, original_quantity: v.qty, replay_until: Date.now(), mark_price: L, mark_source: 'order fill at LTP', fill_model: 'market order at last price' },
    };
    const { data, error } = await sb.from('stock_paper_trades').insert(row).select().single();
    if (error) throw error;
    S.trades.unshift(data);
    closeSheet(); toast((s.side === 'BUY' ? 'Bought ' : 'Sold ') + v.qty + ' ' + s.symbol + ' @ ' + fmt(L));
    setTab('positions'); renderAll();
  } catch (e) {
    const dup = e && (e.code === '23505' || /duplicate|unique/i.test(String(e.message)));
    toast(dup ? 'You already hold ' + s.symbol + '.' : 'Order failed: ' + String((e && e.message) || e), true);
    btn.disabled = false;
  }
}

/* ===================== POSITIONS tab ===================== */
function renderPositions() {
  const a = acctNumbers();
  $('posBadge').hidden = !a.open.length; $('posBadge').textContent = a.open.length;
  $('posSummary').innerHTML = `<div class="stat big"><b>Unrealised P&amp;L</b><div class="v ${cls(a.unreal)}">${sinr(a.unreal)}</div></div>
    <div class="stat"><b>Invested</b><div class="v">${inr(a.invested, 0)}</div></div><div class="stat"><b>Current value</b><div class="v">${inr(a.value, 0)}</div></div>
    <div class="stat"><b>Booked (T1 exits)</b><div class="v ${cls(a.booked)}">${sinr(a.booked)}</div></div><div class="stat"><b>Open risk</b><div class="v">${inr(a.openRisk, 0)}</div></div>`;
  const host = $('posList');
  if (!a.open.length) { host.innerHTML = '<div class="empty"><b>No open positions</b><br>Place a paper order from a signal to see it here with live P&amp;L.</div>'; return; }
  host.innerHTML = a.open.map((t) => {
    const m = posMetrics(t), buy = t.direction === 'BUY', c = chgOf(t.symbol), snap = t.signal_snapshot || {};
    return `<article class="scard" data-pos="${esc(t.id)}">
      <div class="srow"><div><div class="sym">${esc(t.symbol)} <span class="tag ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span></div>
        <div class="nm">${fmt(m.qty, 0)} @ ${fmt(m.entry)} · ${t.timeframe === 'intraday' ? 'Intraday' : 'Swing'}${snap.target1_partial_filled ? ' · T1 booked' : ''}</div></div>
        <div class="px"><div class="l ${cls(m.net)}">${sinr(m.net)}</div><div class="c ${cls(m.net)}">${pct(m.netPct)}</div></div></div>
      ${ladder({ stop: num(t.stop_loss), entry: m.entry, t1: num(t.target_1), t2: num(t.target_2) }, m.px)}
      <div class="srow2"><div class="metrics"><span>LTP <b>${fmt(m.px)}</b></span><span class="${cls(c)}">${pct(c)}</span><span>Opened <b>${esc(ago(t.opened_at))}</b></span></div>
        <button class="btn small outline-red" data-exit="${esc(t.id)}">Exit</button></div></article>`;
  }).join('');
}
function openManage(t) {
  const m = posMetrics(t), buy = t.direction === 'BUY';
  openSheet(`<div class="hd"><div><h2>${esc(t.symbol)} <span class="tag ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span></h2><div class="sub">${fmt(m.qty, 0)} shares @ ${inr(m.entry)} · opened ${esc(ago(t.opened_at))}</div></div><button class="x" data-close aria-label="Close">×</button></div>
    <div class="srow" style="margin:10px 0"><div><div class="l mono" style="font-size:22px;font-weight:700">${inr(m.px)}</div><div class="${cls(m.net)} mono" style="font-weight:700">${sinr(m.net)} (${pct(m.netPct)})</div></div></div>
    ${ladder({ stop: num(t.stop_loss), entry: m.entry, t1: num(t.target_1), t2: num(t.target_2) }, m.px)}
    <div class="grid3" style="margin-top:24px"><label class="field"><span>Stop loss</span><input id="ms" type="number" step="0.05" value="${t.stop_loss}"></label>
      <label class="field"><span>Target 1</span><input id="m1" type="number" step="0.05" value="${t.target_1}"></label>
      <label class="field"><span>Target 2</span><input id="m2" type="number" step="0.05" value="${t.target_2}"></label></div>
    <div id="mMsg"></div>
    <button class="btn primary block" id="mSave">Update stop &amp; targets</button>
    <button class="btn outline-red block" id="mExit">Exit at market (${inr(m.px)})</button>
    <p class="hint">Updated levels apply from now on. Open since ${esc(new Date(t.opened_at).toLocaleString('en-IN'))}.</p>`);
  $('mSave').addEventListener('click', async () => {
    const sl = num($('ms').value), t1 = num($('m1').value), t2 = num($('m2').value);
    const entry = m.entry, ok = buy ? (sl < m.px && t1 > m.px && t2 >= t1) : (sl > m.px && t1 < m.px && t2 <= t1);
    if (sl === null || t1 === null || t2 === null || !ok) { $('mMsg').innerHTML = `<div class="msg err">${buy ? 'Stop must be below the current price and targets above it (T2 ≥ T1).' : 'Stop must be above the current price and targets below it (T2 ≤ T1).'}</div>`; return; }
    const { error } = await sb.from('stock_paper_trades').update({ stop_loss: sl, target_1: t1, target_2: t2 }).eq('id', t.id).eq('status', 'OPEN');
    if (error) { $('mMsg').innerHTML = `<div class="msg err">${esc(error.message)}</div>`; return; }
    Object.assign(t, { stop_loss: sl, target_1: t1, target_2: t2 }); closeSheet(); toast('Levels updated'); renderAll();
  });
  $('mExit').addEventListener('click', () => exitTrade(t));
}
async function exitTrade(t) {
  const m = posMetrics(t);
  const q = S.quotes[t.symbol];
  if (!(m.px > 0)) { toast('No price available to exit.', true); return; }
  const now = new Date().toISOString();
  const costs = (m.entry * m.qty + m.px * m.qty) * costBpsOf(t) / 10000;
  const net = m.gross - costs;
  const snap = Object.assign({}, t.signal_snapshot || {}, { exit_reason: 'MANUAL_EXIT', exit_cost: Math.round(costs * 100) / 100, gross_pnl: Math.round(((num((t.signal_snapshot || {}).gross_pnl) || 0) + m.gross) * 100) / 100, mark_price: m.px, mark_time: q && q.updated_at || now, exit_time: now, fill_model: 'manual exit at last price' });
  const patch = { status: 'CLOSED', exit_price: m.px, closed_at: now, realized_pnl: Math.round(((num(t.realized_pnl) || 0) + net) * 100) / 100, signal_snapshot: snap };
  const { data, error } = await sb.from('stock_paper_trades').update(patch).eq('id', t.id).eq('status', 'OPEN').select();
  if (error) { toast('Could not exit: ' + error.message, true); return; }
  if (!data || !data.length) { toast('This position was already closed.', true); await loadTrades(); renderAll(); closeSheet(); return; }
  Object.assign(t, data[0]); closeSheet(); toast('Exited ' + t.symbol + ' @ ' + fmt(m.px) + ' · ' + sinr(net)); renderAll();
}

/* ===================== HISTORY tab ===================== */
const REASONS = { STOP_LOSS: 'Stop loss', TARGET_1: 'Target 1', TARGET_2: 'Target 2', SQUARE_OFF: 'Square-off', MANUAL_EXIT: 'Manual exit', MANUAL_MARKET_EXIT: 'Manual exit', EOD: 'End of day' };
function renderHistory() {
  const a = acctNumbers();
  const closed = a.closed.slice().sort((x, y) => new Date(y.closed_at || y.opened_at) - new Date(x.closed_at || x.opened_at));
  const pnl = (t) => num(t.realized_pnl) || 0;
  const wins = closed.filter((t) => pnl(t) > 0), losses = closed.filter((t) => pnl(t) < 0);
  const gw = wins.reduce((s, t) => s + pnl(t), 0), gl = Math.abs(losses.reduce((s, t) => s + pnl(t), 0));
  const net = closed.reduce((s, t) => s + pnl(t), 0);
  $('histSummary').innerHTML = `<div class="stat big"><b>Net realised P&amp;L</b><div class="v ${cls(net)}">${sinr(net)}</div></div>
    <div class="stat"><b>Trades</b><div class="v">${closed.length}</div></div><div class="stat"><b>Win rate</b><div class="v">${closed.length ? Math.round(wins.length / closed.length * 100) : 0}%</div></div>
    <div class="stat"><b>Avg win / loss</b><div class="v"><span class="up">${wins.length ? sinr(gw / wins.length) : '—'}</span> <span class="muted">/</span> <span class="down">${losses.length ? sinr(-gl / losses.length) : '—'}</span></div></div>
    <div class="stat"><b>Profit factor</b><div class="v">${gl ? fmt(gw / gl, 2) : (gw ? '∞' : '—')}</div></div>`;
  // equity curve
  const ordered = closed.slice().reverse(); let run = 0; const pts = [0].concat(ordered.map((t) => (run += pnl(t))));
  if (pts.length >= 3) {
    const lo = Math.min(...pts), hi = Math.max(...pts), W = 320, H = 70, rng = hi - lo || 1;
    $('equityCard').innerHTML = `<h3 style="margin-bottom:4px">Equity curve <span class="muted" style="font-weight:500;font-size:11px">· closed trades</span></h3><svg class="chart" viewBox="0 0 ${W} ${H}"><path d="${sparkPath(pts, W, H - 6, lo, hi)}" transform="translate(0,3)" fill="none" stroke="${run >= 0 ? 'var(--green)' : 'var(--red)'}" stroke-width="2" stroke-linejoin="round"/></svg>`;
    $('equityCard').hidden = false;
  } else $('equityCard').hidden = true;
  let list = closed;
  if (S.f.hist === 'win') list = wins; else if (S.f.hist === 'loss') list = losses;
  const host = $('histList');
  if (!list.length) { host.innerHTML = '<div class="empty"><b>No closed trades yet</b><br>Exited and stopped-out trades appear here.</div>'; return; }
  host.innerHTML = list.map((t) => {
    const p = pnl(t), snap = t.signal_snapshot || {}, buy = t.direction === 'BUY';
    const why = REASONS[snap.exit_reason] || snap.exit_reason || 'Closed';
    const qtyShow = num(snap.original_quantity) || num(t.quantity);
    return `<article class="scard" style="cursor:default"><div class="srow"><div><div class="sym">${esc(t.symbol)} <span class="tag ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span></div>
      <div class="nm">${fmt(qtyShow, 0)} · ${fmt(t.entry_price)} → ${fmt(t.exit_price)}</div></div><div class="px"><div class="l ${cls(p)}">${sinr(p)}</div><div class="c muted">${esc(why)}</div></div></div>
      <div class="tags"><span class="tag">${t.timeframe === 'intraday' ? 'Intraday' : 'Swing'}</span>${snap.target1_partial_filled ? '<span class="tag buy">T1 booked</span>' : ''}<span class="tag">${esc(new Date(t.closed_at || t.opened_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}</span></div></article>`;
  }).join('');
}

/* ===================== ACCOUNT tab ===================== */
function dotCls(job, maxAgeSec) {
  if (!job || !job.last_run_at) return 'warn';
  const age = (nowMs() - new Date(job.last_run_at).getTime()) / 1000;
  if (job.ok === false) return 'bad';
  return age <= maxAgeSec ? 'ok' : (age <= maxAgeSec * 4 ? 'warn' : 'bad');
}
function renderAccount() {
  const a = acctNumbers();
  $('acctSummary').innerHTML = `<div class="stat big"><b>Equity</b><div class="v ${cls(a.equity - a.start)}">${inr(a.equity, 0)}</div></div>
    <div class="stat"><b>Available cash</b><div class="v">${inr(a.cash, 0)}</div></div><div class="stat"><b>Invested</b><div class="v">${inr(a.invested, 0)}</div></div>
    <div class="stat"><b>Realised P&amp;L</b><div class="v ${cls(a.realized)}">${sinr(a.realized)}</div></div><div class="stat"><b>Unrealised P&amp;L</b><div class="v ${cls(a.unreal)}">${sinr(a.unreal)}</div></div>`;
  if (document.activeElement !== $('setBalance')) $('setBalance').value = S.account.starting_balance;
  if (document.activeElement !== $('setRisk')) $('setRisk').value = S.account.risk_pct;
  if (document.activeElement !== $('setBps')) $('setBps').value = S.account.cost_bps;
  const jobs = {}; ((S.status && S.status.jobs) || []).forEach((j) => { jobs[j.job] = j; });
  const row = (label, job, maxAge, extra) => `<div class="hrow"><span><i class="d ${dotCls(job, maxAge)}"></i>${label}</span><span class="muted">${job && job.last_run_at ? esc(ago(job.last_run_at)) : 'no heartbeat'}${extra ? ' · ' + esc(extra) : ''}</span></div>`;
  const sg = jobs['stock-signals'] && jobs['stock-signals'].summary || {};
  const open = marketState(nowMs()).open;
  $('healthCard').innerHTML = `<h3>Server status</h3><div class="health">
    ${row('Signal scanner', jobs['stock-signals'], open ? 600 : 5400, sg.swing !== undefined ? sg.swing + ' swing · ' + (sg.intraday || 0) + ' intraday' : '')}
    ${row('Paper-trade monitor', jobs['stock-paper'], open ? 180 : 5400, ((jobs['stock-paper'] || {}).summary || {}).open !== undefined ? ((jobs['stock-paper'].summary.open) + ' open trade(s) watched') : '')}
    ${row('Price refresh (all stocks)', jobs.sector, open ? 600 : 5400, '')}</div>
    <p class="hint">These jobs run on Supabase, so your stops, targets and signals keep working even when this page is closed.</p>`;
}
async function saveSettings() {
  const bal = num($('setBalance').value), risk = num($('setRisk').value), bps = num($('setBps').value);
  if (!(bal >= 1000) || !(risk > 0 && risk <= 5) || bps === null || bps < 0 || bps > 100) { toast('Check the values: balance ≥ 1,000, risk 0.1–5%, charges 0–100 bps.', true); return; }
  const { error } = await sb.from('stock_paper_accounts').upsert({ user_id: S.user.id, starting_balance: bal, cost_bps: bps, risk_pct: risk, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) { toast('Could not save: ' + error.message, true); return; }
  S.account = { starting_balance: bal, cost_bps: bps, risk_pct: risk }; toast('Settings saved'); renderAll();
}
function confirmReset() {
  openSheet(`<div class="hd"><h2>Reset paper account?</h2><button class="x" data-close aria-label="Close">×</button></div>
    <p class="sub" style="margin:10px 0">All ${S.trades.length} paper trades will be permanently deleted and your balance returns to ${inr(S.account.starting_balance, 0)}.</p>
    <button class="btn outline-red block" id="resetYes">Yes, delete everything</button><button class="btn block" data-close>Cancel</button>`);
  $('resetYes').addEventListener('click', async () => {
    const { error } = await sb.from('stock_paper_trades').delete().eq('user_id', S.user.id);
    if (error) { toast('Could not reset: ' + error.message, true); return; }
    S.trades = []; closeSheet(); toast('Paper account reset'); renderAll();
  });
}

/* ===================== shell ===================== */
function renderIndexStrip() {
  $('indexStrip').innerHTML = S.indices.map((x) => { const c = num(x.change_percent); return `<div class="ix"><b>${esc(x.display_name || x.name)}</b><div class="v">${fmt(x.price)}</div><div class="c ${cls(c)}">${pct(c)}</div></div>`; }).join('');
}
function renderMarket() { const m = marketState(nowMs()); $('marketText').textContent = m.text; $('marketChip').classList.toggle('open', m.open); }
function renderAll() {
  renderMarket(); renderIndexStrip();
  renderSignals(); renderPositions(); renderHistory(); renderAccount();
}
function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.id === 'tab-' + tab));
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo({ top: 0 });
}
function seg(id, key, after) {
  $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.f[key] = b.dataset.v; $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); after(); });
}
function wire() {
  document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  seg('tfSeg', 'tf', renderSignals); seg('sideSeg', 'side', renderSignals); seg('histSeg', 'hist', renderHistory);
  $('sortSel').addEventListener('change', (e) => { S.f.sort = e.target.value; renderSignals(); });
  $('searchBox').addEventListener('input', (e) => { S.f.q = e.target.value; renderSignals(); });
  $('backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  $('signalList').addEventListener('click', (e) => {
    const ob = e.target.closest('[data-order]'); if (ob) { e.stopPropagation(); const s = sigByKey(ob.dataset.order); if (s) openOrder(s); return; }
    const card = e.target.closest('[data-sig]'); if (card) { const s = sigByKey(card.dataset.sig); if (s) openSignal(s); }
  });
  $('posList').addEventListener('click', (e) => {
    const ex = e.target.closest('[data-exit]'); const id = (ex || e.target.closest('[data-pos]') || {}).dataset;
    const key = ex ? ex.dataset.exit : (id && id.pos); if (!key) return;
    const t = S.trades.find((x) => String(x.id) === String(key)); if (!t) return;
    if (ex) { e.stopPropagation(); confirmExit(t); } else openManage(t);
  });
  $('saveSettings').addEventListener('click', saveSettings);
  $('resetBtn').addEventListener('click', confirmReset);
  $('themeBtn').addEventListener('click', () => { const light = document.documentElement.getAttribute('data-theme') !== 'light'; applyTheme(light ? 'light' : 'dark'); try { localStorage.setItem('marketpulse-theme', light ? 'light' : 'dark'); } catch (e) { /* ignore */ } });
}
function confirmExit(t) {
  const m = posMetrics(t);
  openSheet(`<div class="hd"><h2>Exit ${esc(t.symbol)}?</h2><button class="x" data-close aria-label="Close">×</button></div>
    <div class="kv"><div>${t.direction === 'BUY' ? 'Sell' : 'Buy to cover'}</div><div>${fmt(m.qty, 0)} @ ${inr(m.px)}</div><div>Estimated P&amp;L</div><div class="${cls(m.net)}">${sinr(m.net)} (${pct(m.netPct)})</div></div>
    <p class="hint">Exit fills at the last available price (updates about every 3 minutes${S.quotes[t.symbol] && S.quotes[t.symbol].updated_at ? ', last ' + esc(ago(S.quotes[t.symbol].updated_at)) : ''}).</p>
    <button class="btn outline-red block" id="exitYes">Exit position</button><button class="btn block" data-close>Cancel</button>`);
  $('exitYes').addEventListener('click', () => exitTrade(t));
}
function applyTheme(t) { if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); }

async function init() {
  try { applyTheme(localStorage.getItem('marketpulse-theme') === 'light' ? 'light' : 'dark'); } catch (e) { applyTheme('dark'); }
  wire();
  const { data } = await sb.auth.getSession();
  S.user = data && data.session && data.session.user;
  if (!S.user) { $('gate').hidden = false; document.querySelectorAll('.tab,#tabbar').forEach((el) => { el.hidden = true; }); await Promise.all([loadIndices()]); renderMarket(); renderIndexStrip(); return; }
  window.mpRefreshNow = () => refresh(true);
  await refresh(true);
  // live refresh: server prices update every ~3 min; the clocks tick every second
  setInterval(() => { if (!document.hidden) refresh(false); }, 20000);
  setInterval(() => { renderMarket(); if (S.tab === 'signals') $('signalNote') && renderSignals(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - S.loaded.feed > 10000) refresh(false); });
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.reload(); });
}
init();
})();
