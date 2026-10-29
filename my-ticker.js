/* "My stocks" ticker on Home: a second row in the sticky ticker bar with the stocks the user holds
   in Portfolio plus any stocks they add from My Profile. The list lives in public.user_ticker
   (one row per user: symbols[], show_portfolio). Prices come from the stock_quotes_for RPC.
   Needs the page globals supabaseClient, mpSearchStocks and STOCK_SEARCH_URL, plus /portfolio-core.js. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s) => String(s || '').trim().toUpperCase();
  const validSymbol = (s) => /^[A-Z0-9][A-Z0-9&_.-]{0,24}$/.test(s);
  const MAX = 50;
  if (typeof supabaseClient === 'undefined') return;
  const sb = supabaseClient;

  let user = null, prefs = { symbols: [], show_portfolio: true }, held = [], timer = null;

  /* ───────── Data ───────── */
  async function loadPrefs() {
    const { data, error } = await sb.from('user_ticker').select('symbols,show_portfolio').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    prefs = { symbols: (data?.symbols || []).map(clean).filter(validSymbol), show_portfolio: data ? data.show_portfolio !== false : true };
  }
  async function savePrefs() {
    const { error } = await sb.from('user_ticker').upsert({ user_id: user.id, symbols: prefs.symbols, show_portfolio: prefs.show_portfolio, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  /* ───────── Ticker row ───────── */
  const row = $('myTicker'), track = $('myTickerTrack'), view = row && row.querySelector('.myt-view');
  const fmt = (v) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function item(sym, q, isHeld) {
    const price = Number(q?.price), pct = Number(q?.change_percent), chg = Number(q?.change);
    const up = !(pct < 0);
    return '<a class="ticker-item" href="/stock-analysis.html?symbol=' + encodeURIComponent(sym) + '" title="' + esc((q?.name || sym) + (isHeld ? ' · in your portfolio' : ' · added in Profile')) + '">' +
      '<span class="ticker-symbol">' + (isHeld ? '<i class="myt-dot" aria-hidden="true"></i>' : '') + esc(sym) + '</span>' +
      (price > 0
        ? '<span class="ticker-price">₹' + fmt(price) + '</span><span class="ticker-change ' + (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + ' ' + (Number.isFinite(chg) ? Math.abs(chg).toFixed(2) : '') + ' (' + Math.abs(pct || 0).toFixed(2) + '%)</span>'
        : '<span class="ticker-price">—</span>') +
      '</a>';
  }

  function setRow(html, animate) {
    track.classList.remove('myt-scroll');
    track.style.animationDuration = '';
    track.innerHTML = html;
    // Scroll only when the stocks don't fit; the doubled list makes the -50% loop seamless.
    if (animate && track.scrollWidth > view.clientWidth + 4) {
      const n = track.children.length;
      track.innerHTML = html + html;
      track.classList.add('myt-scroll');
      track.style.animationDuration = Math.max(n * 4, 16) + 's';
    }
  }

  async function refresh() {
    if (!row) return;
    if (!user) { row.hidden = true; return; }
    try {
      const heldList = prefs.show_portfolio && window.mpPortfolio?.heldSymbols ? await window.mpPortfolio.heldSymbols(sb, user).catch(() => []) : [];
      held = heldList.slice().sort();
      const extra = prefs.symbols.filter((s) => !held.includes(s));
      const all = held.concat(extra);
      row.hidden = false;
      if (!all.length) {
        setRow('<button type="button" class="myt-empty" data-myt-edit>Add stocks to your ticker in My Profile →</button>', false);
        return;
      }
      const { data } = await sb.rpc('stock_quotes_for', { p_symbols: all });
      const q = Object.fromEntries((Array.isArray(data) ? data : []).map((x) => [clean(x.symbol), x]));
      setRow(all.map((s) => item(s, q[s], held.includes(s))).join(''), true);
    } catch (e) {
      console.warn('[MyTicker]', e);
    }
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  }

  function openProfile() { if (typeof openProfileModal === 'function') openProfileModal(); }
  row?.addEventListener('click', (e) => { if (e.target.closest('[data-myt-edit]')) { e.preventDefault(); openProfile(); } });

  /* ───────── My Profile section ───────── */
  const chips = $('mytChips'), input = $('mytSearch'), results = $('mytResults'), status = $('mytStatus'), toggle = $('mytPortfolio');
  const HINT = 'Shown in the “My stocks” row of the ticker on Home. Changes save straight away.';
  let found = [], idx = -1, searchTimer = null, busy = false;

  function say(msg, kind) { if (!status) return; status.textContent = msg || HINT; status.className = 'hint myt-status' + (kind ? ' ' + kind : ''); }

  function drawChips() {
    if (!chips) return;
    if (toggle) toggle.checked = prefs.show_portfolio;
    chips.innerHTML = prefs.symbols.length
      ? prefs.symbols.map((s) => '<span class="myt-chip">' + esc(s) + '<button type="button" data-myt-remove="' + esc(s) + '" aria-label="Remove ' + esc(s) + '">×</button></span>').join('')
      : '<span class="myt-none">No extra stocks added yet.</span>';
  }

  async function change(fn, okMsg) {
    if (!user || busy) return;
    const before = { symbols: prefs.symbols.slice(), show_portfolio: prefs.show_portfolio };
    fn();
    drawChips();
    busy = true; say('Saving…');
    try { await savePrefs(); say(okMsg, 'success'); refresh(); }
    catch (e) { prefs = before; drawChips(); say(e.message || 'Could not save your ticker.', 'error'); }
    finally { busy = false; }
  }

  function add(sym) {
    sym = clean(sym);
    closeResults(); input.value = '';
    if (!validSymbol(sym)) return say('That doesn’t look like an NSE symbol.', 'error');
    if (prefs.symbols.includes(sym)) return say(sym + ' is already in your ticker.');
    if (prefs.symbols.length >= MAX) return say('You can add up to ' + MAX + ' stocks.', 'error');
    change(() => { prefs.symbols = prefs.symbols.concat(sym); }, sym + ' added to your ticker.');
  }

  function closeResults() { if (results) { results.hidden = true; results.innerHTML = ''; } found = []; idx = -1; }
  function drawResults() {
    results.innerHTML = found.length
      ? found.map((s, i) => '<button type="button" data-myt-add="' + esc(s.symbol) + '"' + (i === idx ? ' class="on"' : '') + '><b>' + esc(s.symbol) + '</b><small>' + esc(s.company_name || s.name || '') + '</small></button>').join('')
      : '<div class="myt-none">No matching stocks</div>';
    results.hidden = false;
  }

  input?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2 || typeof mpSearchStocks !== 'function') { closeResults(); return; }
    searchTimer = setTimeout(async () => {
      try {
        const list = await mpSearchStocks(q, { url: typeof STOCK_SEARCH_URL === 'function' ? STOCK_SEARCH_URL() : undefined, client: sb });
        if (input.value.trim() !== q) return;
        found = (list || []).filter((s) => s && s.symbol).slice(0, 6); idx = -1; drawResults();
      } catch (e) { found = []; drawResults(); }
    }, 220);
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && found.length) { e.preventDefault(); idx = (idx + 1) % found.length; drawResults(); }
    else if (e.key === 'ArrowUp' && found.length) { e.preventDefault(); idx = (idx - 1 + found.length) % found.length; drawResults(); }
    else if (e.key === 'Enter') { e.preventDefault(); const pick = found[idx] || found[0]; if (pick) add(pick.symbol); else if (input.value.trim()) add(input.value); }
    else if (e.key === 'Escape' && !results.hidden) { e.stopPropagation(); closeResults(); }
  });
  results?.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
  results?.addEventListener('click', (e) => { const b = e.target.closest('[data-myt-add]'); if (b) add(b.dataset.mytAdd); });
  chips?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-myt-remove]'); if (!b) return;
    const sym = b.dataset.mytRemove;
    change(() => { prefs.symbols = prefs.symbols.filter((s) => s !== sym); }, sym + ' removed.');
  });
  toggle?.addEventListener('change', () => {
    const on = toggle.checked;
    change(() => { prefs.show_portfolio = on; }, on ? 'Portfolio stocks are shown in your ticker.' : 'Portfolio stocks are hidden from your ticker.');
  });
  document.addEventListener('click', (e) => { if (results && !results.hidden && !e.target.closest('.myt-add')) closeResults(); });

  // Reload the list whenever the profile opens, so it matches what is saved.
  const modal = $('profileModal');
  if (modal && window.MutationObserver) {
    new MutationObserver(() => {
      if (modal.classList.contains('open') && user) { say(''); closeResults(); loadPrefs().then(drawChips).catch(() => {}); }
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  /* ───────── Auth ───────── */
  async function setUser(u) {
    const same = u && user && u.id === user.id;
    user = u || null;
    if (!user) { clearInterval(timer); prefs = { symbols: [], show_portfolio: true }; drawChips(); refresh(); return; }
    if (same) return;
    try { await loadPrefs(); } catch (e) { console.warn('[MyTicker] prefs', e); }
    drawChips(); say('');
    // /?profile=1 (from the account menu on other pages) opens My Profile.
    if (new URLSearchParams(location.search).get('profile') === '1') {
      history.replaceState(null, '', location.pathname + location.hash);
      setTimeout(openProfile, 300);
    }
    await refresh();
    schedule();
  }
  sb.auth.getSession().then(({ data }) => setUser(data?.session?.user || null));
  sb.auth.onAuthStateChange((_e, session) => setUser(session?.user || null));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && user) refresh(); });
})();
