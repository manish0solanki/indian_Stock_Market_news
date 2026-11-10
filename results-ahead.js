/* Events page: "Results ahead" (platform admin only). Companies with results on the chosen trading days, ranked by
   their set-up going in (results_ahead() in supabase/results-ahead.sql: the Events preview's rule-based factors plus the
   scanner's swing signal), with this page adding each listed stock's news of the last 7 days (stock-news.js).
   Shows the track record of these leans once results_lean_log has settled some (results_lean_record()).
   "Paper trade" places a BUY in the Signals paper account (stock_paper_trades, source 'results-ahead') at the last price,
   sized from an amount you enter, with the stop 1.5x the stock's usual results-day move below (at least 3%, at most 15%)
   so a normal results gap doesn't stop it out, and targets at 2x and 3x that distance. The paper monitor manages it.
   Layout: a swipeable row of cards (the top 15), with "Show all" opening the full list and "Close" returning to the cards.
   Paper / personal use until SEBI RA registration. Uses the page's globals: sb, $, esc, fmtDay, pct, inr, events, detail, user. */
(function () {
  const KEY = 'mp-results-ahead';
  let st = { days: null, posOnly: true, mcap: 1000, amount: 10000 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ posOnly: st.posOnly, mcap: st.mcap, amount: st.amount })); } catch (e) { /* ignore */ } };
  let data = null, record = null, news = {}, open = {}, box = null, loading = false, limit = 10;
  let mode = 'cards', info = false; // 'cards' (carousel) or 'list' (show all); the "How it works" box
  let held = new Set(), ticket = null; // open paper positions (symbols); the row whose order form is open
  const me = () => (typeof user !== 'undefined' && user) || null;
  async function loadHeld() {
    if (!me()) return;
    const { data: rows } = await sb.from('stock_paper_trades').select('symbol').eq('user_id', me().id).eq('status', 'OPEN');
    held = new Set((rows || []).map((r) => r.symbol));
  }
  // The order for a row: stop beyond the usual results-day move, targets at 2x and 3x.
  function plan(r, amount) {
    const mv = r.stats && Number(r.stats.avgAbs) > 0 ? Number(r.stats.avgAbs) : 4;
    const sp = Math.min(15, Math.max(3, mv * 1.5)) / 100, px = Number(r.price);
    const qty = Math.floor(amount / px);
    const r2 = (v) => Math.round(v * 20) / 20; // to the 5-paise tick
    return { qty, px, stop: r2(px * (1 - sp)), t1: r2(px * (1 + 2 * sp)), t2: r2(px * (1 + 3 * sp)), sp, risk: Math.round(qty * px * sp), cost: Math.round(qty * px), mv };
  }
  async function place(r) {
    if (!me()) { alert('Sign in to paper trade.'); return; }
    const p = plan(r, st.amount);
    if (!(p.qty > 0)) return;
    const now = new Date().toISOString(), t = total(r);
    const row = {
      user_id: me().id, symbol: r.symbol, timeframe: 'swing', direction: 'BUY', setup: 'Results play', score: Math.round(t * 10),
      entry_price: p.px, stop_loss: p.stop, target_1: p.t1, target_2: p.t2, quantity: p.qty, risk_budget: Math.round((p.px - p.stop) * p.qty * 100) / 100,
      signal_time: now, source: 'results-ahead', status: 'OPEN', opened_at: now,
      signal_snapshot: { results_date: r.date, lean_score: t, factors: r.factors, usual_results_move: p.mv, stop_pct: Math.round(p.sp * 1000) / 10,
        estimated_cost_bps: 10, original_quantity: p.qty, replay_until: Date.now(), mark_price: p.px, mark_source: 'order fill at LTP', fill_model: 'market order at last price' },
    };
    const btn = box.querySelector('[data-raplace]'); if (btn) { btn.disabled = true; btn.textContent = 'Placing…'; }
    const { error } = await sb.from('stock_paper_trades').insert(row);
    if (error) { alert(error.code === '23505' ? r.symbol + ' is already open in your paper account.' : 'Could not place: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Place paper trade'; } return; }
    held.add(r.symbol); ticket = null; paint();
  }
  function ticketHtml(r) {
    return '<div class="ra-tk" data-ratkfor="' + esc(r.symbol) + '"><label>Amount ₹ <input type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done" value="' + st.amount + '" data-raamt aria-label="Amount to invest"></label>' +
      '<div class="ra-tk-calc">' + calcHtml(r) + '</div></div>';
  }
  // The part of the order form that follows the amount: quantity, stop, targets, max loss, and the buttons.
  function calcHtml(r) {
    const p = plan(r, st.amount);
    return (p.qty > 0 ? '<div class="ra-tk-l">Buy <b>' + p.qty + '</b> at about ' + inr(p.px) + ' = ' + inr(p.cost, 0) + ' · stop ' + inr(p.stop) + ' (−' + (p.sp * 100).toFixed(1) + '%, 1.5× its usual ±' + p.mv.toFixed(1) + '% results move) · targets ' + inr(p.t1) + ' / ' + inr(p.t2) + ' · <b class="neg">max loss about ' + inr(p.risk, 0) + '</b> if the stop fills (a gap can make it worse)</div>'
        : '<div class="ra-tk-l neg">' + inr(st.amount, 0) + ' is less than one share at ' + inr(p.px) + '.</div>') +
      '<div class="ra-tk-b"><button class="chip on" data-raplace="' + esc(r.symbol) + '"' + (p.qty > 0 ? '' : ' disabled') + '>Place paper trade</button><button class="chip" data-racancel="1">Cancel</button></div>';
  }

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
.ra-pt{border:1px solid var(--accent2);background:none;color:var(--accent2);border-radius:8px;padding:3px 9px;font:700 11.5px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.ra-pt.done{border-color:transparent;color:var(--green);cursor:default}
.ra-tk{grid-column:2/-1;margin-top:6px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);font-size:12.5px}
.ra-tk input{width:110px;padding:5px 8px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);margin-left:4px}
.ra-tk-l{margin:8px 0;line-height:1.55}
.ra-tk-b{display:flex;gap:8px}
.ra-note{font-size:12px;color:var(--dim);margin-top:10px;line-height:1.55}
.ra-h small{display:block}
.ra-hb{display:flex;gap:6px;align-items:center}
.ra-x{border:1px solid var(--border);background:var(--surface2);color:var(--text);border-radius:9px;padding:5px 10px;font:700 12px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.ra-ctl{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.ra-ctl::-webkit-scrollbar{display:none}
.ra-ctl .chip,.ra-ctl select{flex:0 0 auto}
.ra-info{margin:8px 0;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);font-size:12.5px;line-height:1.55}
.ra-info table{border-collapse:collapse;margin:6px 0;width:100%}
.ra-info td{padding:3px 6px;border-bottom:1px solid var(--border);vertical-align:top}
.ra-info td:last-child{white-space:nowrap;font-weight:700}
.ra-wrap{position:relative}
.ra-track{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;padding:4px 2px 10px;scrollbar-width:thin;overscroll-behavior-x:contain}
.ra-card{flex:0 0 268px;scroll-snap-align:start;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.ra-card.sel{border-color:var(--accent2)}
.ra-card .top{display:flex;justify-content:space-between;align-items:flex-start;gap:6px}
.ra-card .rk{font-size:11px;font-weight:800;color:var(--dim)}
.ra-card b.sym{font-size:15px;display:block}
.ra-card .co{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ra-card .meta{font-size:11.5px;color:var(--muted)}
.ra-card ul{margin:0;padding-left:15px;font-size:12px;line-height:1.45}
.ra-card ul li{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ra-card .stats{display:flex;gap:10px;font-size:11.5px;color:var(--muted)}
.ra-card .act{display:flex;gap:8px;align-items:center;margin-top:auto;padding-top:4px}
.ra-more-card{flex:0 0 160px;scroll-snap-align:start;border:1px dashed var(--border);border-radius:12px;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px}
.ra-nav{position:absolute;top:50%;transform:translateY(-60%);width:34px;height:34px;border-radius:50%;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:18px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3);z-index:2}
.ra-nav.l{left:-10px}.ra-nav.r{right:-10px}
.ra-tkbox .ra-tk{margin-top:4px}
@media(max-width:700px){.ra-nav{display:none}.ra-card{flex-basis:82%}.ra{padding:12px}}
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
    // Anything that redraws the panel (news arriving, a filter) keeps the amount box as it was: text, focus and caret.
    const act = document.activeElement, typing = act && act.matches && act.matches('[data-raamt]') && box.contains(act);
    const keep = typing ? { v: act.value, a: act.selectionStart, b: act.selectionEnd } : null;
    paintInner();
    if (keep) {
      const inp = box.querySelector('[data-raamt]');
      if (inp) { inp.value = keep.v; inp.focus({ preventScroll: true }); try { inp.setSelectionRange(keep.a, keep.b); } catch (_) { /* ignore */ } }
    }
  }
  function paintInner() {
    const days = nextTradingDays(5), counts = {};
    (data && data.rows || []).forEach((r) => { counts[r.date] = (counts[r.date] || 0) + 1; });
    box.querySelector('.ra-ctl').innerHTML = days.map((d, i) => '<button class="chip' + (st.days.includes(d) ? ' on' : '') + '" data-rad="' + d + '">' + (i === 0 ? 'Tomorrow · ' : '') + esc(fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' })) + '</button>').join('') +
      '<button class="chip' + (st.posOnly ? ' on' : '') + '" data-rapos="1">Leaning positive only</button>' +
      '<select data-ramcap aria-label="Smallest company"><option value="1000">Market cap ₹1,000 Cr+</option><option value="5000">₹5,000 Cr+</option><option value="20000">₹20,000 Cr+</option></select>';
    box.querySelector('[data-ramcap]').value = String(st.mcap);
    box.querySelector('.ra-infobox').innerHTML = info ? infoHtml() : '';
    box.querySelector('[data-ramode]').textContent = mode === 'list' ? 'Close' : 'Show all' + (data ? ' (' + shown().length + ')' : '');
    const list = shown();
    const all = (data && data.rows || []).filter((r) => st.days.includes(r.date)).length;
    const lb0 = box.querySelector('.ra-list');
    if (!data) { lb0.innerHTML = '<div class="ra-empty">Loading…</div>'; return; }
    if (!list.length) { lb0.innerHTML = '<div class="ra-empty">' + (all ? 'None of the ' + all + ' companies with results on these days leans positive. Turn off "Leaning positive only" to see them all.' : 'No companies above this size have results on these days.') + '</div>'; box.querySelector('.ra-tkbox').innerHTML = ''; return; }
    if (mode === 'cards') {
      const prev = box.querySelector('.ra-track'), sl = prev ? prev.scrollLeft : 0;
      const top = list.slice(0, 15);
      lb0.innerHTML = '<div class="ra-wrap"><button class="ra-nav l" data-ranav="-1" aria-label="Previous">‹</button><div class="ra-track">' +
        top.map((r, i) => cardHtml(r, i)).join('') +
        (list.length > top.length ? '<div class="ra-more-card"><button class="ra-x" data-ramode="1">Show all ' + list.length + ' →</button></div>' : '') +
        '</div><button class="ra-nav r" data-ranav="1" aria-label="Next">›</button></div>';
      const tr = box.querySelector('.ra-track'); tr.style.scrollBehavior = 'auto'; tr.scrollLeft = sl; tr.style.scrollBehavior = '';
      const tr2 = list.find((r) => r.symbol === ticket);
      box.querySelector('.ra-tkbox').innerHTML = tr2 ? '<div style="font-size:12.5px;font-weight:700;margin-top:4px">Paper trade ' + esc(tr2.symbol) + '</div>' + ticketHtml(tr2) : '';
      return;
    }
    box.querySelector('.ra-tkbox').innerHTML = '';
    lb0.innerHTML = list.slice(0, limit).map((r, i) => rowHtml(r, i)).join('') +
      (list.length > limit ? '<div class="ra-empty"><button class="chip" data-ramorelist="1">Show ' + Math.min(10, list.length - limit) + ' more</button> <span style="font-size:12px">of ' + (list.length - limit) + ' left</span></div>' : '') +
      '<div class="ra-empty"><button class="ra-x" data-ramode="1">Close list</button></div>';
  }
  // Reasons for a row: the scored factors (biggest first), the scanner's signal and the news read.
  function reasons(r, all) {
    const nw = news[r.symbol];
    const fs = (r.factors || []).slice().sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    const out = (all ? fs : fs.filter((f) => f.w)).map((f) => ({ w: f.w, t: f.t }));
    if (r.signal) out.push({ w: r.signal.side === 'BUY' ? 1 : -1, t: 'Scanner ' + r.signal.side + ' signal (' + (r.signal.setup || 'swing') + ', entry ' + inr(r.signal.entry) + ', stop ' + inr(r.signal.stop) + ')' });
    if (nw && nw.s && nw.s.score != null && (all || nw.w)) out.push({ w: nw.w, t: 'News in the last 7 days: ' + nw.s.label.toLowerCase() });
    return out;
  }
  const li = (x) => '<li' + (x.w ? '' : ' class="n"') + '>' + (x.w > 0 ? '▲ ' : x.w < 0 ? '▼ ' : '• ') + esc(x.t) + '</li>';
  const scorePill = (t) => { const lb = label(t); return '<span class="ra-score ' + lb[1] + '" title="Points: see How it works">' + lb[0] + ' · ' + (t > 0 ? '+' : '') + t.toFixed(1) + '</span>'; };
  const tradeBtn = (r) => held.has(r.symbol) ? '<span class="ra-pt done">✓ In paper portfolio</span>' : '<button class="ra-pt" data-ratk="' + esc(r.symbol) + '">' + (ticket === r.symbol ? 'Close order' : 'Paper trade') + '</button>';
  function cardHtml(r, i) {
    const t = total(r), st2 = r.stats, nw = news[r.symbol];
    return '<div class="ra-card' + (ticket === r.symbol ? ' sel' : '') + '"><div class="top"><div style="min-width:0"><span class="rk">#' + (i + 1) + '</span> <b class="sym">' + esc(r.symbol) + '</b><div class="co">' + esc(r.company || '') + '</div></div>' + scorePill(t) + '</div>' +
      '<div class="meta">Results ' + esc(fmtDay(r.date, { weekday: 'short', day: 'numeric', month: 'short' })) + ' · ' + inr(r.price) + (r.change_percent != null ? ' (' + pct(r.change_percent) + ')' : '') + '</div>' +
      '<ul>' + reasons(r, false).slice(0, 3).map(li).join('') + '</ul>' +
      (st2 ? '<div class="stats"><span>Usual move ±' + Number(st2.avgAbs).toFixed(1) + '%</span><span>Rose after ' + st2.up + '/' + st2.n + '</span>' + (nw && nw.pending ? '<span>news…</span>' : '') + '</div>' : '') +
      '<div class="act">' + tradeBtn(r) + '<button class="ra-a" data-raopen="' + esc(r.id) + '">What to expect →</button></div></div>';
  }
  function rowHtml(r, i) {
    const t = total(r), st2 = r.stats, nw = news[r.symbol];
    const rs = reasons(r, !!open[r.symbol]);
    return '<div class="ra-row"><div class="ra-n">' + (i + 1) + '</div><div class="ra-t"><b>' + esc(r.symbol) + '</b> <span class="sub">' + esc(r.company || '') + '</span>' +
      '<div class="sub">Results ' + esc(fmtDay(r.date, { weekday: 'short', day: 'numeric', month: 'short' })) + ' · ' + inr(r.price) + (r.change_percent != null ? ' (' + pct(r.change_percent) + ')' : '') + ' · ₹' + Number(r.mcap_cr || 0).toLocaleString('en-IN') + ' Cr' + (r.sector ? ' · ' + esc(r.sector) : '') + '</div>' +
      '<ul class="ra-why">' + (open[r.symbol] ? rs : rs.slice(0, 3)).map(li).join('') + '</ul>' +
      '<button class="ra-a" data-ramore="' + esc(r.symbol) + '">' + (open[r.symbol] ? 'Fewer reasons' : 'All reasons') + '</button> · <button class="ra-a" data-raopen="' + esc(r.id) + '">What to expect →</button></div>' +
      '<div class="ra-side">' + scorePill(t) +
      (st2 ? '<span class="ra-mv">Usual results move ±' + Number(st2.avgAbs).toFixed(1) + '%</span><span class="ra-mv">Rose after ' + st2.up + ' of ' + st2.n + '</span>' : '') +
      (nw && nw.pending ? '<span class="ra-mv">Reading news…</span>' : '') + tradeBtn(r) + '</div>' +
      (ticket === r.symbol ? ticketHtml(r) : '') + '</div>';
  }
  function infoHtml() {
    return '<div class="ra-info"><b>The score</b> adds up points for each reason (from −5 to +5): +1 or more is "Leans positive", −1 or less "Leans negative".' +
      '<table><tr><td>Last quarter\'s profit vs a year ago: up 15%+ / down 15%+</td><td>+1 / −1</td></tr>' +
      '<tr><td>Last quarter\'s revenue: up 12%+ / shrank</td><td>+0.5 / −0.5</td></tr>' +
      '<tr><td>Sector peers this season: mostly positive / mostly negative</td><td>+1 / −1</td></tr>' +
      '<tr><td>Shares rose / fell after 3 in 4 past results</td><td>+0.5 / −0.5</td></tr>' +
      '<tr><td>Last 20 sessions vs the Nifty: 8+ points behind / ahead</td><td>+0.5 / −0.5</td></tr>' +
      '<tr><td>Scanner swing signal: BUY / SELL</td><td>+1 / −1</td></tr>' +
      '<tr><td>News in the last 7 days: positive / negative</td><td>+0.5 / −0.5</td></tr></table>' +
      esc(recordLine()) + '<div class="ra-note" style="margin-top:6px">Buying before results is a bet on the numbers: shares often gap either way, and a strong quarter can still fall if more was expected. These leans are rule-based, with no analyst estimates, and are not a forecast. If you take a position, keep it small and put the stop beyond the stock\'s usual results-day move. Paper / personal use only.</div></div>';
  }
  function mount() {
    const host = document.getElementById('resAhead'); if (!host) return;
    const days = nextTradingDays(5);
    if (!st.days || !st.days.every((d) => days.includes(d))) st.days = days.slice(1, 3); // the day after tomorrow and the next
    host.innerHTML = '<div class="ra"><div class="ra-h"><div><h2>🎯 Results ahead <span class="pill mine">Admin only</span></h2><small>Results in the next few days, ranked by how things look going in.</small></div><div class="ra-hb"><button class="ra-x" data-rainfo="1">ⓘ How it works</button><button class="ra-x" data-ramode="1">Show all</button></div></div>' +
      '<div class="ra-ctl"></div><div class="ra-infobox"></div><div class="ra-list"><div class="ra-empty">Loading…</div></div><div class="ra-tkbox"></div></div>';
    box = host.firstChild;
    host.addEventListener('click', (e) => {
      const d = e.target.closest('[data-rad]');
      if (d) { limit = 10; const v = d.dataset.rad; st.days = st.days.includes(v) ? st.days.filter((x) => x !== v) : st.days.concat(v); if (!st.days.length) st.days = [v]; paint(); load(); return; }
      if (e.target.closest('[data-ramorelist]')) { limit += 10; paint(); return; }
      if (e.target.closest('[data-ramode]')) { mode = mode === 'cards' ? 'list' : 'cards'; limit = 10; paint(); if (mode === 'cards') box.scrollIntoView({ block: 'nearest' }); return; }
      if (e.target.closest('[data-rainfo]')) { info = !info; paint(); return; }
      const nv = e.target.closest('[data-ranav]'); if (nv) { const tr = box.querySelector('.ra-track'); if (tr) tr.scrollBy({ left: Number(nv.dataset.ranav) * (tr.clientWidth - 40), behavior: 'smooth' }); return; }
      const tk = e.target.closest('[data-ratk]'); if (tk) { ticket = ticket === tk.dataset.ratk ? null : tk.dataset.ratk; paint(); if (ticket && mode === 'cards') { const b2 = box.querySelector('.ra-tkbox'); b2 && b2.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } return; }
      if (e.target.closest('[data-racancel]')) { ticket = null; paint(); return; }
      const pl = e.target.closest('[data-raplace]'); if (pl) { const r = (data && data.rows || []).find((x) => x.symbol === pl.dataset.raplace); if (r) place(r); return; }
      if (e.target.closest('[data-rapos]')) { st.posOnly = !st.posOnly; save(); paint(); loadNews(); return; }
      const m = e.target.closest('[data-ramore]'); if (m) { open[m.dataset.ramore] = !open[m.dataset.ramore]; paint(); return; }
      const o = e.target.closest('[data-raopen]');
      if (o) { const ev = (window.events || events || []).find((x) => x.id === o.dataset.raopen); if (ev) detail(ev); return; }
    });
    host.addEventListener('input', (e) => {
      if (!e.target.matches('[data-raamt]')) return;
      // Digits only (commas and spaces are fine to type); the box itself is never redrawn while typing.
      st.amount = Math.max(0, Number(String(e.target.value).replace(/[^\d.]/g, '')) || 0); save();
      const r = (data && data.rows || []).find((x) => x.symbol === ticket); if (!r) return;
      const calc = e.target.closest('.ra-tk').querySelector('.ra-tk-calc'); if (calc) calc.innerHTML = calcHtml(r);
    });
    host.addEventListener('keydown', (e) => { if (e.target.matches('[data-raamt]') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    host.addEventListener('change', (e) => { if (e.target.matches('[data-ramcap]')) { limit = 10; st.mcap = Number(e.target.value) || 1000; save(); load(); } });
    paint(); loadHeld().then(paint); load();
  }
  window.mpResultsAhead = { mount, repaint: () => paint() };
})();
