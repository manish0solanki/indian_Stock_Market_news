/* Options Paper Desk: the Stock Signals scanner's F&O signals (plus Nifty / Bank Nifty) as paper debit spreads
   (options-signals edge function). Platform admin only. Used by the Options tab on the Signals page (added only after
   mp_is_platform_admin() says yes) and by admin-options.html. The data and every action are admin-only on the server
   too: options_paper_feed() and the options_paper_* functions refuse anyone else.
   Laid out like the Signals tab: a summary, sub-tabs (Open · Closed · Activity · Settings, remembered across reloads),
   and compact trade cards (symbol and P&L, tags, a stop / entry / target ladder, metrics, actions; Details opens the
   full plan). A spread's plan is fixed when it opens (only Edit changes stop / target / lots); the minute refresh
   updates prices and keeps open Details, an edit in progress and the order of the cards (newest first).
   Controls: cap settings, Exit / Edit / Delete on each spread, Take on a dry-run candidate (ignores the cap),
   Clear closed, Clear everything. Messages appear as a toast at the bottom of the screen.
   window.mpOptionsDesk.mount(rootElement, supabaseClient). */
(function () {
  'use strict';
  if (window.mpOptionsDesk) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const inr = (v, d = 0) => { v = num(v); return v === null ? '—' : (v < 0 ? '−' : '') + '₹' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const sInr = (v) => { v = num(v); return v === null ? '—' : (v > 0 ? '+' : '') + inr(v); };
  const px = (v) => { v = num(v); return v === null ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const k = (v) => px(v).replace(/\.00$/, '');
  const tone = (v) => (num(v) > 0 ? 'up' : num(v) < 0 ? 'down' : '');
  const dt = (t) => t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const dExp = (d) => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
  const istToday = () => new Date(Date.now() + 330 * 60e3).toISOString().slice(0, 10);
  const daysTo = (d) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(istToday() + 'T00:00:00Z')) / 864e5);
  const IDX = new Set(['NIFTY', 'BANKNIFTY']);
  const symHtml = (sym) => IDX.has(sym) ? `${esc(sym)} <span class="od-tag">Index</span>` : `<span data-sym="${esc(sym)}">${esc(sym)}</span>`;
  const label = (t) => `${t.strategy === 'bear_put_spread' ? 'Bear put' : 'Bull call'} ${k(t.long_strike)}/${k(t.short_strike)} ${t.opt_type || ''}`.trim();
  const lotsOf = (t) => Math.max(1, num(t.lots) || 1);
  const isOpenNow = () => { const t = new Date(Date.now() + 330 * 60e3), m = t.getUTCHours() * 60 + t.getUTCMinutes(), d = t.getUTCDay(); const ms = window.MP_CONFIG && window.MP_CONFIG.marketSession ? window.MP_CONFIG.marketSession() : null; return !(ms && ms.holiday) && d >= 1 && d <= 5 && m >= 560 && m <= 930; };
  const store = { get: (k2, d) => { try { return localStorage.getItem(k2) || d; } catch (e) { return d; } }, set: (k2, v) => { try { localStorage.setItem(k2, v); } catch (e) { /* ignore */ } } };
  const VIEWS = ['open', 'closed', 'log', 'settings'];

  const SHELL = `
    <div class="od-note"><b>Paper only · admins only.</b> Not recommendations: showing options trade ideas to the public needs SEBI research-analyst registration. No back-test exists for options, so judge it on the paper record.</div>
    <div class="od-sum" data-od="kpis"></div>
    <div class="od-warn" data-od="capWarn" hidden></div>
    <div class="od-seg" role="tablist" data-od="seg">
      <button type="button" data-view="open">Open <b data-od="nOpen"></b></button><button type="button" data-view="closed">Closed <b data-od="nClosed"></b></button><button type="button" data-view="log">Activity</button><button type="button" data-view="settings">Settings</button>
    </div>
    <section data-pane="open">
      <div class="od-bar">
        <button class="od-btn primary sm" type="button" data-od="run">Run now</button>
        <button class="od-btn sm" type="button" data-od="dry">Dry run</button>
        <span class="od-msg" data-od="lastRun"></span>
      </div>
      <div data-od="dryOut"></div>
      <div class="od-list" data-od="open"></div>
    </section>
    <section data-pane="closed" hidden>
      <div class="od-bar"><span class="od-msg" data-od="closedNote"></span><button class="od-btn sm" type="button" data-od="clearClosed">Clear closed</button></div>
      <div class="od-list" data-od="closed"></div>
    </section>
    <section data-pane="log" hidden><div class="od-list" data-od="log"></div></section>
    <section data-pane="settings" hidden>
      <div class="od-card">
        <h3>Cap &amp; settings <small data-od="setNote"></small></h3>
        <form class="od-form" data-od="setForm">
          <label><span>Max open spreads</span><input type="number" name="max_open" min="0" max="200" step="1" inputmode="numeric" required></label>
          <label><span>Max total at risk (₹)</span><input type="number" name="max_risk" min="0" step="5000" inputmode="numeric" required></label>
          <label><span>Lots per new trade</span><input type="number" name="lots" min="1" max="50" step="1" inputmode="numeric" required></label>
          <label class="od-check"><input type="checkbox" name="auto_open"><span>Engine opens new spreads by itself</span></label>
          <button class="od-btn primary block" type="submit">Save settings</button>
        </form>
        <p class="od-hint">When the cap is full the engine stops opening; open spreads are still marked and closed. Free slots go to Nifty / Bank Nifty signals first, then strong-sector stocks, neutral, no sector index, then by scanner score. <b>Take</b> on a dry-run result opens one anyway.</p>
      </div>
      <div class="od-card"><details><summary>How trades are picked and closed</summary><ul>
        <li><b>Source:</b> the Stock Signals scanner's BUY / SELL signals on F&amp;O stocks. Signals in a <b>weak sector</b> (Sectors page filter) are skipped.</li>
        <li><b>Nifty &amp; Bank Nifty:</b> their own rule, checked from 2:45 PM IST on daily closes plus the live level. BUY when the 20-day average is above the 50-day, and the index has dipped below its 20-day average (still above the 50-day) to under its lowest close of the previous 4 days; SELL is the mirror image. Stop 1.5× and target 2.5× the average daily move. On ~21 months of history: 81 signals, target first 38, stop first 32, +0.71× the daily move per signal on average (a breakout rule tested the same way came out at zero). At most one signal per index per day.</li>
        <li><b>Trade:</b> BUY → bull call spread (buy the at-the-money call, sell the call at the strike nearest the signal's target 1). SELL → bear put spread. One spread per stock at a time, with the lots set above.</li>
        <li><b>Fixed plan:</b> strikes, entry prices, stop and target are set when the spread opens and never change on their own (only Edit changes stop, target or lots).</li>
        <li><b>Expiry:</b> the nearest with at least 14 days left. <b>Liquidity:</b> live bid and ask on both legs, bid-ask within 12% / 20%, open interest 50+. <b>Price:</b> skipped when IV is above 1.6× the 20-day historical volatility, or max profit is under 0.8× max loss.</li>
        <li><b>Fills:</b> buy at the ask, sell at the bid (the reverse on exit). Brokerage and taxes are not included.</li>
        <li><b>Exit:</b> stop, target 1, the spread worth 80% of its width, or 2 days before expiry; or by hand with <b>Exit</b> (live prices; after hours at the last mark). The most a spread can lose is the debit paid.</li>
      </ul></details></div>
      <div class="od-card od-danger">
        <h3>Start again</h3>
        <p class="od-hint">Deletes every spread, open and closed, and the activity log. Settings are kept. This cannot be undone.</p>
        <button class="od-btn danger block" type="button" data-od="clearAll">Clear everything…</button>
      </div>
    </section>
    <div class="od-toast" data-od="toast" role="status" aria-live="polite"></div>`;

  function mount(root, sb) {
    if (!root || root.dataset.odMounted) return;
    root.dataset.odMounted = '1';
    root.classList.add('od');
    root.innerHTML = SHELL;
    const q = (n) => root.querySelector(`[data-od="${n}"]`);
    let F = null, editing = null, lastDry = null, toastT = null, view = store.get('mp-od-view', 'open');
    const expanded = new Set();
    if (!VIEWS.includes(view)) view = 'open';

    function toast(msg, bad) {
      const t = q('toast'); t.textContent = msg; t.className = 'od-toast show' + (bad ? ' err' : '');
      clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'od-toast'; }, bad ? 6000 : 3500);
    }
    function setView(v) {
      view = v; store.set('mp-od-view', v);
      q('seg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
      root.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== v; });
    }
    async function callFn(qs) {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(MP_CONFIG.fn('options-signals') + qs, { method: 'POST', headers: { Authorization: 'Bearer ' + (session ? session.access_token : ''), apikey: MP_CONFIG.supabaseKey, 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      return j;
    }
    async function rpc(name, args) { const { data, error } = await sb.rpc(name, args); if (error) throw new Error(error.message); return data; }

    function kpis() {
      const s = F.stats || {}, open = F.open || [], cfg = F.settings || {};
      const overN = open.length > num(cfg.max_open), overR = num(F.open_risk) > num(cfg.max_risk);
      q('kpis').innerHTML = [
        ['Open P&L', sInr(F.open_pnl), tone(F.open_pnl), 'big'],
        ['Open spreads', `${open.length} <small>of ${num(cfg.max_open) ?? '—'}</small>`, overN ? 'down' : ''],
        ['At risk', `${inr(F.open_risk)} <small>of ${inr(cfg.max_risk)}</small>`, overR ? 'down' : ''],
        ['Realised P&L', sInr(s.pnl), tone(s.pnl)],
        ['Win rate', s.closed ? `${Math.round(100 * s.wins / s.closed)}% <small>of ${s.closed}</small>` : '—', ''],
      ].map(([l, v, c, big]) => `<div class="od-stat${big ? ' big' : ''}"><b>${l}</b><div class="v ${c}">${v}</div></div>`).join('');
      q('nOpen').textContent = open.length || ''; q('nClosed').textContent = (F.closed || []).length || '';
      q('lastRun').textContent = (F.last_run ? 'Last run ' + dt(F.last_run) + ' · ' : '') + 'every 15 min, 9:30 AM – 3:15 PM IST';
      const w = q('capWarn'), parts = [];
      if (overN || overR) parts.push(`<b>Over the cap:</b> ${open.length} open with ${inr(F.open_risk)} at risk; the cap is ${num(cfg.max_open)} spread${num(cfg.max_open) === 1 ? '' : 's'} and ${inr(cfg.max_risk)}. No new spreads open until you're under it: exit or delete some, raise the cap in Settings, or clear everything there.`);
      if (cfg.auto_open === false) parts.push('<b>Auto-open is off:</b> open spreads are still marked and closed; use <b>Take</b> on a dry-run result to open one by hand.');
      w.hidden = !parts.length; w.innerHTML = parts.join('<br>');
    }
    function settingsForm() {
      const cfg = F.settings || {}, f = q('setForm');
      if (f.contains(document.activeElement)) return; // don't overwrite what's being typed
      f.max_open.value = num(cfg.max_open) ?? 10; f.max_risk.value = num(cfg.max_risk) ?? 150000; f.lots.value = num(cfg.lots) ?? 1; f.auto_open.checked = cfg.auto_open !== false;
      q('setNote').textContent = cfg.updated_at ? 'saved ' + dt(cfg.updated_at) : '';
    }
    // Stop / entry / target ladder with the underlying's current level, like the signal cards.
    function ladder(t) {
      const st = num(t.stop), en = num(t.spot_entry), tg = num(t.target), now = num(t.mark_spot);
      if (!(st > 0 && tg > 0 && en > 0)) return '';
      const lo = Math.min(st, tg, en, now || en), hi = Math.max(st, tg, en, now || en), pad = (hi - lo) * 0.08 || 1;
      const pos = (v) => ((v - (lo - pad)) / ((hi + pad) - (lo - pad)) * 100).toFixed(1) + '%';
      const tick = (cls, v, name) => `<i class="tick ${cls}" style="left:${pos(v)}"><span>${name}</span><em>${k(v)}</em></i>`;
      return `<div class="od-ladder"><div class="rail"></div>${tick('sl', st, 'Stop')}${tick('en', en, 'Entry')}${tick('t1', tg, 'Target')}${now > 0 ? `<i class="ltp" style="left:${pos(now)}" title="Now ${px(now)}"></i>` : ''}</div>`;
    }
    function editForm(t) {
      return `<form class="od-form od-edit" data-edit="${t.id}">
        <label><span>Stop</span><input type="number" name="stop" step="0.05" min="0" inputmode="decimal" value="${num(t.stop) ?? ''}" required></label>
        <label><span>Target 1</span><input type="number" name="target" step="0.05" min="0" inputmode="decimal" value="${num(t.target) ?? ''}" required></label>
        <label><span>Lots (× ${num(t.lot_size)})</span><input type="number" name="lots" step="1" min="1" max="50" inputmode="numeric" value="${lotsOf(t)}" required></label>
        <div class="od-acts"><button class="od-btn primary sm" type="submit">Save</button><button class="od-btn sm" type="button" data-cancel="1">Cancel</button></div>
      </form>`;
    }
    function card(t) {
      const lots = lotsOf(t), cost = num(t.net_debit) * num(t.lot_size) * lots, pnlPct = cost ? num(t.pnl) / cost * 100 : null, bull = t.opt_type === 'CE', open = expanded.has(t.id);
      return `<article class="od-sc" data-trade="${t.id}">
        <div class="od-srow"><div class="od-name"><div class="od-sym">${symHtml(t.symbol)}</div><div class="od-nm">${esc(label(t))} · ${dExp(t.expiry)} (${daysTo(t.expiry)}d)</div></div>
          <div class="od-px"><div class="l ${tone(t.pnl)}">${sInr(t.pnl)}</div><div class="c">${pnlPct === null ? '' : (pnlPct > 0 ? '+' : '') + pnlPct.toFixed(0) + '% of cost'}</div></div></div>
        <div class="od-tags"><span class="od-tag ${bull ? 'buy' : 'sell'}">${bull ? 'BUY' : 'SELL'}</span><span class="od-tag">${esc(t.signal_setup || 'Signal')}</span><span class="od-tag">${lots} lot${lots > 1 ? 's' : ''} × ${num(t.lot_size)}</span>${t.sector_group ? `<span class="od-tag">${esc(t.sector_group)}${t.sector_state ? ' · ' + esc(t.sector_state) : ''}</span>` : ''}${t.source === 'manual' ? '<span class="od-tag warn">Taken by hand</span>' : ''}</div>
        ${ladder(t)}
        <div class="od-metrics"><span>Cost <b>${inr(num(t.max_loss) * lots)}</b></span><span>Max profit <b class="up">${inr(num(t.max_profit) * lots)}</b></span><span>Breakeven <b>${k(t.breakeven)}</b></span><span>Worth <b>${px(t.mark_value)}</b> of ${k(t.width)}</span></div>
        <div class="od-more" ${open ? '' : 'hidden'}>
          <div class="od-kv"><div>Bought ${k(t.long_strike)} ${esc(t.opt_type)} at</div><div>${px(t.entry_long)}</div><div>Sold ${k(t.short_strike)} ${esc(t.opt_type)} at</div><div>${px(t.entry_short)}</div>
            <div>Net debit / share</div><div>${px(t.net_debit)}</div><div>IV / 20-day HV</div><div>${num(t.iv) === null ? '—' : num(t.iv).toFixed(1) + '%'} / ${num(t.hv) === null ? '—' : num(t.hv).toFixed(1) + '%'}</div>
            <div>Opened</div><div>${dt(t.opened_at)} at ${k(t.spot_entry)}</div><div>Last mark</div><div>${dt(t.marked_at)}${num(t.mark_spot) ? ' at ' + k(t.mark_spot) : ''}</div></div>
          <p class="od-hint">Fixed plan: closes at the stop ${k(t.stop)}, target 1 ${k(t.target)}, when the spread is worth ${px(0.8 * num(t.width))} (80% of its width), or 2 days before expiry.</p>
        </div>
        ${editing === t.id ? editForm(t) : `<div class="od-acts">
          <button class="od-btn sm ghost" type="button" data-more="${t.id}">${open ? 'Less' : 'Details'}</button><span class="od-sp"></span>
          <button class="od-btn sm" type="button" data-editbtn="${t.id}">Edit</button>
          <button class="od-btn sm ghost-danger" type="button" data-del="${t.id}">Delete</button>
          <button class="od-btn sm primary" type="button" data-exit="${t.id}">Exit</button>
        </div>`}
      </article>`;
    }
    function openCards() {
      const open = (F.open || []).slice().sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at)) || b.id - a.id);
      q('open').innerHTML = open.length ? open.map(card).join('') : '<div class="od-empty"><b>No open spreads</b><br>The engine opens one when a scanner signal on an F&amp;O stock passes every rule and the cap has room.</div>';
    }
    function closedList() {
      const c = F.closed || [];
      q('clearClosed').disabled = !c.length;
      q('closedNote').textContent = c.length ? `${c.length} closed · ${sInr((F.stats || {}).pnl)} realised` : '';
      q('closed').innerHTML = c.length ? c.map((t) => `<article class="od-sc od-row">
          <div class="od-srow"><div class="od-name"><div class="od-sym">${symHtml(t.symbol)}</div><div class="od-nm">${esc(label(t))} · ${lotsOf(t)} × ${num(t.lot_size)}</div></div>
            <div class="od-px"><div class="l ${tone(t.pnl)}">${sInr(t.pnl)}</div><div class="c">of ${inr(num(t.max_loss) * lotsOf(t))} risked</div></div></div>
          <div class="od-srow od-sub"><span>${esc(t.exit_reason || '')} · ${dt(t.closed_at)}</span><button class="od-x" type="button" data-del="${t.id}" title="Delete from the record" aria-label="Delete ${esc(t.symbol)}">×</button></div>
        </article>`).join('') : '<div class="od-empty">No closed spreads yet.</div>';
    }
    function logList() {
      const L = F.log || [];
      q('log').innerHTML = L.length ? L.map((l) => `<div class="od-logrow"><span class="od-tag ${esc(String(l.action).split(' ')[0])}">${esc(l.action)}</span><div><b>${esc(l.symbol || '')}</b> ${esc(l.reason || '')}<small>${dt(l.at)}</small></div></div>`).join('')
        : '<div class="od-empty">Nothing yet. The first run is at 9:30 AM IST on the next trading day, or press Run now.</div>';
    }
    function renderDry() {
      const r = lastDry; if (!r) { q('dryOut').innerHTML = ''; return; }
      const rows = r.results || [], openSyms = new Set((F && F.open || []).map((t) => t.symbol));
      const takeable = (x) => r.market_open && x.symbol && !openSyms.has(x.symbol) && (x.action === 'would open' || (x.action === 'skipped' && x.detail && x.detail.cap));
      q('dryOut').innerHTML = `<div class="od-card od-dry"><h3>Dry run <small>${r.market_open ? 'live prices' : 'market closed: last quotes'} · would open ${r.opened}, skip ${r.skipped} · nothing saved</small><button class="od-x" type="button" data-closedry="1" aria-label="Close dry run">×</button></h3>
        ${rows.length ? rows.map((x) => `<div class="od-logrow"><span class="od-tag ${esc(String(x.action).split(' ')[0])}">${esc(x.action)}</span><div><b>${esc(x.symbol || '')}</b> ${esc(x.reason)}${x.detail && x.detail.max_loss ? `<small>risk ${inr(x.detail.max_loss * (x.detail.lots || 1))} · max profit ${inr(x.detail.max_profit * (x.detail.lots || 1))}</small>` : ''}</div>${takeable(x) ? `<button class="od-btn sm primary" type="button" data-take="${esc(x.symbol)}">Take</button>` : ''}</div>`).join('') : '<div class="od-empty">No F&amp;O signals to check right now.</div>'}
      </div>`;
    }
    async function refresh() {
      let data;
      try { data = await rpc('options_paper_feed'); } catch (e) { toast('Could not load: ' + e.message, true); return; }
      F = data; kpis(); settingsForm(); openCards(); closedList(); logList(); renderDry();
    }

    q('seg').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
    q('run').onclick = async () => {
      const b = q('run'); b.disabled = true; b.textContent = 'Running…'; toast('Running… this can take a minute (it reads each option chain from NSE).');
      try {
        const r = await callFn('?force=1');
        toast(`Done: opened ${r.opened}, closed ${r.closed}, marked ${r.marked}, skipped ${r.skipped}${r.errors ? ', errors ' + r.errors : ''}${r.note ? ' (' + r.note + ')' : ''}.` + (r.opened === 0 && !isOpenNow() ? ' New spreads open only in market hours.' : ''));
        refresh();
      } catch (e) { toast('Run failed: ' + e.message, true); } finally { b.disabled = false; b.textContent = 'Run now'; }
    };
    q('dry').onclick = async () => {
      const b = q('dry'); b.disabled = true; b.textContent = 'Checking…';
      try { lastDry = await callFn('?dry=1'); renderDry(); }
      catch (e) { toast('Dry run failed: ' + e.message, true); } finally { b.disabled = false; b.textContent = 'Dry run'; }
    };
    q('setForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, mo = parseInt(f.max_open.value, 10), mr = Number(f.max_risk.value), lots = parseInt(f.lots.value, 10);
      if (!(mo >= 0 && mo <= 200) || !(mr >= 0) || !(lots >= 1 && lots <= 50)) { toast('Check the settings: max open 0–200, max at risk 0 or more, lots 1–50.', true); return; }
      try { await rpc('options_paper_settings_set', { p_max_open: mo, p_max_risk: mr, p_lots: lots, p_auto: f.auto_open.checked }); if (document.activeElement) document.activeElement.blur(); toast('Settings saved.'); refresh(); }
      catch (err) { toast('Could not save: ' + err.message, true); }
    };
    q('clearClosed').onclick = async () => {
      const n = (F.closed || []).length;
      if (!n || !confirm(`Delete all ${n} closed spreads from the record? Open spreads are kept.`)) return;
      try { const k2 = await rpc('options_paper_clear', { p_what: 'closed' }); toast(`Cleared ${k2} closed spreads.`); refresh(); } catch (e) { toast('Could not clear: ' + e.message, true); }
    };
    q('clearAll').onclick = async () => {
      const b = q('clearAll'), n = (F.open || []).length + (F.closed || []).length;
      if (!confirm(`Delete everything: ${n} spreads (open and closed) and the activity log? Settings are kept. This cannot be undone.`)) return;
      b.disabled = true; b.textContent = 'Clearing…';
      try { const k2 = await rpc('options_paper_clear', { p_what: 'all' }); toast(`Cleared ${k2} spreads and the log.`); lastDry = null; expanded.clear(); editing = null; await refresh(); setView('open'); }
      catch (e) { toast('Could not clear: ' + e.message, true); } finally { b.disabled = false; b.textContent = 'Clear everything…'; }
    };
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
      const find = (id) => [...(F.open || []), ...(F.closed || [])].find((t) => String(t.id) === String(id));
      if (b.dataset.more) { const id = Number(b.dataset.more); if (expanded.has(id)) expanded.delete(id); else expanded.add(id); openCards(); }
      else if (b.dataset.closedry) { lastDry = null; renderDry(); }
      else if (b.dataset.exit) {
        const t = find(b.dataset.exit); if (!t) return;
        const live = isOpenNow();
        if (!confirm(`Exit ${t.symbol} ${label(t)} now${live ? ' at live prices' : ' at its last mark (' + px(t.mark_value) + ', market closed)'}? Marked P&L ${sInr(t.pnl)}.`)) return;
        b.disabled = true; b.textContent = 'Exiting…';
        try { const r = await callFn('?action=exit&id=' + encodeURIComponent(t.id)); toast(`Exited ${r.symbol} ${r.how}: ${sInr(r.pnl)}.`); refresh(); }
        catch (err) { toast('Exit failed: ' + err.message, true); b.disabled = false; b.textContent = 'Exit'; }
      } else if (b.dataset.editbtn) { editing = Number(b.dataset.editbtn); openCards(); }
      else if (b.dataset.cancel) { editing = null; openCards(); }
      else if (b.dataset.del) {
        const t = find(b.dataset.del); if (!t) return;
        if (!confirm(`Delete ${t.symbol} ${label(t)} (${t.status === 'OPEN' ? 'open' : 'closed'}) from the record? It is removed, not exited, and won't count in the results.`)) return;
        try { await rpc('options_paper_delete', { p_id: t.id }); toast(`Deleted ${t.symbol}.`); refresh(); } catch (err) { toast('Delete failed: ' + err.message, true); }
      } else if (b.dataset.take) {
        const sym = b.dataset.take;
        if (!confirm(`Take ${sym} now at live prices? This opens it even if the cap is full.`)) return;
        b.disabled = true; b.textContent = 'Taking…';
        try { const r = await callFn('?action=take&symbol=' + encodeURIComponent(sym)); const t = r.trade || {}; toast(`Taken: ${sym} ${label(t)}, ${inr(num(t.max_loss) * lotsOf(t))} at risk.`); refresh(); }
        catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Take'; }
      }
    });
    root.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-edit]'); if (!f) return;
      e.preventDefault();
      const id = Number(f.dataset.edit), stop = Number(f.stop.value), target = Number(f.target.value), lots = parseInt(f.lots.value, 10);
      if (!(stop > 0 && target > 0 && lots >= 1 && lots <= 50)) { toast('Stop and target must be above 0, lots 1–50.', true); return; }
      try { await rpc('options_paper_edit', { p_id: id, p_stop: stop, p_target: target, p_lots: lots }); editing = null; toast('Saved.'); refresh(); }
      catch (err) { toast('Could not save: ' + err.message, true); }
    });
    setView(view);
    refresh();
    // Prices update every minute; open Details and the card order are kept, and nothing redraws while you edit or type.
    setInterval(() => {
      const ae = document.activeElement, typing = ae && root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName);
      if (!document.hidden && root.offsetParent !== null && editing === null && !typing) refresh();
    }, 60000);
    return { refresh };
  }
  window.mpOptionsDesk = { mount };
})();
