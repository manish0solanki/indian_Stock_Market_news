/* "My stocks" ticker: the stocks the user holds in Portfolio (minus any they hide) plus stocks they
   add on /my-ticker.html. Saved per user in public.user_ticker (symbols[], show_portfolio, hidden[]).
   Prices come from the stock_quotes_for RPC. Needs /portfolio-core.js for the held stocks.

   window.mpMyTicker: load / save / build (shared with my-ticker.html) and draw (scrolling row).
   On Home it also fills the #myTicker row in the sticky ticker bar, using the page's supabaseClient. */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s) => String(s || '').trim().toUpperCase();
  const validSymbol = (s) => /^[A-Z0-9][A-Z0-9&_.-]{0,24}$/.test(s);
  const MAX = 50;
  const fmt = (v) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  async function load(sb, user) {
    const { data, error } = await sb.from('user_ticker').select('symbols,show_portfolio,hidden').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return {
      symbols: (data?.symbols || []).map(clean).filter(validSymbol),
      show_portfolio: data ? data.show_portfolio !== false : true,
      hidden: (data?.hidden || []).map(clean).filter(validSymbol),
    };
  }

  async function save(sb, user, prefs) {
    const { error } = await sb.from('user_ticker').upsert({
      user_id: user.id, symbols: prefs.symbols.slice(0, MAX), show_portfolio: !!prefs.show_portfolio,
      hidden: prefs.hidden || [], updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  // -> { held: every held symbol, items: [{ symbol, held, quote }] in ticker order }
  async function build(sb, user, prefs) {
    const held = window.mpPortfolio?.heldSymbols ? (await window.mpPortfolio.heldSymbols(sb, user).catch(() => [])).slice().sort() : [];
    const shownHeld = prefs.show_portfolio ? held.filter((s) => !prefs.hidden.includes(s)) : [];
    const added = prefs.symbols.filter((s) => !shownHeld.includes(s));
    const all = shownHeld.concat(added), want = all.concat(held.filter((s) => !all.includes(s)));
    let quotes = {};
    if (want.length) {
      const { data } = await sb.rpc('stock_quotes_for', { p_symbols: want });
      quotes = Object.fromEntries((Array.isArray(data) ? data : []).map((x) => [clean(x.symbol), x]));
    }
    return {
      held, quotes,
      items: shownHeld.map((s) => ({ symbol: s, held: true, quote: quotes[s] })).concat(added.map((s) => ({ symbol: s, held: false, quote: quotes[s] }))),
    };
  }

  function itemHtml(it) {
    const q = it.quote || {}, price = Number(q.price), pct = Number(q.change_percent), chg = Number(q.change);
    const up = !(pct < 0);
    return '<a class="ticker-item" href="/stock-analysis.html?symbol=' + encodeURIComponent(it.symbol) + '" title="' + esc((q.name || it.symbol) + (it.held ? ' · in your portfolio' : ' · added to your ticker')) + '">' +
      '<span class="ticker-symbol">' + (it.held ? '<i class="myt-dot" aria-hidden="true"></i>' : '') + esc(it.symbol) + '</span>' +
      (price > 0
        ? '<span class="ticker-price">₹' + fmt(price) + '</span><span class="ticker-change ' + (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + ' ' + (Number.isFinite(chg) ? Math.abs(chg).toFixed(2) : '') + ' (' + Math.abs(pct || 0).toFixed(2) + '%)</span>'
        : '<span class="ticker-price">—</span>') +
      '</a>';
  }

  // Always scrolling: the list is repeated until one pass is wider than the row, then doubled so
  // the -50% keyframe loops seamlessly. Speed is constant (~45px/s) whatever the number of stocks.
  function draw(track, view, items, emptyHtml) {
    track.classList.remove('myt-scroll');
    track.style.animationDuration = '';
    if (!items.length) { track.innerHTML = emptyHtml || ''; return; }
    const one = items.map(itemHtml).join('');
    track.innerHTML = one;
    const w = track.scrollWidth || 1;
    const reps = Math.max(1, Math.ceil((view.clientWidth || w) / w));
    const pass = one.repeat(reps);
    track.innerHTML = pass + pass;
    track.classList.add('myt-scroll');
    track.style.animationDuration = Math.max(12, Math.round((w * reps) / 45)) + 's';
  }

  window.mpMyTicker = { load, save, build, draw, clean, validSymbol, MAX, esc };

  /* ───────── Home: the "My stocks" row in the ticker bar ───────── */
  const row = document.getElementById('myTicker');
  if (!row || typeof supabaseClient === 'undefined') return;
  const sb = supabaseClient, track = document.getElementById('myTickerTrack'), view = row.querySelector('.myt-view');
  const EMPTY = '<a class="myt-empty" href="/my-ticker.html">Set up your ticker: add stocks or show your portfolio →</a>';
  let user = null, items = [], timer = null;

  async function refresh() {
    if (!user) { row.hidden = true; return; }
    try {
      const prefs = await load(sb, user);
      items = (await build(sb, user, prefs)).items;
      row.hidden = false;
      draw(track, view, items, EMPTY);
    } catch (e) { console.warn('[MyTicker]', e); }
  }

  async function setUser(u) {
    if ((u && u.id) === (user && user.id)) return;
    user = u || null;
    clearInterval(timer);
    await refresh();
    if (user) timer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  }
  sb.auth.getSession().then(({ data }) => setUser(data?.session?.user || null));
  sb.auth.onAuthStateChange((_e, session) => setUser(session?.user || null));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && user) refresh(); });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (items.length) draw(track, view, items); }, 200); });
})();
