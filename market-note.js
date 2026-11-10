/* Home: a one-line note when the Indian market is shut, from the NSE holiday calendar (MP_CONFIG, market_calendar()).
   - On an exchange holiday: "Market closed today for <holiday>", the session the prices are from, and when trading resumes.
   - Up to 3 days ahead: a heads-up that the next weekday is a holiday (e.g. on Friday for a Monday holiday).
   Weekends get no note. Redraws when the fresh calendar arrives and every 10 minutes. Host: #mktNote. */
(function () {
  const C = window.MP_CONFIG;
  if (!C || !C.isTradingDay) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const fmt = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const weekday = (iso) => { const w = new Date(iso + 'T00:00:00Z').getUTCDay(); return w >= 1 && w <= 5; };
  const holName = (iso) => (C.holidayNames && C.holidayNames[iso]) || 'a market holiday';
  const step = (from, dir) => { let d = from; for (let i = 0; i < 15; i++) { d = addDays(d, dir); if (C.isTradingDay(d)) return d; } return null; };
  const sessionOf = (iso) => { const s = (C.specialSessions || []).find((x) => x.date === iso); return s ? { from: s.from, name: s.name } : null; };
  const time = (hm) => { const [h, m] = hm.split(':').map(Number); return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'am' : 'pm'); };

  const css = document.createElement('style');
  css.textContent = `#mktNote{margin:14px 0}#mktNote:empty{display:none}@media(max-width:760px){#mktNote{order:-3}}
.mkn{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-radius:14px;border:1px solid color-mix(in srgb,#f3c969 45%,var(--border,#1f2a46));background:color-mix(in srgb,#f3c969 9%,var(--surface,#0f1629))}
.mkn i{font-style:normal;font-size:20px;line-height:1.2}
.mkn b{display:block;font-size:15px;color:var(--text,inherit)}
.mkn p{margin:3px 0 0;font-size:13px;line-height:1.55;color:var(--text-secondary,var(--muted,#a3aec6))}
.mkn.soon{border-color:var(--border,#1f2a46);background:var(--surface,#0f1629)}`;
  document.head.appendChild(css);

  function render() {
    const host = document.getElementById('mktNote'); if (!host) return;
    const today = C.marketSession().today;
    let html = '';
    if (weekday(today) && !C.isTradingDay(today)) {
      const prev = step(today, -1), next = step(today, 1), sp = next && sessionOf(next);
      html = `<div class="mkn" role="status"><i>🔒</i><div><b>Market closed today for ${esc(holName(today))}</b>
        <p>NSE and BSE are shut for stocks and F&amp;O today${prev ? `, so the prices on the site are from the last session (${esc(fmt(prev))})` : ''}.
        ${next ? `Trading resumes ${esc(fmt(next))} at ${sp ? esc(time(sp.from)) + ' (' + esc(sp.name) + ')' : '9:15 am'}.` : ''}</p></div></div>`;
    } else {
      // Heads-up: the next weekday after today, if it is a holiday and within 3 days.
      let d = today;
      for (let i = 1; i <= 3; i++) {
        d = addDays(today, i);
        if (!weekday(d)) continue;
        if (!C.isTradingDay(d)) {
          const next = step(d, 1);
          html = `<div class="mkn soon" role="status"><i>📅</i><div><b>Market closed ${i === 1 ? 'tomorrow' : 'on ' + esc(fmt(d))} for ${esc(holName(d))}</b>
            <p>${i === 1 ? esc(fmt(d)) + ' is an NSE holiday. ' : ''}Positions held today carry over to ${next ? esc(fmt(next)) : 'the next session'}.</p></div></div>`;
        }
        break;
      }
    }
    if (host.innerHTML !== html) host.innerHTML = html;
  }
  window.addEventListener('mp-market-calendar', render);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
  setInterval(render, 10 * 60e3);
})();
