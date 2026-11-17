/* Expiry reversal desk: one cheap-option (₹4–12) reversal trade on expiry day, Nifty / Bank Nifty / Sensex.
   Platform admin only, paper only (until SEBI RA registration). Shown at the top of the admin-only Options tab on the
   Signals page. The expiry-reversal edge function (every minute, 11:30 AM – 3:30 PM IST) watches the index that expires
   today, opens the day's one trade and manages it; this panel shows what it sees and lets you exit, paper trade a signal
   (when auto paper trading is off) and change the budget and premium range. expiry_desk() refuses anyone but the admin.
   window.mpExpiryDesk.mount(rootElement, supabaseClient). */
(function () {
  'use strict';
  if (window.mpExpiryDesk) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const inr = (v) => { v = num(v); return v === null ? '—' : (v < 0 ? '−' : '') + '₹' + Math.abs(Math.round(v)).toLocaleString('en-IN'); };
  const sInr = (v) => { v = num(v); return v === null ? '—' : (v > 0 ? '+' : '') + inr(v); };
  const px = (v) => { v = num(v); return v === null ? '—' : '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const ix = (v) => { v = num(v); return v === null ? '—' : Math.round(v).toLocaleString('en-IN'); };
  const tone = (v) => (num(v) > 0 ? 'up' : num(v) < 0 ? 'down' : '');
  const NAME = { NIFTY: 'Nifty', BANKNIFTY: 'Bank Nifty', SENSEX: 'Sensex' };
  const istNow = () => new Date(Date.now() + 330 * 60e3);
  const istDay = () => istNow().toISOString().slice(0, 10);
  const addDays = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
  const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
  const fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const hm = (m) => { m = num(m); if (m === null) return '—'; const h = Math.floor(m / 60), mm = m % 60; return `${h > 12 ? h - 12 : h}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
  const holidays = () => { const h = window.MP_CONFIG && window.MP_CONFIG.holidays; return new Set(Array.isArray(h) ? h : h ? Object.keys(h) : []); };
  const trading = (d, hol) => dow(d) >= 1 && dow(d) <= 5 && !hol.has(d);
  const back = (d, hol) => { while (!trading(d, hol)) d = addDays(d, -1); return d; };

  // The next expiry of each index on or after today (holidays move it to the trading day before). NSE's own list is
  // what the server uses for Nifty / Bank Nifty; this is only the "next one" hint when nothing expires today.
  function nextExpiries() {
    const hol = holidays(), today = istDay(), out = [];
    const nextWd = (wd, from) => addDays(from, (wd - dow(from) + 7) % 7);
    for (const [idx, wd] of [['NIFTY', 2], ['SENSEX', 4]]) {
      let d = nextWd(wd, today), e = back(d, hol);
      if (e < today) e = back(nextWd(wd, addDays(d, 1)), hol);
      out.push([idx, e]);
    }
    for (let m = 0; m < 3; m++) {
      const t = istNow(), y = t.getUTCFullYear(), mo = t.getUTCMonth() + m;
      let d = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);
      while (dow(d) !== 2) d = addDays(d, -1);
      d = back(d, hol);
      if (d >= today) { out.push(['BANKNIFTY', d]); break; }
    }
    return out.sort((a, b) => a[1].localeCompare(b[1]));
  }

  const CSS = `
  .xd{display:block;margin-bottom:16px;font-size:13.5px;line-height:1.45;color:var(--text);--xg:var(--green,#31d17c);--xr:var(--red,#ff5d6c);--xa:var(--amber,#f5a623);--xm:var(--mono,ui-monospace,Menlo,monospace)}
  .xd *{box-sizing:border-box}.xd .up{color:var(--xg)}.xd .down{color:var(--xr)}
  .xd-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,14px);padding:14px;margin-bottom:10px;min-width:0}
  .xd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .xd h3{margin:0;font-size:15px}.xd h3 small{display:block;font-size:11.5px;font-weight:500;color:var(--muted);margin-top:2px}
  .xd-pill{display:inline-block;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:var(--surface2,rgba(127,127,127,.12));color:var(--muted);white-space:nowrap}
  .xd-pill.live{background:rgba(49,209,124,.15);color:var(--xg)}.xd-pill.warn{background:rgba(245,166,35,.15);color:var(--xa)}.xd-pill.bad{background:rgba(255,93,108,.14);color:var(--xr)}
  .xd-note{font-size:11.5px;color:var(--muted);margin:8px 0 0;line-height:1.5}.xd-note b{color:var(--text)}
  .xd-watch{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-top:10px}
  .xd-w{border:1px solid var(--border);border-radius:12px;padding:10px 12px;min-width:0}
  .xd-w .top{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
  .xd-w .top b{font-size:14px}
  .xd-checks{list-style:none;margin:8px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px 12px;font-size:12px}
  .xd-checks li{display:flex;gap:6px;align-items:baseline;min-width:0}.xd-checks li i{font-style:normal;font-weight:700;width:14px;flex:none}
  .xd-checks li.ok i{color:var(--xg)}.xd-checks li.no i{color:var(--muted)}
  .xd-trade .big{font-size:18px;font-weight:800;font-family:var(--xm);overflow-wrap:anywhere}
  .xd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px 12px;margin-top:10px}
  .xd-grid div{min-width:0}.xd-grid span{display:block;font-size:10.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  .xd-grid b{font-family:var(--xm);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
  .xd-bar{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}
  .xd-btn{border:1px solid var(--border);background:var(--surface2,transparent);color:var(--text);font:700 12.5px inherit;font-family:inherit;padding:8px 12px;border-radius:10px;cursor:pointer}
  .xd-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.xd-btn.danger{color:var(--xr)}
  .xd-btn:disabled{opacity:.55;cursor:default}
  .xd-msg{font-size:11.5px;color:var(--muted)}
  .xd details{margin-top:8px}.xd summary{cursor:pointer;font-size:12.5px;font-weight:700;color:var(--muted)}
  .xd details ul{margin:6px 0 0;padding-left:18px;font-size:12.5px;line-height:1.55}
  .xd-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:10px;align-items:end}
  .xd-form label span{display:block;font-size:11px;color:var(--muted);font-weight:600;margin-bottom:3px}
  .xd-form input[type=text]{width:100%;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--bg,transparent);color:var(--text);font:600 14px var(--xm)}
  .xd-form .chk{display:flex;gap:8px;align-items:center;font-size:12.5px;font-weight:600}
  .xd-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  .xd-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .xd-table th,.xd-table td{padding:6px 6px;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap}
  .xd-table th{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .xd-table td.n{text-align:right;font-family:var(--xm)}
  .xd-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%) translateY(20px);opacity:0;pointer-events:none;background:var(--text);color:var(--bg,#000);padding:9px 14px;border-radius:10px;font-size:12.5px;font-weight:600;transition:.2s;z-index:60;max-width:calc(100vw - 32px)}
  .xd-toast.show{opacity:1;transform:translateX(-50%)}.xd-toast.err{background:var(--xr);color:#fff}`;

  function mount(root, sb) {
    if (!root || root.dataset.xdMounted) return;
    root.dataset.xdMounted = '1';
    root.classList.add('xd');
    if (!document.getElementById('xd-css')) { const st = document.createElement('style'); st.id = 'xd-css'; st.textContent = CSS; document.head.appendChild(st); }
    root.innerHTML = `
      <div class="xd-card">
        <div class="xd-head"><h3>⚡ Expiry reversal · ₹10 options<small>One trade on expiry day, 12:00 – 2:00 PM · Nifty, Bank Nifty, Sensex</small></h3><span class="xd-pill" data-x="state">…</span></div>
        <div data-x="body"></div>
        <details><summary>How it works</summary><ul>
          <li><b>When:</b> only on expiry day (Nifty weekly Tue, Bank Nifty monthly, Sensex weekly Thu), signals from 12:00 to 2:00 PM IST.</li>
          <li><b>Setup:</b> the index has fallen at least 0.6% from the day's high (or risen 0.6% from the low), made that low (high) within the last hour, has won back 20% of the move and closed three 5-minute bars in a row in the new direction: the sellers (buyers) are covering.</li>
          <li><b>Option:</b> the out-of-the-money call after a fall (put after a rise) closest to the index that costs ₹4–12, as many lots as the budget allows. Bought at the ask.</li>
          <li><b>Exit:</b> 3× the entry (target), half the entry or the index back past the day's low / high (stop), or 3:00 PM. Sold at the bid. One trade a day across all three.</li>
          <li><b>Sensex:</b> BSE blocks automated price requests, so Sensex signals carry an <i>estimated</i> option price. Check the real price in your trading app; they are not paper traded and stay out of the record.</li>
          <li><b>Evidence:</b> tested on 60 days of 5-minute bars (31 expiry days) with modelled option prices: 9 trades, 5 winners, net positive. That is a small sample and real fills on cheap expiry options are rough, so treat the paper record here as the real test. Most of these options expire worthless; size for losing the whole premium.</li>
        </ul></details>
        <p class="xd-note"><b>Paper only · admins only.</b> Not a recommendation: options ideas for others need SEBI research-analyst registration.</p>
      </div>
      <div data-x="trade"></div>
      <div class="xd-card" data-x="watchCard" hidden><h3>Watching now <small data-x="watchNote"></small></h3><div class="xd-watch" data-x="watch"></div></div>
      <div class="xd-card"><h3>Record <small data-x="statNote"></small></h3><div class="xd-grid" data-x="stats"></div><div class="xd-scroll"><table class="xd-table" data-x="hist"></table></div></div>
      <div class="xd-card"><h3>Settings <small>budget and premium range</small></h3>
        <form class="xd-form" data-x="form">
          <label><span>Budget (₹)</span><input type="text" inputmode="numeric" name="budget"></label>
          <label><span>Min premium (₹)</span><input type="text" inputmode="decimal" name="min"></label>
          <label><span>Max premium (₹)</span><input type="text" inputmode="decimal" name="max"></label>
          <label class="chk"><input type="checkbox" name="auto"> Paper trade signals automatically</label>
          <button class="xd-btn primary" type="submit">Save</button>
        </form>
      </div>
      <div class="xd-toast" data-x="toast"></div>`;
    const q = (n) => root.querySelector(`[data-x="${n}"]`);
    let D = null, toastT = null, formFilled = false;
    const toast = (m, bad) => { const t = q('toast'); t.textContent = m; t.className = 'xd-toast show' + (bad ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'xd-toast'; }, bad ? 6000 : 3500); };
    async function callFn(qs) {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(MP_CONFIG.fn('expiry-reversal') + qs, { method: 'POST', headers: { Authorization: 'Bearer ' + (session ? session.access_token : ''), apikey: MP_CONFIG.supabaseKey, 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
      return j;
    }

    function stateLine() {
      const today = istDay(), w = (D.watch || []).filter((x) => x.day === today), t = D.today, m = istNow().getUTCHours() * 60 + istNow().getUTCMinutes();
      if (t && t.status === 'OPEN') return ['live', 'Trade open'];
      if (t && t.status === 'SIGNAL') return ['warn', t.estimate ? 'Signal (estimate)' : 'Signal'];
      if (t) return ['', 'Done for today'];
      if (!w.length) return ['', 'No expiry today'];
      if (m < 720) return ['', 'Watching from 12:00'];
      if (m <= 842) return ['live', 'Watching'];
      return ['', 'No signal today'];
    }
    function renderTrade() {
      const t = D.today, el = q('trade');
      if (!t) { el.innerHTML = ''; return; }
      const open = t.status === 'OPEN', sig = t.status === 'SIGNAL', closed = t.status === 'CLOSED';
      const cost = num(t.entry) * num(t.qty), val = num(closed ? t.exit : t.mark) * num(t.qty);
      const pill = open ? '<span class="xd-pill live">Paper trade open</span>' : sig ? `<span class="xd-pill warn">${t.estimate ? 'Signal · estimated price' : 'Signal · not paper traded'}</span>` : `<span class="xd-pill ${num(t.pnl) >= 0 ? 'live' : 'bad'}">Closed · ${esc(t.exit_reason || '')}</span>`;
      const why = t.reasons || {};
      el.innerHTML = `<div class="xd-card xd-trade">
        <div class="xd-head"><div><div class="big">${esc(NAME[t.idx] || t.idx)} ${ix(t.strike)} ${esc(t.side)}</div>
          <div class="xd-msg">Buy ${t.side === 'CE' ? 'call' : 'put'} · ${num(t.lots)} lot${num(t.lots) === 1 ? '' : 's'} × ${num(t.lot_size)} = ${num(t.qty)} · expires today</div></div>${pill}</div>
        <div class="xd-grid">
          <div><span>Entry</span><b>${px(t.entry)}</b></div>
          <div><span>${closed ? 'Exit' : 'Now'}</span><b>${px(closed ? t.exit : t.mark)}</b></div>
          <div><span>P&amp;L</span><b class="${tone(t.pnl)}">${sInr(t.pnl)}</b></div>
          <div><span>Cost</span><b>${inr(cost)}</b></div>
          <div><span>Target</span><b class="up">${px(t.target)}</b></div>
          <div><span>Stop</span><b class="down">${px(t.stop)}</b></div>
          <div><span>${esc(NAME[t.idx] || t.idx)} stop</span><b>${t.side === 'CE' ? 'below' : 'above'} ${ix(t.pivot)}</b></div>
          <div><span>${esc(NAME[t.idx] || t.idx)} now</span><b>${ix(closed ? t.exit_spot : t.mark_spot)}</b></div>
        </div>
        <p class="xd-note">Why: ${esc(NAME[t.idx] || t.idx)} ${esc(why.dir || '')} ${num(why.movePct) ?? '—'}% (high ${ix(t.day_high)}, low ${ix(t.day_low)}), turned ${why.sinceMin ?? '—'} min after the ${t.side === 'CE' ? 'low' : 'high'} and won back ${why.wonBackPct ?? '—'}% · signal at ${hm(why.barClose)}${t.estimate ? ' · <b>Sensex option prices are estimates</b>: check the real price before you act' : ''}. Out by 3:00 PM.${!closed && t.marked_at ? ' Updated ' + new Date(t.marked_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + '.' : ''}</p>
        <div class="xd-bar">
          ${sig && !t.estimate ? '<button class="xd-btn primary" type="button" data-act="take">Paper trade it now</button>' : ''}
          ${open || sig ? `<button class="xd-btn danger" type="button" data-act="exit">${open ? 'Exit now' : 'Stop following'}</button>` : ''}
        </div></div>`;
    }
    function renderWatch() {
      const today = istDay(), w = (D.watch || []).filter((x) => x.day === today);
      q('watchCard').hidden = !w.length || !!D.today;
      if (!w.length) {
        const nx = nextExpiries();
        q('body').innerHTML = `<p class="xd-note">Nothing expires today. Next: ${nx.map(([i, d]) => `${esc(NAME[i])} ${fmtDay(d)}`).join(' · ')}.</p>`;
        return;
      }
      q('body').innerHTML = `<p class="xd-note">Expiring today: <b>${w.map((x) => esc(NAME[x.idx])).join(', ')}</b>. The check runs every minute from 11:30 AM; a signal can fire from 12:00 to 2:00 PM.</p>`;
      q('watchNote').textContent = 'updated ' + new Date(w[0].updated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      q('watch').innerHTML = w.map((x) => {
        const d = x.data || {};
        if (d.error) return `<div class="xd-w"><div class="top"><b>${esc(NAME[x.idx])}</b><span class="xd-pill bad">Data error</span></div><p class="xd-note">${esc(d.error)}</p></div>`;
        if (d.state) return `<div class="xd-w"><div class="top"><b>${esc(NAME[x.idx])}</b><span class="xd-pill">${esc(d.state)}</span></div></div>`;
        const up = d.dir === 'fell', side = up ? 'call' : 'put';
        const checks = [
          [num(d.movePct) >= 0.6, `${up ? 'Fell' : 'Rose'} ${num(d.movePct)}% (needs 0.6%)`],
          [num(d.sinceMin) >= 5 && num(d.sinceMin) <= 60, `${up ? 'Low' : 'High'} ${d.sinceMin} min ago (5–60)`],
          [num(d.wonBackPct) >= 20, `Won back ${d.wonBackPct}% (needs 20%)`],
          [!!d.three, `Three ${up ? 'rising' : 'falling'} closes`],
          [!!d.inWindow, `Bar at ${hm(d.barClose)} (12:00–2:00)`],
        ];
        const res = d.result ? (d.result.opened ? 'Signal fired' : d.result.skipped) : null;
        return `<div class="xd-w"><div class="top"><b>${esc(NAME[x.idx])} ${ix(d.last)}</b><span class="xd-pill ${d.signal ? 'live' : ''}">${d.signal ? 'Signal: buy ' + side : 'Watching for a ' + side}</span></div>
          <ul class="xd-checks">${checks.map(([ok, s]) => `<li class="${ok ? 'ok' : 'no'}"><i>${ok ? '✓' : '·'}</i><span>${esc(s)}</span></li>`).join('')}</ul>
          <p class="xd-note">Day high ${ix(d.dayHigh)} · low ${ix(d.dayLow)}${x.idx === 'SENSEX' ? ' · Sensex: estimated option prices' : ''}${res ? ' · ' + esc(res) : ''}</p></div>`;
      }).join('');
    }
    function renderRecord() {
      const s = D.stats || {}, n = num(s.n) || 0;
      q('statNote').textContent = 'paper trades on live NSE prices (Sensex estimates left out)';
      q('stats').innerHTML = `
        <div><span>Trades</span><b>${n}</b></div>
        <div><span>Winners</span><b>${n ? `${s.wins} (${Math.round(s.wins / n * 100)}%)` : '—'}</b></div>
        <div><span>Net P&amp;L</span><b class="${tone(s.pnl)}">${sInr(s.pnl)}</b></div>
        <div><span>Best · worst</span><b>${n ? sInr(s.best) + ' · ' + sInr(s.worst) : '—'}</b></div>`;
      const h = (D.history || []).filter((t) => t.status !== 'OPEN' || t.day !== istDay());
      q('hist').innerHTML = h.length ? `<thead><tr><th>Day</th><th>Option</th><th class="n">In</th><th class="n">Out</th><th class="n">P&amp;L</th><th>Exit</th></tr></thead><tbody>${h.map((t) => `<tr>
        <td>${fmtDay(t.day)}</td><td>${esc(NAME[t.idx] || t.idx)} ${ix(t.strike)} ${esc(t.side)}${t.estimate ? ' <span class="xd-pill warn">est.</span>' : t.status === 'SIGNAL' ? ' <span class="xd-pill">signal</span>' : ''}</td>
        <td class="n">${px(t.entry)}</td><td class="n">${px(t.exit ?? t.mark)}</td><td class="n ${tone(t.pnl)}">${sInr(t.pnl)}</td><td>${esc(t.exit_reason || (t.status === 'CLOSED' ? '' : 'open'))}</td></tr>`).join('')}</tbody>`
        : '<tbody><tr><td class="xd-msg">No trades yet. The first one can come on the next expiry day.</td></tr></tbody>';
    }
    function fillForm() {
      const s = D.settings || {}, f = q('form');
      f.budget.value = num(s.budget) ?? 1000; f.min.value = num(s.min_prem) ?? 4; f.max.value = num(s.max_prem) ?? 12; f.auto.checked = s.auto_paper !== false;
      formFilled = true;
    }
    async function refresh() {
      try {
        const { data, error } = await sb.rpc('expiry_desk');
        if (error) throw error;
        D = data || {};
        const [cls, txt] = stateLine(); const p = q('state'); p.className = 'xd-pill ' + cls; p.textContent = txt;
        renderWatch(); renderTrade(); renderRecord();
        const ae = document.activeElement;
        if (!formFilled || !(ae && q('form').contains(ae))) fillForm();
      } catch (e) { q('body').innerHTML = `<p class="xd-note">Could not load: ${esc(e.message)}</p>`; }
    }
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const t = D && D.today; if (!t) return;
      if (b.dataset.act === 'exit') {
        if (!confirm(t.status === 'OPEN' ? `Exit ${NAME[t.idx]} ${ix(t.strike)} ${t.side} now at the bid? Marked P&L ${sInr(t.pnl)}.` : 'Stop following this signal?')) return;
        b.disabled = true;
        try { const r = await callFn('?action=exit'); toast(r.closed ? `Closed: ${sInr(r.closed.pnl)}` : (r.note || 'Done')); }
        catch (err) { toast('Exit failed: ' + err.message, true); }
        refresh();
      } else if (b.dataset.act === 'take') {
        if (!confirm(`Paper trade ${NAME[t.idx]} ${ix(t.strike)} ${t.side} now at the current ask? The target and stop are reset from that price.`)) return;
        b.disabled = true;
        try { const r = await callFn('?action=take'); toast(`Paper traded at ${px(r.taken.price)} × ${r.taken.qty}.`); }
        catch (err) { toast(err.message, true); }
        refresh();
      }
    });
    q('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, budget = Number(f.budget.value.replace(/[,₹\s]/g, '')), mn = Number(f.min.value), mx = Number(f.max.value);
      if (!(budget >= 100 && mn > 0 && mx > mn)) { toast('Budget at least ₹100, and max premium above min.', true); return; }
      try { await sb.rpc('expiry_settings_save', { p_auto: f.auto.checked, p_budget: budget, p_min: mn, p_max: mx }).then((r) => { if (r.error) throw r.error; }); toast('Saved.'); formFilled = false; refresh(); }
      catch (err) { toast('Could not save: ' + err.message, true); }
    });
    refresh();
    setInterval(() => { if (!document.hidden && root.offsetParent !== null) refresh(); }, 30000);
    return { refresh };
  }
  window.mpExpiryDesk = { mount, nextExpiries };
})();
