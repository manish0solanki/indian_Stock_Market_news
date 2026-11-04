/* Options Paper Desk: the Stock Signals scanner's F&O signals as paper debit spreads (options-signals edge function).
   Platform admin only. Used by the Options tab on the Signals page (added only after mp_is_platform_admin() says yes)
   and by admin-options.html. The data itself is admin-only too: options_paper_feed() refuses anyone else.
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
  const label = (t) => `${t.strategy === 'bear_put_spread' ? 'Bear put' : 'Bull call'} ${k(t.long_strike)}/${k(t.short_strike)} ${t.opt_type}`;
  const isOpenNow = () => { const t = new Date(Date.now() + 330 * 60e3), m = t.getUTCHours() * 60 + t.getUTCMinutes(), d = t.getUTCDay(); return d >= 1 && d <= 5 && m >= 560 && m <= 930; };

  const SHELL = `
    <div class="od-banner"><b>Paper only, admins only.</b> Not recommendations. Showing options trade ideas to the public needs SEBI research-analyst registration, so this stays private until that is in place. There is no back-test for options (no stored option prices): judge it on the paper record below once it has a few weeks of trades.</div>
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
    <div class="od-card"><h3><span>Open spreads</span><small data-od="openNote"></small></h3><div data-od="open"></div></div>
    <div class="od-card"><h3><span>Closed spreads</span></h3><div data-od="closed"></div></div>
    <div class="od-card"><h3><span>Activity (last 2 days)</span></h3><div class="od-tw" data-od="log"></div></div>
    <div class="od-card"><details><summary>How trades are picked and closed</summary><ul>
      <li><b>Source:</b> the Stock Signals scanner's BUY / SELL signals on F&amp;O stocks. Signals in a <b>weak sector</b> (Sectors page filter) are skipped.</li>
      <li><b>Trade:</b> BUY → bull call spread (buy the at-the-money call, sell the call at the strike nearest the signal's target 1). SELL → bear put spread. One lot, one spread per stock at a time.</li>
      <li><b>Expiry:</b> the nearest with at least 14 days left, so time decay doesn't dominate.</li>
      <li><b>Liquidity:</b> both legs need a live bid and ask, a bid-ask spread within 12% (bought leg) / 20% (sold leg), and open interest of 50+ contracts.</li>
      <li><b>Price:</b> skipped when implied volatility is above 1.6× the stock's 20-day historical volatility, or the maximum profit is under 0.8× the maximum loss.</li>
      <li><b>Fills:</b> buy at the ask, sell at the bid (the reverse on exit). Brokerage and taxes are not included.</li>
      <li><b>Exit:</b> the stock hits the signal's stop, reaches target 1, the spread is worth 80% of its width, or 2 days before expiry. The most a spread can lose is the debit paid.</li>
    </ul></details></div>`;

  function mount(root, sb) {
    if (!root || root.dataset.odMounted) return;
    root.dataset.odMounted = '1';
    root.classList.add('od');
    root.innerHTML = SHELL;
    const q = (n) => root.querySelector(`[data-od="${n}"]`);
    let F = null;

    async function callFn(qs) {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(MP_CONFIG.fn('options-signals') + qs, { method: 'POST', headers: { Authorization: 'Bearer ' + (session ? session.access_token : ''), apikey: MP_CONFIG.supabaseKey, 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      return j;
    }
    function kpis() {
      const s = F.stats || {}, open = F.open || [];
      const risk = open.reduce((a, t) => a + num(t.max_loss) * num(t.lots), 0);
      q('kpis').innerHTML = [
        ['Open spreads', open.length, ''], ['Open P&L', sInr(F.open_pnl), tone(F.open_pnl)], ['At risk now', inr(risk), ''],
        ['Closed', s.closed || 0, ''], ['Win rate', s.closed ? Math.round(100 * s.wins / s.closed) + '%' : '—', ''],
        ['Realised P&L', sInr(s.pnl), tone(s.pnl)], ['Avg win / loss', s.closed ? `${sInr(s.avg_win)} / ${sInr(s.avg_loss)}` : '—', ''],
      ].map(([l, v, c]) => `<div class="od-kpi"><span>${l}</span><b class="${c}">${v}</b></div>`).join('');
      q('lastRun').textContent = F.last_run ? 'Last run ' + dt(F.last_run) : 'Not run yet';
    }
    function meter(t) {
      const st = num(t.stop), tg = num(t.target), now = num(t.mark_spot), en = num(t.spot_entry);
      if (!(st > 0 && tg > 0 && now > 0)) return '';
      const lo = Math.min(st, tg), hi = Math.max(st, tg), pos = (v) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)), bull = t.opt_type === 'CE';
      return `<div class="od-meter"><i class="st" style="left:${pos(st)}%"></i><i class="tg" style="left:calc(${pos(tg)}% - 3px)"></i><i class="now" style="left:${pos(now)}%" title="Stock now ${px(now)}"></i></div>
        <div class="od-meter-l"><span>${bull ? 'Stop' : 'Target'} ${px(lo)}</span><span>Stock ${px(now)} (entry ${px(en)})</span><span>${bull ? 'Target' : 'Stop'} ${px(hi)}</span></div>`;
    }
    function openCards() {
      const open = F.open || [];
      q('openNote').textContent = open.length ? 'Marked every 15 minutes in market hours' : '';
      if (!open.length) { q('open').innerHTML = '<div class="od-empty">No open spreads. The engine opens one when a scanner signal on an F&amp;O stock passes every rule.</div>'; return; }
      q('open').innerHTML = '<div class="od-trades">' + open.map((t) => {
        const per = num(t.lot_size) * num(t.lots), cost = num(t.net_debit) * per, pnlPct = cost ? num(t.pnl) / cost * 100 : null;
        return `<div class="od-tr">
          <div class="od-tr-h"><div><b data-sym="${esc(t.symbol)}">${esc(t.symbol)}</b> <span class="od-pill ${t.opt_type === 'CE' ? 'bull' : 'bear'}">${esc(label(t))}</span>
            <small>${dExp(t.expiry)} expiry · ${daysTo(t.expiry)} days left · lot ${num(t.lot_size)} · ${esc(t.signal_setup || t.signal_side)} signal${t.sector_group ? ' · ' + esc(t.sector_group) + ' (' + esc(t.sector_state) + ')' : ''}</small></div>
            <div class="od-pnl ${tone(t.pnl)}">${sInr(t.pnl)}<small>${pnlPct === null ? '' : (pnlPct > 0 ? '+' : '') + pnlPct.toFixed(0) + '% of cost'}</small></div></div>
          <div class="od-kv">
            <div><span>Buy ${k(t.long_strike)} ${t.opt_type} at</span><b>${px(t.entry_long)}</b></div><div><span>Sell ${k(t.short_strike)} ${t.opt_type} at</span><b>${px(t.entry_short)}</b></div>
            <div><span>Net debit / share</span><b>${px(t.net_debit)}</b></div><div><span>Cost = max loss</span><b>${inr(t.max_loss)}</b></div>
            <div><span>Max profit</span><b class="up">${inr(t.max_profit)}</b></div><div><span>Breakeven at expiry</span><b>${px(t.breakeven)}</b></div>
            <div><span>Spread worth now</span><b>${px(t.mark_value)}</b></div><div><span>IV / 20-day HV</span><b>${num(t.iv) === null ? '—' : num(t.iv).toFixed(1) + '%'} / ${num(t.hv) === null ? '—' : num(t.hv).toFixed(1) + '%'}</b></div>
          </div>
          ${meter(t)}
          <div class="od-plan">Opened ${dt(t.opened_at)} with the stock at ${px(t.spot_entry)}. Closes when the stock hits ${px(t.stop)} (stop) or ${px(t.target)} (target 1), when the spread is worth ${px(0.8 * num(t.width))} (80% of its ${px(t.width)} width), or 2 days before expiry. Last mark ${dt(t.marked_at)}.</div>
        </div>`;
      }).join('') + '</div>';
    }
    function closedTable() {
      const c = F.closed || [];
      if (!c.length) { q('closed').innerHTML = '<div class="od-empty">No closed spreads yet.</div>'; return; }
      q('closed').innerHTML = `<div class="od-tw"><table><thead><tr><th>Stock</th><th>Spread</th><th class="hide-s">Opened</th><th>Closed</th><th>Why</th><th class="r hide-s">Debit → exit</th><th class="r">P&amp;L</th></tr></thead><tbody>
        ${c.map((t) => `<tr><td><b data-sym="${esc(t.symbol)}">${esc(t.symbol)}</b><small>${esc(t.signal_setup || t.signal_side || '')}</small></td><td>${esc(label(t))}<small>${dExp(t.expiry)} · lot ${num(t.lot_size)}</small></td>
          <td class="hide-s">${dt(t.opened_at)}<small>stock ${px(t.spot_entry)}</small></td><td>${dt(t.closed_at)}<small>stock ${px(t.exit_spot)}</small></td><td>${esc(t.exit_reason || '')}</td>
          <td class="r hide-s">${px(t.net_debit)} → ${px(t.exit_value)}</td><td class="r ${tone(t.pnl)}"><b>${sInr(t.pnl)}</b><small>of ${inr(t.max_loss)} risked</small></td></tr>`).join('')}
        </tbody></table></div>`;
    }
    function logTable() {
      const L = F.log || [];
      if (!L.length) { q('log').innerHTML = '<div class="od-empty">Nothing yet. The first run is at 9:30 AM IST on the next trading day, or press Run now.</div>'; return; }
      q('log').innerHTML = `<table><thead><tr><th>Time</th><th>Stock</th><th>What</th><th>Details</th></tr></thead><tbody>
        ${L.map((l) => `<tr><td style="white-space:nowrap">${dt(l.at)}</td><td><b>${esc(l.symbol || '')}</b></td><td><span class="od-pill ${esc(String(l.action).split(' ')[0])}">${esc(l.action)}</span></td><td>${esc(l.reason || '')}</td></tr>`).join('')}
        </tbody></table>`;
    }
    async function refresh() {
      const { data, error } = await sb.rpc('options_paper_feed');
      if (error) { q('runMsg').className = 'od-msg err'; q('runMsg').textContent = 'Could not load: ' + error.message; return; }
      F = data; kpis(); openCards(); closedTable(); logTable();
    }
    q('run').onclick = async () => {
      const b = q('run'), m = q('runMsg'); b.disabled = true; m.className = 'od-msg'; m.textContent = 'Running… this can take a minute (it reads each option chain from NSE).';
      try {
        const r = await callFn('?force=1');
        m.textContent = `Done: opened ${r.opened}, closed ${r.closed}, marked ${r.marked}, skipped ${r.skipped}${r.errors ? ', errors ' + r.errors : ''}.` + (r.opened === 0 && !isOpenNow() ? ' New spreads open only while the market is open.' : '');
        refresh();
      } catch (e) { m.className = 'od-msg err'; m.textContent = 'Run failed: ' + e.message; } finally { b.disabled = false; }
    };
    q('dry').onclick = async () => {
      const b = q('dry'), out = q('dryOut'); b.disabled = true; out.innerHTML = '<p class="od-msg">Checking every current signal against the rules…</p>';
      try {
        const r = await callFn('?dry=1'), rows = r.results || [];
        out.innerHTML = `<p class="od-msg">${r.market_open ? 'Live prices.' : 'Market is closed: these use the last quotes NSE shows, which can be stale or missing until the open.'} Would open <b>${r.opened}</b>, skip <b>${r.skipped}</b>${r.errors ? ', errors ' + r.errors : ''}. Nothing was saved.</p>` +
          (rows.length ? `<div class="od-tw"><table><thead><tr><th>Stock</th><th>Result</th><th>Details</th><th class="r">Max loss</th><th class="r">Max profit</th></tr></thead><tbody>
            ${rows.map((x) => `<tr><td><b>${esc(x.symbol || '')}</b></td><td><span class="od-pill ${esc(String(x.action).split(' ')[0])}">${esc(x.action)}</span></td><td>${esc(x.reason)}</td>
              <td class="r">${x.detail && x.detail.max_loss ? inr(x.detail.max_loss) : ''}</td><td class="r up">${x.detail && x.detail.max_profit ? inr(x.detail.max_profit) : ''}</td></tr>`).join('')}
            </tbody></table></div>` : '<div class="od-empty">No F&amp;O signals to check right now.</div>');
      } catch (e) { out.innerHTML = '<p class="od-msg err">Dry run failed: ' + esc(e.message) + '</p>'; } finally { b.disabled = false; }
    };
    refresh();
    setInterval(() => { if (!document.hidden && root.offsetParent !== null) refresh(); }, 60000);
    return { refresh };
  }
  window.mpOptionsDesk = { mount };
})();
