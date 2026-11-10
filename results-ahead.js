/* Events page: "Results ahead" (platform admin only). Companies with results on the chosen trading days, ranked by
   their set-up going in (results_ahead() in supabase/results-ahead.sql: the Events preview's rule-based factors plus the
   scanner's swing signal), with this page adding each listed stock's news of the last 7 days (stock-news.js).
   Shows the track record of these leans once results_lean_log has settled some (results_lean_record()).
   Paper / personal use until SEBI RA registration. Uses the page's globals: sb, $, esc, fmtDay, pct, inr, events, detail. */
(function () {
  const KEY = 'mp-results-ahead';
  let st = { days: null, posOnly: true, mcap: 1000 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ posOnly: st.posOnly, mcap: st.mcap })); } catch (e) { /* ignore */ } };
  let data = null, record = null, news = {}, open = {}, box = null, loading = false, limit = 10;

  const css = document.createElement('style');
  css.textContent = `
#resAhead{margin:0 0 14px}
.ra{background:var(--surface);border:1px solid color-mix(in srgb,var(--accent2) 40%,var(--border));border-radius:var(--radius);padding:14px 16px}
.ra-h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
.ra-h h2{margin:0;font-size:17px}
.ra-h small{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}
.ra-ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0 4px}
.ra-ctl .chip{font-size:12px}
.ra-ctl select{padding:5px 8px;border-radius:9px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font:600 12px Inter,system-ui,sans-serif}
.ra-rec{font-size:12.5px;color:var(--muted);margin:6px 0 8px}
.ra-list{display:flex;flex-direction:column}
.ra-row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:4px 12px;padding:10px 4px;border-top:1px solid var(--border);align-items:start}
.ra-row:first-child{border-top:0}
.ra-n{font-weight:800;color:var(--dim);font-size:13px;padding-top:2px}
.ra-t b{font-size:14.5px}
.ra-t .sub{font-size:12px;color:var(--muted)}
.ra-why{margin:4px 0 0;padding-left:16px;font-size:12.5px;line-height:1.5;color:var(--text)}
.ra-why li.n{color:var(--muted)}
.ra-side{text-align:right;display:flex;flex-direction:column;gap:4px;align-items:flex-end}
.ra-score{font-weight:800;font-size:12px;padding:2px 9px;border-radius:999px;white-space:nowrap}
.ra-score.pos{background:var(--greenbg);color:var(--green)}.ra-score.neg{background:var(--redbg);color:var(--red)}.ra-score.mix{background:var(--amberbg);color:var(--amber)}
.ra-mv{font-size:11.5px;color:var(--muted);white-space:nowrap}
.ra-a{border:0;background:none;color:var(--accent2);font:700 12px Inter,system-ui,sans-serif;cursor:pointer;padding:0}
.ra-note{font-size:12px;color:var(--dim);margin-top:10px;line-height:1.55}
.ra-empty{padding:18px;text-align:center;color:var(--muted)}
@media(max-width:700px){.ra-row{grid-template-columns:22px minmax(0,1fr)}.ra-side{grid-column:2;flex-direction:row;align-items:center;justify-content:flex-start;flex-wrap:wrap}}`;
  document.head.appendChild(css);

  const C = window.MP_CONFIG || {};
  const istToday = () => new Date(Date.now() + 330 * 60e3).toISOString().slice(0, 10);
  const addD = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  function nextTradingDays(n) {
    const out = []; let d = istToday();
    for (let i = 0; i < 20 && out.length < n; i++) { d = addD(d, 1); if (C.isTradingDay ? C.isTradingDay(d) : [1, 2, 3, 4, 5].includes(new Date(d + 'T00:00:00Z').getUTCDay())) out.push(d); }
    return out;
  }
  const label = (s) => s >= 1 ? ['Leans positive', 'pos'] : s <= -1 ? ['Leans negative', 'neg'] : ['No clear lean', 'mix'];
  const total = (r) => r.score + (news[r.symbol] && news[r.symbol].w || 0);

  async function load() {
    if (loading) return; loading = true;
    const days = st.days.slice().sort();
    const [a, b] = await Promise.all([
      sb.rpc('results_ahead', { p_from: days[0], p_to: days[days.length - 1], p_min_mcap_cr: st.mcap }),
      record ? Promise.resolve({ data: record }) : sb.rpc('results_lean_record'),
    ]);
    loading = false;
    if (a.error) { box.querySelector('.ra-list').innerHTML = '<div class="ra-empty">Could not load: ' + esc(a.error.message) + '</div>'; return; }
    data = a.data; record = b.data || record;
    paint();
    loadNews();
  }
  // News for the stocks in view (top 15 by the current order), one at a time; each changes the score by ±0.5.
  async function loadNews() {
    if (!window.mpStockNews) return;
    const want = shown().slice(0, 15).filter((r) => !news[r.symbol]);
    for (const r of want) {
      news[r.symbol] = { pending: true, w: 0 };
      const s = await window.mpStockNews.sentiment({ symbol: r.symbol, name: r.company, client: sb }).catch(() => null);
      news[r.symbol] = s && s.score != null ? { s, w: s.score >= 15 ? 0.5 : s.score <= -15 ? -0.5 : 0 } : { s, w: 0 };
      paint();
    }
  }
  function shown() {
    if (!data) return [];
    const days = new Set(st.days);
    return (data.rows || []).filter((r) => days.has(r.date)).sort((x, y) => total(y) - total(x) || (y.mcap_cr || 0) - (x.mcap_cr || 0))
      .filter((r) => !st.posOnly || total(r) >= 1);
  }
  function recordLine() {
    const by = record && record.by_lean || {};
    const p = by.positive, n = by.negative;
    if (!p && !n) return 'Track record: these leans are being logged the day before each company\'s results and checked the day after' + (record && record.pending ? ' (' + record.pending + ' waiting)' : '') + '. Until enough have settled, treat the list as a checklist, not a forecast.';
    const f = (x, nm) => x ? nm + ': ' + x.rose + ' of ' + x.n + ' rose through results (average ' + pct(x.avg) + ')' : '';
    return 'Track record so far: ' + [f(p, 'leans positive'), f(n, 'leans negative')].filter(Boolean).join(' · ') + '.';
  }
  function paint() {
    if (!box) return;
    const days = nextTradingDays(5), counts = {};
    (data && data.rows || []).forEach((r) => { counts[r.date] = (counts[r.date] || 0) + 1; });
    box.querySelector('.ra-ctl').innerHTML = days.map((d, i) => '<button class="chip' + (st.days.includes(d) ? ' on' : '') + '" data-rad="' + d + '">' + (i === 0 ? 'Tomorrow · ' : '') + esc(fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' })) + '</button>').join('') +
      '<button class="chip' + (st.posOnly ? ' on' : '') + '" data-rapos="1">Leaning positive only</button>' +
      '<select data-ramcap aria-label="Smallest company"><option value="1000">Market cap ₹1,000 Cr+</option><option value="5000">₹5,000 Cr+</option><option value="20000">₹20,000 Cr+</option></select>';
    box.querySelector('[data-ramcap]').value = String(st.mcap);
    box.querySelector('.ra-rec').textContent = recordLine();
    const list = shown();
    const all = (data && data.rows || []).filter((r) => st.days.includes(r.date)).length;
    if (!data) { box.querySelector('.ra-list').innerHTML = '<div class="ra-empty">Loading…</div>'; return; }
    if (!list.length) { box.querySelector('.ra-list').innerHTML = '<div class="ra-empty">' + (all ? 'None of the ' + all + ' companies with results on these days leans positive. Turn off "Leaning positive only" to see them all.' : 'No companies above this size have results on these days.') + '</div>'; return; }
    box.querySelector('.ra-list').innerHTML = list.slice(0, limit).map((r, i) => {
      const t = total(r), lb = label(t), nw = news[r.symbol];
      const fs = (r.factors || []).slice().sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
      const top = open[r.symbol] ? fs : fs.filter((f) => f.w).slice(0, 2);
      const extra = [];
      if (r.signal) extra.push('<li class="' + (r.signal.side === 'BUY' ? '' : 'n') + '">' + (r.signal.side === 'BUY' ? '▲ Scanner BUY signal' : '▼ Scanner SELL signal') + ' (' + esc(r.signal.setup || 'swing') + ', entry ' + inr(r.signal.entry) + ', stop ' + inr(r.signal.stop) + ')</li>');
      if (nw && nw.s && nw.s.score != null && (open[r.symbol] || nw.w)) extra.push('<li' + (nw.w ? '' : ' class="n"') + '>' + (nw.w > 0 ? '▲' : nw.w < 0 ? '▼' : '•') + ' News in the last 7 days: ' + esc(nw.s.label.toLowerCase()) + '</li>');
      const st2 = r.stats;
      return '<div class="ra-row"><div class="ra-n">' + (i + 1) + '</div><div class="ra-t"><b>' + esc(r.symbol) + '</b> <span class="sub">' + esc(r.company || '') + '</span>' +
        '<div class="sub">Results ' + esc(fmtDay(r.date, { weekday: 'short', day: 'numeric', month: 'short' })) + ' · ' + inr(r.price) + (r.change_percent != null ? ' (' + pct(r.change_percent) + ')' : '') + ' · ₹' + Number(r.mcap_cr || 0).toLocaleString('en-IN') + ' Cr' + (r.sector ? ' · ' + esc(r.sector) : '') + '</div>' +
        '<ul class="ra-why">' + top.map((f) => '<li' + (f.w ? '' : ' class="n"') + '>' + (f.w > 0 ? '▲ ' : f.w < 0 ? '▼ ' : '• ') + esc(f.t) + '</li>').join('') + extra.join('') + '</ul>' +
        '<button class="ra-a" data-ramore="' + esc(r.symbol) + '">' + (open[r.symbol] ? 'Fewer reasons' : 'All reasons') + '</button> · <button class="ra-a" data-raopen="' + esc(r.id) + '">What to expect →</button></div>' +
        '<div class="ra-side"><span class="ra-score ' + lb[1] + '" title="Score ' + t.toFixed(1) + '">' + lb[0] + ' · ' + (t > 0 ? '+' : '') + t.toFixed(1) + '</span>' +
        (st2 ? '<span class="ra-mv">Usual results move ±' + Number(st2.avgAbs).toFixed(1) + '%</span><span class="ra-mv">Rose after ' + st2.up + ' of ' + st2.n + '</span>' : '') +
        (nw && nw.pending ? '<span class="ra-mv">Reading news…</span>' : '') + '</div></div>';
    }).join('') + (list.length > limit ? '<div class="ra-empty"><button class="chip" data-ramorelist="1">Show ' + Math.min(10, list.length - limit) + ' more</button> <span style="font-size:12px">of ' + (list.length - limit) + ' left</span></div>' : '');
  }
  function mount() {
    const host = document.getElementById('resAhead'); if (!host) return;
    const days = nextTradingDays(5);
    if (!st.days || !st.days.every((d) => days.includes(d))) st.days = days.slice(1, 3); // the day after tomorrow and the next
    host.innerHTML = '<div class="ra"><div class="ra-h"><div><h2>🎯 Results ahead <span class="pill mine">Admin only</span></h2><small>Companies with results on the days you pick, ranked by how things look going in: last quarter\'s trend, sector peers this season, past results-day moves, the run-up versus the Nifty, the scanner\'s signal and the latest news.</small></div></div>' +
      '<div class="ra-ctl"></div><div class="ra-rec"></div><div class="ra-list"><div class="ra-empty">Loading…</div></div>' +
      '<div class="ra-note">Buying before results is a bet on the numbers: shares often gap either way, and a strong quarter can still fall if more was expected. These leans are rule-based, with no analyst estimates, and are not a forecast. If you take a position, keep it small and put the stop beyond the stock\'s usual results-day move. Paper / personal use only.</div></div>';
    box = host.firstChild;
    host.addEventListener('click', (e) => {
      const d = e.target.closest('[data-rad]');
      if (d) { limit = 10; const v = d.dataset.rad; st.days = st.days.includes(v) ? st.days.filter((x) => x !== v) : st.days.concat(v); if (!st.days.length) st.days = [v]; paint(); load(); return; }
      if (e.target.closest('[data-ramorelist]')) { limit += 10; paint(); return; }
      if (e.target.closest('[data-rapos]')) { st.posOnly = !st.posOnly; save(); paint(); loadNews(); return; }
      const m = e.target.closest('[data-ramore]'); if (m) { open[m.dataset.ramore] = !open[m.dataset.ramore]; paint(); return; }
      const o = e.target.closest('[data-raopen]');
      if (o) { const ev = (window.events || events || []).find((x) => x.id === o.dataset.raopen); if (ev) detail(ev); return; }
    });
    host.addEventListener('change', (e) => { if (e.target.matches('[data-ramcap]')) { limit = 10; st.mcap = Number(e.target.value) || 1000; save(); load(); } });
    paint(); load();
  }
  window.mpResultsAhead = { mount };
})();
