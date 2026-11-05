/* Options Paper Desk: the Stock Signals scanner's F&O signals (plus Nifty / Bank Nifty) as paper debit spreads
   (options-signals edge function). Platform admin only. Used by the Options tab on the Signals page (added only after
   mp_is_platform_admin() says yes) and by admin-options.html. The data and every action are admin-only on the server
   too: options_paper_feed() and the options_paper_* functions refuse anyone else.
   Controls: cap settings (max open spreads, max total at risk, lots per trade, auto-open), Exit / Edit / Delete on each
   spread, Take on a dry-run candidate (ignores the cap), Clear closed, Clear everything.
   window.mpOptionsDesk.mount(rootElement, supabaseClient) renders into rootElement and refreshes every minute while
   it is visible. */
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
  // Index names aren't stocks: don't make them open the stock card.
  const symHtml = (sym) => IDX.has(sym) ? `${esc(sym)} <span class="od-pill">Index</span>` : `<span data-sym="${esc(sym)}">${esc(sym)}</span>`;
  const label = (t) => `${t.strategy === 'bear_put_spread' ? 'Bear put' : 'Bull call'} ${k(t.long_strike)}/${k(t.short_strike)} ${t.opt_type}`;
  const lotsOf = (t) => Math.max(1, num(t.lots) || 1);
  const isOpenNow = () => { const t = new Date(Date.now() + 330 * 60e3), m = t.getUTCHours() * 60 + t.getUTCMinutes(), d = t.getUTCDay(); return d >= 1 && d <= 5 && m >= 560 && m <= 930; };

  const SHELL = `
    <div class="od-banner"><b>Paper only, admins only.</b> Not recommendations. Showing options trade ideas to the public needs SEBI research-analyst registration, so this stays private until that is in place. There is no back-test for options (no stored option prices): judge it on the paper record below once it has a few weeks of trades.</div>
    <div class="od-banner od-warn" data-od="capWarn" hidden></div>
    <div class="od-kpis" data-od="kpis"></div>
    <div class="od-card">
      <h3><span>Engine</span><small data-od="lastRun"></small></h3>
      <div class="od-bar">
        <button class="od-btn primary" type="button" data-od="run">Run now</button>
        <button class="od-btn" type="button" data-od="dry">Dry run: what would it open now?</button>
        <span class="od-msg" data-od="runMsg">Runs by itself every 15 minutes, 9:30 AM – 3:15 PM IST on weekdays. New spreads open only while the market is open.</span>
      </div>
      <div data-od="dryOut"></div>
    </div>
    <div class="od-card">
      <h3><span>Cap &amp; settings</span><small data-od="setNote"></small></h3>
      <form class="od-form" data-od="setForm">
        <label><span>Max open spreads</span><input type="number" name="max_open" min="0" max="200" step="1" required></label>
        <label><span>Max total at risk (₹)</span><input type="number" name="max_risk" min="0" step="5000" required></label>
        <label><span>Lots per new trade</span><input type="number" name="lots" min="1" max="50" step="1" required></label>
        <label class="od-check"><input type="checkbox" name="auto_open"><span>Engine opens new spreads by itself</span></label>
        <button class="od-btn primary" type="submit">Save</button>
      </form>
      <p class="od-msg">When the cap is full the engine stops opening; open spreads are still marked and closed. It fills free slots in this order: Nifty / Bank Nifty signals, strong-sector stocks, neutral, no sector index, then by scanner score. <b>Take</b> on a dry-run result opens it anyway.</p>
    </div>
    <div class="od-card"><h3><span>Open spreads</span><small data-od="openNote"></small></h3><div data-od="open"></div></div>
    <div class="od-card"><h3><span>Closed spreads</span><span class="od-bar"><button class="od-btn sm" type="button" data-od="clearClosed">Clear closed</button></span></h3><div data-od="closed"></div></div>
    <div class="od-card"><h3><span>Activity (last 2 days)</span></h3><div class="od-tw" data-od="log"></div></div>
    <div class="od-card od-danger">
      <h3><span>Start again</span></h3>
      <p class="od-msg">Deletes every spread, open and closed, and the activity log. Settings are kept. This cannot be undone.</p>
      <button class="od-btn danger" type="button" data-od="clearAll">Clear everything…</button>
    </div>
    <div class="od-card"><details><summary>How trades are picked and closed</summary><ul>
      <li><b>Source:</b> the Stock Signals scanner's BUY / SELL signals on F&amp;O stocks. Signals in a <b>weak sector</b> (Sectors page filter) are skipped.</li>
      <li><b>Nifty &amp; Bank Nifty:</b> their own rule, checked from 2:45 PM IST on daily closes plus the live level. BUY when the 20-day average is above the 50-day, and the index has dipped below its 20-day average (still above the 50-day) to under its lowest close of the previous 4 days; SELL is the mirror image. Stop 1.5× and target 2.5× the average daily move. On ~21 months of history: 81 signals, target first 38, stop first 32, +0.71× the daily move per signal on average (a breakout rule tested the same way came out at zero). At most one signal per index per day.</li>
      <li><b>Trade:</b> BUY → bull call spread (buy the at-the-money call, sell the call at the strike nearest the signal's target 1). SELL → bear put spread. One spread per stock at a time, with the lots set above.</li>
      <li><b>Cap:</b> at most the set number of open spreads and the set total at risk (each spread's maximum loss × lots).</li>
      <li><b>Expiry:</b> the nearest with at least 14 days left, so time decay doesn't dominate.</li>
      <li><b>Liquidity:</b> both legs need a live bid and ask, a bid-ask spread within 12% (bought leg) / 20% (sold leg), and open interest of 50+ contracts.</li>
      <li><b>Price:</b> skipped when implied volatility is above 1.6× the stock's 20-day historical volatility, or the maximum profit is under 0.8× the maximum loss.</li>
      <li><b>Fills:</b> buy at the ask, sell at the bid (the reverse on exit). Brokerage and taxes are not included.</li>
      <li><b>Exit:</b> the stock hits the signal's stop, reaches target 1, the spread is worth 80% of its width, or 2 days before expiry; or by hand with <b>Exit</b> (live prices; after hours, at the last mark). The most a spread can lose is the debit paid.</li>
    </ul></details></div>`;

  function mount(root, sb) {
    if (!root || root.dataset.odMounted) return;
    root.dataset.odMounted = '1';
    root.classList.add('od');
    root.innerHTML = SHELL;
    const q = (n) => root.querySelector(`[data-od="${n}"]`);
    let F = null, editing = null, lastDry = null;

    function toast(msg, bad) { const m = q('runMsg'); m.className = 'od-msg' + (bad ? ' err' : ''); m.textContent = msg; m.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
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
      const over = open.length > num(cfg.max_open) || num(F.open_risk) > num(cfg.max_risk);
      q('kpis').innerHTML = [
        ['Open spreads', `${open.length}<small>cap ${num(cfg.max_open) ?? '—'}</small>`, open.length > num(cfg.max_open) ? 'down' : ''],
        ['At risk now', `${inr(F.open_risk)}<small>cap ${inr(cfg.max_risk)}</small>`, num(F.open_risk) > num(cfg.max_risk) ? 'down' : ''],
        ['Open P&L', sInr(F.open_pnl), tone(F.open_pnl)],
        ['Closed', s.closed || 0, ''], ['Win rate', s.closed ? Math.round(100 * s.wins / s.closed) + '%' : '—', ''],
        ['Realised P&L', sInr(s.pnl), tone(s.pnl)], ['Avg win / loss', s.closed ? `${sInr(s.avg_win)} / ${sInr(s.avg_loss)}` : '—', ''],
      ].map(([l, v, c]) => `<div class="od-kpi"><span>${l}</span><b class="${c}">${v}</b></div>`).join('');
      q('lastRun').textContent = F.last_run ? 'Last run ' + dt(F.last_run) : 'Not run yet';
      const w = q('capWarn');
      w.hidden = !over;
      if (over) w.innerHTML = `<b>Over the cap:</b> ${open.length} spreads open with ${inr(F.open_risk)} at risk, against a cap of ${num(cfg.max_open)} spread${num(cfg.max_open) === 1 ? '' : 's'} and ${inr(cfg.max_risk)}. The engine won't open new ones until you're under it. Exit or delete some below, raise the cap, or use <b>Clear everything</b> to start again.`;
      if (!cfg.auto_open) { w.hidden = false; w.innerHTML = (over ? w.innerHTML + '<br>' : '') + '<b>Auto-open is off:</b> the engine marks and closes open spreads but opens no new ones. Use <b>Take</b> on a dry-run result to open one by hand.'; }
    }
    function settingsForm() {
      const cfg = F.settings || {}, f = q('setForm');
      if (f.contains(document.activeElement)) return; // don't overwrite what's being typed
      f.max_open.value = num(cfg.max_open) ?? 10; f.max_risk.value = num(cfg.max_risk) ?? 150000; f.lots.value = num(cfg.lots) ?? 1; f.auto_open.checked = cfg.auto_open !== false;
      q('setNote').textContent = cfg.updated_at ? 'Saved ' + dt(cfg.updated_at) : '';
    }
    function meter(t) {
      const st = num(t.stop), tg = num(t.target), now = num(t.mark_spot), en = num(t.spot_entry);
      if (!(st > 0 && tg > 0 && now > 0)) return '';
      const lo = Math.min(st, tg), hi = Math.max(st, tg), pos = (v) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)), bull = t.opt_type === 'CE';
      return `<div class="od-meter"><i class="st" style="left:${pos(st)}%"></i><i class="tg" style="left:calc(${pos(tg)}% - 3px)"></i><i class="now" style="left:${pos(now)}%" title="Now ${px(now)}"></i></div>
        <div class="od-meter-l"><span>${bull ? 'Stop' : 'Target'} ${px(lo)}</span><span>${IDX.has(t.symbol) ? 'Index' : 'Stock'} ${px(now)} (entry ${px(en)})</span><span>${bull ? 'Target' : 'Stop'} ${px(hi)}</span></div>`;
    }
    function editForm(t) {
      return `<form class="od-form od-edit" data-edit="${t.id}">
        <label><span>Stop (${IDX.has(t.symbol) ? 'index' : 'stock'} level)</span><input type="number" name="stop" step="0.05" min="0" value="${num(t.stop) ?? ''}" required></label>
        <label><span>Target 1</span><input type="number" name="target" step="0.05" min="0" value="${num(t.target) ?? ''}" required></label>
        <label><span>Lots (lot = ${num(t.lot_size)})</span><input type="number" name="lots" step="1" min="1" max="50" value="${lotsOf(t)}" required></label>
        <span class="od-bar"><button class="od-btn primary sm" type="submit">Save</button><button class="od-btn sm" type="button" data-cancel="1">Cancel</button></span>
      </form>`;
    }
    function openCards() {
      const open = F.open || [];
      q('openNote').textContent = open.length ? 'Marked every 15 minutes in market hours' : '';
      if (!open.length) { q('open').innerHTML = '<div class="od-empty">No open spreads. The engine opens one when a scanner signal on an F&amp;O stock passes every rule and the cap has room.</div>'; return; }
      q('open').innerHTML = '<div class="od-trades">' + open.map((t) => {
        const lots = lotsOf(t), cost = num(t.net_debit) * num(t.lot_size) * lots, pnlPct = cost ? num(t.pnl) / cost * 100 : null;
        return `<div class="od-tr" data-trade="${t.id}">
          <div class="od-tr-h"><div><b>${symHtml(t.symbol)}</b> <span class="od-pill ${t.opt_type === 'CE' ? 'bull' : 'bear'}">${esc(label(t))}</span>${t.source === 'manual' ? ' <span class="od-pill">Taken by hand</span>' : ''}
            <small>${dExp(t.expiry)} expiry · ${daysTo(t.expiry)} days left · ${lots} lot${lots > 1 ? 's' : ''} of ${num(t.lot_size)} · ${esc(t.signal_setup || t.signal_side)} signal${t.sector_group ? ' · ' + esc(t.sector_group) + ' (' + esc(t.sector_state) + ')' : ''}</small></div>
            <div class="od-pnl ${tone(t.pnl)}">${sInr(t.pnl)}<small>${pnlPct === null ? '' : (pnlPct > 0 ? '+' : '') + pnlPct.toFixed(0) + '% of cost'}</small></div></div>
          <div class="od-kv">
            <div><span>Buy ${k(t.long_strike)} ${t.opt_type} at</span><b>${px(t.entry_long)}</b></div><div><span>Sell ${k(t.short_strike)} ${t.opt_type} at</span><b>${px(t.entry_short)}</b></div>
            <div><span>Net debit / share</span><b>${px(t.net_debit)}</b></div><div><span>Cost = max loss</span><b>${inr(num(t.max_loss) * lots)}</b></div>
            <div><span>Max profit</span><b class="up">${inr(num(t.max_profit) * lots)}</b></div><div><span>Breakeven at expiry</span><b>${px(t.breakeven)}</b></div>
            <div><span>Spread worth now</span><b>${px(t.mark_value)}</b></div><div><span>IV / 20-day HV</span><b>${num(t.iv) === null ? '—' : num(t.iv).toFixed(1) + '%'} / ${num(t.hv) === null ? '—' : num(t.hv).toFixed(1) + '%'}</b></div>
          </div>
          ${meter(t)}
          <div class="od-plan">Opened ${dt(t.opened_at)} at ${px(t.spot_entry)}. Closes when it hits ${px(t.stop)} (stop) or ${px(t.target)} (target 1), when the spread is worth ${px(0.8 * num(t.width))} (80% of its ${px(t.width)} width), or 2 days before expiry. Last mark ${dt(t.marked_at)}.</div>
          ${editing === t.id ? editForm(t) : `<div class="od-acts">
            <button class="od-btn sm" type="button" data-exit="${t.id}">Exit now</button>
            <button class="od-btn sm" type="button" data-editbtn="${t.id}">Edit</button>
            <button class="od-btn sm ghost-danger" type="button" data-del="${t.id}">Delete</button>
          </div>`}
        </div>`;
      }).join('') + '</div>';
    }
    function closedTable() {
      const c = F.closed || [];
      q('clearClosed').disabled = !c.length;
      if (!c.length) { q('closed').innerHTML = '<div class="od-empty">No closed spreads yet.</div>'; return; }
      q('closed').innerHTML = `<div class="od-tw"><table><thead><tr><th>Stock</th><th>Spread</th><th class="hide-s">Opened</th><th>Closed</th><th>Why</th><th class="r hide-s">Debit → exit</th><th class="r">P&amp;L</th><th></th></tr></thead><tbody>
        ${c.map((t) => `<tr><td><b>${symHtml(t.symbol)}</b><small>${esc(t.signal_setup || t.signal_side || '')}</small></td><td>${esc(label(t))}<small>${dExp(t.expiry)} · ${lotsOf(t)} × ${num(t.lot_size)}</small></td>
          <td class="hide-s">${dt(t.opened_at)}<small>at ${px(t.spot_entry)}</small></td><td>${dt(t.closed_at)}<small>at ${px(t.exit_spot)}</small></td><td>${esc(t.exit_reason || '')}</td>
          <td class="r hide-s">${px(t.net_debit)} → ${px(t.exit_value)}</td><td class="r ${tone(t.pnl)}"><b>${sInr(t.pnl)}</b><small>of ${inr(num(t.max_loss) * lotsOf(t))} risked</small></td>
          <td class="r"><button class="od-x" type="button" data-del="${t.id}" title="Delete from the record" aria-label="Delete ${esc(t.symbol)}">×</button></td></tr>`).join('')}
        </tbody></table></div>`;
    }
    function logTable() {
      const L = F.log || [];
      if (!L.length) { q('log').innerHTML = '<div class="od-empty">Nothing yet. The first run is at 9:30 AM IST on the next trading day, or press Run now.</div>'; return; }
      q('log').innerHTML = `<table><thead><tr><th>Time</th><th>Stock</th><th>What</th><th>Details</th></tr></thead><tbody>
        ${L.map((l) => `<tr><td style="white-space:nowrap">${dt(l.at)}</td><td><b>${esc(l.symbol || '')}</b></td><td><span class="od-pill ${esc(String(l.action).split(' ')[0])}">${esc(l.action)}</span></td><td>${esc(l.reason || '')}</td></tr>`).join('')}
        </tbody></table>`;
    }
    function renderDry() {
      const r = lastDry; if (!r) return;
      const rows = r.results || [], openSyms = new Set((F && F.open || []).map((t) => t.symbol));
      const takeable = (x) => x.symbol && !openSyms.has(x.symbol) && (x.action === 'would open' || (x.action === 'skipped' && x.detail && x.detail.cap));
      q('dryOut').innerHTML = `<p class="od-msg">${r.market_open ? 'Live prices.' : 'Market is closed: these use the last quotes NSE shows, which can be stale or missing until the open.'} Would open <b>${r.opened}</b>, skip <b>${r.skipped}</b>${r.errors ? ', errors ' + r.errors : ''}. Nothing was saved.${r.market_open ? ' <b>Take</b> opens one now, even over the cap.' : ''}</p>` +
        (rows.length ? `<div class="od-tw"><table><thead><tr><th>Stock</th><th>Result</th><th>Details</th><th class="r">Max loss</th><th class="r">Max profit</th><th></th></tr></thead><tbody>
          ${rows.map((x) => `<tr><td><b>${esc(x.symbol || '')}</b></td><td><span class="od-pill ${esc(String(x.action).split(' ')[0])}">${esc(x.action)}</span></td><td>${esc(x.reason)}</td>
            <td class="r">${x.detail && x.detail.max_loss ? inr(x.detail.max_loss * (x.detail.lots || 1)) : ''}</td><td class="r up">${x.detail && x.detail.max_profit ? inr(x.detail.max_profit * (x.detail.lots || 1)) : ''}</td>
            <td class="r">${takeable(x) && r.market_open ? `<button class="od-btn sm primary" type="button" data-take="${esc(x.symbol)}">Take</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="od-empty">No F&amp;O signals to check right now.</div>');
    }
    async function refresh() {
      let data;
      try { data = await rpc('options_paper_feed'); } catch (e) { toast('Could not load: ' + e.message, true); return; }
      F = data; kpis(); settingsForm(); openCards(); closedTable(); logTable(); renderDry();
    }

    q('run').onclick = async () => {
      const b = q('run'); b.disabled = true; toast('Running… this can take a minute (it reads each option chain from NSE).');
      try {
        const r = await callFn('?force=1');
        toast(`Done: opened ${r.opened}, closed ${r.closed}, marked ${r.marked}, skipped ${r.skipped}${r.errors ? ', errors ' + r.errors : ''}${r.note ? ' (' + r.note + ')' : ''}.` + (r.opened === 0 && !isOpenNow() ? ' New spreads open only while the market is open.' : ''));
        refresh();
      } catch (e) { toast('Run failed: ' + e.message, true); } finally { b.disabled = false; }
    };
    q('dry').onclick = async () => {
      const b = q('dry'); b.disabled = true; q('dryOut').innerHTML = '<p class="od-msg">Checking every current signal against the rules…</p>';
      try { lastDry = await callFn('?dry=1'); renderDry(); }
      catch (e) { q('dryOut').innerHTML = '<p class="od-msg err">Dry run failed: ' + esc(e.message) + '</p>'; } finally { b.disabled = false; }
    };
    q('setForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, mo = parseInt(f.max_open.value, 10), mr = Number(f.max_risk.value), lots = parseInt(f.lots.value, 10);
      if (!(mo >= 0 && mo <= 200) || !(mr >= 0) || !(lots >= 1 && lots <= 50)) { toast('Check the settings: max open 0–200, max at risk 0 or more, lots 1–50.', true); return; }
      try { await rpc('options_paper_settings_set', { p_max_open: mo, p_max_risk: mr, p_lots: lots, p_auto: f.auto_open.checked }); document.activeElement.blur(); toast('Settings saved.'); refresh(); }
      catch (err) { toast('Could not save: ' + err.message, true); }
    };
    q('clearClosed').onclick = async () => {
      const n = (F.closed || []).length;
      if (!n || !confirm(`Delete all ${n} closed spreads from the record? Open spreads are kept.`)) return;
      try { const k2 = await rpc('options_paper_clear', { p_what: 'closed' }); toast(`Cleared ${k2} closed spreads.`); refresh(); } catch (e) { toast('Could not clear: ' + e.message, true); }
    };
    q('clearAll').onclick = async () => {
      const n = (F.open || []).length + (F.closed || []).length;
      if (!confirm(`Delete everything: ${n} spreads (open and closed) and the activity log? Settings are kept. This cannot be undone.`)) return;
      try { const k2 = await rpc('options_paper_clear', { p_what: 'all' }); toast(`Cleared ${k2} spreads and the log.`); lastDry = null; q('dryOut').innerHTML = ''; refresh(); } catch (e) { toast('Could not clear: ' + e.message, true); }
    };
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
      const find = (id) => [...(F.open || []), ...(F.closed || [])].find((t) => String(t.id) === String(id));
      if (b.dataset.exit) {
        const t = find(b.dataset.exit); if (!t) return;
        const live = isOpenNow();
        if (!confirm(`Exit ${t.symbol} ${label(t)} now${live ? ' at live prices' : ' at its last mark (' + px(t.mark_value) + ', market closed)'}? Marked P&L ${sInr(t.pnl)}.`)) return;
        b.disabled = true; b.textContent = 'Exiting…';
        try { const r = await callFn('?action=exit&id=' + encodeURIComponent(t.id)); toast(`Exited ${r.symbol} ${r.how}: ${sInr(r.pnl)}.`); refresh(); }
        catch (err) { toast('Exit failed: ' + err.message, true); b.disabled = false; b.textContent = 'Exit now'; }
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
    refresh();
    setInterval(() => { if (!document.hidden && root.offsetParent !== null && editing === null) refresh(); }, 60000);
    return { refresh };
  }
  window.mpOptionsDesk = { mount };
})();
