/* Today's best 3 (Signals tab, platform admin only): from all active scanner signals, the three best trades for today
   and how many shares of each to buy for the amount entered.
   Ranking: signal_best_trades() (supabase/best-trades.sql): the same tradable filters and quality score as Top
   Signals, minus signals whose own news goes against them, minus 10 for trading against the Nifty's trend.
   Here: one pick per sector group, then sizing. Each pick gets an equal share of the amount, capped so that its stop
   loses at most the chosen % of the amount; a stock too expensive for its share is skipped for the next one.
   window.mpBestTrades.mount(host, sb). */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const fmt = (n, d = 2) => n === null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const inr = (n, d = 0) => n === null ? '—' : (n < 0 ? '−₹' : '₹') + fmt(Math.abs(n), d);
  const pct = (v, d = 1) => v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
  const KEY = 'mp-best3';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (_) { /* ignore */ } };
  const SLOTS = 3;

  function plan(picks, amount, riskPct) {
    const slot = amount / SLOTS, riskCap = amount * riskPct / 100, used = new Set(), out = [], skipped = [];
    for (const p of picks) {
      if (out.length >= SLOTS) break;
      const g = p.grp || p.symbol;
      if (used.has(g)) { skipped.push({ p, why: 'same sector as a pick above' }); continue; }
      const px = num(p.ltp), stop = num(p.stop), risk = Math.abs(px - stop);
      if (!(px > 0) || !(risk > 0)) continue;
      const byCash = Math.floor(slot / px), byRisk = Math.floor(riskCap / risk), qty = Math.min(byCash, byRisk);
      if (qty < 1) { skipped.push({ p, why: byCash < 1 ? `one share (${inr(px)}) is more than its ${inr(slot)} share` : 'its stop is too wide for the risk limit' }); continue; }
      used.add(g);
      const dir = p.side === 'SELL' ? -1 : 1, t1 = num(p.target1), t2 = num(p.target2);
      out.push({ p, qty, cost: qty * px, loss: qty * risk, gain1: t1 ? qty * dir * (t1 - px) : null, gain2: t2 ? qty * dir * (t2 - px) : null, cappedByRisk: byRisk < byCash });
    }
    return { out, skipped, slot, riskCap };
  }

  function mount(host, sb) {
    const st = Object.assign({ amount: 50000, risk: 1, tf: 'swing', sell: false }, load());
    let D = null, busy = false, timer = null;
    host.innerHTML = `<div class="card bt">
      <div class="bt-h"><h3>⭐ Today’s best 3</h3><span class="bt-admin">admin only</span></div>
      <div class="bt-form">
        <label><span>Amount to invest today (₹)</span><input id="btAmt" type="number" min="1000" step="1000" inputmode="decimal" value="${esc(st.amount)}"></label>
        <label><span>Max loss per trade (% of amount)</span><input id="btRisk" type="number" min="0.25" max="5" step="0.25" inputmode="decimal" value="${esc(st.risk)}"></label>
        <div class="seg" id="btTf"><button data-v="swing" class="${st.tf === 'swing' ? 'on' : ''}">Swing</button><button data-v="intraday" class="${st.tf === 'intraday' ? 'on' : ''}">Intraday</button></div>
        <label class="bt-chk" ${st.tf === 'intraday' ? '' : 'hidden'}><input id="btSell" type="checkbox" ${st.sell ? 'checked' : ''}> Include sell (short) trades</label>
      </div>
      <div id="btOut"><div class="note">Picking…</div></div></div>`;
    const $ = (id) => host.querySelector('#' + id);

    function render() {
      const box = $('btOut'); if (!box) return;
      if (!D) { box.innerHTML = '<div class="note">Picking…</div>'; return; }
      const amount = num($('btAmt').value), risk = num($('btRisk').value);
      if (!(amount >= 1000) || !(risk > 0 && risk <= 5)) { box.innerHTML = '<div class="note warn">Enter an amount of ₹1,000 or more and a max loss between 0.25% and 5%.</div>'; return; }
      const { out, skipped, slot, riskCap } = plan(D.picks || [], amount, risk);
      if (!out.length) { box.innerHTML = `<div class="empty"><b>No trade fits right now</b><br>${D.tradable ? 'The tradable signals are too expensive for a ' + inr(slot) + ' share or need a wider stop than your limit allows.' : `None of the ${D.active} active ${esc(D.tf)} signals is in a tradable spot at the moment (price between stop and target, close to entry). Check again later.`}</div>`; return; }
      const tot = out.reduce((a, x) => ({ cost: a.cost + x.cost, loss: a.loss + x.loss, g1: a.g1 + (x.gain1 || 0) }), { cost: 0, loss: 0, g1: 0 });
      const buy = (x) => x.p.side === 'SELL' ? 'Sell short' : 'Buy';
      box.innerHTML = `<div class="bt-sum">
          <div><small>Invest</small><b>${inr(tot.cost)}</b></div><div><small>Cash left</small><b>${inr(amount - tot.cost)}</b></div>
          <div><small>If every stop hits</small><b class="down">${inr(-tot.loss)}</b></div><div><small>If every target 1 hits</small><b class="up">${inr(tot.g1)}</b></div></div>
        <div class="bt-list">${out.map((x, i) => { const p = x.p, px = num(p.ltp);
          return `<article class="bt-pick">
            <div class="bt-top"><span class="bt-n">${i + 1}</span><div class="bt-name"><b data-sym="${esc(p.symbol)}">${esc(p.symbol)}</b> <span class="tag ${p.side === 'SELL' ? 'sell' : 'buy'}">${esc(p.side)}</span><small>${esc(p.name || '')}${p.grp ? ' · ' + esc(p.grp) : ''}</small></div><span class="bt-q" title="Quality score">${esc(p.quality)}</span></div>
            <div class="bt-act">${buy(x)} <b>${x.qty}</b> share${x.qty === 1 ? '' : 's'} at about <b>${inr(px, 2)}</b> = ${inr(x.cost)}</div>
            <div class="bt-kv">
              <div><small>Stop loss</small><b class="down">${inr(num(p.stop), 2)}</b><em>${inr(-x.loss)}</em></div>
              <div><small>Target 1</small><b class="up">${inr(num(p.target1), 2)}</b><em>${x.gain1 === null ? '' : inr(x.gain1)}</em></div>
              <div><small>Target 2</small><b class="up">${num(p.target2) ? inr(num(p.target2), 2) : '—'}</b><em>${x.gain2 === null ? '' : inr(x.gain2)}</em></div></div>
            <div class="tags">${(p.strengths || []).map((s) => `<span class="tag">${esc(s)}</span>`).join('')}<span class="tag">${esc(p.setup || '')}</span>${x.cappedByRisk ? '<span class="tag">Size cut to your loss limit</span>' : ''}</div>
          </article>`; }).join('')}</div>
        ${out.length < SLOTS ? `<div class="note">Only ${out.length} trade${out.length === 1 ? '' : 's'} fit${out.length === 1 ? 's' : ''} your amount and limits right now, so the rest stays in cash.</div>` : ''}
        <div class="bt-foot"><button class="btn" type="button" id="btCopy">Copy orders</button><span class="note">From ${D.tradable} tradable of ${D.active} active ${esc(D.tf)} signals · each pick gets up to ${inr(slot)} and risks at most ${inr(riskCap)} · updated ${new Date(D.server_now).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}</span></div>
        ${skipped.length ? `<details class="bt-skip"><summary>Skipped higher-ranked signals (${skipped.length})</summary><ul>${skipped.slice(0, 6).map((s) => `<li><b>${esc(s.p.symbol)}</b> (quality ${esc(s.p.quality)}): ${esc(s.why)}</li>`).join('')}</ul></details>` : ''}
        <p class="note">Ranked by the scanner’s quality score, signals whose own news is against them left out, trades against the Nifty’s trend marked down, one per sector. Prices move: buy near the shown price and place the stop loss with the order. For your own use; not investment advice.</p>`;
      $('btCopy').onclick = async () => {
        const txt = out.map((x) => `${x.p.side} ${x.qty} ${x.p.symbol} @ ~${fmt(num(x.p.ltp))} | SL ${fmt(num(x.p.stop))} | T1 ${fmt(num(x.p.target1))}${num(x.p.target2) ? ' | T2 ' + fmt(num(x.p.target2)) : ''}`).join('\n');
        try { await navigator.clipboard.writeText(txt); $('btCopy').textContent = 'Copied'; setTimeout(() => { const b = $('btCopy'); if (b) b.textContent = 'Copy orders'; }, 1500); } catch (_) { /* ignore */ }
      };
    }
    async function fetchPicks() {
      if (busy) return; busy = true;
      try {
        const { data, error } = await sb.rpc('signal_best_trades', { p_tf: st.tf, p_include_sell: st.tf === 'intraday' && st.sell, p_limit: 15 });
        if (error) throw error;
        D = data;
      } catch (e) { $('btOut').innerHTML = '<div class="note warn">Could not load today’s picks. Try again in a minute.</div>'; busy = false; return; }
      busy = false; render();
    }
    const changed = () => { st.amount = num($('btAmt').value) || st.amount; st.risk = num($('btRisk').value) || st.risk; st.sell = $('btSell').checked; save(st); render(); };
    $('btAmt').addEventListener('input', changed); $('btRisk').addEventListener('input', changed);
    $('btSell').addEventListener('change', () => { changed(); fetchPicks(); });
    $('btTf').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.tf = b.dataset.v; save(st);
      $('btTf').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); host.querySelector('.bt-chk').hidden = st.tf !== 'intraday'; D = null; render(); fetchPicks(); });
    fetchPicks();
    timer = setInterval(() => { if (!document.hidden && host.offsetParent !== null) fetchPicks(); }, 120e3);
  }
  window.mpBestTrades = { mount };
})();
