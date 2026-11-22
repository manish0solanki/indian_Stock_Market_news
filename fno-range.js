/* F&O page: "This week's expected range" card (fno-range.js).
   The ATM call + put (straddle) is the option market's own estimate of the move to expiry; 1.5x the straddle around
   spot is the range Nifty closed inside on about 8 of 10 weekly expiries. Tested on NSE's closing option prices for
   every weekly Nifty expiry from Feb 2019 to Nov 2026 (389 weeks, straddle taken 4 trading days before expiry, 3 in
   holiday weeks): closed inside 1.5x on 306 (79%), above 42, below 41; the week's high or low went past an edge in
   139 weeks (36%). "Your target" uses the same 389 weeks: how often Nifty closed at or beyond that many straddles
   from spot, and how often it touched that level during the week. A range for the size of the move, not a direction,
   and not a trade call. window.mpRange.render(hostElement, optionChainData, indexName). */
(function () {
  'use strict';
  if (window.mpRange) return;
  // 389 weekly Nifty expiries, 2019-02-21 to 2026-11-17: (expiry close − spot) / straddle, and the week's high above / low below spot in straddles
  const H = { n: 389, from: "Feb 2019", to: "Nov 2026",
    close: [0.43,0.01,1.4,2.49,0.73,0.81,-0.56,-0.55,0.89,0.41,-3.43,-0.11,0.51,0.6,-0.51,0.32,0.07,0.78,1.05,-1.65,0.39,-1.24,-2.46,0.2,-1.84,0.23,-2.88,1.6,-1.11,0.34,1.5,-0.48,2.04,0.77,-0.26,0.52,1.74,-0.29,0.38,1.2,-1.29,0.36,-0.09,0.69,-1.37,-1.67,0.6,0.56,-0.23,-1.11,0.2,-4.71,-0.14,2.26,-0.27,-0.35,-0.09,1.71,-0.91,0.39,0.16,0.63,0.9,-0.13,1.49,-0.42,0.58,0.43,0.66,1.09,-0.7,0.51,0.26,-3.54,1.74,2.04,-1.05,0.6,-1.29,1.56,1.88,0.25,0.62,0.76,1.18,1.08,-0.06,0.62,0.57,1.13,0.55,-1.98,2.91,0.81,-0.18,0.44,1.35,0.65,-1.45,-1.26,1.27,0.92,-0.97,-0.75,1.67,0.28,-0.5,0.9,0.7,1.18,0.34,-0.6,0.52,-0.98,0.04,1.34,-0.66,-0.5,3.18,0.73,0.24,0.95,2.83,0.22,1.74,1.16,-0.98,1.0,2.02,-1.46,-0.95,-0.18,-1.51,0.52,1.14,1.09,-1.05,0.3,0.76,1.6,1.61,-1.97,-1.73,0.93,0.3,-0.24,-2.69,-0.33,0.71,1.45,0.28,0.87,-0.11,-1.21,0.87,0.25,-1.46,-1.67,0.08,-0.27,0.85,-0.34,-2.73,0.69,0.26,1.25,-1.06,2.3,0.83,0.9,0.93,1.2,-0.91,-0.06,0.83,0.16,0.3,-1.41,0.78,-1.07,1.33,0.71,1.05,-0.39,-0.03,0.86,1.64,-0.42,-0.42,-0.68,1.48,-0.51,-0.01,0.71,-0.74,0.02,0.16,0.96,-2.25,-0.71,-0.03,-2.12,-0.1,0.62,1.19,1.49,-0.58,1.88,1.42,1.3,-1.04,0.71,-0.07,0.6,0.75,-0.35,1.89,0.46,2.5,-0.39,-1.38,0.15,-0.37,0.44,-0.06,1.72,1.62,-2.57,-0.82,-0.55,0.81,-0.66,-3.59,0.4,0.9,2.07,0.36,2.17,2.61,1.03,-0.84,1.77,-0.27,-0.29,-1.62,-0.92,-0.11,-0.44,0.42,0.58,-0.78,0.49,-0.79,-0.04,0.98,0.24,1.04,-2.19,1.33,0.88,-1.83,1.17,1.88,-1.52,0.34,0.26,0.43,2.09,0.98,-0.03,1.26,-0.27,0.65,-1.95,-0.77,1.02,1.27,-0.38,1.69,0.23,1.54,-3.61,-0.04,-0.75,-1.69,0.08,-0.26,-2.09,0.02,1.87,-0.36,-2.83,0.44,1.33,-1.53,-0.37,0.01,0.47,0.41,-1.75,-0.05,-0.88,1.43,-0.57,3.01,0.95,-1.14,-2.11,2.06,0.49,0.87,-0.22,2.26,-1.16,-0.05,0.0,-0.34,0.21,1.38,-0.84,-0.39,-0.16,0.37,-0.28,0.1,1.02,0.95,-1.62,0.69,1.22,-0.77,-2.11,1.42,0.5,0.25,-1.58,0.87,0.13,-0.58,-0.65,-0.59,0.4,1.55,-1.17,0.25,-2.14,-1.74,0.06,0.92,0.5,-0.94,-1.51,-2.09,-0.35,-0.49,-2.01,0.72,-0.36,0.78,-0.86,-0.38,-2.47,0.47,0.62,-1.4,-0.42,2.24,-0.87,-0.56,1.34,0.45,0.35,-0.04,1.4,-0.55,-1.14,1.09,-0.7,-1.1,-1.28,0.37,-3.45,0.57,0.43,0.96,-0.19,3.12,3.33,0.29],
    up: [0.56,1.09,1.62,2.81,1.0,0.95,0.73,0.35,1.72,1.77,0,0.11,1.29,0.73,1.17,0.95,0.16,1.25,1.2,0,1.37,0,0.22,0.34,0.59,0.87,0,2.27,0.23,0.83,1.57,0.32,2.51,0.83,0.27,1.02,1.8,0.62,0.63,1.26,0.14,0.44,0,0.92,0.62,0,0.67,0.97,0.33,0.3,0.67,0,0.0,2.35,0.44,1.07,0.12,2.27,0.71,0.45,1.11,0.81,1.05,0.58,1.6,0.67,0.83,0.8,1.39,1.42,0.85,0.57,0.79,0.15,1.79,2.47,0.5,1.15,0.06,1.6,2.23,1.17,1.38,1.14,1.56,1.23,0.09,0.86,1.14,1.39,1.12,0.42,2.95,1.08,1.07,0.74,1.82,0.78,0.06,0.4,1.33,1.35,0,0,2.12,0.33,0.57,1.82,0.9,1.24,0.65,0.56,1.04,0.3,1.25,1.51,0,0.24,3.51,0.8,1.04,1.34,2.89,0.55,1.83,1.26,0.38,1.36,2.08,0.62,0.84,0.8,0.48,0.79,1.2,1.18,0.51,0.46,1.08,2.41,1.67,0.38,0,1.4,0.41,0.39,0.2,0.33,1.04,1.57,0.86,1.14,1.62,0,0.96,0.52,0.11,0,1.74,0.42,1.05,0.09,0,1.09,0.74,1.3,0.11,2.39,0.9,1.34,1.15,1.26,0,0.8,0.86,0.98,1.17,0,1.1,0,1.48,1.04,1.55,0.78,0.43,1.09,2.05,0.16,1.03,0.98,1.63,0.66,1.29,1.06,0.94,1.02,0.26,1.49,0.31,0.01,1.29,0.58,0.46,0.82,1.39,1.6,0.42,1.98,1.5,1.82,0.81,1.31,0.92,1.45,1.39,0.39,1.98,1.31,2.58,0.56,0.78,0.72,0.32,1.56,1.0,1.78,1.99,0.02,0.51,0,1.09,0.52,0.07,0.86,1.27,2.74,0.74,2.34,2.87,1.17,0.57,1.86,0.38,0.24,0.86,0.44,0.27,0.65,0.56,0.7,0.06,0.59,0.51,0.35,1.78,0.73,1.13,0,1.51,1.41,0.4,1.27,1.98,0.5,0.95,0.45,0.84,2.25,1.32,0.57,1.42,0.14,0.89,0,0.36,1.23,1.43,0.41,1.83,0.98,1.66,0,0.59,0.86,0.46,1.04,0.57,0.64,1.12,2.35,0.07,0.04,0.77,1.47,0.27,0,0.68,0.69,1.11,0.03,0.36,0,1.47,0.46,3.12,2.04,0.19,0,2.1,0.94,1.23,0.53,2.38,0.12,0.56,0.37,0.66,0.73,1.43,0.11,0.32,0.43,1.1,0.49,0.58,1.29,1.26,0.67,1.19,1.32,0.56,0.17,2.01,1.42,0.87,0,0.97,0.59,0.67,0.45,0.88,1.17,1.79,0.01,1.22,0,0.84,0.89,2.38,0.67,0,0.25,0.31,0.59,0,0,0.77,0.18,0.84,0,0.3,0.39,0.97,1.06,0.32,0.29,2.3,0.34,0.86,1.8,1.01,0.93,0.15,2.02,0.19,0,1.09,0.42,0.44,0.66,0.89,0,0.57,0.43,2.0,0.06,3.12,3.45,0.54],
    down: [0.92,0.46,0.33,0,0.11,1.04,0.87,0.92,0,0.26,3.82,0.88,0,0.19,0.6,0.39,1.54,0.49,0,2.53,0.18,1.4,3.26,1.2,1.98,0.36,3.15,0,1.48,0.48,0.08,0.77,0,0.26,0.75,0.2,0,0.92,0.67,0.28,1.36,0.93,2.37,0,2.11,1.86,1.18,0.79,1.47,1.66,0.48,4.98,1.67,0,0.5,0.67,0.96,0,0.98,0.81,0.18,0.6,0,0.94,0,0.5,0.87,0,0.17,0,1.86,0.65,0.41,3.62,0,0,1.14,0,1.62,0.28,0,0,0.33,0.03,0.09,0.32,3.27,0.08,0.31,0,0.74,2.35,0,0,0.34,1.81,0,0.05,1.69,1.44,0,0.25,2.25,1.66,0,0.63,0.69,0,0.13,0.28,0.52,1.07,0.87,1.05,0.26,0.26,2.29,2.21,0,0.44,0.29,0.28,0,0.34,0,1.26,1.15,0,0.26,2.09,1.17,0.48,1.85,0.86,0.74,1.04,1.31,2.0,0.65,0,0,2.39,2.66,0,1.58,1.91,2.8,0.63,1.17,0.17,0.3,0.42,0.17,1.34,1.39,0.98,1.67,1.87,0.12,1.03,0,1.09,2.81,0.27,0.04,0.3,1.36,0,1.11,0.01,0.13,0,1.59,1.43,0.18,0.23,0.3,1.49,0.79,1.3,0.31,0,0,0.64,0.32,0.85,0.81,0.81,0.78,0.96,0.13,0.96,0.45,0.48,0.99,0.7,0.84,0.73,2.54,1.04,0.13,2.79,1.18,0.14,0.23,0,0.9,0.07,0.17,0,1.19,0.15,0.2,0.01,0.02,1.05,0,0.03,0.01,0.64,1.83,0.28,0.99,0.08,0.23,0.01,0,2.75,1.0,1.81,1.0,1.25,3.69,0.49,0,0.06,0.32,0,0,0.97,2.0,0.08,0.86,1.2,2.29,1.66,0.82,0.61,0.82,0.54,1.19,0.36,1.82,1.1,0.63,0.74,0,2.33,0,0,1.92,0.79,0.23,1.75,1.47,0.2,0.22,0.58,0.06,0.76,0,0.98,0.22,2.67,0.92,0.07,0,0.64,0.31,0.27,0,3.69,0.87,0.82,1.91,0.15,1.2,2.25,0.09,0.4,0.46,3.12,0,1.25,1.62,1.2,0.69,0.91,0.89,2.52,0.61,1.0,0.55,0.87,0,0,1.62,4.85,0,0.21,0,0.58,0,1.57,0.43,0.61,0.53,0.04,0.91,0.94,0.44,0.6,0.34,0.99,0.75,0.06,0.01,1.71,0.42,0.15,1.17,2.23,0.46,0.11,0.55,1.65,0.9,0.51,0.68,0.77,1.04,0.25,0.4,1.52,0.08,3.5,1.99,0.72,1.58,0.89,2.39,1.89,2.98,1.24,1.55,3.03,0.81,1.04,0.31,1.27,1.01,2.55,0.22,0.15,2.24,0.87,0.41,1.0,0.69,0,0,0.09,1.26,0.24,0.7,1.14,0,1.18,1.15,1.28,0.08,4.14,1.47,1.54,0,1.33,0.12,0,0.44] };
  const MULT = 1.5;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f0 = (v) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const f2 = (v) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (a, n) => Math.round(a / n * 100);
  const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

  // Trading days from today (IST) to expiry, counting the expiry day, and today until the 3:30 PM close.
  function tradingDaysLeft(exp) {
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(exp || '');
    if (!m) return null;
    const end = Date.UTC(+m[3], MON[m[2].toUpperCase()], +m[1]);
    const now = new Date(Date.now() + 330 * 60e3), mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const hol = (window.MP_CONFIG && window.MP_CONFIG.holidays) || [];
    let d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), n = 0;
    if (mins >= 930) d += 864e5;
    for (; d <= end && n < 60; d += 864e5) {
      const x = new Date(d), iso = x.toISOString().slice(0, 10), w = x.getUTCDay();
      if (w > 0 && w < 6 && hol.indexOf(iso) < 0) n++;
    }
    return n;
  }
  // Of the 389 weeks: closed at or beyond k straddles from spot (signed), and touched that level during the week.
  function odds(k) {
    let closed = 0, touched = 0;
    for (let i = 0; i < H.n; i++) {
      if (k >= 0 ? H.close[i] >= k : H.close[i] <= k) closed++;
      if (k >= 0 ? H.up[i] >= k : H.down[i] >= -k) touched++;
    }
    return { closed, touched };
  }

  let host = null, last = null, side = 'CE', lastCheck = null;
  function shell(el) {
    host = el;
    el.innerHTML = `
      <div class="rng-head"><div><h2>This week's expected range</h2><p class="rng-sub" data-r="sub"></p></div><span class="rng-pill" data-r="pill"></span></div>
      <div class="rng-calc" data-r="calc"></div>
      <div class="rng-bar" data-r="bar"></div>
      <p class="rng-rec" data-r="rec"></p>
      <form class="rng-target" data-r="form" autocomplete="off">
        <label for="rngTarget" data-r="flabel">Check an option you want to trade</label>
        <div class="rng-in">
          <input id="rngTarget" type="text" inputmode="decimal" placeholder="Strike, e.g. 26000" aria-label="Strike price">
          <div class="rng-side" role="group" aria-label="Call or put"><button type="button" data-side="CE" class="on">Call</button><button type="button" data-side="PE">Put</button></div>
          <input id="rngPrice" type="text" inputmode="decimal" placeholder="Price ₹ (optional)" aria-label="Price you pay">
          <button type="submit">Check</button>
        </div>
        <div class="rng-out" data-r="out" aria-live="polite"></div>
      </form>
      <p class="rng-note">In simple words: option prices show how much the market expects the index to move by expiry. This range is how far, not which way, and it is not a trade recommendation. Closer to expiry the range gets smaller.</p>`;
    el.querySelector('[data-r="form"]').addEventListener('submit', (e) => { e.preventDefault(); check(); });
    el.querySelector('#rngTarget').addEventListener('input', (e) => { if (!e.target.value.trim()) el.querySelector('[data-r="out"]').innerHTML = ''; });
    el.querySelector('.rng-side').addEventListener('click', (e) => {
      const b = e.target.closest('[data-side]'); if (!b) return;
      side = b.dataset.side; el.querySelectorAll('.rng-side button').forEach((x) => x.classList.toggle('on', x === b));
      if (el.querySelector('#rngTarget').value.trim()) check();
    });
  }
  // Plain-language check of one option: where the index must close for it to pay at expiry, and how often that
  // happened in the 389 weeks (moves measured in straddles, so they scale with today's straddle).
  function check() {
    const out = host.querySelector('[data-r="out"]'), num = (id) => Number(host.querySelector(id).value.replace(/[,\s₹]/g, ''));
    const rawK = host.querySelector('#rngTarget').value.trim();
    if (!last || !rawK) { out.innerHTML = ''; if (lastCheck) { lastCheck = null; document.dispatchEvent(new CustomEvent('mp:range-check')); } return; }
    const K = num('#rngTarget');
    if (!(K > 0)) { out.innerHTML = '<span class="bad">Enter a strike price, like 26000.</span>'; return; }
    const { spot, strad, lo, hi, name, isNifty, rows } = last, call = side === 'CE';
    const row = (rows || []).find((r) => r[0] === K), ltp = row ? (call ? row[5] : row[11]) : null;
    let price = num('#rngPrice'), priceNote = '';
    if (!(price > 0)) { price = ltp > 0 ? ltp : 0; priceNote = price ? ` (its last traded price; type your own price to change it)` : ''; }
    const label = `${esc(name)} ${f0(K)} ${call ? 'Call' : 'Put'}`;
    const be = call ? K + price : K - price, need = be - spot, dir = call ? 'above' : 'below';
    const kBe = (be - spot) / strad, kK = (K - spot) / strad;
    const cnt = (f) => { let c = 0; for (let i = 0; i < H.n; i++) if (f(i)) c++; return c; };
    const win = cnt((i) => call ? H.close[i] > kBe : H.close[i] < kBe);
    const zero = cnt((i) => call ? H.close[i] <= kK : H.close[i] >= kK);
    const itmNow = call ? K <= spot : K >= spot;
    const touch = itmNow ? null : cnt((i) => call ? H.up[i] >= kK : H.down[i] >= -kK);
    const inRange = K >= lo && K <= hi;
    const pts = [];
    pts.push(price > 0
      ? `You pay <b>₹${f2(price)}</b> per unit${priceNote}. At expiry you make money only if ${esc(name)} closes <b>${dir} ${f0(be)}</b> (strike ${call ? '+' : '−'} price), which is <b>${f0(Math.abs(need))} points ${need >= 0 ? 'up' : 'down'}</b> (${(Math.abs(need) / spot * 100).toFixed(2)}%) from ${f0(spot)} now.`
      : `No price found for this strike: type the price you would pay to see where you break even.`);
    if (isNifty) {
      if (price > 0) pts.push(`In ${H.n} past weeks, ${esc(name)} closed that far ${call ? 'up' : 'down'} <b>${win} times (${pct(win, H.n)}%)</b>: roughly <b>${win ? '1 in ' + Math.max(1, Math.round(H.n / win)) : 'never'}</b>.`);
      pts.push(`The option ended <b>worthless</b> (${esc(name)} ${call ? 'at or below' : 'at or above'} ${f0(K)} at expiry) in <b>${zero} weeks (${pct(zero, H.n)}%)</b>.`);
      if (touch !== null) pts.push(`${esc(name)} touched ${f0(K)} at some point before expiry in ${touch} weeks (${pct(touch, H.n)}%). Those were the chances to sell early at a profit.`);
    } else pts.push(`The weekly record is for Nifty only, so there are no past odds for ${esc(name)}.`);
    pts.push(itmNow
      ? `This strike is already <b>in the money</b> (the price is ${call ? 'above' : 'below'} it), so it costs more but needs a smaller move.`
      : inRange ? `The strike is <b>inside</b> the expected range (${f0(lo)} – ${f0(hi)}).`
      : `The strike is <b>outside</b> the expected range (${f0(lo)} – ${f0(hi)}): the market itself thinks a move this big is unlikely by expiry.`);
    const odds = isNifty && price > 0 ? win / H.n : null;
    const tag = odds === null ? '' : odds >= 0.35 ? ['ok', 'Fair chance'] : odds >= 0.15 ? ['warn', 'Long shot'] : ['bad', 'Very long shot'];
    lastCheck = { label: `${name} ${f0(K)} ${call ? 'Call' : 'Put'}`, tag: tag ? tag[1] : null, tone: tag ? tag[0] : '', win: odds === null ? null : Math.round(odds * 100), be, inRange, itmNow };
    document.dispatchEvent(new CustomEvent('mp:range-check'));
    out.innerHTML = `<div class="opt-head">${label}${tag ? ` <span class="opt-tag ${tag[0]}">${tag[1]}</span>` : ''}</div><ul>${pts.map((x) => `<li>${x}</li>`).join('')}</ul>`
      + `<p class="opt-foot">Past odds from closing prices 4 trading days before expiry, scaled to today's straddle; ${last.daysLeft !== null && last.daysLeft < 4 ? 'with fewer days left they are rougher. ' : ''}Not a recommendation.</p>`;
  }
  function render(el, D, name) {
    if (!el) return;
    if (host !== el) shell(el);
    const atmRow = (D.rows || []).find((r) => r[0] === D.atm);
    const ce = atmRow ? atmRow[5] : 0, pe = atmRow ? atmRow[11] : 0, spot = D.spot;
    if (!(ce > 0 && pe > 0 && spot > 0)) { el.hidden = true; last = null; return; }
    el.hidden = false;
    const strad = ce + pe, move = strad * MULT, lo = spot - move, hi = spot + move, days = tradingDaysLeft(D.expiry);
    const isNifty = D.symbol === 'NIFTY';
    last = { spot, strad, lo, hi, name, isNifty, rows: D.rows, daysLeft: days };
    const q = (n) => el.querySelector(`[data-r="${n}"]`);
    const weekly = days !== null && days <= 6;
    el.querySelector('h2').textContent = weekly ? "This week's expected range" : 'Expected range to expiry';
    q('flabel').textContent = weekly ? 'Check an option you want to trade this week' : 'Check an option you want to trade (this expiry)';
    q('sub').textContent = `${name} · expiry ${D.expiry}` + (days !== null ? ` · ${days} trading day${days === 1 ? '' : 's'} left` : '');
    q('pill').textContent = isNifty ? 'Closed inside in 79% of weeks' : 'Record is for Nifty only';
    q('pill').className = 'rng-pill' + (isNifty ? ' ok' : '');
    q('calc').innerHTML = `
      <div><span>ATM ${f0(D.atm)} call</span><b>₹${f2(ce)}</b></div><i>+</i>
      <div><span>ATM ${f0(D.atm)} put</span><b>₹${f2(pe)}</b></div><i>=</i>
      <div><span>Straddle</span><b>₹${f2(strad)}</b></div><i>× ${MULT}</i>
      <div class="hl"><span>Range</span><b>±${f0(move)} pts</b></div>`;
    q('bar').innerHTML = `
      <div class="track"><div class="zone"></div><div class="mark"><i></i><em>${f0(spot)}</em></div></div>
      <div class="ends"><span><small>Low</small><b>${f0(lo)}</b></span><span class="mid">${(move / spot * 100).toFixed(1)}% either way</span><span class="r"><small>High</small><b>${f0(hi)}</b></span></div>`;
    q('rec').innerHTML = isNifty
      ? `<b>Record, ${H.n} weekly expiries (${H.from} – ${H.to}):</b> Nifty closed inside the range in <b>306 weeks (79%)</b>, above it in 42 (11%), below it in 41 (11%). But during the week it went past an edge in <b>139 (36%)</b> before coming back. A cheap ₹20 call or put beyond the range ended worthless about 9 times in 10.`
      : `<b>Note:</b> the 79% record was measured on weekly Nifty expiries only. ${esc(name)} may behave differently, so read this range as the option market's estimate, not a tested rule.`;
    if (host.querySelector('#rngTarget').value.trim()) check();
  }
  const state = () => last ? { lo: last.lo, hi: last.hi, strad: last.strad, isNifty: last.isNifty, daysLeft: last.daysLeft, check: lastCheck } : null;
  window.mpRange = { render, odds, tradingDaysLeft, state, H };
})();
