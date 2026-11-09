/* Muhurat trading 2026: Home card (#muhuratCard), shown from 7 Nov 2026 until the next trading day's pre-market brief
   is out (premarket_brief() dated after the session), and never after 9 Nov.
   Before the session: the timings and a countdown. Pre-open / live: the Nifty's move, refreshed every 30 seconds
   (market_snapshot). After it: how the session went. Always: how the session works, the Nifty in the last 10 Muhurat
   sessions and the Samvat year after each, and Samvat 2082 so far (sectors, best and worst Nifty 50 stocks), from
   festival_stats('muhurat-2026') (supabase/muhurat-2026.sql, built by the muhurat-stats function). */
(function () {
  'use strict';
  const SB = window.MP_CONFIG && window.MP_CONFIG.supabaseUrl, KEY = window.MP_CONFIG && window.MP_CONFIG.supabaseKey;
  if (!SB) return;
  // Session times (IST) as reported from the NSE / BSE circulars.
  const DAY = '2026-11-08', SHOW_FROM = '2026-11-07', SHOW_TO = '2026-11-09';
  const T = { pre: '14:05', open: '14:20', close: '15:30', fno: '15:40' };
  const at = (hm) => Date.parse(DAY + 'T' + hm + ':00+05:30');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const pct = (v, d = 2) => v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
  const n0 = (v) => v === null ? '—' : Math.round(v).toLocaleString('en-IN');
  const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const istDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60e3)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`; };
  const fmtD = (ymd) => new Date(ymd + 'T06:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  let S = null, live = null, open = false, timer = null, superseded = false;
  // Once the next trading day's pre-market brief is out, the Muhurat card has done its job and hides.
  async function checkSuperseded() {
    if (superseded || istDay() <= DAY) return superseded;
    try {
      const r = await fetch(SB + '/rest/v1/rpc/premarket_brief', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: '{}' });
      if (r.ok) { const b = await r.json(); superseded = !!(b && b.date && b.date > DAY); }
    } catch (_) { /* keep showing */ }
    return superseded;
  }

  function phase(now = Date.now()) {
    if (now < at(T.pre)) return 'before';
    if (now < at(T.open)) return 'preopen';
    if (now < at(T.fno)) return 'live';
    return 'after';
  }

  function render() {
    const box = $('muhuratCard'); if (!box) return;
    const d = istDay();
    if (d < SHOW_FROM || d > SHOW_TO || superseded) { box.innerHTML = ''; return; }
    const ph = phase(), H = (S && S.history) || [], past = H.filter((r) => num(r.chg) !== null && r.date < DAY), today = H.find((r) => r.date === DAY);
    const up = past.filter((r) => r.chg > 0).length, avg = past.length ? past.reduce((a, r) => a + r.chg, 0) / past.length : null;
    const contrarian = past.filter((r) => r.chg < 0 && num(r.year) > 0 && r.year_done);
    const Sv = S && S.samvat;

    // the headline, by phase
    let big, sub;
    const L = live && live.price ? { chg: live.prev ? (live.price / live.prev - 1) * 100 : null, pts: live.prev ? live.price - live.prev : null, price: live.price } : null;
    if (ph === 'before') { big = `Muhurat trading · Sun 8 Nov, 2:20 PM`; sub = `Starts in ${dur(at(T.open) - Date.now())} · pre-open 2:05 PM · ends 3:30 PM (F&O 3:40 PM)`; }
    else if (ph === 'preopen') { big = `Muhurat pre-open is on`; sub = `Trading starts at 2:20 PM, in ${dur(at(T.open) - Date.now())}`; }
    else if (ph === 'live') { big = L && L.chg !== null ? `<span class="${tone(L.chg)}">Nifty ${n0(L.price)} ${pct(L.chg)}</span> <span>live</span>` : 'Muhurat session is live'; sub = (L ? '' : 'Live index prices aren’t in from our data source yet; your broker’s app shows them · ') + (Date.now() < at(T.close) ? `Cash market closes in ${dur(at(T.close) - Date.now())} · F&O at 3:40 PM` : 'Cash market closed · F&O until 3:40 PM'); }
    else {
      const r = today && num(today.chg) !== null ? today : L && L.chg !== null ? { chg: L.chg, pts: L.pts, close: L.price } : null;
      big = r ? `<span class="${tone(r.chg)}">Muhurat: Nifty ${pct(num(r.chg))}</span> <span>${r.pts !== null && r.pts !== undefined ? (r.pts >= 0 ? '+' : '−') + n0(Math.abs(r.pts)) + ' pts · ' : ''}closed ${n0(num(r.close))}</span>` : 'Muhurat session is over';
      sub = 'Samvat 2083 has begun · Monday 9 Nov is a normal session · Tuesday 10 Nov is a market holiday';
    }

    const lines = [];
    if (past.length) lines.push(`The Nifty closed higher in ${up} of the last ${past.length} Muhurat sessions, by ${pct(avg)} on average: a small, symbolic move.`);
    if (contrarian.length) lines.push(`The session says little about the year ahead: the Nifty fell in the ${contrarian.map((r) => r.date.slice(0, 4)).join(' and ')} session${contrarian.length > 1 ? 's' : ''} and still rose ${contrarian.map((r) => pct(r.year, 1)).join(' and ')} over ${contrarian.length > 1 ? 'those Samvat years' : 'that Samvat year'}.`);
    if (Sv && Sv.nifty) {
      const s = Sv.sectors || [], top = s.slice(0, 2), bot = s.slice(-1);
      lines.push(`Samvat 2082 so far: Nifty ${pct(Sv.nifty.chg)} since last Diwali${top.length ? `; ${top.map((x) => `${esc(x.n)} ${pct(x.chg, 0)}`).join(' and ')} led` : ''}${bot.length ? `, ${bot.map((x) => `${esc(x.n)} ${pct(x.chg, 0)}`).join('')} lagged` : ''}.`);
    }

    let h = `<div class="mw-card mu-card${open ? '' : ' mw-c'}">
      <div class="mw-head"><div><div class="mw-k">🪔 Diwali Muhurat trading · Samvat 2083</div><div class="mw-big mu-big">${big}</div><div class="mw-sub">${sub}</div></div>
        ${ph === 'live' || ph === 'preopen' ? '<div class="mu-live"><i></i>Live</div>' : ''}</div>
      ${lines.length ? `<ul class="pm-lines">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : ''}`;

    let x = `<div class="pm-sec"><h4>Session times <small>Sunday 8 Nov, IST</small></h4><div class="mu-times">
        <span><small>Pre-open</small>2:05–2:20 PM</span><span><small>Trading</small>2:20–3:30 PM</span><span><small>F&amp;O</small>2:20–3:40 PM</span></div>
        <p class="pm-p mu-small">Some stocks move to a closing auction from 3:15 PM. Times as reported from the exchanges’ circulars; your broker’s app has the final word.</p></div>
      <div class="pm-sec"><h4>How it works</h4><ul class="mu-list">
        <li>A one-hour session that opens the new Hindu financial year, <b>Samvat 2083</b>. Many investors buy a small amount as a good-luck start.</li>
        <li>Trades are real. Delivery buys settle like any other trade, on the next trading day; intraday positions are squared off at the end of the session.</li>
        <li>Volumes are thin and spreads can be wider, so a few large orders move prices more than usual. Limit orders are safer than market orders.</li>
        <li><b>Monday 9 Nov</b> is a normal trading day; <b>Tuesday 10 Nov</b> is a market holiday (Diwali Balipratipada).</li></ul></div>`;
    if (H.length) x += `<div class="pm-sec"><h4>Nifty in past Muhurat sessions <small>session move · the Samvat year after</small></h4>
      <div class="mu-hist"><div class="mu-hr mu-hh"><span>Year</span><span>Date</span><span>Session</span><span>Year after</span></div>
      ${H.slice().reverse().filter((r) => num(r.chg) !== null).map((r) => `<div class="mu-hr"><span>${r.samvat}</span><span>${esc(fmtD(r.date))}</span><span class="${tone(r.chg)}">${pct(num(r.chg))}</span><span class="${tone(r.year)}">${num(r.year) === null ? '—' : pct(num(r.year), 1) + (r.year_done ? '' : ' so far')}</span></div>`).join('')}</div>
      <p class="pm-p mu-small">Year after: the Muhurat close to the next year’s Muhurat close. Weekend sessions (2016, 2019, 2020, 2023) use the published close; the rest come from daily Nifty data.</p></div>`;
    if (Sv) {
      const secs = Sv.sectors || [], mx = Math.max(1, ...secs.map((s) => Math.abs(s.chg)));
      const stk = (a) => a.map((s) => `<a class="mu-st" href="/stock-analysis.html?symbol=${encodeURIComponent(s.s)}" title="${esc(s.n)}: ₹${s.from} → ₹${s.to}"><b>${esc(s.s)}</b><em class="${tone(s.chg)}">${pct(s.chg, 1)}</em></a>`).join('');
      x += `<div class="pm-sec"><h4>Samvat 2082 so far <small>${esc(fmtD(Sv.from))} → ${esc(fmtD(Sv.to))}</small></h4>
        ${Sv.nifty ? `<p class="pm-p">Nifty 50 <b class="${tone(Sv.nifty.chg)}">${pct(Sv.nifty.chg)}</b> (${n0(Sv.nifty.from)} → ${n0(Sv.nifty.to)}) · ${Sv.stocks_up} of ${Sv.stocks_n} Nifty stocks are up.</p>` : ''}
        <div class="mu-secs">${secs.map((s) => `<div class="mu-sr"><span>${esc(s.n)}</span><span class="mu-bar"><i class="${s.chg >= 0 ? 'p' : 'n'}" style="width:${Math.abs(s.chg) / mx * 50}%;${s.chg >= 0 ? 'left:50%' : 'right:50%'}"></i></span><b class="${tone(s.chg)}">${pct(s.chg, 1)}</b></div>`).join('')}</div>
        <div class="mu-two"><div><h5>Best Nifty 50 stocks</h5>${stk(Sv.best || [])}</div><div><h5>Worst Nifty 50 stocks</h5>${stk(Sv.worst || [])}</div></div></div>`;
    }
    x += `<div class="pm-sec"><a class="mu-cta" href="/picks.html">✨ Our Diwali picks for Samvat 2083, with a live track record →</a></div>
      <p class="mw-note">Past Muhurat sessions don’t predict the year ahead. This is information, not a recommendation to buy or sell.</p>`;
    h += `<div class="mw-x">${x}</div><button type="button" class="mw-toggle" data-mu aria-expanded="${open}">${open ? 'Show less ▴' : 'Read more ▾'}</button></div>`;
    box.innerHTML = h;
  }

  async function loadStats() {
    try {
      const r = await fetch(SB + '/rest/v1/rpc/festival_stats', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_key: 'muhurat-2026' }) });
      if (r.ok) S = await r.json();
    } catch (_) { /* keep */ }
  }
  // Live Nifty from the site's index table (market_snapshot: price and the true previous close). index-sparklines
  // was tried first, but on the Muhurat Sunday its previous close and chart points were from earlier sessions.
  async function loadLive() {
    try {
      const r = await fetch(SB + '/rest/v1/rpc/market_snapshot', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) return;
      const n = (await r.json() || []).find((x) => x.symbol === '^NSEI');
      // only a reading refreshed on the Muhurat day counts as live
      const upd = n && n.updated_at ? new Date(n.updated_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null;
      live = n && num(n.price) && num(n.previous_close) && upd === DAY ? { price: num(n.price), prev: num(n.previous_close) } : null;
    } catch (_) { /* keep */ }
  }
  async function tick() {
    const ph = phase();
    if (ph === 'live' || ph === 'preopen' || (ph === 'after' && Date.now() < at(T.fno) + 3 * 3600e3)) await loadLive();
    if (ph === 'after' && (!S || !(S.history || []).some((r) => r.date === DAY && num(r.chg) !== null))) await loadStats();
    render();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-mu]'); if (!b) return;
    open = !open; const card = b.closest('.mw-card'); card.classList.toggle('mw-c', !open);
    b.textContent = open ? 'Show less ▴' : 'Read more ▾'; b.setAttribute('aria-expanded', open);
    if (!open) { const top = card.getBoundingClientRect().top; if (top < 0) window.scrollBy({ top: top - 80, behavior: 'smooth' }); }
  });
  async function start() {
    const d = istDay(); if (d < SHOW_FROM || d > SHOW_TO) return;
    if (await checkSuperseded()) { render(); return; }
    await loadStats(); await tick();
    timer = setInterval(async () => { if (document.hidden) return; if (await checkSuperseded()) { clearInterval(timer); render(); return; } tick(); }, 30e3);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
