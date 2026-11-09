/* Today's best picks (Signals tab, platform admin only): from all active scanner signals, the N best trades for today
   (1-5, chosen by the user), how many shares of each to buy for the amount entered, editable quantities, and paper
   trading of one pick or all of them through the Signals page's paper account.
   Ranking: signal_best_trades() (supabase/best-trades.sql): the same tradable filters and quality score as Top
   Signals, minus signals whose own news goes against them, minus 10 for trading against the Nifty's trend.
   Here: one pick per sector group, then sizing. Each pick gets an equal share (amount / N). "Loss limit" (default) caps
   it so that its stop loses at most the chosen % of the amount, and says so with a one-tap "use the full share";
   "Full amount" spends the whole share. A stock too expensive for its share is skipped for the next one. The
   quantity can then be changed with − / + or typed; totals follow, with a warning past the amount or the loss limit.
   window.mpBestTrades.mount(host, sb, paper) where paper = { place(items) -> Promise, held(symbol) -> bool }. */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const fmt = (n, d = 2) => n === null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const inr = (n, d = 0) => n === null ? '—' : (n < 0 ? '−₹' : '₹') + fmt(Math.abs(n), d);
  const KEY = 'mp-best3';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (_) { /* ignore */ } };

  // which signals, and the suggested quantity of each
  function plan(picks, amount, riskPct, n, mode) {
    const slot = amount / n, riskCap = amount * riskPct / 100, used = new Set(), out = [], skipped = [];
    for (const p of picks) {
      if (out.length >= n) break;
      const g = p.grp || p.symbol;
      if (used.has(g)) { skipped.push({ p, why: 'same sector as a pick above' }); continue; }
      const px = num(p.ltp), risk = Math.abs(px - num(p.stop));
      if (!(px > 0) || !(risk > 0)) continue;
      const byCash = Math.floor(slot / px), byRisk = Math.floor(riskCap / risk), qty = mode === 'full' ? byCash : Math.min(byCash, byRisk);
      if (qty < 1) { skipped.push({ p, why: byCash < 1 ? `one share (${inr(px)}) is more than its ${inr(slot)} share` : `its stop (${inr(risk, 2)} a share) loses more than your ${inr(riskCap)} limit even for 1 share` }); continue; }
      used.add(g);
      out.push({ p, sug: qty, byCash, byRisk, riskPer: risk, cappedByRisk: mode !== 'full' && byRisk < byCash });
    }
    return { out, skipped, slot, riskCap };
  }
  const outcome = (p, qty) => {
    const px = num(p.ltp), dir = p.side === 'SELL' ? -1 : 1, t1 = num(p.target1), t2 = num(p.target2);
    return { cost: qty * px, loss: qty * Math.abs(px - num(p.stop)), gain1: t1 ? qty * dir * (t1 - px) : null, gain2: t2 ? qty * dir * (t2 - px) : null };
  };

  function mount(host, sb, paper) {
    const st = Object.assign({ amount: 50000, risk: 1, tf: 'swing', sell: false, n: 3, mode: 'risk' }, load());
    let D = null, busy = false, edits = {}, P = null; // edits: symbol -> quantity chosen by hand
    host.innerHTML = `<div class="card bt">
      <div class="bt-h"><h3>⭐ Today’s best picks</h3><span class="bt-admin">admin only</span></div>
      <div class="bt-form">
        <label><span>Amount to invest today (₹)</span><input id="btAmt" type="number" min="1000" step="1000" inputmode="decimal" value="${esc(st.amount)}"></label>
        <label><span>Max loss per trade (% of amount)</span><input id="btRisk" type="number" min="0.25" max="5" step="0.25" inputmode="decimal" value="${esc(st.risk)}"></label>
        <div class="bt-row"><span class="bt-lbl">Size by</span><div class="seg" id="btMode"><button data-v="risk" class="${st.mode !== 'full' ? 'on' : ''}">Loss limit</button><button data-v="full" class="${st.mode === 'full' ? 'on' : ''}">Full amount</button></div></div>
        <div class="bt-row"><span class="bt-lbl">How many trades</span><div class="seg" id="btN">${[1, 2, 3, 4, 5].map((k) => `<button data-v="${k}" class="${k === st.n ? 'on' : ''}">${k}</button>`).join('')}</div></div>
        <div class="seg" id="btTf"><button data-v="swing" class="${st.tf === 'swing' ? 'on' : ''}">Swing</button><button data-v="intraday" class="${st.tf === 'intraday' ? 'on' : ''}">Intraday</button></div>
        <label class="bt-chk" ${st.tf === 'intraday' ? '' : 'hidden'}><input id="btSell" type="checkbox" ${st.sell ? 'checked' : ''}> Include sell (short) trades</label>
      </div>
      <div id="btOut"><div class="note">Picking…</div></div></div>`;
    const $ = (id) => host.querySelector('#' + id);
    const qtyOf = (x) => { const e = num(edits[x.p.symbol]); return e !== null && e >= 0 ? Math.floor(e) : x.sug; };

    // the totals and each card's figures, without rebuilding the inputs (keeps focus while typing)
    function refresh() {
      if (!P) return;
      const amount = num($('btAmt').value), riskCap = P.riskCap;
      let cost = 0, loss = 0, g1 = 0;
      P.out.forEach((x) => {
        const q = qtyOf(x), o = outcome(x.p, q), card = host.querySelector(`[data-pick="${CSS.escape(x.p.symbol)}"]`); if (!card) return;
        cost += o.cost; loss += o.loss; g1 += o.gain1 || 0;
        card.querySelector('.bt-cost').textContent = inr(o.cost);
        card.querySelector('.bt-loss').textContent = inr(-o.loss);
        card.querySelector('.bt-g1').textContent = o.gain1 === null ? '' : inr(o.gain1);
        card.querySelector('.bt-g2').textContent = o.gain2 === null ? '' : inr(o.gain2);
        card.querySelector('.bt-edited').hidden = q === x.sug;
        const over = o.loss > riskCap * 1.001;
        card.querySelector('.bt-warn').textContent = q < 1 ? 'Quantity 0: this pick is left out of paper trades.' : over ? `Its stop now loses ${inr(o.loss)}, above your ${inr(riskCap)} limit.` : '';
        const pb = card.querySelector('[data-paper]'); if (pb && !pb.dataset.done) pb.disabled = q < 1 || (paper && paper.held(x.p.symbol));
      });
      host.querySelector('.bt-sum').innerHTML = `<div><small>Invest</small><b>${inr(cost)}</b></div><div><small>${cost > amount ? 'Over your amount by' : 'Cash left'}</small><b class="${cost > amount ? 'down' : ''}">${inr(Math.abs(amount - cost))}</b></div>
        <div><small>If every stop hits</small><b class="down">${inr(-loss)}</b>${amount ? `<em class="bt-pctof">${(loss / amount * 100).toFixed(1)}% of the amount</em>` : ''}</div><div><small>If every target 1 hits</small><b class="up">${inr(g1)}</b></div>`;
      const all = $('btPaperAll'); if (all && !all.dataset.done) { const n = P.out.filter((x) => qtyOf(x) > 0 && !(paper && paper.held(x.p.symbol))).length; all.disabled = !n; all.textContent = n ? `Paper trade ${n === P.out.length ? 'all ' : ''}${n}` : 'All in your paper account'; }
    }

    function render() {
      const box = $('btOut'); if (!box) return;
      if (!D) { box.innerHTML = '<div class="note">Picking…</div>'; return; }
      const amount = num($('btAmt').value), risk = num($('btRisk').value);
      if (!(amount >= 1000) || !(risk > 0 && risk <= 5)) { P = null; box.innerHTML = '<div class="note warn">Enter an amount of ₹1,000 or more and a max loss between 0.25% and 5%.</div>'; return; }
      P = plan(D.picks || [], amount, risk, st.n, st.mode);
      const { out, skipped, slot, riskCap } = P;
      if (!out.length) { box.innerHTML = `<div class="empty"><b>No trade fits right now</b><br>${D.tradable ? 'The tradable signals are too expensive for a ' + inr(slot) + ' share or need a wider stop than your limit allows.' : `None of the ${D.active} active ${esc(D.tf)} signals is in a tradable spot at the moment (price between stop and target, close to entry). Check again later.`}</div>`; return; }
      const verb = (p) => p.side === 'SELL' ? 'Sell short' : 'Buy';
      box.innerHTML = `<div class="bt-sum"></div>
        <div class="bt-list">${out.map((x, i) => { const p = x.p, px = num(p.ltp), held = paper && paper.held(p.symbol);
          return `<article class="bt-pick" data-pick="${esc(p.symbol)}">
            <div class="bt-top"><span class="bt-n">${i + 1}</span><div class="bt-name"><b data-sym="${esc(p.symbol)}">${esc(p.symbol)}</b> <span class="tag ${p.side === 'SELL' ? 'sell' : 'buy'}">${esc(p.side)}</span><small>${esc(p.name || '')}${p.grp ? ' · ' + esc(p.grp) : ''}</small></div><span class="bt-q" title="Quality score">${esc(p.quality)}</span></div>
            <div class="bt-act"><span>${verb(p)}</span>
              <span class="bt-qty"><button type="button" data-step="-1" aria-label="One less">−</button><input type="number" min="0" step="1" inputmode="numeric" value="${qtyOf(x)}" data-qty aria-label="Quantity of ${esc(p.symbol)}"><button type="button" data-step="1" aria-label="One more">+</button></span>
              <span>at about <b>${inr(px, 2)}</b> = <b class="bt-cost"></b></span></div>
            ${x.cappedByRisk ? `<div class="bt-why">Cut to ${x.sug} share${x.sug === 1 ? '' : 's'}: your ${esc(st.risk)}% loss limit is ${inr(riskCap)} and its stop is ${inr(x.riskPer, 2)} a share away. <button type="button" class="bt-full" data-full="${x.byCash}">Use ${inr(slot)}: ${x.byCash} shares (risks ${inr(x.byCash * x.riskPer)}, ${(x.byCash * x.riskPer / amount * 100).toFixed(1)}% of the amount)</button></div>` : ''}
            <div class="bt-sub"><span class="bt-edited" hidden>Changed from the suggested ${x.sug} · <button type="button" class="bt-reset" data-reset>reset</button></span><span class="bt-warn"></span></div>
            <div class="bt-kv">
              <div><small>Stop loss</small><b class="down">${inr(num(p.stop), 2)}</b><em class="bt-loss"></em></div>
              <div><small>Target 1</small><b class="up">${inr(num(p.target1), 2)}</b><em class="bt-g1"></em></div>
              <div><small>Target 2</small><b class="up">${num(p.target2) ? inr(num(p.target2), 2) : '—'}</b><em class="bt-g2"></em></div></div>
            <div class="tags">${(p.strengths || []).map((s) => `<span class="tag">${esc(s)}</span>`).join('')}<span class="tag">${esc(p.setup || '')}</span></div>
            <div class="bt-pact"><button class="btn sm" type="button" data-paper ${held ? 'disabled data-done="1"' : ''}>${held ? 'In your paper account' : '📄 Paper trade'}</button></div>
          </article>`; }).join('')}</div>
        ${out.length < st.n ? `<div class="note">Only ${out.length} trade${out.length === 1 ? '' : 's'} fit${out.length === 1 ? 's' : ''} your amount and limits right now, so the rest stays in cash.</div>` : ''}
        <div class="bt-foot"><button class="btn primary" type="button" id="btPaperAll">Paper trade all</button><button class="btn" type="button" id="btCopy">Copy orders</button>
          <span class="note">From ${D.tradable} tradable of ${D.active} active ${esc(D.tf)} signals · each pick gets up to ${inr(slot)} and risks at most ${inr(riskCap)} · updated ${new Date(D.server_now).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}</span></div>
        ${skipped.length ? `<details class="bt-skip"><summary>Skipped higher-ranked signals (${skipped.length})</summary><ul>${skipped.slice(0, 6).map((s) => `<li><b>${esc(s.p.symbol)}</b> (quality ${esc(s.p.quality)}): ${esc(s.why)}</li>`).join('')}</ul></details>` : ''}
        <p class="note">Ranked by the scanner’s quality score, signals whose own news is against them left out, trades against the Nifty’s trend marked down, one per sector. “Loss limit” sizes each trade so its stop loses at most your % of the amount (the usual rule is 1–2%); “Full amount” spends each trade’s share of the money whatever the stop costs. Paper trades fill at the last price in your Signals paper account; stops and targets are then managed like any other paper trade. Prices move: when trading for real, buy near the shown price and place the stop loss with the order. For your own use; not investment advice.</p>`;
      refresh();
    }

    async function doPaper(list, btn) {
      if (!paper || !list.length) return;
      btn.disabled = true; const label = btn.textContent; btn.textContent = 'Placing…';
      const res = await paper.place(list.map((x) => ({ s: x.p, qty: qtyOf(x) })));
      btn.textContent = label; render();
      return res;
    }
    host.addEventListener('click', (e) => {
      const step = e.target.closest('[data-step]'), reset = e.target.closest('[data-reset]'), one = e.target.closest('[data-paper]');
      const card = e.target.closest('[data-pick]'), x = card && P && P.out.find((y) => y.p.symbol === card.dataset.pick);
      const full = e.target.closest('[data-full]');
      if (full && x) { const q = Number(full.dataset.full); edits[x.p.symbol] = q; card.querySelector('[data-qty]').value = q; refresh(); return; }
      if (step && x) { const q = Math.max(0, qtyOf(x) + Number(step.dataset.step)); edits[x.p.symbol] = q; card.querySelector('[data-qty]').value = q; refresh(); }
      else if (reset && x) { delete edits[x.p.symbol]; card.querySelector('[data-qty]').value = x.sug; refresh(); }
      else if (one && x && !one.disabled) doPaper([x], one);
      else if (e.target.id === 'btPaperAll' && P) {
        const list = P.out.filter((y) => qtyOf(y) > 0 && !(paper && paper.held(y.p.symbol)));
        const cost = list.reduce((a, y) => a + outcome(y.p, qtyOf(y)).cost, 0);
        if (list.length && confirm(`Paper trade ${list.length} pick${list.length === 1 ? '' : 's'} for about ${inr(cost)}?\n\n` + list.map((y) => `${y.p.side} ${qtyOf(y)} ${y.p.symbol} @ ~${fmt(num(y.p.ltp))}`).join('\n'))) doPaper(list, e.target);
      } else if (e.target.id === 'btCopy' && P) {
        const txt = P.out.filter((y) => qtyOf(y) > 0).map((y) => `${y.p.side} ${qtyOf(y)} ${y.p.symbol} @ ~${fmt(num(y.p.ltp))} | SL ${fmt(num(y.p.stop))} | T1 ${fmt(num(y.p.target1))}${num(y.p.target2) ? ' | T2 ' + fmt(num(y.p.target2)) : ''}`).join('\n');
        navigator.clipboard.writeText(txt).then(() => { e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy orders'; }, 1500); }).catch(() => {});
      }
    });
    host.addEventListener('input', (e) => {
      const inp = e.target.closest('[data-qty]'); if (!inp) return;
      const card = inp.closest('[data-pick]'), q = num(inp.value); edits[card.dataset.pick] = q === null ? 0 : Math.max(0, Math.floor(q)); refresh();
    });

    async function fetchPicks() {
      if (busy) return; busy = true;
      try {
        const { data, error } = await sb.rpc('signal_best_trades', { p_tf: st.tf, p_include_sell: st.tf === 'intraday' && st.sell, p_limit: 20 });
        if (error) throw error;
        D = data;
      } catch (e) { $('btOut').innerHTML = '<div class="note warn">Could not load today’s picks. Try again in a minute.</div>'; busy = false; return; }
      busy = false;
      // don't rebuild under the user's fingers: a refresh while editing only updates prices on the next render
      if (!host.contains(document.activeElement) || document.activeElement === document.body) render();
    }
    const settings = (resetEdits) => { st.amount = num($('btAmt').value) || st.amount; st.risk = num($('btRisk').value) || st.risk; st.sell = $('btSell').checked; save(st); if (resetEdits) edits = {}; render(); };
    $('btAmt').addEventListener('change', () => settings(true)); $('btRisk').addEventListener('change', () => settings(true));
    $('btSell').addEventListener('change', () => { settings(true); fetchPicks(); });
    $('btMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.mode = b.dataset.v; $('btMode').querySelectorAll('button').forEach((y) => y.classList.toggle('on', y === b)); settings(true); });
    $('btN').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.n = Number(b.dataset.v); $('btN').querySelectorAll('button').forEach((y) => y.classList.toggle('on', y === b)); settings(true); });
    $('btTf').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.tf = b.dataset.v; save(st); edits = {};
      $('btTf').querySelectorAll('button').forEach((y) => y.classList.toggle('on', y === b)); host.querySelector('.bt-chk').hidden = st.tf !== 'intraday'; D = null; render(); fetchPicks(); });
    fetchPicks();
    setInterval(() => { if (!document.hidden && host.offsetParent !== null) fetchPicks(); }, 120e3);
    // the page calls this after its trades change: rebuild (for the paper buttons) unless the user is typing in here
    return { refresh: () => { if (host.contains(document.activeElement) && document.activeElement !== document.body) refresh(); else render(); } };
  }
  window.mpBestTrades = { mount };
})();
