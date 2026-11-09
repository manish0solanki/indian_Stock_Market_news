/* Pre-market brief: Home card (#pmBrief). Data: premarket_brief() (supabase/premarket-brief.sql), built by the
   premarket-brief Edge Function at 7:45 and 8:50 AM IST on weekdays.
   Opens in full before 9:30 AM IST on the brief's own day; otherwise it shows as a summary (the open GIFT Nifty
   points to and the lines on what to watch) with Read more. When signed in, stocks you hold that are in the news
   since the last close are listed in the summary too (matched in the browser; your holdings are not sent anywhere). */
(function () {
  'use strict';
  const SB = window.MP_CONFIG && window.MP_CONFIG.supabaseUrl, KEY = window.MP_CONFIG && window.MP_CONFIG.supabaseKey;
  if (!SB) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const pct = (v, d = 2) => v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
  const sgn = (v, d = 0) => v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
  const n0 = (v) => v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-IN');
  const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const safeUrl = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (_) { return ''; } };
  const IST = { timeZone: 'Asia/Kolkata' };
  const istDay = (d = new Date()) => d.toLocaleDateString('en-CA', IST); // YYYY-MM-DD
  const istMin = (d = new Date()) => { const p = d.toLocaleTimeString('en-GB', { ...IST, hour12: false }).split(':'); return +p[0] * 60 + +p[1]; };
  const dayName = (ymd) => new Date(ymd + 'T06:00:00Z').toLocaleDateString('en-IN', { ...IST, weekday: 'short', day: 'numeric', month: 'short' });
  const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-IN', { ...IST, hour: 'numeric', minute: '2-digit' });
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const KIND = { dividend: 'Dividend', bonus: 'Bonus', buyback: 'Buyback', split: 'Split', action: 'Corporate action', board: 'Board meeting', fundraise: 'Fund raise' };

  let B = null, held = null, open = null, loading = false, at = 0;

  function render() {
    const box = $('pmBrief'); if (!box) return;
    if (!B || !B.date) { box.innerHTML = ''; return; }
    const today = istDay(), isToday = B.date === today, early = isToday && istMin() < 9 * 60 + 30;
    if (open === null) open = early; // full before 9:30 AM on the day, a summary after
    const G = B.gift, Nf = B.nifty, wk = new Date().getUTCDay(), weekend = wk === 0 || wk === 6;
    const gdir = G && G.pct !== null ? (Math.abs(G.pct) < 0.15 ? 'a flat' : G.pct > 0 ? 'a higher' : 'a lower') : null;
    const mine = held && held.size ? (B.news || []).filter((x) => held.has(x.symbol)) : [];
    const mineSyms = [...new Set(mine.map((x) => x.symbol))];

    let h = `<div class="mw-card pm-card${open ? '' : ' mw-c'}">
      <div class="mw-head"><div>
        <div class="mw-k">${isToday ? 'Pre-market brief' : 'Last pre-market brief'} · ${esc(dayName(B.date))}</div>
        ${G ? `<div class="mw-big ${tone(G.pct)}">GIFT Nifty ${n0(G.price)} <span>${sgn(G.pts)} pts (${pct(G.pct)})</span></div>
          <div class="mw-sub">${esc(G.basis)}${gdir ? ` · points to ${gdir} open${G.implied_open ? ' near ' + n0(G.implied_open) : ''}` : ''}${B.vix ? ` · India VIX ${B.vix.price}${num(B.vix.chg) !== null ? ` (${pct(num(B.vix.chg), 1)})` : ''}` : ''}</div>`
          : `<div class="mw-big">Before the open</div>`}
      </div><div class="mw-asof">Built ${esc(timeOf(B.built_at))} IST · ${esc(ago(B.built_at))}${!isToday ? `<br>${weekend ? 'Next brief Monday 7:45 AM' : 'Next brief 7:45 AM'}` : ''}</div></div>`;
    if ((B.lines || []).length) h += `<ul class="pm-lines">${B.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
    if (mineSyms.length) h += `<div class="pm-mine"><b>Your stocks in the news:</b> ${mineSyms.map((s) => { const t = mine.filter((x) => x.symbol === s).reduce((a, x) => a + x.t, 0); return `<a class="mw-chip ${tone(t)}" href="/stock-analysis.html?symbol=${encodeURIComponent(s)}">${esc(s)}</a>`; }).join(' ')}</div>`;

    // ---------- full brief ----------
    let x = '';
    const lv = (name, L) => L ? `<div class="pm-lv"><div class="pm-lv-h"><b>${name}</b><span>Last close ${n0(L.close)}${num(L.chg) !== null ? ` <em class="${tone(L.chg)}">${pct(L.chg)}</em>` : ''} · ${L.pivots_from === 'the last full session' ? 'levels from the last full session' : 'range'} ${n0(L.low)}–${n0(L.high)}</span></div>
      <div class="pm-lv-row"><span class="down"><small>S2</small>${n0(L.S2)}</span><span class="down"><small>S1</small>${n0(L.S1)}</span><span><small>Pivot</small>${n0(L.P)}</span><span class="up"><small>R1</small>${n0(L.R1)}</span><span class="up"><small>R2</small>${n0(L.R2)}</span></div></div>` : '';
    if (Nf || B.bank) x += `<div class="pm-sec"><h4>Levels for today <small>pivots from ${esc((Nf && Nf.pivots_from) || 'the last session')}</small></h4>${lv('Nifty 50', Nf)}${lv('Bank Nifty', B.bank)}</div>`;
    if ((B.regions || []).length) x += `<div class="pm-sec"><h4>Overnight</h4>${B.regions.map((r) => `<div class="pm-reg"><div class="pm-reg-h"><b>${esc(r.name)}</b><span class="mw-pill ${tone(r.move)}">${pct(num(r.move))}</span>${r.sentiment ? `<span class="pm-sent ${tone(r.sentiment.score >= 15 ? 1 : r.sentiment.score <= -15 ? -1 : 0)}">News: ${esc(r.sentiment.label)}</span>` : ''}</div>
        ${(r.reasons || []).length ? `<div class="pm-why">${r.reasons.slice(0, 2).map(esc).join(' · ')}</div>` : ''}</div>`).join('')}
      <a class="pm-more" href="/#global">Why global markets moved →</a></div>`;
    if ((B.drivers || []).length) x += `<div class="pm-sec"><h4>Other markets</h4><div class="pm-drv">${B.drivers.map((d) => `<span class="${d.impact > 0 ? 'pos' : d.impact < 0 ? 'neg' : ''}" title="${esc(d.why || '')}"><b>${esc(d.label)}</b> ${esc(d.value)}</span>`).join('')}</div></div>`;
    if (B.flows) { const F = B.flows; x += `<div class="pm-sec"><h4>Money flows <small>${esc(dayName(F.date))}, ₹ Cr</small></h4><div class="pm-flow">
        <span><small>FII</small><b class="${tone(F.fii)}">${sgn(num(F.fii))}</b></span><span><small>DII</small><b class="${tone(F.dii)}">${sgn(num(F.dii))}</b></span>
        <span><small>FII, ${F.days} sessions</small><b class="${tone(F.fii5)}">${sgn(num(F.fii5))}</b></span><span><small>DII, ${F.days} sessions</small><b class="${tone(F.dii5)}">${sgn(num(F.dii5))}</b></span></div></div>`; }
    const E = B.events || {}, econToday = (B.econ || []).filter((e) => e.date === B.date), econLater = (B.econ || []).filter((e) => e.date !== B.date);
    if (E.results_n || (E.actions || []).length || (B.econ || []).length) {
      x += `<div class="pm-sec"><h4>Today</h4>`;
      if (E.results_n) x += `<p class="pm-p"><b>${E.results_n} result${E.results_n === 1 ? '' : 's'}</b>, largest first: ${E.results.map((e) => `<a class="mw-chip" href="/stock-analysis.html?symbol=${encodeURIComponent(e.symbol)}" title="${esc(e.company || '')}">${esc(e.symbol)}</a>`).join(' ')}${E.results_n > E.results.length ? ` <a class="pm-more" href="/events.html">+${E.results_n - E.results.length} more →</a>` : ''}</p>`;
      if ((E.actions || []).length) x += `<p class="pm-p"><b>Corporate actions:</b> ${E.actions.map((e) => `<span class="mw-chip" title="${esc(e.title || '')}">${esc(e.symbol)} · ${esc(KIND[e.kind] || e.kind)}</span>`).join(' ')}</p>`;
      if (econToday.length) x += `<p class="pm-p"><b>Economic data:</b> ${econToday.map((e) => `${esc(e.title)}${e.time ? ' at ' + esc(e.time) + ' IST' : ''}`).join('; ')}</p>`;
      if (econLater.length) x += `<p class="pm-p"><b>Later this week:</b> ${econLater.map((e) => `${esc(e.title)} (${esc(dayName(e.date))}${e.confirmed === false ? ', date expected' : ''})`).join('; ')}</p>`;
      x += '</div>';
    }
    const head = (n) => { const u = safeUrl(n.url); return `<li><i class="pm-dot ${tone(n.t)}"></i><a class="pm-sym" href="/stock-analysis.html?symbol=${encodeURIComponent(n.symbol)}">${esc(n.symbol)}</a> ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)}</li>`; };
    if (mine.length) x += `<div class="pm-sec"><h4>Your stocks in the news</h4><ul class="pm-news">${mine.slice(0, 8).map(head).join('')}</ul></div>`;
    if ((B.focus || []).length) x += `<div class="pm-sec"><h4>Stocks in focus <small>news since the last close</small></h4><ul class="pm-news">${B.focus.map(head).join('')}</ul></div>`;
    x += `<p class="mw-note">${B.writer && String(B.writer).startsWith('moonshot') ? 'The lines at the top are written by AI from the facts below; any line with a number not in the data is dropped. ' : ''}GIFT Nifty is the Nifty future traded at GIFT City; its move ${G && G.basis === 'since our close' ? 'since 3:35 PM yesterday' : 'since its last session'} is applied to the Nifty's close to estimate the open. Levels are standard floor pivots from the last session's high, low and close. Not investment advice.</p>`;
    h += `<div class="mw-x">${x}</div><button type="button" class="mw-toggle" data-pm aria-expanded="${open}">${open ? 'Show less ▴' : 'Read more ▾'}</button></div>`;
    box.innerHTML = h;
  }

  async function holdings() {
    try {
      if (typeof supabaseClient === 'undefined' || !window.mpPortfolio) return;
      const { data } = await supabaseClient.auth.getSession(); const user = data && data.session && data.session.user;
      if (!user) { held = null; return; }
      const snap = window.mpPortfolio.cached(user);
      const syms = snap && snap.stocks ? snap.stocks.map((s) => s.id) : await window.mpPortfolio.heldSymbols(supabaseClient, user);
      held = new Set((syms || []).map((s) => String(s).toUpperCase()));
    } catch (_) { /* no holdings shown */ }
  }
  async function load() {
    if (loading) return; loading = true;
    try {
      const r = await fetch(SB + '/rest/v1/rpc/premarket_brief', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: '{}' });
      if (r.ok) { B = await r.json(); at = Date.now(); render(); }
      await holdings(); render();
    } catch (_) { /* keep the last view */ } finally { loading = false; }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-pm]'); if (!b) return;
    open = !open; const card = b.closest('.mw-card'); card.classList.toggle('mw-c', !open);
    b.textContent = open ? 'Show less ▴' : 'Read more ▾'; b.setAttribute('aria-expanded', open);
    if (!open) { const top = card.getBoundingClientRect().top; if (top < 0) window.scrollBy({ top: top - 80, behavior: 'smooth' }); }
  });
  // refresh every 5 minutes while open (picks up the 8:50 AM rebuild); a new day starts collapsed or open again by the clock
  setInterval(() => { if (!document.hidden && Date.now() - at > 5 * 60e3) { const d = B && B.date; load().then(() => { if (B && B.date !== d) { open = null; render(); } }); } }, 60e3);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
  window.mpPremarket = { refresh: load };
})();
