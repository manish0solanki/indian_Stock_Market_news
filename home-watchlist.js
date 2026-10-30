/* Home watchlist widget (#mpWatch): the signed-in user's watchlist (watchlist table, the same list
   as the ☆ button on the stock card and the My Watchlist window) with live prices, day change,
   any active Stock Signals trade and results or dividends due in the next 7 days.
   Uses index.html's supabaseClient, currentUser, openAuthModal and openWatchlistModal.
   index.html calls window.mpHomeWatch.refresh() after sign-in/out and watchlist changes. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const inr = (v) => v === null ? '—' : '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v) => v === null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
  const tone = (v) => v === null ? '' : v >= 0 ? 'mp-up-t' : 'mp-down-t';
  const user = () => { try { return currentUser || null; } catch (_) { return null; } };
  const client = () => { try { return supabaseClient; } catch (_) { return null; } };
  const istDay = (d = 0) => new Date(Date.now() + 330 * 60e3 + d * 864e5).toISOString().slice(0, 10);
  const dayTxt = (iso) => { const n = Math.round((Date.parse(iso) - Date.parse(istDay())) / 864e5); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };
  const marketOpen = () => { const t = new Date(Date.now() + 330 * 60e3), d = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes(); return d > 0 && d < 6 && m >= 555 && m <= 935; };
  let loading = false, lastAt = 0;

  function head(right) {
    return `<div class="mp-card-head"><h2 class="mp-h2"><span class="mp-h-ico">★</span>My Watchlist</h2>${right || ''}</div>`;
  }
  async function refresh() {
    const host = $('mpWatch'), sb = client();
    if (!host || !sb || loading) return;
    const u = user();
    host.hidden = false;
    if (!u) {
      host.innerHTML = head() + `<div class="mpw-empty">Keep an eye on the stocks you care about: prices, signals and upcoming results in one place. <button type="button" class="mp-link" data-mpw-login>Log in to start a watchlist →</button></div>`;
      return;
    }
    loading = true;
    try {
      const { data: rows, error } = await sb.from('watchlist').select('symbol,created_at').eq('user_id', u.id).order('created_at', { ascending: true });
      if (error) throw error;
      const syms = [...new Set((rows || []).map((r) => String(r.symbol || '').trim().toUpperCase()).filter(Boolean))];
      if (!syms.length) {
        host.innerHTML = head() + `<div class="mpw-empty">Your watchlist is empty. Search a stock above and tap <b>☆ Add to Watchlist</b> on its card.</div>`;
        return;
      }
      const [quotes, feed, events] = await Promise.all([
        sb.rpc('stock_quotes_for', { p_symbols: syms }).then((r) => r.data || []).catch(() => []),
        sb.rpc('stock_signals_feed').then((r) => (r.data && r.data.signals) || []).catch(() => []),
        sb.from('market_events').select('symbol,event_date,kind,amount,id').in('symbol', syms).in('kind', ['results', 'dividend'])
          .gte('event_date', istDay()).lte('event_date', istDay(7)).order('event_date').then((r) => r.data || []).catch(() => []),
      ]);
      const q = Object.fromEntries((Array.isArray(quotes) ? quotes : []).map((x) => [String(x.symbol).toUpperCase(), x]));
      const sig = {}; for (const s of feed) { const k = String(s.symbol).toUpperCase(); if (syms.includes(k) && (!sig[k] || s.tf === 'swing')) sig[k] = s; }
      const ev = {}; for (const e of events) { const k = String(e.symbol).toUpperCase(); if (!ev[k] && (e.kind === 'results' || /-ex$/.test(e.id || ''))) ev[k] = e; }
      const list = syms.map((s) => ({ s, q: q[s] || {} }));
      const ups = list.filter((x) => num(x.q.change_percent) > 0).length, downs = list.filter((x) => num(x.q.change_percent) < 0).length;
      const rowsHtml = list.map(({ s, q: x }) => {
        const p = num(x.price), c = num(x.change_percent), g = sig[s], e = ev[s];
        const badges = [];
        if (g) badges.push(`<a class="mpw-b ${g.side === 'BUY' ? 'up' : 'down'}" href="/stock-signals.html?sig=${encodeURIComponent(s + '|' + g.tf)}" title="${esc(g.setup || '')}">${g.side === 'BUY' ? '▲ Buy' : '▼ Sell'} signal</a>`);
        if (e) badges.push(`<a class="mpw-b ev" href="/events.html" title="${e.kind === 'results' ? 'Results' : 'Dividend ex-date'}">${e.kind === 'results' ? 'Results' : 'Ex-dividend'} ${esc(dayTxt(e.event_date))}</a>`);
        return `<div class="mpw-row"><div class="mpw-id"><b data-sym="${esc(s)}">${esc(s)}</b><small data-sym="${esc(s)}">${esc(x.name || '')}</small>${badges.length ? `<div class="mpw-badges">${badges.join('')}</div>` : ''}</div>
          <div class="mpw-px"><b>${inr(p)}</b><span class="mpx-pill ${tone(c)}">${pct(c)}</span></div></div>`;
      }).join('');
      host.innerHTML = head(`<span class="mp-muted">${list.length} stock${list.length === 1 ? '' : 's'} · <span class="mp-up-t">${ups} up</span> · <span class="mp-down-t">${downs} down</span></span><button type="button" class="mp-link" data-mpw-manage>Manage →</button>`) +
        `<div class="mpw-list">${rowsHtml}</div>`;
      lastAt = Date.now();
    } catch (e) {
      console.warn('[Home watchlist]', e);
      host.innerHTML = head() + '<div class="mpw-empty">Your watchlist could not be loaded right now.</div>';
    } finally { loading = false; }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-mpw-login]')) { try { openAuthModal('login'); } catch (_) {} }
    if (e.target.closest('[data-mpw-manage]')) { try { openWatchlistModal(); } catch (_) {} }
  });
  // Prices move during the session: refresh every minute while Home is on screen.
  setInterval(() => {
    const host = $('mpWatch');
    if (!document.hidden && host && host.offsetParent && user() && marketOpen() && Date.now() - lastAt > 55e3) refresh();
  }, 15e3);
  window.mpHomeWatch = { refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(refresh, 300)); else setTimeout(refresh, 300);
})();
