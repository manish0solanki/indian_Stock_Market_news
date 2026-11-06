/* "Why is the market moving?" — Home card (#mwIndia) and the Global Market page (#mwGlobal).
   Data: market_why() (supabase/market-why.sql). The story is written only from those numbers: which Nifty 50 stocks
   added or took away the points, sectors, breadth, overnight US, Asia, crude, the rupee, yields, the dollar, FII / DII
   flows, today's events and matching headlines; for the US, Europe and Asia, each region's move with its cross-market
   drivers and headlines. Drivers that line up with the move are shown as "pushing", the rest as "holding back".
   It explains with data that agrees with the move; it can't prove the cause, and says so.
   Refreshes every 2 minutes while either section is on screen. */
(function () {
  'use strict';
  const SB = window.MP_CONFIG && window.MP_CONFIG.supabaseUrl, KEY = window.MP_CONFIG && window.MP_CONFIG.supabaseKey;
  if (!SB) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const unent = (s) => { const t = document.createElement('textarea'); t.innerHTML = String(s ?? ''); return t.value; };
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const pct = (v, d = 2) => v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
  const pts = (v) => v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.round(Math.abs(v)).toLocaleString('en-IN');
  const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const ago = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  // "3:42 pm" today, "6 Nov, 3:42 pm" on other days, in India time
  const istWhen = (iso) => {
    if (!iso) return ''; const d = new Date(iso), o = { timeZone: 'Asia/Kolkata' };
    const day = (x) => x.toLocaleDateString('en-IN', { ...o, day: 'numeric', month: 'short' });
    const t = d.toLocaleTimeString('en-IN', { ...o, hour: 'numeric', minute: '2-digit' });
    return (day(d) === day(new Date()) ? '' : day(d) + ', ') + t + ' IST';
  };
  const short = (n) => String(n || '').replace(/ (Limited|Ltd\.?)$/i, '').replace(/^Nifty /, '');
  // Headlines must be about markets / the economy (the global feed also carries general news).
  const MARKETY = /(stock|share|market|index|indices|nifty|sensex|nasdaq|s&p|dow|nikkei|hang seng|kospi|stoxx|dax|ftse|rally|sell-?off|slump|surge|tumble|plunge|jump|rate|inflation|yield|bond|treasur|earnings|results|profit|economy|gdp|currency|rupee|dollar|yen|euro|\bfed\b|ecb|boj|rbi|tariff|chip|oil|crude|gold|investor|fii|fpi)/i;

  // How each driver reads in a sentence, by direction of its push.
  const PHRASE = {
    fii: ['heavy foreign buying', 'foreign selling'], dii: ['domestic fund buying', 'domestic fund selling'],
    us: ['a strong Wall Street close', 'a sharp fall on Wall Street'], asia: ['gains across Asia', 'losses across Asia'],
    usfut: ['rising US futures', 'falling US futures'], crude: ['cheaper oil', 'dearer oil'], rupee: ['a firmer rupee', 'a weaker rupee'],
    yield: ['lower US bond yields', 'higher US bond yields'], dollar: ['a softer dollar', 'a stronger dollar'], breadth: ['broad buying', 'broad selling'],
    vix: ['easing fear (VIX down)', 'rising fear (VIX up)'], gold: ['less demand for safety', 'a rush into gold'], btc: ['strong risk appetite', 'weak risk appetite'],
    euro: ['a weaker euro, good for exporters', 'a stronger euro, hard on exporters'], yen: ['a weaker yen, good for Japanese exporters', 'a stronger yen, hard on Japanese exporters'],
  };
  const phrase = (d) => (PHRASE[d.key] || [d.label, d.label])[d.impact > 0 ? 0 : 1];
  const list = (a) => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  // Each card opens as a summary (the move and the main reasons' titles); Read more shows everything.
  const open = { india: false, us: false, europe: false, asia: false };
  let D = null, R = {}, lastLoad = 0, loading = false, timer = null;

  // Drivers split into those pushing with the move and those working against it.
  function split(drivers, dir) {
    const ds = (drivers || []).filter((d) => num(d.impact));
    if (!dir) return { withMove: ds.filter((d) => d.impact > 0), against: ds.filter((d) => d.impact < 0) };
    return { withMove: ds.filter((d) => Math.sign(d.impact) === dir), against: ds.filter((d) => Math.sign(d.impact) === -dir) };
  }
  function driverList(arr, cls, empty) {
    if (!arr.length) return `<p class="mw-none">${empty}</p>`;
    return `<ul class="mw-drv ${cls}">${arr.map((d) => `<li><b>${esc(d.label)}</b> <span class="mw-val">${esc(d.value)}</span><small>${esc(d.why)}</small></li>`).join('')}</ul>`;
  }
  function headlines(arr, empty) {
    const hs = (arr || []).filter((h) => MARKETY.test(unent(h.title))).slice(0, 4);
    if (!hs.length) return empty ? `<p class="mw-none">${empty}</p>` : '';
    return `<ul class="mw-heads">${hs.map((h) => `<li>${h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(unent(h.title))}</a>` : esc(unent(h.title))}<small>${esc(unent(h.source || ''))}${h.at ? ' · ' + ago(h.at) : ''}</small></li>`).join('')}</ul>`;
  }

  // "The main reasons" (written from the news by market-reasons, checked against the data) and the news themes
  // with the moves of the stocks behind them.
  function reasonsBlock(rr, region) {
    if (!rr) return '';
    const reasons = (rr.reasons || []).filter((x) => x && x.title), themes = rr.themes || [];
    const movers = (rr.movers || []).filter((m) => num(m.c) !== null).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, region === 'india' ? 0 : 8);
    if (!reasons.length && !themes.length) return '';
    const src = (arr) => (arr || []).filter((h) => h && h.title).map((h) => h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.source || 'source')}</a>` : esc(h.source || '')).join(' · ');
    const stk = (arr) => (arr || []).map((x) => `<span>${esc(x.n)} <b class="${tone(num(x.c))}">${pct(num(x.c), 1)}</b></span>`).join('');
    let h = '';
    if (reasons.length) {
      const at = rr.written_at || rr.updated_at;
      h += `<div class="mw-why"><h4>The main reasons${at ? ` <small class="mw-upd" title="When the AI last wrote these reasons">Updated ${istWhen(at)} · ${ago(at)}</small>` : ''}</h4><ol>${reasons.map((x) => `<li><b>${esc(x.title)}</b>${x.detail ? `<p>${esc(x.detail)}</p>` : ''}${(x.sources || []).length ? `<small>Sources: ${src(x.sources)}</small>` : ''}</li>`).join('')}</ol>
        <div class="mw-by mw-x">Written by AI from the news and checked against the market data. Rewritten when the news or the index move changes, around each market's trading hours${rr.updated_at ? `; news last checked ${ago(rr.updated_at)}` : ''}.</div></div>`;
    }
    if (themes.length) {
      h += `<div class="mw-themes mw-x"><h4>What the news is about <small>last 24 hours</small></h4>${themes.map((t) => `<details class="mw-th"><summary><span class="mw-th-l">${esc(t.label)}</span><span class="mw-th-n">${t.n} ${t.n === 1 ? 'story' : 'stories'}</span>${num(t.avg) !== null ? `<span class="mw-th-a ${tone(num(t.avg))}">${pct(num(t.avg), 1)} avg</span>` : ''}</summary>
        ${(t.stocks || []).length ? `<div class="mw-idx">${stk(t.stocks)}</div>` : ''}
        <ul class="mw-heads">${(t.heads || []).map((x) => `<li>${num(x.t) ? `<i class="mw-dot ${x.t > 0 ? 'up' : 'down'}"></i>` : ''}${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(unent(x.title))}</a>` : esc(unent(x.title))}<small>${esc(x.source || '')}${x.at ? ' · ' + ago(x.at) : ''}</small></li>`).join('')}</ul></details>`).join('')}</div>`;
    }
    if (movers.length) h += `<div class="mw-movers mw-x"><h5>Key stocks, latest session</h5><div class="mw-idx">${stk(movers)}</div></div>`;
    return h;
  }

  // News sentiment: every headline of the last day rated good / bad / neutral for that market (market-reasons).
  function sentiBlock(rr) {
    const se = rr && rr.sentiment; if (!se) return '';
    const pos = num(se.pos) || 0, neg = num(se.neg) || 0, neu = num(se.neu) || 0, n = pos + neg + neu; if (!n) return '';
    const sc = num(se.score) || 0, cls = sc >= 15 ? 'up' : sc <= -15 ? 'down' : '';
    const w = (x) => (100 * x / n).toFixed(1) + '%';
    const hl = (arr, c) => (arr || []).slice(0, 2).map((h) => `<li><i class="mw-dot ${c}"></i>${h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(unent(h.title))}</a>` : esc(unent(h.title))}<small>${esc(h.source || '')}</small></li>`).join('');
    return `<div class="mw-senti">
      <div class="mw-senti-h"><span>News sentiment</span><b class="${cls}">${esc(se.label || '')}</b><em class="${cls}">${sc > 0 ? '+' : sc < 0 ? '−' : ''}${Math.abs(sc)}</em></div>
      <div class="mw-senti-bar" role="img" aria-label="${pos} positive, ${neu} neutral, ${neg} negative headlines"><i class="up" style="width:${w(pos)}"></i><i class="neu" style="width:${w(neu)}"></i><i class="down" style="width:${w(neg)}"></i></div>
      <small>${pos} positive · ${neu} neutral · ${neg} negative, of ${n} headlines in the last day${se.by === 'ai' ? ', rated by AI' : ', rated by keywords'}</small>
      ${(se.up || []).length || (se.down || []).length ? `<ul class="mw-heads mw-senti-l mw-x">${hl(se.up, 'up')}${hl(se.down, 'down')}</ul>` : ''}
    </div>`;
  }
  const toggle = (k) => `<button type="button" class="mw-toggle" data-mw="${k}" aria-expanded="${open[k]}">${open[k] ? 'Show less ▴' : 'Read more ▾'}</button>`;

  /* ---------- India ---------- */
  function india() {
    const box = $('mwIndia'); if (!box || !D || !D.india) return;
    const I = D.india, chg = num(I.chg), p = num(I.pts), dir = chg === null ? 0 : chg >= 0.15 ? 1 : chg <= -0.15 ? -1 : 0;
    const word = dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat';
    const C = I.contributors || {}, ups = C.up || [], downs = C.down || [];
    const lead = dir >= 0 ? ups : downs, drag = dir >= 0 ? downs : ups;
    const { withMove, against } = split(I.drivers, dir);
    const results = new Set((I.events || []).filter((e) => e.k === 'results').map((e) => String(e.t).replace(/ results$/, '')));
    const B = I.breadth || {}, tot = (num(B.up) || 0) + (num(B.down) || 0), advPct = tot ? Math.round(100 * B.up / tot) : null;
    const secs = dir >= 0 ? (I.sectors || {}).top || [] : (I.sectors || {}).bottom || [];
    const leadPts = lead.slice(0, 5).reduce((a, x) => a + (num(x.pts) || 0), 0);
    const closed = I.session === 'closed';

    // The story, one sentence at a time, from the numbers.
    const s = [];
    const verb = closed ? (dir > 0 ? 'closed up' : dir < 0 ? 'closed down' : 'closed flat') : (dir > 0 ? 'is up' : dir < 0 ? 'is down' : 'is flat');
    const why = withMove.filter((d) => d.key !== 'breadth').slice(0, 3).map(phrase), despite = against.filter((d) => d.key !== 'breadth').slice(0, 2).map(phrase);
    s.push(`Nifty 50 ${verb} ${pct(chg)} (${pts(p)} points)${dir && why.length ? ' on ' + list(why) : ''}${dir && despite.length ? (why.length ? ', despite ' : ' despite ') + list(despite) : ''}.`);
    if (dir && lead.length) {
      const names = lead.slice(0, 3).map((x) => `${short(x.n)} (${pct(num(x.chg), 1)}, ${pts(num(x.pts))} pts)`);
      s.push(`${list(names)} ${dir > 0 ? 'added' : 'took away'} the most${p ? `; the top five account for about ${Math.round(Math.abs(leadPts))} of the ${Math.round(Math.abs(p))} points` : ''}.`);
    }
    if (secs.length && dir) s.push(`${dir > 0 ? 'Leading' : 'Weakest'} sectors: ${list(secs.map((x) => `${short(x.n)} ${pct(num(x.c), 1)}`))}.`);
    if (advPct !== null && dir) {
      if ((dir > 0 && advPct < 45) || (dir < 0 && advPct > 55)) s.push(`The move was narrow: ${advPct}% of stocks rose${num(I.midcap) !== null ? ` and the Midcap 50 is ${pct(num(I.midcap))}` : ''}, so a few heavyweights carried the index.`);
      else if ((dir > 0 && advPct >= 58) || (dir < 0 && advPct <= 42)) s.push(`The move was broad: ${advPct}% of stocks rose.`);
    }

    const bar = (x, max) => `<div class="mw-cb"><span class="mw-cn" title="${esc(x.n)}">${esc(x.s)}${results.has(x.s) ? ' <em>results</em>' : ''}</span><span class="mw-bar"><i class="${tone(num(x.pts))}" style="width:${Math.max(4, Math.abs(num(x.pts)) / max * 100)}%"></i></span><span class="mw-cv ${tone(num(x.pts))}">${pts(num(x.pts))}</span></div>`;
    const maxPts = Math.max(1, ...[...ups, ...downs].map((x) => Math.abs(num(x.pts) || 0)));
    const hasR = !!(R.india && (R.india.reasons || []).length);
    box.innerHTML = `<div class="mw-card${open.india ? '' : ' mw-c'}">
      <div class="mw-head">
        <div><div class="mw-k">Why is the market ${word} ${closed ? 'today' : 'right now'}?</div>
          <div class="mw-big ${tone(dir)}">Nifty 50 ${pct(chg)} <span>${pts(p)} pts</span></div>
          <div class="mw-sub">Sensex ${pct(num(I.sensex))} · Bank Nifty ${pct(num(I.bank))} · Midcap 50 ${pct(num(I.midcap))}</div></div>
        <div class="mw-asof">${closed ? 'At the close' : 'Live'} · updated ${ago(D.as_of)}</div>
      </div>
      ${sentiBlock(R.india)}
      ${reasonsBlock(R.india, 'india')}
      ${hasR ? '<h4 class="mw-sec mw-x">By the numbers</h4>' : ''}
      <p class="mw-story${hasR ? ' mw-x' : ''}">${s.map(esc).join(' ')}</p>
      <div class="mw-x">
      <div class="mw-grid">
        <div class="mw-col"><h4>Points ${dir >= 0 ? 'added' : 'lost'} by stock <small>Nifty 50, estimated</small></h4>
          ${lead.length ? lead.map((x) => bar(x, maxPts)).join('') : '<p class="mw-none">—</p>'}
          ${drag.length ? `<h5>${dir >= 0 ? 'Held it back' : 'Held up best'}</h5>${drag.slice(0, 3).map((x) => bar(x, maxPts)).join('')}` : ''}
        </div>
        <div class="mw-col"><h4 class="${dir < 0 ? 'down' : 'up'}">Pushing it ${dir < 0 ? 'down' : 'up'}</h4>${driverList(withMove, dir < 0 ? 'neg' : 'pos', 'Nothing beyond the stocks above.')}</div>
        <div class="mw-col"><h4 class="${dir < 0 ? 'up' : 'down'}">Working against it</h4>${driverList(against, dir < 0 ? 'pos' : 'neg', 'Nothing notable against the move.')}</div>
      </div>
      ${(I.events || []).length ? `<div class="mw-events"><b>Today:</b> ${(I.events || []).map((e) => `<span class="mw-chip">${esc(e.t)}</span>`).join('')}</div>` : ''}
      ${headlines(I.headlines) ? `<div class="mw-news"><h4>In the news</h4>${headlines(I.headlines)}</div>` : ''}
      <p class="mw-note">The main reasons are written by AI from the last day's market news; any reason with a number that doesn't match the market data is dropped, but news can be wrong or incomplete. In the numbers, index points are estimated from each Nifty 50 stock's move and free-float size (market cap less promoter holding), so they add to ${num(I.est_pts) !== null ? pts(num(I.est_pts)) : '—'} vs the actual ${pts(p)}. Markets can move for reasons the data doesn't show. Not investment advice.</p>
      </div>
      ${toggle('india')}
    </div>`;
  }

  /* ---------- United States, Europe, Asia ---------- */
  function global() {
    const box = $('mwGlobal'); if (!box || !D || !D.regions) return;
    box.innerHTML = `<div class="mw-card"><div class="mw-head"><div><div class="mw-k">Why global markets moved</div><div class="mw-sub">Each region's latest session, and the moves in yields, currencies, oil and volatility that line up with it.</div></div><div class="mw-asof">Updated ${ago(D.as_of)}</div></div>
      <div class="mw-regions">${D.regions.map((r) => {
        const mv = num(r.move), dir = mv === null ? 0 : mv >= 0.25 ? 1 : mv <= -0.25 ? -1 : 0;
        const { withMove, against } = split(r.drivers, dir);
        const idx = (r.indices || []).filter((x) => num(x.c) !== null);
        const why = withMove.slice(0, 3).map(phrase), despite = against.slice(0, 2).map(phrase);
        const story = dir ? `${r.name === 'Asia' ? 'Asian markets' : r.name === 'Europe' ? 'European markets' : 'US stocks'} ${dir > 0 ? 'rose' : 'fell'}${why.length ? ' alongside ' + list(why) : ''}${despite.length ? ', despite ' + list(despite) : ''}.` : `${r.name} was little changed.`;
        return `<div class="mw-reg${open[r.key] ? '' : ' mw-c'}">
          <div class="mw-reg-h"><b>${esc(r.name)}</b><span class="mw-pill ${tone(dir)}">${pct(mv)}</span></div>
          <div class="mw-idx">${idx.map((x) => `<span>${esc(x.n)} <b class="${tone(num(x.c))}">${pct(num(x.c))}</b></span>`).join('')}</div>
          ${sentiBlock(R[r.key])}
          ${reasonsBlock(R[r.key], r.key)}
          ${R[r.key] && (R[r.key].reasons || []).length ? `<h5 class="mw-x">By the numbers</h5><p class="mw-story sm mw-x">${esc(story)}</p>` : `<p class="mw-story sm">${esc(story)}</p>`}
          <div class="mw-x">
          ${withMove.length ? `<h5 class="${dir < 0 ? 'down' : 'up'}">${dir < 0 ? 'Pushing down' : 'Pushing up'}</h5>${driverList(withMove, dir < 0 ? 'neg' : 'pos', '')}` : ''}
          ${against.length ? `<h5 class="${dir < 0 ? 'up' : 'down'}">Working against</h5>${driverList(against, dir < 0 ? 'pos' : 'neg', '')}` : ''}
          ${R[r.key] && (R[r.key].themes || []).length ? '' : headlines(r.headlines, 'No market headlines for this region in the last day.')}
          </div>
          ${toggle(r.key)}
        </div>`;
      }).join('')}</div>
      <p class="mw-note">The main reasons and the sentiment come from the last day's market news (rated by AI) and are checked against the market data; news can be wrong or incomplete. Index moves are each market's latest session (some are closed now).</p></div>`;
  }

  async function load() {
    if (loading) return; loading = true;
    try {
      const call = (fn) => fetch(SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: '{}' });
      const [r, rr] = await Promise.all([call('market_why'), call('market_reasons').catch(() => null)]);
      if (rr && rr.ok) R = (await rr.json()) || {};
      if (r.ok) { D = await r.json(); lastLoad = Date.now(); india(); global(); }
    } catch (e) { /* keep the last good view */ } finally { loading = false; }
  }
  const visible = (id) => { const el = $(id); return el && el.offsetParent !== null && !document.hidden; };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.mw-toggle'); if (!b) return;
    const k = b.dataset.mw; open[k] = !open[k];
    const card = b.closest('.mw-reg') || b.closest('.mw-card');
    card.classList.toggle('mw-c', !open[k]);
    b.textContent = open[k] ? 'Show less ▴' : 'Read more ▾'; b.setAttribute('aria-expanded', open[k]);
    if (!open[k]) { const top = card.getBoundingClientRect().top; if (top < 0) window.scrollBy({ top: top - 80, behavior: 'smooth' }); }
  });
  function start() {
    if (!$('mwIndia') && !$('mwGlobal')) return;
    load();
    if (!timer) timer = setInterval(() => { if ((visible('mwIndia') || visible('mwGlobal')) && Date.now() - lastLoad > 110e3) load(); }, 15e3);
    // the Global page is a hidden section until opened: draw it (from the cached data) when it appears
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > 110e3) load(); });
  }
  window.mpMarketWhy = { refresh: load, show: () => { if (D) { india(); global(); } if (Date.now() - lastLoad > 110e3) load(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
