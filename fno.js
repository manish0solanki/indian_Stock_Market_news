/* F&O page: option chain, open interest, PCR, max pain and expected move for NSE indices and F&O stocks.
   Data: the option-chain Edge Function (NSE, cached a minute). Symbol and expiry live in the URL. */
(function () {
  const SUPABASE_URL = window.MP_CONFIG.supabaseUrl;
  const KEY = window.MP_CONFIG.supabaseKey;
  const INDICES = [['NIFTY', 'Nifty 50'], ['BANKNIFTY', 'Bank Nifty'], ['FINNIFTY', 'Fin Nifty'], ['MIDCPNIFTY', 'Midcap Nifty'], ['NIFTYNXT50', 'Nifty Next 50']];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 2) => v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const big = (v) => { const a = Math.abs(v); const s = v < 0 ? '−' : ''; return a >= 1e7 ? s + (a / 1e7).toFixed(2) + ' Cr' : a >= 1e5 ? s + (a / 1e5).toFixed(1) + ' L' : a >= 1e3 ? s + (a / 1e3).toFixed(1) + 'K' : s + a.toLocaleString('en-IN'); };
  const signedBig = (v) => (v > 0 ? '+' : '') + big(v);
  const strikeTxt = (k) => k === null || k === undefined ? '—' : Number(k).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  let S = { symbol: 'NIFTY', expiry: '', range: '15', chart: 'oi' }, D = null, fnoStocks = [], timer = null;

  function load() {
    const p = new URLSearchParams(location.search);
    if (p.get('symbol')) S.symbol = p.get('symbol').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
    if (p.get('expiry')) S.expiry = p.get('expiry');
    try { const r = localStorage.getItem('mp-fno-range'); if (r) S.range = r; } catch (_) {}
  }
  function save() {
    const p = new URLSearchParams();
    if (S.symbol !== 'NIFTY') p.set('symbol', S.symbol);
    if (S.expiry && D && S.expiry !== D.expiries[0]) p.set('expiry', S.expiry);
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
  }

  async function fetchChain() {
    const q = 'symbol=' + encodeURIComponent(S.symbol) + (S.expiry ? '&expiry=' + encodeURIComponent(S.expiry) : '');
    const r = await fetch(SUPABASE_URL + '/functions/v1/option-chain?' + q, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || 'HTTP ' + r.status);
    return d;
  }

  async function refresh(showLoading) {
    if (showLoading) { $('status').hidden = false; $('status').textContent = 'Loading the option chain…'; }
    try {
      D = await fetchChain();
      S.expiry = D.expiry;
      $('status').hidden = true;
      render(); save();
    } catch (e) {
      $('status').hidden = false;
      $('status').textContent = (e.message || 'Could not load the option chain.') + ' Please try again in a minute.';
      if (showLoading) { $('content').hidden = true; }
    }
  }

  /* ───────── rendering ───────── */
  // Plain-language reading of the put-call ratio (open interest). Option sellers ("writers") are mostly big, well-funded
  // traders; a seller of a put is betting the price will NOT fall below that strike, a seller of a call that it will
  // NOT rise above it. So more open puts than calls = more money betting the market holds up.
  function pcrRead(p) {
    if (p === null) return ['—', ''];
    if (p >= 1.6) return ['Bulls strong, maybe too many', 'up'];
    if (p >= 1.2) return ['Bulls stronger', 'up'];
    if (p >= 0.9) return ['Fairly even, slight bull tilt', ''];
    if (p > 0.7) return ['Fairly even, slight bear tilt', ''];
    if (p <= 0.5) return ['Bears strong, maybe too many', 'down'];
    return ['Bears stronger', 'down'];
  }
  function stats() {
    const d = D, spot = d.spot, [pr, pt] = pcrRead(d.pcr);
    const away = (k) => k && spot ? ((k - spot) / spot * 100) : null;
    const awayTxt = (k) => { const a = away(k); return a === null ? '' : (Math.abs(a) < 0.05 ? 'right at the current price' : Math.abs(a).toFixed(1) + '% ' + (a > 0 ? 'above' : 'below') + ' the price'); };
    const lo = d.straddle && spot ? spot - d.straddle : null, hi = d.straddle && spot ? spot + d.straddle : null;
    const name = (INDICES.find((x) => x[0] === d.symbol) || [])[1] || d.symbol;
    return `
      <div class="stat"><div class="l">${esc(name)} now</div><div class="v">${fmt(spot)}</div><div class="s">${d.timestamp ? 'NSE, ' + esc(d.timestamp.replace(/:\d\d$/, '')) : ''}</div></div>
      <div class="stat"><div class="l">Put-call ratio</div><div class="v ${pt}">${d.pcr === null ? '—' : d.pcr.toFixed(2)}</div><div class="s">${pr}${d.pcr !== null ? ` · ${Math.round(d.pcr * 100)} puts open for every 100 calls` : ''}</div></div>
      <div class="stat"><div class="l">Floor (most put bets)</div><div class="v up">${strikeTxt(d.support)}</div><div class="s">${awayTxt(d.support)}</div></div>
      <div class="stat"><div class="l">Ceiling (most call bets)</div><div class="v down">${strikeTxt(d.resistance)}</div><div class="s">${awayTxt(d.resistance)}</div></div>
      <div class="stat"><div class="l">Max pain</div><div class="v">${strikeTxt(d.maxPain)}</div><div class="s">${awayTxt(d.maxPain)} · where most option buyers lose</div></div>
      <div class="stat"><div class="l">Expected move by expiry</div><div class="v">${d.straddle ? '±' + fmt(d.straddle, 0) : '—'}</div><div class="s">${lo ? 'about ' + fmt(lo, 0) + ' to ' + fmt(hi, 0) : ''}</div></div>`;
  }
  // "Which side is stronger?" in plain words: a one-line verdict and short points a beginner can follow.
  function summary() {
    const d = D, t = d.totals, name = (INDICES.find((x) => x[0] === d.symbol) || [])[1] || d.symbol;
    let score = 0;
    if (d.pcr !== null) score += d.pcr >= 1.2 ? 1 : d.pcr <= 0.8 ? -1 : 0;
    const flow = (t.peChgOI || 0) - (t.ceChgOI || 0), scale = Math.max(Math.abs(t.peChgOI || 0), Math.abs(t.ceChgOI || 0), 1);
    if (Math.abs(flow) / scale > 0.25) score += flow > 0 ? 1 : -1;
    const head = score >= 1 ? ['up', '🟢 Bulls (people betting on a rise) look stronger right now']
      : score <= -1 ? ['down', '🔴 Bears (people betting on a fall) look stronger right now']
      : ['', '⚪ Neither side is clearly stronger right now'];
    const pts = [];
    if (d.pcr !== null) pts.push(d.pcr >= 1
      ? `<b>More bets that ${esc(name)} won't fall.</b> For every 100 open call contracts there are ${Math.round(d.pcr * 100)} put contracts. Most puts are sold by big players who earn only if the price stays <i>above</i> their strike, so lots of puts means lots of money defending the downside.`
      : `<b>More bets that ${esc(name)} won't rise.</b> For every 100 open call contracts there are only ${Math.round(d.pcr * 100)} put contracts. Most calls are sold by big players who earn only if the price stays <i>below</i> their strike, so lots of calls means lots of money capping the upside.`);
    if (d.support && d.resistance) pts.push(`<b>Floor and ceiling.</b> The biggest pile of put bets is at <b>${strikeTxt(d.support)}</b> (sellers there don't want the price to fall below it), and the biggest pile of call bets is at <b>${strikeTxt(d.resistance)}</b> (sellers there don't want it to go above). The price often stays between the two, but they can break.`);
    if (t.ceChgOI || t.peChgOI) {
      const c = t.ceChgOI || 0, p = t.peChgOI || 0, w = (v, kind) => `${v >= 0 ? 'added' : 'cut'} ${big(Math.abs(v))} ${kind} contracts`;
      const read = p - c > 0 ? 'more new money is betting the market holds up' : p - c < 0 ? 'more new money is betting the market won\'t go much higher' : 'new money is split evenly';
      pts.push(`<b>Today's new bets.</b> Traders ${w(c, 'call')} and ${w(p, 'put')}, so ${read}.`);
    }
    if (d.pcrVol !== null && d.pcrVol !== undefined) pts.push(`<b>Today's trading.</b> For every 100 call contracts traded today, ${Math.round(d.pcrVol * 100)} puts were traded: ${d.pcrVol > 1.1 ? 'more action on puts' : d.pcrVol < 0.9 ? 'more action on calls' : 'about even'}. (Every trade has a buyer and a seller, so this shows where the activity is, not who won.)`);
    if (d.maxPain && d.spot) pts.push(`<b>Max pain ${strikeTxt(d.maxPain)}.</b> If ${esc(name)} ends expiry here, option buyers as a group lose the most. Near expiry the price sometimes drifts towards it; it is a pull, not a promise.`);
    if (d.pcr !== null && (d.pcr >= 1.6 || d.pcr <= 0.5)) pts.push(`<b>⚠ Careful:</b> the ratio is extreme (${d.pcr.toFixed(2)}). When almost everyone is on one side, the market sometimes turns the other way.`);
    return `<div class="sum-head ${head[0]}">${head[1]}</div><ul class="sum-pts">${pts.map((x) => `<li>${x}</li>`).join('')}</ul><div class="sum-foot">This reads the positions of option traders. It shows where money is placed, not where the price will go.</div>`;
  }
  // "Your step-by-step guide": the four steps filled in with live data, so the page can be read top to bottom.
  function verdict() {
    const d = D, t = d.totals || {};
    let score = 0;
    if (d.pcr !== null) score += d.pcr >= 1.2 ? 1 : d.pcr <= 0.8 ? -1 : 0;
    const flow = (t.peChgOI || 0) - (t.ceChgOI || 0), scale = Math.max(Math.abs(t.peChgOI || 0), Math.abs(t.ceChgOI || 0), 1);
    if (Math.abs(flow) / scale > 0.25) score += flow > 0 ? 1 : -1;
    return score;
  }
  function steps() {
    const d = D, name = (INDICES.find((x) => x[0] === d.symbol) || [])[1] || d.symbol, spot = d.spot;
    const now = new Date(Date.now() + 330 * 60e3), mins = now.getUTCHours() * 60 + now.getUTCMinutes(), open = marketOpen();
    const st = (cls, icon, title, body) => `<li class="${cls}"><span class="st-i">${icon}</span><div><b>${title}</b><p>${body}</p></div></li>`;
    const out = [];
    // 1. Time
    if (!open) out.push(st('wait', '1', 'Market is closed', `These are the last closing numbers. Use them to plan for the next session; the guide updates itself once the market opens.`));
    else if (mins < 570) out.push(st('wait', '1', `Wait until 9:30 AM (${570 - mins} min)`, `The first 15 minutes are noisy while traders settle their positions. Look, but don't trade yet.`));
    else if (mins >= 900) out.push(st('wait', '1', 'Last 30 minutes', `Prices can jump around near the close. New trades now have little time to work; for weekly options on expiry day, very little.`));
    else out.push(st('ok', '✓', 'Good time to look', `The opening noise has settled. The page updates itself about every minute (NSE's own numbers change every few minutes).`));
    // 2. Who is stronger
    const v = verdict();
    out.push(st(v > 0 ? 'up' : v < 0 ? 'down' : 'flat', '2',
      v > 0 ? 'Bulls look stronger' : v < 0 ? 'Bears look stronger' : 'No clear side',
      v > 0 ? `More money is betting ${esc(name)} won't fall than won't rise. That leans towards calls (betting on a rise), not puts.`
        : v < 0 ? `More money is betting ${esc(name)} won't rise than won't fall. That leans towards puts (betting on a fall), not calls.`
        : `Money is split between the two sides. With no clear side, a big one-way move is less likely; be extra picky.`));
    if (d.pcr !== null && (d.pcr >= 1.6 || d.pcr <= 0.5)) out[out.length - 1] = out[out.length - 1].replace('</p></div></li>', ` <span class="st-warn">⚠ Almost everyone is on one side (ratio ${d.pcr.toFixed(2)}); markets sometimes turn when that happens.</span></p></div></li>`);
    // 3. Where the price sits: range, floor and ceiling
    const r = window.mpRange && window.mpRange.state();
    let where = '';
    if (d.support && d.resistance && spot) {
      const band = d.resistance - d.support, pos = band > 0 ? (spot - d.support) / band : 0.5;
      where = pos <= 0.25 ? ` It is <b>close to the floor</b> (${strikeTxt(d.support)}): bounces often start here, but if the floor breaks the fall can be quick.`
        : pos >= 0.75 ? ` It is <b>close to the ceiling</b> (${strikeTxt(d.resistance)}): rallies often stall here, but if it breaks the rise can be quick.`
        : ` It is in the <b>middle</b>, between the floor ${strikeTxt(d.support)} and the ceiling ${strikeTxt(d.resistance)}.`;
    }
    out.push(st('info', '3', r ? `Expected range: ${fmt(r.lo, 0)} to ${fmt(r.hi, 0)}` : 'Where the price sits',
      (r ? `${esc(name)} is ${fmt(spot, 0)}. ${r.isNifty ? 'It finished inside a range like this in about 8 of 10 weeks.' : 'This is the option market\'s own estimate.'} Pick a strike inside it; a strike outside it rarely pays.` : `${esc(name)} is ${fmt(spot, 0)}.`) + where));
    // 4. Your option
    const c = r && r.check;
    out.push(c
      ? st(c.tone === 'ok' ? 'ok' : c.tone === 'warn' ? 'wait' : 'down', '4', `Your option: ${esc(c.label)}${c.tag ? ' · ' + c.tag : ''}`,
          c.win === null ? `See the details in the range card below.` : `It paid at expiry in about <b>${c.win}%</b> of past weeks (break-even ${fmt(c.be, 0)}). ${c.win >= 35 ? 'Reasonable odds, still not a sure thing.' : c.win >= 15 ? 'Possible, but most weeks it would lose. Keep the amount small.' : 'Most weeks this loses everything. Only risk money you can afford to lose.'}`)
      : st('todo', '4', 'Check your option', `Type the strike you're thinking of in <a href="#rangeCard">the range card below</a>, pick Call or Put, and it tells you the odds in plain words.`));
    // 5. Keep watching
    const t = d.totals || {};
    const flowTxt = (t.peChgOI || 0) > (t.ceChgOI || 0) ? 'more new put bets than call bets today (support building)' : (t.ceChgOI || 0) > (t.peChgOI || 0) ? 'more new call bets than put bets today (a ceiling building)' : 'new bets split evenly today';
    out.push(st('info', '5', 'Re-check every 15–30 minutes', `Right now: ${flowTxt}. If that flips, or the price breaks the floor or ceiling, the picture has changed.`));
    return `<div class="steps-head"><h2>Your step-by-step guide</h2><span>${d.timestamp ? 'NSE data ' + esc(d.timestamp.replace(/:\d\d$/, '').replace(/^.* /, '')) : ''}</span></div><ol class="steps-list">${out.join('')}</ol><p class="steps-foot">Built from where option traders have placed their money. The range and option odds are tested on 389 weekly Nifty expiries; the "stronger side" reading is not yet tested. Not a recommendation.</p>`;
  }
  function visibleRows() {
    const rows = D.rows;
    if (S.range === 'all' || !rows.length) return rows;
    const n = Number(S.range), i = rows.findIndex((r) => r[0] === D.atm);
    const c = i < 0 ? Math.floor(rows.length / 2) : i;
    return rows.slice(Math.max(0, c - n), c + n + 1);
  }
  function chart(rows) {
    const oi = S.chart === 'oi', ci = oi ? 1 : 2, pi = oi ? 7 : 8;
    const max = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r[ci]), Math.abs(r[pi]))));
    const w = (v) => (Math.abs(v) / max * 100).toFixed(1) + '%';
    let spotDone = false;
    return rows.map((r) => {
      let line = '';
      if (!spotDone && r[0] >= D.spot) { spotDone = true; line = `<div class="spotline"><span>Spot ${fmt(D.spot)}</span></div>`; }
      const tags = (r[0] === D.maxPain ? '<em>max pain</em>' : '');
      return line + `<div class="brow${r[0] === D.atm ? ' atm' : ''}">
        <div class="bside ce"><span class="bval">${oi ? big(r[ci]) : signedBig(r[ci])}</span><i class="${r[ci] < 0 ? 'neg' : ''}" style="width:${w(r[ci])}"></i></div>
        <div class="bk">${strikeTxt(r[0])}${tags}</div>
        <div class="bside pe"><i class="${r[pi] < 0 ? 'neg' : ''}" style="width:${w(r[pi])}"></i><span class="bval">${oi ? big(r[pi]) : signedBig(r[pi])}</span></div></div>`;
    }).join('') + (spotDone ? '' : `<div class="spotline"><span>Spot ${fmt(D.spot)}</span></div>`);
  }
  function table(rows) {
    const chg = (v) => v === 0 ? '<span class="muted">0</span>' : `<span class="${v > 0 ? 'up' : 'down'}">${signedBig(v)}</span>`;
    const px = (v, c) => v ? `<b>${fmt(v)}</b><small class="${c >= 0 ? 'up' : 'down'}">${c ? (c > 0 ? '+' : '') + fmt(c) : ''}</small>` : '<span class="muted">—</span>';
    const maxCe = Math.max(1, ...rows.map((r) => r[1])), maxPe = Math.max(1, ...rows.map((r) => r[7]));
    let spotDone = false;
    return rows.map((r) => {
      let line = '';
      if (!spotDone && r[0] >= D.spot) { spotDone = true; line = `<tr class="spotrow"><td colspan="11"><span>Spot ${fmt(D.spot)}</span></td></tr>`; }
      const ceItm = r[0] < D.spot, peItm = r[0] > D.spot;
      return line + `<tr class="${r[0] === D.atm ? 'atm' : ''}">
        <td class="r ce ${ceItm ? 'itm' : ''} oi"><span class="oibar" style="width:${(r[1] / maxCe * 100).toFixed(0)}%"></span>${big(r[1])}</td>
        <td class="r ce ${ceItm ? 'itm' : ''}">${chg(r[2])}</td>
        <td class="r ce ${ceItm ? 'itm' : ''} xs">${big(r[3])}</td>
        <td class="r ce ${ceItm ? 'itm' : ''} xs">${r[4] ? r[4].toFixed(1) : '—'}</td>
        <td class="r ce ${ceItm ? 'itm' : ''} px">${px(r[5], r[6])}</td>
        <td class="k">${strikeTxt(r[0])}</td>
        <td class="pe ${peItm ? 'itm' : ''} px">${px(r[11], r[12])}</td>
        <td class="pe ${peItm ? 'itm' : ''} xs">${r[10] ? r[10].toFixed(1) : '—'}</td>
        <td class="pe ${peItm ? 'itm' : ''} xs">${big(r[9])}</td>
        <td class="pe ${peItm ? 'itm' : ''}">${chg(r[8])}</td>
        <td class="pe ${peItm ? 'itm' : ''} oi"><span class="oibar" style="width:${(r[7] / maxPe * 100).toFixed(0)}%"></span>${big(r[7])}</td></tr>`;
    }).join('');
  }
  function render() {
    if (!D) return;
    $('content').hidden = false;
    $('stats').innerHTML = stats();
    $('summary').innerHTML = summary();
    if (window.mpRange) window.mpRange.render($('rangeCard'), D, (INDICES.find((x) => x[0] === D.symbol) || [])[1] || D.symbol);
    $('steps').innerHTML = steps();
    const isStock = !INDICES.some((x) => x[0] === D.symbol);
    $('title').innerHTML = isStock ? `<span data-sym="${esc(D.symbol)}">${esc(D.symbol)}</span> option chain` : esc(((INDICES.find((x) => x[0] === D.symbol) || [])[1] || D.symbol)) + ' option chain';
    $('expiry').innerHTML = D.expiries.map((e) => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
    $('expiry').value = D.expiry;
    document.querySelectorAll('#idx [data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === D.symbol));
    if (isStock) $('stockIn').value = D.symbol;
    const rows = visibleRows();
    $('chart').innerHTML = chart(rows);
    $('tbody').innerHTML = table(rows);
    const t = D.totals;
    $('totals').innerHTML = `Total call OI <b>${big(t.ceOI)}</b> · put OI <b>${big(t.peOI)}</b> · contracts, all strikes of this expiry`;
    const atm = document.querySelector('#tbody tr.atm');
    if (atm && !render.scrolled) { render.scrolled = true; const w = $('tablewrap'); w.scrollTop += atm.getBoundingClientRect().top - w.getBoundingClientRect().top - w.clientHeight / 2;
      const c = $('chart'), b = c.querySelector('.brow.atm'); if (b) c.scrollTop += b.getBoundingClientRect().top - c.getBoundingClientRect().top - c.clientHeight / 2; }
  }

  function pick(sym) {
    sym = String(sym || '').toUpperCase().trim();
    if (!sym || sym === S.symbol) return;
    S.symbol = sym; S.expiry = ''; render.scrolled = false;
    refresh(true);
  }

  async function loadStocks() {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/stocks?select=symbol,company_name&is_fno=eq.true&order=symbol', { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
      fnoStocks = r.ok ? await r.json() : [];
      $('fnoList').innerHTML = fnoStocks.map((s) => `<option value="${esc(s.symbol)}">${esc(s.company_name || '')}</option>`).join('');
    } catch (_) {}
  }

  function marketOpen() {
    { const S_ = window.MP_CONFIG && MP_CONFIG.marketSession && MP_CONFIG.marketSession(); if (S_ && S_.special) return true; if (S_ && S_.holiday) return false; }
    const t = new Date(Date.now() + 330 * 60e3), d = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
    return d > 0 && d < 6 && m >= 555 && m <= 935;
  }

  function wire() {
    $('idx').innerHTML = INDICES.map(([s, l]) => `<button type="button" class="chip" data-s="${s}">${l}</button>`).join('');
    $('idx').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) pick(b.dataset.s); });
    $('stockForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('stockIn').value.trim().toUpperCase();
      const hit = fnoStocks.find((s) => s.symbol === v) || fnoStocks.find((s) => (s.company_name || '').toUpperCase().includes(v));
      pick(hit ? hit.symbol : v);
    });
    $('stockIn').addEventListener('change', () => { const v = $('stockIn').value.trim().toUpperCase(); if (fnoStocks.some((s) => s.symbol === v)) pick(v); });
    $('expiry').addEventListener('change', () => { S.expiry = $('expiry').value; render.scrolled = false; refresh(true); });
    $('range').value = S.range;
    $('range').addEventListener('change', () => { S.range = $('range').value; try { localStorage.setItem('mp-fno-range', S.range); } catch (_) {} render.scrolled = false; render(); });
    $('chartMode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      S.chart = b.dataset.m;
      document.querySelectorAll('#chartMode [data-m]').forEach((x) => x.classList.toggle('on', x === b));
      render();
    });
  }

  document.addEventListener('mp:range-check', () => { if (D) $('steps').innerHTML = steps(); });
  function start() {
    load(); wire(); loadStocks(); refresh(true);
    // NSE updates the chain every few minutes in market hours: refresh each minute while visible.
    timer = setInterval(() => { if (!document.hidden && marketOpen()) refresh(false); }, 60e3);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
