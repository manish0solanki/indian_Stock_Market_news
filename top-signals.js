/* Top signals on Home: the few strongest stock signals that can still be traded right now, from
   stock_signals_top() in Supabase (tradable = price between stop and target 1 and not chased past entry;
   ranked by score plus volume, entry-zone, reward-left, market-direction, stop-size and size bonuses).
   The Signals page needs a login, so signed-out visitors see a short teaser instead of the picks.
   Refreshes every 2 minutes while Home is visible (signals are rebuilt every 5). */
(function () {
  const host = document.getElementById('mpTopSignals');
  if (!host || typeof supabaseClient === 'undefined') return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null; };
  const price = (v) => { const n = num(v); return n === null ? '—' : '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: n < 100 ? 2 : 1, maximumFractionDigits: n < 100 ? 2 : 1 }); };
  const pct = (v) => { const n = num(v); return n === null ? '' : (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2) + '%'; };
  const hhmm = (iso) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '';
  const homeVisible = () => !document.hidden && !document.getElementById('homeDashboard')?.classList.contains('hidden');
  const signalUrl = (p) => '/stock-signals.html?sig=' + encodeURIComponent(p.symbol + '|' + p.tf);

  const head = (sub) => `<div class="mp-card-head"><div><h2 class="mp-h2"><span aria-hidden="true">🎯</span>Top Signals</h2>${sub ? `<div class="ts-sub">${sub}</div>` : ''}</div><a class="mp-link ts-all" href="/stock-signals.html">All signals →</a></div>`;

  function card(p) {
    const buy = p.side === 'BUY';
    const why = (p.strengths || []).slice(0, 3).map((w) => `<span>${esc(w)}</span>`).join('');
    return `<a class="ts-card ${buy ? 'buy' : 'sell'}" href="${signalUrl(p)}">
      <div class="ts-top"><div class="ts-id"><b>${esc(p.symbol)}</b><small>${esc(p.name)}</small></div>
        <div class="ts-px"><b>${price(p.ltp)}</b><small class="${num(p.change_percent) >= 0 ? 'up' : 'down'}">${pct(p.change_percent)}</small></div></div>
      <div class="ts-tags"><span class="ts-side ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span><span>${p.tf === 'intraday' ? 'Intraday' : 'Swing'}</span><span>${esc(p.setup)}</span></div>
      <div class="ts-lv"><div><span>Entry</span><b>${price(p.entry)}</b></div><div><span>Stop</span><b class="down">${price(p.stop)}</b></div><div><span>Target 1</span><b class="up">${price(p.target1)}</b></div></div>
      <div class="ts-why">${why}</div>
      <div class="ts-foot"><span>Quality <b>${esc(p.quality)}</b></span><span>Risk <b>${num(p.risk_pct) === null ? '—' : num(p.risk_pct).toFixed(1) + '%'}</b></span><span class="ts-open">Details →</span></div>
    </a>`;
  }

  function render(d, signedIn) {
    host.hidden = false;
    const picks = Array.isArray(d?.picks) ? d.picks : [];
    const when = d?.generated_at ? 'Scanned ' + hhmm(d.generated_at) + ' IST' : '';
    if (!signedIn) {
      host.innerHTML = head('') + `<div class="ts-empty"><div><b>${picks.length ? `${picks.length} high-conviction setup${picks.length > 1 ? 's' : ''} right now` : 'The strongest setups of the day, in one place'}</b>
        <span>Sign in to see the best stock signals, still in their entry zone, with entry, stop and targets.</span></div><button type="button" class="mp-btn" id="tsLogin">Sign in</button></div>`;
      document.getElementById('tsLogin').onclick = () => document.getElementById('authButton')?.click();
      return;
    }
    if (!picks.length) {
      host.innerHTML = head(when) + `<div class="ts-empty"><div><b>No high-conviction setups right now</b>
        <span>${num(d?.total) ? `${d.total} signal${d.total > 1 ? 's are' : ' is'} active, but none is strong enough and still in its entry zone.` : 'The strategy is strict: setups appear when trend, momentum and volume line up.'} This updates every few minutes.</span></div>
        <a class="mp-btn" href="/stock-signals.html">View all signals</a></div>`;
      return;
    }
    host.innerHTML = head(`The ${picks.length === 1 ? 'strongest setup' : picks.length + ' strongest setups'} still in the entry zone, out of ${esc(d.total)} active · ${when}`) +
      `<div class="ts-grid">${picks.map(card).join('')}</div>` +
      '<div class="ts-note">Ranked by signal score, volume, entry position, reward left and market direction. For paper trading and learning; not investment advice.</div>';
  }

  let at = 0, busy = false;
  async function load(force) {
    if (busy || (!force && (!homeVisible() || Date.now() - at < 110e3))) return;
    busy = true;
    try {
      const [{ data: sess }, { data, error }] = await Promise.all([supabaseClient.auth.getSession(), supabaseClient.rpc('stock_signals_top')]);
      if (error) throw error;
      render(data, !!sess?.session?.user);
      at = Date.now();
    } catch (e) {
      console.warn('[Top signals]', e);
    } finally { busy = false; }
  }
  load(true);
  setInterval(() => load(false), 30e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
  supabaseClient.auth.onAuthStateChange(() => setTimeout(() => load(true), 300));
})();
