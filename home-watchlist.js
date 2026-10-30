/* Home watchlist widget (#mpWatch): the signed-in user's watchlist (watchlist table, the same list
   as the ☆ button on the stock card, the My Watchlist window and Stock Analysis' ☆ Watch) with live
   prices, day change, 1-month trend, today's and 52-week range, trend vs the 50/200-day averages,
   volume spikes, any active Stock Signals trade and results or dividends due in the next 7 days.
   Data: watchlist_details() (supabase/watchlist-details.sql).
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
  let loading = false, lastAt = 0, data = [], sortBy = (() => { try { return localStorage.getItem('mp-watch-sort') || 'added'; } catch (_) { return 'added'; } })();
  const crore = (v) => v === null ? '—' : v >= 1e5 ? '₹' + (v / 1e5).toFixed(2) + ' L Cr' : '₹' + v.toLocaleString('en-IN') + ' Cr';
  const ret1m = (x) => { const sp = (x.spark || []).map(Number).filter((v) => v > 0); return sp.length > 1 ? (sp[sp.length - 1] / sp[0] - 1) * 100 : null; };
  function spark(vals) {
    vals = (vals || []).map(Number).filter((v) => v > 0);
    if (vals.length < 2) return '<span class="mpw-nospark">—</span>';
    const W = 96, H = 30, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1, up = vals[vals.length - 1] >= vals[0];
    const pts = vals.map((v, i) => (i / (vals.length - 1) * W).toFixed(1) + ',' + (3 + (hi - v) / span * (H - 6)).toFixed(1));
    return `<svg class="mpw-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="var(${up ? '--positive' : '--negative'})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function range(lo, hi, p, left, right) {
    if (lo === null || hi === null || p === null || hi <= lo) return '<span class="mpw-nospark">—</span>';
    const at = Math.max(0, Math.min(100, (p - lo) / (hi - lo) * 100));
    return `<div class="mpw-range"><div class="mpw-bar"><i style="left:${at.toFixed(0)}%"></i></div><div class="mpw-rl"><span>${left}</span><span>${right}</span></div></div>`;
  }
  function trendTxt(x) {
    const p = num(x.price), a = num(x.dma50), b = num(x.dma200);
    if (p === null || a === null || b === null) return '';
    if (p > a && p > b) return '<span class="mpw-t up">Above 50 & 200 DMA</span>';
    if (p < a && p < b) return '<span class="mpw-t down">Below 50 & 200 DMA</span>';
    return p > a ? '<span class="mpw-t">Above 50 DMA, below 200</span>' : '<span class="mpw-t">Below 50 DMA, above 200</span>';
  }
  // Carousel: native horizontal scroll with snap (swipe on touch, arrows / shift-wheel on desktop),
  // plus dots that show which page of cards is in view.
  function setupCarousel() {
    const tr = $('mpwTrack'), dots = $('mpwDots'); if (!tr) return;
    // One dot per card position (a card's width plus the gap).
    const step = () => { const c = tr.children; return c.length > 1 ? c[1].offsetLeft - c[0].offsetLeft : tr.clientWidth; };
    const sync = () => {
      const st = step(), n = Math.max(1, Math.round((tr.scrollWidth - tr.clientWidth) / st) + 1), at = Math.round(tr.scrollLeft / st);
      dots.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<button type="button" data-mpw-page="${i}" class="${i === at ? 'on' : ''}" aria-label="Page ${i + 1}"></button>`).join('') : '';
      const car = tr.parentElement;
      car.classList.toggle('at-start', tr.scrollLeft < 4);
      car.classList.toggle('at-end', tr.scrollLeft > tr.scrollWidth - tr.clientWidth - 4);
    };
    let t; tr.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(sync, 60); }, { passive: true });
    tr.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); move(e.key === 'ArrowRight' ? 1 : -1); } });
    sync();
  }
  function move(dir) { const tr = $('mpwTrack'); if (tr) tr.scrollBy({ left: dir * tr.clientWidth * 0.9, behavior: 'smooth' }); }
  function draw() {
    const host = $('mpWatch'); if (!host || !data.length) return;
    const keep = $('mpwTrack') ? $('mpwTrack').scrollLeft : 0; // the minute refresh keeps your place
    const list = data.slice().sort((A, B) => {
      if (sortBy === 'today') return (num(B.q.change_percent) ?? -1e9) - (num(A.q.change_percent) ?? -1e9);
      if (sortBy === 'month') return (ret1m(B.q) ?? -1e9) - (ret1m(A.q) ?? -1e9);
      if (sortBy === 'name') return A.s.localeCompare(B.s);
      return A.i - B.i;
    });
    const chg = list.map((x) => num(x.q.change_percent)).filter((v) => v !== null);
    const ups = chg.filter((v) => v > 0).length, downs = chg.filter((v) => v < 0).length;
    const avg = chg.length ? chg.reduce((a, b) => a + b, 0) / chg.length : null;
    const best = list.filter((x) => num(x.q.change_percent) !== null).sort((A, B) => num(B.q.change_percent) - num(A.q.change_percent));
    const sigs = list.filter((x) => x.g).length, evs = list.filter((x) => x.e).length;
    const stat = (l, v, cls = '', opt) => `<div class="mpw-stat${opt ? ' mpw-opt' : ''}"><span>${l}</span><b class="${cls}">${v}</b></div>`;
    const rows = list.map(({ s, q: x, g, e }) => {
      const p = num(x.price), c = num(x.change_percent), ch = num(x.change), m = ret1m(x);
      const hi52 = num(x.high_52w), lo52 = num(x.low_52w);
      const fromHi = p !== null && hi52 ? (hi52 - p) / hi52 * 100 : null;
      const volR = num(x.volume) && num(x.avg_volume_3m) ? num(x.volume) / num(x.avg_volume_3m) : null;
      const badges = [];
      if (g) badges.push(`<a class="mpw-b ${g.side === 'BUY' ? 'up' : 'down'}" href="/stock-signals.html?sig=${encodeURIComponent(s + '|' + g.tf)}" title="${esc(g.setup || '')}">${g.side === 'BUY' ? '▲ Buy' : '▼ Sell'} signal</a>`);
      if (e) badges.push(`<a class="mpw-b ev" href="/events.html">${e.kind === 'results' ? 'Results' : 'Ex-dividend'} ${esc(dayTxt(e.event_date))}</a>`);
      if (volR !== null && volR >= 1.5) badges.push(`<span class="mpw-b vol" title="Today's volume vs the 3-month average">${volR.toFixed(1)}× volume</span>`);
      if (fromHi !== null && fromHi <= 2) badges.push('<span class="mpw-b hi">Near 52-week high</span>');
      return `<article class="mpw-card ${c === null ? '' : c >= 0 ? 'is-up' : 'is-down'}">
        <div class="mpw-ctop"><div class="mpw-id"><b data-sym="${esc(s)}">${esc(s)}</b><small data-sym="${esc(s)}">${esc(x.name || '')}</small></div>
          <div class="mpw-px"><b>${inr(p)}</b><span class="mpx-pill ${tone(c)}">${pct(c)}</span></div></div>
        <small class="mpw-sec">${esc(x.sector || '')}${num(x.market_cap_cr) ? ' · ' + crore(num(x.market_cap_cr)) : ''}${num(x.pe) ? ' · P/E ' + num(x.pe) : ''}</small>
        <div class="mpw-trend">${spark(x.spark)}<small class="${tone(m)}">${m === null ? 'No 1-month chart' : '1 month ' + pct(m)}</small></div>
        <div class="mpw-col"><small class="mpw-k">Today${ch === null ? '' : ` · <span class="${tone(ch)}">${(ch >= 0 ? '+' : '−') + '₹' + Math.abs(ch).toFixed(2)}</span>`}</small>${range(num(x.low), num(x.high), p, inr(num(x.low)), inr(num(x.high)))}</div>
        <div class="mpw-col"><small class="mpw-k">52 weeks${fromHi !== null ? ' · ' + (fromHi < 0.5 ? 'at the high' : fromHi.toFixed(1) + '% below high') : ''}</small>${range(lo52, hi52, p, inr(lo52), inr(hi52))}</div>
        <div class="mpw-foot">${trendTxt(x) || '<span></span>'}${badges.length ? `<div class="mpw-badges">${badges.join('')}</div>` : ''}</div>
        <a class="mpw-open" href="/stock-analysis.html?symbol=${encodeURIComponent(s)}">Open analysis →</a>
      </article>`;
    }).join('');
    host.innerHTML = head(`<div class="mp-seg mpw-sort" role="group" aria-label="Sort watchlist">${[['added', 'Added'], ['today', 'Today'], ['month', '1 month'], ['name', 'A–Z']].map(([k, l]) => `<button type="button" data-mpw-sort="${k}" class="${sortBy === k ? 'on' : ''}">${l}</button>`).join('')}</div><button type="button" class="mp-link" data-mpw-manage>Manage →</button>`) +
      `<div class="mpw-stats">${stat('Stocks', list.length, '', true)}${stat('Average today', pct(avg), tone(avg))}${stat('Up / down', `<span class="mp-up-t">${ups}</span> / <span class="mp-down-t">${downs}</span>`)}${best.length ? stat('Best today', `${esc(best[0].s)} ${pct(num(best[0].q.change_percent))}`, tone(num(best[0].q.change_percent))) : ''}${best.length > 1 ? stat('Worst today', `${esc(best[best.length - 1].s)} ${pct(num(best[best.length - 1].q.change_percent))}`, tone(num(best[best.length - 1].q.change_percent))) : ''}${stat('Signals · events', `${sigs} · ${evs}`, '', true)}</div>` +
      `<div class="mpw-car"><button type="button" class="mpw-nav prev" data-mpw-nav="-1" aria-label="Previous stocks">‹</button>` +
      `<div class="mpw-track" id="mpwTrack" tabindex="0" aria-label="Watchlist stocks, swipe or use the arrows">${rows}</div>` +
      `<button type="button" class="mpw-nav next" data-mpw-nav="1" aria-label="Next stocks">›</button></div><div class="mpw-dots" id="mpwDots"></div>`;
    if (keep && $('mpwTrack')) $('mpwTrack').scrollLeft = keep;
    setupCarousel();
  }

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
        data = [];
        host.innerHTML = head() + `<div class="mpw-empty">Your watchlist is empty. Search a stock above and tap <b>☆ Add to Watchlist</b> on its card, or <b>☆ Watch</b> on Stock Analysis.</div>`;
        return;
      }
      const [quotes, feed, events] = await Promise.all([
        sb.rpc('watchlist_details', { p_symbols: syms }).then((r) => r.data || []).catch(() => []),
        sb.rpc('stock_signals_feed').then((r) => (r.data && r.data.signals) || []).catch(() => []),
        sb.from('market_events').select('symbol,event_date,kind,amount,id').in('symbol', syms).in('kind', ['results', 'dividend'])
          .gte('event_date', istDay()).lte('event_date', istDay(7)).order('event_date').then((r) => r.data || []).catch(() => []),
      ]);
      const q = Object.fromEntries((Array.isArray(quotes) ? quotes : []).map((x) => [String(x.symbol).toUpperCase(), x]));
      const sig = {}; for (const g of feed) { const k = String(g.symbol).toUpperCase(); if (syms.includes(k) && (!sig[k] || g.tf === 'swing')) sig[k] = g; }
      const ev = {}; for (const e of events) { const k = String(e.symbol).toUpperCase(); if (!ev[k] && (e.kind === 'results' || /-ex$/.test(e.id || ''))) ev[k] = e; }
      data = syms.map((s, i) => ({ s, i, q: q[s] || {}, g: sig[s], e: ev[s] }));
      draw();
      lastAt = Date.now();
    } catch (e) {
      console.warn('[Home watchlist]', e);
      host.innerHTML = head() + '<div class="mpw-empty">Your watchlist could not be loaded right now.</div>';
    } finally { loading = false; }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-mpw-login]')) { try { openAuthModal('login'); } catch (_) {} }
    if (e.target.closest('[data-mpw-manage]')) { try { openWatchlistModal(); } catch (_) {} }
    const nv = e.target.closest('[data-mpw-nav]'); if (nv) move(+nv.dataset.mpwNav);
    const pg = e.target.closest('[data-mpw-page]');
    if (pg) { const tr = $('mpwTrack'); if (tr && tr.children.length) tr.scrollTo({ left: tr.children[+pg.dataset.mpwPage].offsetLeft - tr.children[0].offsetLeft, behavior: 'smooth' }); }
    const sb = e.target.closest('[data-mpw-sort]');
    if (sb) { sortBy = sb.dataset.mpwSort; try { localStorage.setItem('mp-watch-sort', sortBy); } catch (_) {} draw(); const tr = $('mpwTrack'); if (tr) tr.scrollLeft = 0; }
  });
  // Prices move during the session: refresh every minute while Home is on screen.
  setInterval(() => {
    const host = $('mpWatch');
    if (!document.hidden && host && host.offsetParent && user() && marketOpen() && Date.now() - lastAt > 55e3) refresh();
  }, 15e3);
  window.mpHomeWatch = { refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(refresh, 300)); else setTimeout(refresh, 300);
})();
